-- EOS strict staged -> SELL dry-run reject loader (v1)
-- Purpose:
--   Evaluate SELL candidates under strict canonical-readiness rules,
--   but write reject audit only (no canonical inserts).
--
-- Scope:
--   - Source: v_eos_sell_candidates_v1
--   - Writes only: eos_stg_rejects
--   - No writes to canonical SELL tables in this dry-run phase.
--
-- Run order:
--   1) sql/eos_stg_rejects_schema_v1.sql
--   2) sql/v_eos_sell_lines_raw_v1.sql
--   3) sql/v_eos_sell_candidates_v1.sql
--   4) sql/eos_stg_to_shift_sell_lines_dry_run_v1.sql

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.eos_stg_rejects') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_stg_rejects (run sql/eos_stg_rejects_schema_v1.sql first)';
  END IF;

  IF to_regclass('public.v_eos_sell_candidates_v1') IS NULL THEN
    RAISE EXCEPTION 'Missing required view: v_eos_sell_candidates_v1';
  END IF;
END$$;

WITH base AS (
  SELECT
    c.raw_line_id AS candidate_id,
    c.branch_code,
    c.source_table_name,
    c.source_family,
    c._source_file,
    c._source_sheet,
    c._row_num,

    c.business_date_candidate,
    c.department_label_raw,
    c.category_label_raw,
    c.source_stage_candidate,
    c.cost_nature_candidate,
    c.payment_channel_candidate,
    c.receipt_state_candidate,
    c.total_amount_candidate,
    c.ex_vat_amount_candidate,
    c.vat_amount_candidate,
    c.tax_code_candidate,

    c.business_date_parse_status,
    c.total_amount_parse_status,
    c.ex_vat_parse_status,
    c.vat_parse_status,
    c.receipt_parse_status,
    c.payment_channel_parse_status,
    c.unresolved_notes,
    c.candidate_confidence_score,
    c.candidate_confidence_level,
    c.candidate_load_status,

    c.raw_business_date_text,
    c.raw_shift_text,
    c.raw_description_text,
    c.raw_category_text,
    c.raw_reference_text,
    c.raw_payment_channel_text,
    c.raw_receipt_text,
    c.raw_total_text,
    c.raw_ex_vat_text,
    c.raw_vat_text
  FROM v_eos_sell_candidates_v1 c
),
classified AS (
  SELECT
    b.*,
    array_remove(ARRAY[
      CASE WHEN b.source_family <> 'SELL' THEN 'source_family_not_sell' END,
      CASE WHEN b.branch_code NOT IN ('EOSZ', 'EOSQ', 'EOSBLUM') THEN 'branch_not_supported' END,

      CASE WHEN b.business_date_candidate IS NULL THEN 'business_date_unresolved' END,

      CASE WHEN b.source_stage_candidate IS NULL THEN 'source_stage_unresolved' END,
      CASE
        WHEN b.source_stage_candidate IS NOT NULL
         AND lower(b.source_stage_candidate) NOT IN ('midshift', 'endshift')
        THEN 'source_stage_out_of_domain'
      END,

      CASE WHEN b.payment_channel_candidate IS NULL THEN 'payment_channel_unresolved' END,
      CASE
        WHEN b.payment_channel_candidate IS NOT NULL
         AND b.payment_channel_candidate NOT IN ('cash', 'non_cash')
        THEN 'payment_channel_out_of_domain'
      END,

      CASE WHEN b.total_amount_candidate IS NULL THEN 'total_amount_unresolved' END,
      CASE WHEN b.total_amount_candidate IS NOT NULL AND b.total_amount_candidate <= 0 THEN 'total_amount_non_positive' END,

      CASE
        WHEN nullif(btrim(coalesce(b.category_label_raw, '')), '') IS NULL
         AND nullif(btrim(coalesce(b.raw_description_text, '')), '') IS NULL
        THEN 'sell_label_unresolved'
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
    'eos_stg_to_shift_sell_lines_dry_run_v1' AS loader_name,
    c.candidate_id,
    c.branch_code,
    c.source_table_name,
    c.source_family,
    c._source_file,
    c._source_sheet,
    c._row_num,
    'STRICT_SELL_DRY_RUN' AS classification_status,
    CASE WHEN cardinality(c.reject_reasons) > 0 THEN c.reject_reasons[1] ELSE NULL END AS unresolved_reason,
    c.reject_reasons,
    jsonb_build_object(
      'business_date_candidate', c.business_date_candidate,
      'source_stage_candidate', c.source_stage_candidate,
      'cost_nature_candidate', c.cost_nature_candidate,
      'payment_channel_candidate', c.payment_channel_candidate,
      'receipt_state_candidate', c.receipt_state_candidate,
      'total_amount_candidate', c.total_amount_candidate,
      'ex_vat_amount_candidate', c.ex_vat_amount_candidate,
      'vat_amount_candidate', c.vat_amount_candidate,
      'tax_code_candidate', c.tax_code_candidate,
      'category_label_raw', c.category_label_raw,
      'department_label_raw', c.department_label_raw,
      'candidate_load_status', c.candidate_load_status,
      'candidate_confidence_score', c.candidate_confidence_score,
      'candidate_confidence_level', c.candidate_confidence_level,
      'business_date_parse_status', c.business_date_parse_status,
      'total_amount_parse_status', c.total_amount_parse_status,
      'ex_vat_parse_status', c.ex_vat_parse_status,
      'vat_parse_status', c.vat_parse_status,
      'receipt_parse_status', c.receipt_parse_status,
      'payment_channel_parse_status', c.payment_channel_parse_status,
      'unresolved_notes', c.unresolved_notes,
      'raw_business_date_text', c.raw_business_date_text,
      'raw_shift_text', c.raw_shift_text,
      'raw_description_text', c.raw_description_text,
      'raw_category_text', c.raw_category_text,
      'raw_reference_text', c.raw_reference_text,
      'raw_payment_channel_text', c.raw_payment_channel_text,
      'raw_receipt_text', c.raw_receipt_text,
      'raw_total_text', c.raw_total_text,
      'raw_ex_vat_text', c.raw_ex_vat_text,
      'raw_vat_text', c.raw_vat_text,
      'rule', 'strict_sell_dry_run_v1'
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
cleared_rejects AS (
  DELETE FROM eos_stg_rejects r
  USING classified c
  WHERE r.loader_name = 'eos_stg_to_shift_sell_lines_dry_run_v1'
    AND r.candidate_id = c.candidate_id
    AND cardinality(c.reject_reasons) = 0
  RETURNING 1
),
pruned_missing_candidates AS (
  DELETE FROM eos_stg_rejects r
  WHERE r.loader_name = 'eos_stg_to_shift_sell_lines_dry_run_v1'
    AND NOT EXISTS (
      SELECT 1
      FROM base b
      WHERE b.candidate_id = r.candidate_id
    )
  RETURNING 1
)
SELECT
  (SELECT count(*) FROM rejected) AS rejected_upserted,
  (SELECT count(*) FROM cleared_rejects) AS stale_rejects_cleared,
  (SELECT count(*) FROM pruned_missing_candidates) AS stale_rejects_pruned_not_in_candidates;

COMMIT;
