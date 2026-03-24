-- EOS staged business-date enrichment layer (v1)
-- Purpose:
--   Provide reviewable, provenance-first business_date enrichment for staged EOS candidates
--   without inventing dates.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_stg_business_date_enrichment_v1.sql
--
-- Assumptions:
--   - v_eos_stg_line_candidates_v1 exists.
--   - Date rules are manually curated from trusted sources (import manifests,
--     workbook metadata, signed monthly calendars).
--
-- Deterministic vs heuristic policy:
--   - deterministic: trusted and load-safe date rule
--   - heuristic: candidate suggestion only; not load-safe
--   - unresolved: no matching approved rule
--
-- Loader impact:
--   - eos_stg_to_shift_header_insert_v1.sql and eos_stg_to_shift_payment_lines_insert_v1.sql
--     should only consume business_date_for_loading (deterministic only).

BEGIN;

CREATE TABLE IF NOT EXISTS eos_stg_business_date_rules (
  id BIGSERIAL PRIMARY KEY,
  branch_code TEXT NULL,
  source_table_name TEXT NULL,
  source_file_pattern TEXT NULL,
  source_sheet_pattern TEXT NULL,
  row_num_from INTEGER NULL,
  row_num_to INTEGER NULL,

  business_date DATE NOT NULL,
  enrichment_class TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending',
  priority INTEGER NOT NULL DEFAULT 100,
  notes TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_stg_business_date_rules_branch_chk
    CHECK (branch_code IS NULL OR branch_code IN ('EOSZ', 'EOSQ', 'EOSBLUM')),

  CONSTRAINT eos_stg_business_date_rules_class_chk
    CHECK (enrichment_class IN ('deterministic', 'heuristic')),

  CONSTRAINT eos_stg_business_date_rules_review_chk
    CHECK (review_status IN ('pending', 'approved', 'rejected')),

  CONSTRAINT eos_stg_business_date_rules_row_range_chk
    CHECK (
      (row_num_from IS NULL AND row_num_to IS NULL)
      OR (row_num_from IS NOT NULL AND row_num_to IS NOT NULL AND row_num_from <= row_num_to)
    )
);

CREATE INDEX IF NOT EXISTS ix_eos_stg_business_date_rules_lookup
  ON eos_stg_business_date_rules(branch_code, source_table_name, review_status, priority);

CREATE INDEX IF NOT EXISTS ix_eos_stg_business_date_rules_patterns
  ON eos_stg_business_date_rules(source_file_pattern, source_sheet_pattern);

ALTER TABLE eos_stg_business_date_rules OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_stg_business_date_rules TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_stg_business_date_rules_id_seq TO app_directus;

CREATE OR REPLACE VIEW v_eos_stg_business_date_enrichment_v1 AS
WITH base AS (
  SELECT
    c.candidate_id,
    c.branch_code,
    c.source_table_name,
    c.source_family,
    c._source_file,
    c._source_sheet,
    c._row_num,
    c.business_date_hint AS business_date_hint_original
  FROM v_eos_stg_line_candidates_v1 c
),
best_rule AS (
  SELECT
    b.candidate_id,
    r.id AS rule_id,
    r.business_date,
    r.enrichment_class,
    r.source_reference,
    r.review_status,
    r.priority,
    r.notes
  FROM base b
  LEFT JOIN LATERAL (
    SELECT rr.*
    FROM eos_stg_business_date_rules rr
    WHERE rr.review_status = 'approved'
      AND (rr.branch_code IS NULL OR rr.branch_code = b.branch_code)
      AND (rr.source_table_name IS NULL OR rr.source_table_name = b.source_table_name)
      AND (rr.source_file_pattern IS NULL OR b._source_file ILIKE rr.source_file_pattern)
      AND (rr.source_sheet_pattern IS NULL OR b._source_sheet ILIKE rr.source_sheet_pattern)
      AND (
        rr.row_num_from IS NULL
        OR (b._row_num IS NOT NULL AND b._row_num BETWEEN rr.row_num_from AND rr.row_num_to)
      )
    ORDER BY rr.priority ASC, rr.id ASC
    LIMIT 1
  ) r ON TRUE
)
SELECT
  b.candidate_id,
  b.branch_code,
  b.source_table_name,
  b.source_family,
  b._source_file,
  b._source_sheet,
  b._row_num,

  b.business_date_hint_original,

  br.rule_id,
  br.business_date AS business_date_enriched,
  br.enrichment_class AS business_date_enrichment_class,
  br.source_reference AS business_date_source_reference,
  br.notes AS business_date_enrichment_notes,

  CASE
    WHEN br.rule_id IS NULL AND b.business_date_hint_original IS NOT NULL THEN 'deterministic_from_pay_row'
    WHEN br.rule_id IS NULL THEN 'unresolved'
    ELSE br.enrichment_class
  END AS business_date_status,

  CASE
    WHEN br.rule_id IS NULL AND b.business_date_hint_original IS NOT NULL THEN b.business_date_hint_original
    WHEN br.enrichment_class = 'deterministic' THEN br.business_date
    ELSE NULL::date
  END AS business_date_for_loading,

  CASE
    WHEN br.rule_id IS NULL AND b.business_date_hint_original IS NOT NULL THEN NULL
    WHEN br.rule_id IS NULL THEN 'no_approved_business_date_rule'
    WHEN br.enrichment_class = 'heuristic' THEN 'heuristic_not_load_safe'
    ELSE NULL
  END AS business_date_unresolved_reason
FROM base b
LEFT JOIN best_rule br
  ON br.candidate_id = b.candidate_id;

-- Feed view for classification layer adoption:
--   Replace direct candidate source with this view, and use business_date_hint_enriched.
CREATE OR REPLACE VIEW v_eos_stg_line_candidates_enriched_business_date_v1 AS
SELECT
  c.*,
  e.business_date_status,
  e.business_date_enrichment_class,
  e.business_date_source_reference,
  e.business_date_unresolved_reason,
  e.business_date_for_loading AS business_date_hint_enriched
FROM v_eos_stg_line_candidates_v1 c
LEFT JOIN v_eos_stg_business_date_enrichment_v1 e
  ON e.candidate_id = c.candidate_id;

COMMIT;
