-- EOS strict staged -> shift header loader (v1)
-- Purpose:
--   Insert only distinct safe headers into eos_shift_header from
--   v_eos_stg_line_classification_v1 with reject-first behavior.
--
-- Run order:
--   1) sql/eos_stg_rejects_schema_v1.sql
--   2) sql/eos_stg_to_shift_header_insert_v1.sql
--
-- Assumptions:
--   - v_eos_stg_line_classification_v1 exists.
--   - v_eos_stg_business_date_enrichment_v1 exists.
--   - eos_shift_header exists with branch/date contract.
--   - eos_stg_rejects exists for reject audit.
--
-- Accepted rows:
--   - source_family = 'PAY'
--   - OR source_family = 'FEE' for EOSQ via enriched FEE candidate view
--   - branch_code in ('EOSZ','EOSQ','EOSBLUM')
--   - business_date_for_loading IS NOT NULL (deterministic only)
--
-- Rejected or excluded rows:
--   - pay_summary rows (aggregate-only, not operational line/header loads)
--   - unresolved business_date_for_loading
--   - invalid/unknown branch code
--
-- Honest current-state note:
--   - With current foundation, business_date_hint is unresolved, so this loader is
--     expected to insert zero headers until deterministic date source is added.
--
-- Additional staged/raw sources still needed for meaningful live loading:
--   - Raw monthly sheets with deterministic date/month context
--   - Import manifest or calendar mapping to derive business_date per row

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.eos_stg_rejects') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_stg_rejects (run sql/eos_stg_rejects_schema_v1.sql first)';
  END IF;

  IF to_regclass('public.eos_shift_header') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_shift_header';
  END IF;

  IF to_regclass('public.v_eos_stg_line_classification_v1') IS NULL THEN
    RAISE EXCEPTION 'Missing required view: v_eos_stg_line_classification_v1';
  END IF;

  IF to_regclass('public.v_eos_stg_business_date_enrichment_v1') IS NULL THEN
    RAISE EXCEPTION 'Missing required view: v_eos_stg_business_date_enrichment_v1';
  END IF;

  IF to_regclass('public.v_eosq_fee_candidates_enriched_v1') IS NULL THEN
    RAISE EXCEPTION 'Missing required view: v_eosq_fee_candidates_enriched_v1';
  END IF;
END$$;

WITH pay_base AS (
  SELECT
    c.candidate_id,
    c.branch_code,
    c.source_table_name,
    c.source_family,
    c._source_file,
    c._source_sheet,
    c._row_num,
    c.raw_label_norm_hint,
    c.classification_status,
    c.unresolved_reason,
    c.business_date_hint,
    e.business_date_for_loading,
    e.business_date_status,
    e.business_date_unresolved_reason
  FROM v_eos_stg_line_classification_v1 c
  LEFT JOIN v_eos_stg_business_date_enrichment_v1 e
    ON e.candidate_id = c.candidate_id
),
fee_base AS (
  SELECT
    f.raw_line_id AS candidate_id,
    f.branch_code,
    f.source_table_name,
    f.source_family,
    f._source_file,
    f._source_sheet,
    f._row_num,
    NULL::text AS raw_label_norm_hint,
    CASE
      WHEN f.business_date_candidate_effective IS NOT NULL THEN 'READY_FOR_HEADER'
      ELSE 'UNRESOLVED'
    END AS classification_status,
    CASE
      WHEN f.business_date_candidate_effective IS NULL THEN 'business_date_unresolved'
      ELSE NULL::text
    END AS unresolved_reason,
    f.business_date_candidate_effective AS business_date_hint,
    f.business_date_candidate_effective AS business_date_for_loading,
    CASE
      WHEN f.business_date_candidate_effective IS NOT NULL THEN 'parsed_from_fee_enrichment'
      ELSE 'unresolved'
    END AS business_date_status,
    CASE
      WHEN f.business_date_candidate_effective IS NULL THEN 'business_date_unresolved'
      ELSE NULL::text
    END AS business_date_unresolved_reason
  FROM v_eosq_fee_candidates_enriched_v1 f
  WHERE f.branch_code = 'EOSQ'
    AND f.source_family = 'FEE'
),
base AS (
  SELECT * FROM pay_base
  UNION ALL
  SELECT * FROM fee_base
),
classified AS (
  SELECT
    b.*,
    array_remove(ARRAY[
      CASE
        WHEN NOT (
          b.source_family = 'PAY'
          OR (b.source_family = 'FEE' AND b.branch_code = 'EOSQ')
        )
        THEN 'source_family_not_supported_for_header'
      END,
      CASE WHEN b.classification_status = 'AGGREGATE_ONLY' THEN 'aggregate_only_excluded' END,
      CASE WHEN b.branch_code NOT IN ('EOSZ', 'EOSQ', 'EOSBLUM') THEN 'invalid_branch_code' END,
      CASE WHEN b.business_date_for_loading IS NULL THEN 'business_date_unresolved' END
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
    'eos_stg_to_shift_header_insert_v1' AS loader_name,
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
      'rule', 'strict_header_acceptance'
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
accepted_headers AS (
  SELECT DISTINCT
    c.branch_code,
    c.business_date_for_loading AS business_date
  FROM classified c
  WHERE cardinality(c.reject_reasons) = 0
)
INSERT INTO eos_shift_header (
  branch_code,
  business_date
)
SELECT
  a.branch_code,
  a.business_date
FROM accepted_headers a
WHERE NOT EXISTS (
  SELECT 1
  FROM eos_shift_header h
  WHERE h.branch_code = a.branch_code
    AND h.business_date = a.business_date
);

COMMIT;
