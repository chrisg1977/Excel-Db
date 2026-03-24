-- EOS staged label mapping enrichment layer (v1)
-- Purpose:
--   Provide provenance-first mapping from raw_label_norm_hint to reviewed labels
--   for department/category handling, without silently inventing mappings.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_stg_label_mapping_enrichment_v1.sql
--
-- Assumptions:
--   - v_eos_stg_line_classification_v1 exists and exposes raw_label_norm_hint,
--     department_label_raw, category_label_raw.
--   - Mapping rules are curated and approved by data owners.
--
-- Deterministic vs heuristic policy:
--   - deterministic: load-safe mapping
--   - heuristic: suggestion only unless explicitly approved_for_loading
--   - unresolved: no approved rule match
--
-- Loader impact:
--   - eos_stg_to_shift_payment_lines_insert_v1.sql can consume
--     department_label_for_loading/category_label_for_loading when available.
--   - unresolved mappings should continue through reject-first path.

BEGIN;

CREATE TABLE IF NOT EXISTS eos_stg_label_mapping_rules (
  id BIGSERIAL PRIMARY KEY,
  branch_code TEXT NULL,
  raw_label_norm_hint TEXT NOT NULL,

  mapped_department_label_raw TEXT NULL,
  mapped_category_label_raw TEXT NULL,

  mapping_class TEXT NOT NULL,
  approved_for_loading BOOLEAN NOT NULL DEFAULT FALSE,
  review_status TEXT NOT NULL DEFAULT 'pending',
  source_reference TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 100,
  notes TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_stg_label_mapping_rules_branch_chk
    CHECK (branch_code IS NULL OR branch_code IN ('EOSZ', 'EOSQ', 'EOSBLUM')),

  CONSTRAINT eos_stg_label_mapping_rules_class_chk
    CHECK (mapping_class IN ('deterministic', 'heuristic')),

  CONSTRAINT eos_stg_label_mapping_rules_review_chk
    CHECK (review_status IN ('pending', 'approved', 'rejected')),

  CONSTRAINT eos_stg_label_mapping_rules_target_chk
    CHECK (
      mapped_department_label_raw IS NOT NULL
      OR mapped_category_label_raw IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS ix_eos_stg_label_mapping_rules_lookup
  ON eos_stg_label_mapping_rules(branch_code, raw_label_norm_hint, review_status, priority);

ALTER TABLE eos_stg_label_mapping_rules OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_stg_label_mapping_rules TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_stg_label_mapping_rules_id_seq TO app_directus;

CREATE OR REPLACE VIEW v_eos_stg_label_mapping_enrichment_v1 AS
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
    c.department_label_raw AS department_label_raw_original,
    c.category_label_raw AS category_label_raw_original,
    c.classification_status
  FROM v_eos_stg_line_classification_v1 c
),
best_rule AS (
  SELECT
    b.candidate_id,
    r.id AS rule_id,
    r.mapping_class,
    r.approved_for_loading,
    r.mapped_department_label_raw,
    r.mapped_category_label_raw,
    r.source_reference,
    r.notes
  FROM base b
  LEFT JOIN LATERAL (
    SELECT rr.*
    FROM eos_stg_label_mapping_rules rr
    WHERE rr.review_status = 'approved'
      AND (rr.branch_code IS NULL OR rr.branch_code = b.branch_code)
      AND rr.raw_label_norm_hint = b.raw_label_norm_hint
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
  b.raw_label_norm_hint,
  b.classification_status,

  b.department_label_raw_original,
  b.category_label_raw_original,

  br.rule_id,
  br.mapping_class,
  br.approved_for_loading,
  br.source_reference AS mapping_source_reference,
  br.notes AS mapping_notes,

  CASE
    WHEN br.rule_id IS NULL THEN 'unresolved'
    ELSE br.mapping_class
  END AS mapping_status,

  CASE
    WHEN br.rule_id IS NULL THEN FALSE
    WHEN br.mapping_class = 'deterministic' THEN TRUE
    ELSE br.approved_for_loading
  END AS mapping_load_safe,

  br.mapped_department_label_raw,
  br.mapped_category_label_raw,

  CASE
    WHEN br.rule_id IS NULL THEN NULL::text
    WHEN br.mapping_class = 'deterministic' THEN br.mapped_department_label_raw
    WHEN br.approved_for_loading THEN br.mapped_department_label_raw
    ELSE NULL::text
  END AS department_label_for_loading,

  CASE
    WHEN br.rule_id IS NULL THEN NULL::text
    WHEN br.mapping_class = 'deterministic' THEN br.mapped_category_label_raw
    WHEN br.approved_for_loading THEN br.mapped_category_label_raw
    ELSE NULL::text
  END AS category_label_for_loading,

  CASE
    WHEN br.rule_id IS NULL THEN 'no_approved_label_mapping_rule'
    WHEN br.mapping_class = 'heuristic' AND NOT br.approved_for_loading THEN 'heuristic_mapping_not_load_safe'
    ELSE NULL
  END AS mapping_unresolved_reason
FROM base b
LEFT JOIN best_rule br
  ON br.candidate_id = b.candidate_id;

-- Feed view for line loader adoption:
--   prefer *_for_loading fields; keep originals for audit and reject context.
CREATE OR REPLACE VIEW v_eos_stg_line_classification_enriched_labels_v1 AS
SELECT
  c.*,
  m.mapping_status,
  m.mapping_load_safe,
  m.mapping_source_reference,
  m.mapping_unresolved_reason,
  m.department_label_for_loading,
  m.category_label_for_loading
FROM v_eos_stg_line_classification_v1 c
LEFT JOIN v_eos_stg_label_mapping_enrichment_v1 m
  ON m.candidate_id = c.candidate_id;

COMMIT;
