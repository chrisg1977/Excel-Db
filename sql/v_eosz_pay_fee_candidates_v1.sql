-- EOSZ PAY+FEE candidate bridge view (v1)
-- Purpose:
--   Read-only, provenance-first bridge for canonical loader preparation.
--   Combines only EOSZ PAY and FEE raw views and exposes:
--   1) raw source values
--   2) parsed helper values
--   3) candidate values (honest-only, NULL when unsafe)
--
-- Scope:
--   Includes:
--     - v_eosz_pay_lines_raw_v1
--     - v_eosz_fee_lines_raw_v1
--   Excludes:
--     - SELL
--     - ENTRY
--     - PAY SUMMARY
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/v_eosz_pay_fee_candidates_v1.sql

DROP VIEW IF EXISTS v_eosz_pay_fee_candidates_v1;

CREATE VIEW v_eosz_pay_fee_candidates_v1 AS
WITH pay_candidates AS (
  SELECT
    -- Provenance / identity
    p.branch_code,
    'PAY'::text AS source_family,
    p.source_table_name,
    p.raw_line_id,
    p._source_file,
    p._source_sheet,
    p._row_num,

    -- Raw source values
    p.raw_business_date_text,
    p.raw_department_text,
    COALESCE(NULLIF(btrim(p.raw_type_text), ''), NULLIF(btrim(p.raw_description_text), '')) AS raw_category_text,
    p.raw_paid_by_text AS raw_payment_channel_text,
    p.raw_receipt_text,
    p.raw_ex_vat_text,
    p.raw_vat_text,
    p.raw_total_text,
    p.raw_reference_text,
    p.raw_description_text,
    p.raw_shift_text,
    p.raw_merchant_text,
    p.raw_running_capital_text,
    p.raw_type_text,
    p.raw_invoice_text,
    p.raw_assistant_text,

    -- Parsed helper values
    p.parsed_business_date,
    p.parsed_ex_vat_amount,
    p.parsed_vat_amount,
    p.parsed_total_amount,
    p.parsed_receipt_state,
    p.parsed_payment_channel,
    p.helper_month_token,
    p.business_date_parse_status,
    p.ex_vat_parse_status,
    p.vat_parse_status,
    p.total_amount_parse_status,
    p.receipt_parse_status,
    p.payment_channel_parse_status,

    -- Candidate values (only where safely derivable)
    p.parsed_business_date AS business_date_candidate,
    NULLIF(btrim(p.raw_department_text), '') AS department_label_raw,
    COALESCE(NULLIF(btrim(p.raw_type_text), ''), NULLIF(btrim(p.raw_description_text), '')) AS category_label_raw,
    NULLIF(btrim(p.raw_shift_text), '') AS source_stage_candidate,
    NULLIF(btrim(p.raw_running_capital_text), '') AS cost_nature_candidate,
    NULLIF(btrim(p.raw_paid_by_text), '') AS payment_channel_candidate,
    p.parsed_receipt_state AS receipt_state_candidate,
    p.parsed_total_amount AS total_amount_candidate,
    p.parsed_ex_vat_amount AS ex_vat_amount_candidate,
    p.parsed_vat_amount AS vat_amount_candidate,
    NULL::text AS tax_code_candidate,

    -- Parse / confidence / unresolved signals
    (p.parsed_business_date IS NULL) AS business_date_unresolved,
    (p.parsed_total_amount IS NULL AND p.parsed_ex_vat_amount IS NULL AND p.parsed_vat_amount IS NULL) AS amount_unresolved,
    (NULLIF(btrim(p.raw_department_text), '') IS NULL AND COALESCE(NULLIF(btrim(p.raw_type_text), ''), NULLIF(btrim(p.raw_description_text), '')) IS NULL) AS label_unresolved,
    (NULLIF(btrim(p.raw_shift_text), '') IS NULL) AS shift_stage_unresolved,
    (NULLIF(btrim(p.raw_running_capital_text), '') IS NULL) AS cost_nature_unresolved,
    (NULLIF(btrim(p.raw_paid_by_text), '') IS NULL) AS payment_channel_unresolved,

    CASE
      WHEN p.parsed_total_amount IS NOT NULL AND p.parsed_business_date IS NOT NULL THEN 0.90::numeric(4,2)
      WHEN p.parsed_total_amount IS NOT NULL THEN 0.75::numeric(4,2)
      WHEN p.parsed_ex_vat_amount IS NOT NULL OR p.parsed_vat_amount IS NOT NULL THEN 0.55::numeric(4,2)
      ELSE 0.20::numeric(4,2)
    END AS candidate_confidence_score,

    CASE
      WHEN p.parsed_total_amount IS NOT NULL AND p.parsed_business_date IS NOT NULL THEN 'HIGH'
      WHEN p.parsed_total_amount IS NOT NULL THEN 'MEDIUM'
      WHEN p.parsed_ex_vat_amount IS NOT NULL OR p.parsed_vat_amount IS NOT NULL THEN 'LOW'
      ELSE 'LOW'
    END AS candidate_confidence_level,

    trim(both ';' from concat_ws('; ',
      CASE WHEN p.parsed_business_date IS NULL THEN 'business_date not safely derivable in current row' END,
      CASE WHEN p.parsed_total_amount IS NULL THEN 'total_amount not safely parsed' END,
      CASE WHEN NULLIF(btrim(p.raw_shift_text), '') IS NULL THEN 'shift/source-stage missing from column C' END,
      CASE WHEN NULLIF(btrim(p.raw_department_text), '') IS NULL THEN 'department label missing/blank' END,
      CASE WHEN NULLIF(btrim(p.raw_running_capital_text), '') IS NULL THEN 'cost_nature missing/blank from column F' END,
      CASE WHEN COALESCE(NULLIF(btrim(p.raw_type_text), ''), NULLIF(btrim(p.raw_description_text), '')) IS NULL THEN 'category label missing/blank' END,
      CASE WHEN NULLIF(btrim(p.raw_paid_by_text), '') IS NULL THEN 'payment method/account missing from column J' END
    )) AS unresolved_notes,

    CASE
      WHEN p.parsed_total_amount IS NOT NULL THEN 'READY_FOR_ENRICHMENT'
      WHEN p.parsed_ex_vat_amount IS NOT NULL OR p.parsed_vat_amount IS NOT NULL THEN 'PARTIAL'
      ELSE 'UNRESOLVED'
    END AS candidate_load_status,

    1::int AS source_priority_rank,
    TRUE AS is_primary_source_for_eosz
  FROM v_eosz_pay_lines_raw_v1 p
  WHERE p.branch_code = 'EOSZ'
),
fee_candidates AS (
  SELECT
    -- Provenance / identity
    f.branch_code,
    'FEE'::text AS source_family,
    f.source_table_name,
    f.raw_line_id,
    f._source_file,
    f._source_sheet,
    f._row_num,

    -- Raw source values
    NULL::text AS raw_business_date_text,
    f.raw_col_7 AS raw_department_text,
    f.raw_col_6 AS raw_category_text,
    NULL::text AS raw_payment_channel_text,
    f.raw_col_22 AS raw_receipt_text,
    f.raw_col_8 AS raw_ex_vat_text,
    f.raw_col_9 AS raw_vat_text,
    NULL::text AS raw_total_text,
    f.raw_col_23 AS raw_reference_text,
    f.raw_col_4 AS raw_description_text,
    NULL::text AS raw_shift_text,
    NULL::text AS raw_merchant_text,
    NULL::text AS raw_running_capital_text,
    NULL::text AS raw_type_text,
    NULL::text AS raw_invoice_text,
    NULL::text AS raw_assistant_text,

    -- Parsed helper values
    f.parsed_business_date,
    f.parsed_ex_vat_amount_primary AS parsed_ex_vat_amount,
    f.parsed_vat_amount_primary AS parsed_vat_amount,
    f.helper_total_amount_primary AS parsed_total_amount,
    f.parsed_receipt_state,
    f.parsed_payment_channel,
    f.helper_month_token,
    f.business_date_parse_status,
    f.ex_vat_parse_status,
    f.vat_parse_status,
    CASE
      WHEN f.helper_total_amount_primary IS NOT NULL THEN 'parsed_derived_sum'
      WHEN f.parsed_ex_vat_amount_primary IS NULL AND f.parsed_vat_amount_primary IS NULL THEN 'blank_or_missing'
      ELSE 'non_numeric_or_ambiguous'
    END AS total_amount_parse_status,
    f.receipt_parse_status,
    f.payment_channel_parse_status,

    -- Candidate values (only where safely derivable)
    NULL::date AS business_date_candidate,
    NULLIF(btrim(f.raw_col_7), '') AS department_label_raw,
    NULLIF(btrim(f.raw_col_6), '') AS category_label_raw,
    'PAYMENT_LINE'::text AS source_stage_candidate,
    NULL::text AS cost_nature_candidate,
    f.parsed_payment_channel AS payment_channel_candidate,
    f.parsed_receipt_state AS receipt_state_candidate,
    f.helper_total_amount_primary AS total_amount_candidate,
    f.parsed_ex_vat_amount_primary AS ex_vat_amount_candidate,
    f.parsed_vat_amount_primary AS vat_amount_candidate,
    NULL::text AS tax_code_candidate,

    -- Parse / confidence / unresolved signals
    TRUE AS business_date_unresolved,
    (f.helper_total_amount_primary IS NULL AND f.parsed_ex_vat_amount_primary IS NULL AND f.parsed_vat_amount_primary IS NULL) AS amount_unresolved,
    (NULLIF(btrim(f.raw_col_7), '') IS NULL AND NULLIF(btrim(f.raw_col_6), '') IS NULL) AS label_unresolved,
    TRUE AS shift_stage_unresolved,
    TRUE AS cost_nature_unresolved,
    TRUE AS payment_channel_unresolved,

    CASE
      WHEN f.helper_total_amount_primary IS NOT NULL THEN 0.70::numeric(4,2)
      WHEN f.parsed_ex_vat_amount_primary IS NOT NULL OR f.parsed_vat_amount_primary IS NOT NULL THEN 0.55::numeric(4,2)
      ELSE 0.20::numeric(4,2)
    END AS candidate_confidence_score,

    CASE
      WHEN f.helper_total_amount_primary IS NOT NULL THEN 'MEDIUM'
      WHEN f.parsed_ex_vat_amount_primary IS NOT NULL OR f.parsed_vat_amount_primary IS NOT NULL THEN 'LOW'
      ELSE 'LOW'
    END AS candidate_confidence_level,

    trim(both ';' from concat_ws('; ',
      'business_date not present in FEE raw layout',
      CASE WHEN f.helper_total_amount_primary IS NULL THEN 'total_amount unresolved unless ex_vat+vat pair parses' END,
      CASE WHEN NULLIF(btrim(f.raw_col_7), '') IS NULL THEN 'department label missing/blank' END,
      CASE WHEN NULLIF(btrim(f.raw_col_6), '') IS NULL THEN 'category label missing/blank' END,
      'payment_channel cannot be safely derived from FEE layout'
    )) AS unresolved_notes,

    CASE
      WHEN f.helper_total_amount_primary IS NOT NULL THEN 'READY_FOR_ENRICHMENT'
      WHEN f.parsed_ex_vat_amount_primary IS NOT NULL OR f.parsed_vat_amount_primary IS NOT NULL THEN 'PARTIAL'
      ELSE 'UNRESOLVED'
    END AS candidate_load_status,

    2::int AS source_priority_rank,
    FALSE AS is_primary_source_for_eosz
  FROM v_eosz_fee_lines_raw_v1 f
  WHERE f.branch_code = 'EOSZ'
)
SELECT * FROM pay_candidates
UNION ALL
SELECT * FROM fee_candidates;
