-- EOS import manifest -> business-date rules promotion (v1)
-- Purpose:
--   Promote trusted, approved deterministic manifest rows into
--   eos_stg_business_date_rules for deterministic business-date enrichment.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_stg_import_manifest_to_business_date_rules_v1.sql
--
-- Assumptions:
--   - eos_stg_import_manifest exists and is populated with trusted rows.
--   - eos_stg_business_date_rules exists.
--   - Manifest rows are already reviewed; only approved deterministic rows are eligible.
--
-- Promotion scope:
--   - review_status = 'approved'
--   - mapping_class = 'deterministic'
--   - branch_code in ('EOSZ', 'EOSQ', 'EOSBLUM')
--
-- Idempotency / duplicate-handling strategy:
--   - Insert only when no effective deterministic approved rule already exists with the same:
--       branch_code, source_file_pattern, source_sheet_pattern,
--       row_num_from, row_num_to, business_date.
--   - source_table_name is set to NULL intentionally so promoted rules can match across
--     current EOS staged source tables by branch/file/sheet/row-range.
--
-- Provenance:
--   - source_reference is carried from manifest.
--   - notes are carried with appended manifest id marker for traceability.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.eos_stg_import_manifest') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_stg_import_manifest (run sql/eos_stg_import_manifest_schema_v1.sql first)';
  END IF;

  IF to_regclass('public.eos_stg_business_date_rules') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_stg_business_date_rules (run sql/eos_stg_business_date_enrichment_v1.sql first)';
  END IF;
END$$;

WITH approved_manifest AS (
  SELECT DISTINCT
    m.id AS manifest_id,
    m.branch_code,
    NULL::text AS source_table_name,
    m.source_file_pattern,
    m.source_sheet_pattern,
    m.row_num_from,
    m.row_num_to,
    m.business_date,
    'deterministic'::text AS enrichment_class,
    m.source_reference,
    'approved'::text AS review_status,
    50::integer AS priority,
    CASE
      WHEN m.notes IS NULL OR btrim(m.notes) = '' THEN format('[manifest_id=%s]', m.id)
      ELSE m.notes || format(' [manifest_id=%s]', m.id)
    END AS notes
  FROM eos_stg_import_manifest m
  WHERE m.review_status = 'approved'
    AND m.mapping_class = 'deterministic'
    AND m.branch_code IN ('EOSZ', 'EOSQ', 'EOSBLUM')
),
insertable AS (
  SELECT a.*
  FROM approved_manifest a
  WHERE NOT EXISTS (
    SELECT 1
    FROM eos_stg_business_date_rules r
    WHERE r.review_status = 'approved'
      AND r.enrichment_class = 'deterministic'
      AND r.branch_code = a.branch_code
      AND r.source_table_name IS NULL
      AND r.source_file_pattern = a.source_file_pattern
      AND r.source_sheet_pattern = a.source_sheet_pattern
      AND (
        (r.row_num_from IS NULL AND a.row_num_from IS NULL)
        OR (r.row_num_from = a.row_num_from)
      )
      AND (
        (r.row_num_to IS NULL AND a.row_num_to IS NULL)
        OR (r.row_num_to = a.row_num_to)
      )
      AND r.business_date = a.business_date
  )
)
INSERT INTO eos_stg_business_date_rules (
  branch_code,
  source_table_name,
  source_file_pattern,
  source_sheet_pattern,
  row_num_from,
  row_num_to,
  business_date,
  enrichment_class,
  source_reference,
  review_status,
  priority,
  notes
)
SELECT
  i.branch_code,
  i.source_table_name,
  i.source_file_pattern,
  i.source_sheet_pattern,
  i.row_num_from,
  i.row_num_to,
  i.business_date,
  i.enrichment_class,
  i.source_reference,
  i.review_status,
  i.priority,
  i.notes
FROM insertable i;

COMMIT;
