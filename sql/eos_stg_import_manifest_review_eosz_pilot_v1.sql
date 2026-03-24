-- EOSZ manifest review/export workflow (pilot v1)
-- Purpose:
--   Prepare trusted, human-reviewed manifest authoring inputs for EOSZ
--   without inventing business_date values.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_stg_import_manifest_review_eosz_pilot_v1.sql
--
-- Why this exists:
--   Current EOSZ staging proves source metadata (_source_file/_source_sheet/_row_num),
--   but does not by itself prove exact business_date values.
--   This script exports deterministic pattern candidates for human approval.

-- 1) Canonical EOSZ pilot metadata for manifest authoring (ENTRY + PAY SUMMARY only).
WITH src AS (
  SELECT
    'EOSZ'::text AS branch_code,
    _source_file,
    _source_sheet,
    min(_row_num)::integer AS row_num_from,
    max(_row_num)::integer AS row_num_to,
    count(*)::bigint AS row_count,
    'stg.eosz_entry'::text AS source_table
  FROM stg.eosz_entry
  GROUP BY _source_file, _source_sheet

  UNION ALL

  SELECT
    'EOSZ'::text AS branch_code,
    _source_file,
    _source_sheet,
    min(_row_num)::integer AS row_num_from,
    max(_row_num)::integer AS row_num_to,
    count(*)::bigint AS row_count,
    'stg.eosz_pay_summary'::text AS source_table
  FROM stg.eosz_pay_summary
  GROUP BY _source_file, _source_sheet
)
SELECT
  branch_code,
  source_table,
  _source_file,
  _source_sheet,
  row_num_from,
  row_num_to,
  row_count,
  -- Pattern forms intended for eos_stg_import_manifest entries.
  _source_file AS source_file_pattern,
  _source_sheet AS source_sheet_pattern
FROM src
ORDER BY source_table, _source_sheet;

-- 2) Human authoring helper: emits INSERT statements with NULL business_date placeholders.
--    Keep business_date NULL in output for review context; do NOT run as-is.
WITH src AS (
  SELECT
    'EOSZ'::text AS branch_code,
    _source_file,
    _source_sheet,
    min(_row_num)::integer AS row_num_from,
    max(_row_num)::integer AS row_num_to,
    count(*)::bigint AS row_count,
    'stg.eosz_entry'::text AS source_table
  FROM stg.eosz_entry
  GROUP BY _source_file, _source_sheet

  UNION ALL

  SELECT
    'EOSZ'::text AS branch_code,
    _source_file,
    _source_sheet,
    min(_row_num)::integer AS row_num_from,
    max(_row_num)::integer AS row_num_to,
    count(*)::bigint AS row_count,
    'stg.eosz_pay_summary'::text AS source_table
  FROM stg.eosz_pay_summary
  GROUP BY _source_file, _source_sheet
)
SELECT
  format(
    '-- REVIEW REQUIRED (%s, rows=%s)\n-- Replace <BUSINESS_DATE_YYYY_MM_DD> only after trusted evidence check\nINSERT INTO eos_stg_import_manifest (branch_code, source_file_pattern, source_sheet_pattern, row_num_from, row_num_to, business_date, mapping_class, review_status, source_reference, notes)\nVALUES (''%s'', ''%s'', ''%s'', %s, %s, ''<BUSINESS_DATE_YYYY_MM_DD>'', ''deterministic'', ''pending'', ''<TRUSTED_SOURCE_REFERENCE>'', ''pilot candidate from %s'');',
    source_table,
    row_count,
    branch_code,
    _source_file,
    _source_sheet,
    row_num_from,
    row_num_to,
    source_table
  ) AS manifest_insert_template
FROM src
ORDER BY source_table, _source_sheet;

-- 3) Optional evidence check target list (for manual workbook audit).
SELECT
  _source_file,
  _source_sheet,
  min(_row_num)::integer AS min_row,
  max(_row_num)::integer AS max_row,
  count(*)::bigint AS row_count
FROM (
  SELECT _source_file, _source_sheet, _row_num FROM stg.eosz_entry
  UNION ALL
  SELECT _source_file, _source_sheet, _row_num FROM stg.eosz_pay_summary
) s
GROUP BY _source_file, _source_sheet
ORDER BY _source_sheet;
