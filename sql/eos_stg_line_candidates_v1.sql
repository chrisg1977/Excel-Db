-- EOS staged line candidates foundation (v1, PAY-only pilot)
-- Purpose:
--   Build a strict provenance-first candidate layer for EOSZ PAY rows only.
--   ENTRY, FEE, SELL and PAY SUMMARY are intentionally excluded.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_stg_line_candidates_v1.sql

DROP VIEW IF EXISTS v_eos_stg_line_candidates_v1 CASCADE;

CREATE VIEW v_eos_stg_line_candidates_v1 AS
WITH base AS (
  SELECT
    c.*,
    CASE
      WHEN c.total_amount_candidate IS NOT NULL AND c.ex_vat_amount_candidate IS NOT NULL THEN (c.total_amount_candidate - c.ex_vat_amount_candidate)::numeric(14,2)
      ELSE NULL::numeric(14,2)
    END AS derived_vat_from_total_minus_ex_vat,
    CASE
      WHEN c.total_amount_candidate IS NOT NULL AND c.vat_amount_candidate IS NOT NULL THEN (c.total_amount_candidate - c.vat_amount_candidate)::numeric(14,2)
      ELSE NULL::numeric(14,2)
    END AS derived_ex_vat_from_total_minus_vat,
    CASE
      WHEN c.ex_vat_amount_candidate IS NOT NULL AND c.vat_amount_candidate IS NOT NULL THEN (c.ex_vat_amount_candidate + c.vat_amount_candidate)::numeric(14,2)
      ELSE NULL::numeric(14,2)
    END AS derived_total_from_components
  FROM v_eosz_pay_fee_candidates_v1 c
  WHERE c.branch_code = 'EOSZ'
    AND c.source_family = 'PAY'
),
normalized AS (
  SELECT
    b.raw_line_id AS candidate_id,
    b.branch_code,
    b.source_table_name,
    b.source_family,
    b.source_priority_rank AS source_priority,
    b._source_file,
    b._source_sheet,
    b._row_num,

    -- Candidate/business helpers from PAY bridge.
    b.business_date_candidate AS business_date_hint,
    b.department_label_raw,
    b.category_label_raw,
    b.source_stage_candidate,
    b.cost_nature_candidate,
    b.payment_channel_candidate,
    b.receipt_state_candidate,
    COALESCE(b.total_amount_candidate, b.derived_total_from_components) AS total_amount_candidate,
    COALESCE(b.ex_vat_amount_candidate, b.derived_ex_vat_from_total_minus_vat) AS ex_vat_amount_candidate,
    COALESCE(b.vat_amount_candidate, b.derived_vat_from_total_minus_ex_vat) AS vat_amount_candidate,
    b.tax_code_candidate AS tax_code,

  -- Full raw-source preservation fields (PAY A:O operational context).
    b.raw_shift_text,
    b.raw_merchant_text,
    b.raw_description_text,
    b.raw_type_text,
    b.raw_invoice_text,
    b.raw_reference_text,
    b.raw_assistant_text,
    b.raw_department_text,
    b.raw_running_capital_text,

  -- Raw and parse helper context for rules/reject diagnostics.
    b.raw_business_date_text,
    b.raw_payment_channel_text,
    b.raw_receipt_text,
    b.raw_ex_vat_text,
    b.raw_vat_text,
    b.raw_total_text,
    b.business_date_parse_status,
    b.total_amount_parse_status,
    b.receipt_parse_status,
    b.payment_channel_parse_status,

    b.candidate_load_status,
    b.candidate_confidence_score,
    b.candidate_confidence_level,
    b.unresolved_notes,

    upper(regexp_replace(trim(coalesce(b.department_label_raw, b.category_label_raw, '')), '[^A-Za-z0-9]+', '_', 'g')) AS raw_label_norm_hint,

    'pay_transaction_candidate'::text AS candidate_state
  FROM base b
)
SELECT *
FROM normalized n
WHERE NOT (
  n.business_date_hint IS NULL
  AND COALESCE(n.total_amount_candidate, 0) = 0
  AND COALESCE(n.ex_vat_amount_candidate, 0) = 0
  AND COALESCE(n.vat_amount_candidate, 0) = 0
  AND nullif(btrim(COALESCE(n.payment_channel_candidate, n.raw_payment_channel_text)), '') IS NULL
  AND nullif(btrim(COALESCE(n.receipt_state_candidate, n.raw_receipt_text)), '') IS NULL
)
AND NOT (
  COALESCE(n.total_amount_candidate, 0) = 0
  AND COALESCE(n.ex_vat_amount_candidate, 0) = 0
  AND COALESCE(n.vat_amount_candidate, 0) = 0
  AND nullif(btrim(COALESCE(n.payment_channel_candidate, n.raw_payment_channel_text)), '') IS NULL
)
AND NOT (
  n.total_amount_candidate IS NULL
  AND n.ex_vat_amount_candidate IS NULL
  AND n.vat_amount_candidate IS NULL
  AND nullif(btrim(COALESCE(n.raw_total_text, '')), '') IS NULL
  AND nullif(btrim(COALESCE(n.raw_ex_vat_text, '')), '') IS NULL
  AND nullif(btrim(COALESCE(n.raw_vat_text, '')), '') IS NULL
);
