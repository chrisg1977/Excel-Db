-- EOS strict staged -> shift payment lines loader (v1)
-- Purpose:
--   Insert only safe operational line rows into eos_shift_payment_lines from
--   v_eos_stg_line_classification_v1 with reject-first behavior.
--
-- Run order:
--   1) sql/eos_stg_rejects_schema_v1.sql
--   2) sql/eos_shift_payment_line_source_details_schema_v1.sql
--   2) sql/eos_stg_to_shift_header_insert_v1.sql
--   3) sql/eos_stg_to_shift_payment_lines_insert_v1.sql
--
-- Assumptions:
--   - v_eos_stg_line_classification_v1 exists and is current.
--   - v_eos_stg_line_candidates_v1 exists and exposes raw PAY source fields.
--   - v_eos_stg_business_date_enrichment_v1 exists.
--   - v_eos_stg_label_mapping_enrichment_v1 exists.
--   - eos_shift_header exists and has branch_code + business_date rows for line linkage.
--   - eos_shift_payment_lines exists with strict enum checks.
--   - eos_shift_payment_line_source_details exists for source-field preservation.
--   - eos_stg_rejects exists for reject audit.
--   - v_eos_stg_tax_split_enrichment_v1 is optional; when present, tax split is consumed
--     only when tax_split_load_safe = true.
--
-- Accepted rows (strict):
--   - source_family = 'PAY' (FEE/SELL/ENTRY/PAY SUMMARY excluded)
--   - classification_status <> 'AGGREGATE_ONLY'
--   - branch_code in ('EOSZ','EOSQ','EOSBLUM')
--   - business_date_for_loading IS NOT NULL (deterministic only)
--   - matching eos_shift_header row exists (shift_header_id resolved)
--   - source_stage, cost_nature, payment_channel, receipt_state are all non-null and in-domain
--   - total_amount_candidate IS NOT NULL
--
-- Rejected or excluded rows:
--   - any row failing one or more required checks above
--   - aggregate-only/pay_summary rows
--   - rows with tax_code but no load-safe tax split enrichment
--
-- Honest placeholder policy:
--   - ex_vat_amount and vat_amount are never defaulted/invented.
--   - tax-coded rows are rejected unless optional tax enrichment marks split as load-safe.
--   - INSERT 0 0 is expected until deterministic business_date and tax-split
--     enrichment inputs are available and approved.
--
-- Additional staged/raw sources still needed for meaningful live loading:
--   - deterministic business_date mapping source
--   - richer row-level fields for reliable enum classification
--   - explicit tax split source (or deterministic derivation rules) for tax-coded rows

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.eos_stg_rejects') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_stg_rejects (run sql/eos_stg_rejects_schema_v1.sql first)';
  END IF;

  IF to_regclass('public.eos_shift_header') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_shift_header';
  END IF;

  IF to_regclass('public.eos_shift_payment_lines') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_shift_payment_lines';
  END IF;

  IF to_regclass('public.v_eos_stg_line_classification_v1') IS NULL THEN
    RAISE EXCEPTION 'Missing required view: v_eos_stg_line_classification_v1';
  END IF;

  IF to_regclass('public.v_eos_stg_line_candidates_v1') IS NULL THEN
    RAISE EXCEPTION 'Missing required view: v_eos_stg_line_candidates_v1';
  END IF;

  IF to_regclass('public.v_eos_stg_business_date_enrichment_v1') IS NULL THEN
    RAISE EXCEPTION 'Missing required view: v_eos_stg_business_date_enrichment_v1';
  END IF;

  IF to_regclass('public.v_eos_stg_label_mapping_enrichment_v1') IS NULL THEN
    RAISE EXCEPTION 'Missing required view: v_eos_stg_label_mapping_enrichment_v1';
  END IF;

  IF to_regclass('public.eos_shift_payment_line_source_details') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_shift_payment_line_source_details (run sql/eos_shift_payment_line_source_details_schema_v1.sql first)';
  END IF;
END$$;

DO $$
BEGIN
  IF to_regclass('public.v_eos_stg_tax_split_enrichment_v1') IS NOT NULL THEN
    EXECUTE '
      CREATE TEMP TABLE tmp_eos_tax_split_enrichment ON COMMIT DROP AS
      SELECT
        t.candidate_id,
        t.tax_split_status,
        t.tax_split_load_safe,
        t.ex_vat_for_loading,
        t.vat_for_loading,
        t.tax_split_unresolved_reason
      FROM v_eos_stg_tax_split_enrichment_v1 t
    ';
  ELSE
    EXECUTE '
      CREATE TEMP TABLE tmp_eos_tax_split_enrichment (
        candidate_id TEXT,
        tax_split_status TEXT,
        tax_split_load_safe BOOLEAN,
        ex_vat_for_loading NUMERIC(14,2),
        vat_for_loading NUMERIC(14,2),
        tax_split_unresolved_reason TEXT
      ) ON COMMIT DROP
    ';
  END IF;
END$$;

WITH base AS (
  SELECT
    c.candidate_id,
    c.branch_code,
    c.source_table_name,
    c.source_family,
    c._source_file,
    c._source_sheet,
    c._row_num,
    c.classification_status,
    c.unresolved_reason,
    c.raw_label_norm_hint,

    c.business_date_hint,
    e.business_date_for_loading,
    e.business_date_status,
    e.business_date_unresolved_reason,

    c.department_label_raw AS department_label_raw_original,
    c.category_label_raw AS category_label_raw_original,
    m.department_label_for_loading,
    m.category_label_for_loading,
    m.mapping_status,
    m.mapping_load_safe,
    m.mapping_unresolved_reason,

    c.source_stage,
    c.cost_nature,
    c.payment_channel,
    c.receipt_state,
    c.tax_code,

    c.total_amount_candidate,
    c.ex_vat_amount_candidate,
    c.vat_amount_candidate,

    lc.raw_business_date_text,
    lc.raw_shift_text,
    lc.raw_merchant_text,
    lc.raw_description_text,
    lc.raw_type_text,
    lc.raw_invoice_text,
    lc.raw_reference_text,
    lc.raw_assistant_text,
    lc.raw_payment_channel_text,
    lc.raw_receipt_text,
    lc.raw_department_text,
    lc.raw_running_capital_text,

    t.tax_split_status,
    t.tax_split_load_safe,
    t.ex_vat_for_loading,
    t.vat_for_loading,
    t.tax_split_unresolved_reason,

    h.id AS shift_header_id
  FROM v_eos_stg_line_classification_v1 c
  LEFT JOIN v_eos_stg_business_date_enrichment_v1 e
    ON e.candidate_id = c.candidate_id
  LEFT JOIN v_eos_stg_label_mapping_enrichment_v1 m
    ON m.candidate_id = c.candidate_id
  LEFT JOIN v_eos_stg_line_candidates_v1 lc
    ON lc.candidate_id = c.candidate_id
  LEFT JOIN tmp_eos_tax_split_enrichment t
    ON t.candidate_id = c.candidate_id
  LEFT JOIN eos_shift_header h
    ON h.branch_code = c.branch_code
   AND h.business_date = e.business_date_for_loading
),
classified AS (
  SELECT
    b.*,
    array_remove(ARRAY[
      CASE WHEN b.source_family <> 'PAY' THEN 'source_family_not_pay' END,
      CASE WHEN b.classification_status = 'AGGREGATE_ONLY' THEN 'aggregate_only_excluded' END,
      CASE WHEN b.branch_code NOT IN ('EOSZ', 'EOSQ', 'EOSBLUM') THEN 'invalid_branch_code' END,
      CASE WHEN b.business_date_for_loading IS NULL THEN 'business_date_unresolved' END,
      CASE WHEN b.shift_header_id IS NULL THEN 'shift_header_missing' END,

      CASE WHEN b.source_stage IS NULL THEN 'source_stage_unresolved' END,
      CASE WHEN b.cost_nature IS NULL THEN 'cost_nature_unresolved' END,
      CASE WHEN b.payment_channel IS NULL THEN 'payment_channel_unresolved' END,
      CASE WHEN b.receipt_state IS NULL THEN 'receipt_state_unresolved' END,
      CASE WHEN b.total_amount_candidate IS NULL THEN 'total_amount_unresolved' END,
      CASE WHEN b.tax_code IS NULL AND b.ex_vat_amount_candidate IS NULL THEN 'ex_vat_unresolved' END,
      CASE WHEN b.tax_code IS NULL AND b.vat_amount_candidate IS NULL THEN 'vat_unresolved' END,

      CASE WHEN b.source_stage IS NOT NULL AND b.source_stage NOT IN ('midshift', 'endshift') THEN 'source_stage_out_of_domain' END,
      CASE WHEN b.cost_nature IS NOT NULL AND b.cost_nature NOT IN ('running', 'capital') THEN 'cost_nature_out_of_domain' END,
      CASE WHEN b.payment_channel IS NOT NULL AND b.payment_channel NOT IN ('cash', 'non_cash') THEN 'payment_channel_out_of_domain' END,
      CASE WHEN b.receipt_state IS NOT NULL AND b.receipt_state NOT IN ('with_receipt', 'no_receipt') THEN 'receipt_state_out_of_domain' END,
      CASE WHEN b.tax_code IS NOT NULL AND b.tax_code NOT IN ('ECOTAX', 'VAT') THEN 'tax_code_out_of_domain' END,

      CASE
        WHEN b.tax_code IS NOT NULL
         AND (
           b.tax_split_load_safe IS DISTINCT FROM TRUE
           OR b.ex_vat_for_loading IS NULL
           OR b.vat_for_loading IS NULL
         )
        THEN 'tax_breakdown_unavailable'
      END
    ], NULL::text) AS reject_reasons
  FROM base b
),
rejected AS (
  INSERT INTO eos_stg_rejects (
    loader_name,
    candidate_id,
    branch_code,
    source_table_name,
    source_family,
    source_file,
    source_sheet,
    source_row_num,
    classification_status,
    unresolved_reason,
    reject_reasons,
    reject_context,
    updated_at
  )
  SELECT
    'eos_stg_to_shift_payment_lines_insert_v1' AS loader_name,
    c.candidate_id,
    c.branch_code,
    c.source_table_name,
    c.source_family,
    c._source_file,
    c._source_sheet,
    c._row_num,
    c.classification_status,
    c.unresolved_reason,
    c.reject_reasons,
    jsonb_build_object(
      'business_date_hint', c.business_date_hint,
      'business_date_for_loading', c.business_date_for_loading,
      'business_date_status', c.business_date_status,
      'business_date_unresolved_reason', c.business_date_unresolved_reason,
      'raw_label_norm_hint', c.raw_label_norm_hint,
      'shift_header_id', c.shift_header_id,
      'department_label_raw_original', c.department_label_raw_original,
      'category_label_raw_original', c.category_label_raw_original,
      'department_label_for_loading', c.department_label_for_loading,
      'category_label_for_loading', c.category_label_for_loading,
      'mapping_status', c.mapping_status,
      'mapping_load_safe', c.mapping_load_safe,
      'mapping_unresolved_reason', c.mapping_unresolved_reason,
      'source_stage', c.source_stage,
      'cost_nature', c.cost_nature,
      'payment_channel', c.payment_channel,
      'receipt_state', c.receipt_state,
      'tax_code', c.tax_code,
      'total_amount_candidate', c.total_amount_candidate,
      'ex_vat_amount_candidate', c.ex_vat_amount_candidate,
      'vat_amount_candidate', c.vat_amount_candidate,
      'tax_split_status', c.tax_split_status,
      'tax_split_load_safe', c.tax_split_load_safe,
      'ex_vat_for_loading', c.ex_vat_for_loading,
      'vat_for_loading', c.vat_for_loading,
      'tax_split_unresolved_reason', c.tax_split_unresolved_reason,
      'raw_business_date_text', c.raw_business_date_text,
      'raw_shift_text', c.raw_shift_text,
      'raw_merchant_text', c.raw_merchant_text,
      'raw_description_text', c.raw_description_text,
      'raw_type_text', c.raw_type_text,
      'raw_invoice_text', c.raw_invoice_text,
      'raw_reference_text', c.raw_reference_text,
      'raw_assistant_text', c.raw_assistant_text,
      'raw_payment_method_text', c.raw_payment_channel_text,
      'raw_receipt_text', c.raw_receipt_text,
      'raw_department_text', c.raw_department_text,
      'raw_cost_nature_text', c.raw_running_capital_text,
      'rule', 'strict_payment_line_acceptance'
    ) AS reject_context,
    now()
  FROM classified c
  WHERE cardinality(c.reject_reasons) > 0
  ON CONFLICT (loader_name, candidate_id) DO UPDATE
  SET
    branch_code = EXCLUDED.branch_code,
    source_table_name = EXCLUDED.source_table_name,
    source_family = EXCLUDED.source_family,
    source_file = EXCLUDED.source_file,
    source_sheet = EXCLUDED.source_sheet,
    source_row_num = EXCLUDED.source_row_num,
    classification_status = EXCLUDED.classification_status,
    unresolved_reason = EXCLUDED.unresolved_reason,
    reject_reasons = EXCLUDED.reject_reasons,
    reject_context = EXCLUDED.reject_context,
    updated_at = now()
  RETURNING 1
),
accepted_lines AS (
  SELECT
    c.candidate_id AS source_candidate_id,
    c.shift_header_id,
    c.source_table_name,
    c.source_family,
    c._source_file,
    c._source_sheet,
    c._row_num,
    coalesce(c.category_label_for_loading, c.category_label_raw_original) AS category_label_raw,
    coalesce(c.department_label_for_loading, c.department_label_raw_original) AS department_label_raw,
    c.source_stage,
    c.cost_nature,
    c.payment_channel,
    c.receipt_state,
    CASE
      WHEN c.tax_code IS NULL THEN c.ex_vat_amount_candidate::numeric(14,2)
      ELSE c.ex_vat_for_loading::numeric(14,2)
    END AS ex_vat_amount,
    CASE
      WHEN c.tax_code IS NULL THEN c.vat_amount_candidate::numeric(14,2)
      ELSE c.vat_for_loading::numeric(14,2)
    END AS vat_amount,
    c.total_amount_candidate::numeric(14,2) AS total_amount,
    c.tax_code,
    c.raw_business_date_text,
    c.raw_shift_text,
    c.raw_merchant_text,
    c.raw_description_text,
    c.raw_type_text,
    c.raw_invoice_text,
    c.raw_reference_text,
    c.raw_assistant_text,
    c.raw_payment_channel_text,
    c.raw_receipt_text,
    c.raw_department_text,
    c.raw_running_capital_text
  FROM classified c
  WHERE cardinality(c.reject_reasons) = 0
),
inserted_lines AS (
INSERT INTO eos_shift_payment_lines (
  source_candidate_id,
  shift_header_id,
  category_label_raw,
  department_label_raw,
  source_stage,
  cost_nature,
  payment_channel,
  receipt_state,
  ex_vat_amount,
  vat_amount,
  total_amount,
  tax_code
)
SELECT
  a.source_candidate_id,
  a.shift_header_id,
  a.category_label_raw,
  a.department_label_raw,
  a.source_stage,
  a.cost_nature,
  a.payment_channel,
  a.receipt_state,
  a.ex_vat_amount,
  a.vat_amount,
  a.total_amount,
  a.tax_code
FROM accepted_lines a
WHERE NOT EXISTS (
  SELECT 1
  FROM eos_shift_payment_lines l
  WHERE l.source_candidate_id = a.source_candidate_id
)
RETURNING id, source_candidate_id
)
INSERT INTO eos_shift_payment_line_source_details (
  shift_payment_line_id,
  source_candidate_id,
  source_table_name,
  source_family,
  source_file,
  source_sheet,
  source_row_num,
  raw_business_date_text,
  raw_shift_text,
  raw_merchant_text,
  raw_description_text,
  raw_type_text,
  raw_invoice_text,
  raw_reference_text,
  raw_assistant_text,
  raw_payment_method_text,
  raw_receipt_text,
  raw_department_text,
  raw_cost_nature_text,
  updated_at
)
SELECT
  i.id,
  a.source_candidate_id,
  a.source_table_name,
  a.source_family,
  a._source_file,
  a._source_sheet,
  a._row_num,
  a.raw_business_date_text,
  a.raw_shift_text,
  a.raw_merchant_text,
  a.raw_description_text,
  a.raw_type_text,
  a.raw_invoice_text,
  a.raw_reference_text,
  a.raw_assistant_text,
  a.raw_payment_channel_text,
  a.raw_receipt_text,
  a.raw_department_text,
  a.raw_running_capital_text,
  now()
FROM inserted_lines i
JOIN accepted_lines a
  ON a.source_candidate_id = i.source_candidate_id
ON CONFLICT (source_candidate_id) DO UPDATE
SET
  shift_payment_line_id = EXCLUDED.shift_payment_line_id,
  source_table_name = EXCLUDED.source_table_name,
  source_family = EXCLUDED.source_family,
  source_file = EXCLUDED.source_file,
  source_sheet = EXCLUDED.source_sheet,
  source_row_num = EXCLUDED.source_row_num,
  raw_business_date_text = EXCLUDED.raw_business_date_text,
  raw_shift_text = EXCLUDED.raw_shift_text,
  raw_merchant_text = EXCLUDED.raw_merchant_text,
  raw_description_text = EXCLUDED.raw_description_text,
  raw_type_text = EXCLUDED.raw_type_text,
  raw_invoice_text = EXCLUDED.raw_invoice_text,
  raw_reference_text = EXCLUDED.raw_reference_text,
  raw_assistant_text = EXCLUDED.raw_assistant_text,
  raw_payment_method_text = EXCLUDED.raw_payment_method_text,
  raw_receipt_text = EXCLUDED.raw_receipt_text,
  raw_department_text = EXCLUDED.raw_department_text,
  raw_cost_nature_text = EXCLUDED.raw_cost_nature_text,
  updated_at = now();

COMMIT;
