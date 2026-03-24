-- EOS staged line classification foundation (v1, PAY-only pilot)
-- Purpose:
--   Apply strict, transparent classification over PAY candidates only.
--   Do not invent values; unresolved fields remain NULL.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_stg_line_classification_v1.sql

DROP VIEW IF EXISTS v_eos_stg_line_classification_v1 CASCADE;

CREATE VIEW v_eos_stg_line_classification_v1 AS
WITH base AS (
  SELECT
    c.candidate_id,
    c.branch_code,
    c.source_table_name,
    c.source_family,
    c._source_file,
    c._source_sheet,
    c._row_num,
    c.raw_label_norm_hint,
    c.department_label_raw,
    c.category_label_raw,
    c.source_stage_candidate,
    c.cost_nature_candidate,
    c.payment_channel_candidate,
    c.receipt_state_candidate,
    c.total_amount_candidate,
    c.ex_vat_amount_candidate,
    c.vat_amount_candidate,
    c.tax_code,
    c.business_date_hint,
    c.business_date_hint_enriched,
    c.business_date_status,
    c.business_date_enrichment_class,
    c.business_date_source_reference,
    c.business_date_unresolved_reason,
    c.candidate_load_status,
    c.unresolved_notes,
    lower(coalesce(c.source_stage_candidate, '')) AS source_stage_probe,
    lower(coalesce(c.cost_nature_candidate, '')) AS cost_nature_probe,
    lower(coalesce(c.payment_channel_candidate, '')) AS payment_probe
  FROM v_eos_stg_line_candidates_enriched_business_date_v1 c
),
classified AS (
  SELECT
    b.*,
    CASE
      WHEN b.source_stage_probe IN ('morning', 'am', 'mid', 'midshift') THEN 'midshift'
      WHEN b.source_stage_probe IN ('afternoon', 'pm', 'end', 'endshift') THEN 'endshift'
      ELSE NULL
    END AS source_stage,

    CASE
      WHEN b.cost_nature_probe IN ('running', 'opex') THEN 'running'
      WHEN b.cost_nature_probe IN ('capital', 'fixed assets', 'fixed asset', 'capex') THEN 'capital'
      ELSE NULL
    END AS cost_nature,

    CASE
      WHEN b.payment_probe = 'cash' THEN 'cash'
      WHEN b.payment_probe = 'non_cash' THEN 'non_cash'
      WHEN b.payment_probe ~ '(cashbox|petty cash|cash)' THEN 'cash'
      WHEN b.payment_probe ~ '(bank|transfer|visa|card|revolut|cheque|transaction)' THEN 'non_cash'
      ELSE NULL
    END AS payment_channel,

    CASE
      WHEN lower(btrim(coalesce(b.receipt_state_candidate, ''))) IN ('with_receipt', 'no_receipt') THEN lower(btrim(b.receipt_state_candidate))
      WHEN lower(btrim(coalesce(b.receipt_state_candidate, ''))) = 'yes' THEN 'with_receipt'
      WHEN lower(btrim(coalesce(b.receipt_state_candidate, ''))) = 'no' THEN 'no_receipt'
      WHEN nullif(btrim(coalesce(b.receipt_state_candidate, '')), '') IS NULL
        AND b.payment_probe ~ '(cashbox|petty cash)' THEN 'no_receipt'
      ELSE NULL
    END AS receipt_state
  FROM base b
)
SELECT
  candidate_id,
  branch_code,
  source_table_name,
  source_family,
  _source_file,
  _source_sheet,
  _row_num,
  business_date_hint_enriched AS business_date_hint,
  business_date_status,
  business_date_enrichment_class,
  business_date_source_reference,
  business_date_unresolved_reason,
  raw_label_norm_hint,

  department_label_raw,
  category_label_raw,
  source_stage,
  cost_nature,
  payment_channel,
  receipt_state,
  tax_code,

  total_amount_candidate,
  ex_vat_amount_candidate,
  vat_amount_candidate,

  CASE WHEN source_stage IS NULL THEN 'sf99_unresolved' ELSE 'sf10_pay_shift_from_column_c' END AS source_stage_rule_id,
  CASE WHEN cost_nature IS NULL THEN 'cn99_unresolved' ELSE 'cn10_pay_cost_nature_from_column_f' END AS cost_nature_rule_id,
  CASE WHEN payment_channel IS NULL THEN 'pc99_unresolved' ELSE 'pc10_pay_method_from_column_j' END AS payment_channel_rule_id,
  CASE WHEN receipt_state IS NULL THEN 'rs99_unresolved' ELSE 'rs10_pay_receipt_from_column_k' END AS receipt_state_rule_id,
  CASE WHEN tax_code IS NULL THEN 'tx00_not_provided' ELSE 'tx10_from_candidate' END AS tax_code_rule_id,

  CASE
    WHEN business_date_hint_enriched IS NOT NULL
      AND source_stage IS NOT NULL
      AND cost_nature IS NOT NULL
      AND payment_channel IS NOT NULL
      AND receipt_state IS NOT NULL
      AND total_amount_candidate IS NOT NULL THEN 0.9
    WHEN total_amount_candidate IS NOT NULL THEN 0.6
    ELSE 0.1
  END::numeric(3,2) AS confidence,

  array_remove(ARRAY[
    CASE WHEN source_family <> 'PAY' THEN 'non_pay_family' END,
    CASE WHEN business_date_hint_enriched IS NULL THEN 'business_date_unresolved' END,
    CASE WHEN source_stage IS NULL THEN 'source_stage_unresolved' END,
    CASE WHEN cost_nature IS NULL THEN 'cost_nature_unresolved' END,
    CASE WHEN payment_channel IS NULL THEN 'payment_channel_unresolved' END,
    CASE WHEN receipt_state IS NULL THEN 'receipt_state_unresolved' END,
    CASE WHEN total_amount_candidate IS NULL THEN 'total_amount_unresolved' END
  ], NULL::text) AS unresolved_flags,

  CASE
    WHEN source_family <> 'PAY' THEN 'non_pay_family_excluded'
    WHEN business_date_hint_enriched IS NULL THEN 'business_date_unresolved'
    WHEN source_stage IS NULL THEN 'source_stage_unresolved'
    WHEN cost_nature IS NULL THEN 'cost_nature_unresolved'
    WHEN payment_channel IS NULL THEN 'payment_channel_unresolved'
    WHEN receipt_state IS NULL THEN 'receipt_state_unresolved'
    WHEN total_amount_candidate IS NULL THEN 'total_amount_unresolved'
    ELSE NULL
  END AS unresolved_reason,

  CASE
    WHEN source_family <> 'PAY' THEN 'EXCLUDED'
    WHEN business_date_hint_enriched IS NOT NULL
      AND source_stage IS NOT NULL
      AND cost_nature IS NOT NULL
      AND payment_channel IS NOT NULL
      AND receipt_state IS NOT NULL
      AND total_amount_candidate IS NOT NULL THEN 'READY'
    WHEN total_amount_candidate IS NOT NULL THEN 'PARTIAL'
    ELSE 'UNCLASSIFIED'
  END AS classification_status,

  (
    source_family = 'PAY'
    AND business_date_hint_enriched IS NOT NULL
    AND source_stage IS NOT NULL
    AND cost_nature IS NOT NULL
    AND payment_channel IS NOT NULL
    AND receipt_state IS NOT NULL
    AND total_amount_candidate IS NOT NULL
  ) AS canon_insert_ready
FROM classified;
