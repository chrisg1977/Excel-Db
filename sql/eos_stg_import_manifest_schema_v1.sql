-- EOS staged import manifest schema (v1)
-- Purpose:
--   Store trusted source-to-date mapping metadata that can be used to seed
--   deterministic business-date rules without inventing dates.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_stg_import_manifest_schema_v1.sql
--
-- Integration intent:
--   - This manifest is the trusted input layer.
--   - Approved deterministic rows can later seed eos_stg_business_date_rules,
--     or be consumed directly by business-date enrichment views.

BEGIN;

CREATE TABLE IF NOT EXISTS eos_stg_import_manifest (
  id BIGSERIAL PRIMARY KEY,
  branch_code TEXT NOT NULL,

  source_file_pattern TEXT NOT NULL,
  source_sheet_pattern TEXT NOT NULL,
  row_num_from INTEGER NULL,
  row_num_to INTEGER NULL,

  business_date DATE NOT NULL,
  mapping_class TEXT NOT NULL DEFAULT 'deterministic',
  review_status TEXT NOT NULL DEFAULT 'pending',
  source_reference TEXT NOT NULL,
  notes TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_stg_import_manifest_branch_chk
    CHECK (branch_code IN ('EOSZ', 'EOSQ', 'EOSBLUM')),

  CONSTRAINT eos_stg_import_manifest_mapping_class_chk
    CHECK (mapping_class = 'deterministic'),

  CONSTRAINT eos_stg_import_manifest_review_status_chk
    CHECK (review_status IN ('pending', 'approved', 'rejected')),

  CONSTRAINT eos_stg_import_manifest_row_range_chk
    CHECK (
      (row_num_from IS NULL AND row_num_to IS NULL)
      OR (row_num_from IS NOT NULL AND row_num_to IS NOT NULL AND row_num_from <= row_num_to)
    ),

  CONSTRAINT eos_stg_import_manifest_uk
    UNIQUE (
      branch_code,
      source_file_pattern,
      source_sheet_pattern,
      row_num_from,
      row_num_to,
      business_date
    )
);

CREATE INDEX IF NOT EXISTS ix_eos_stg_import_manifest_lookup
  ON eos_stg_import_manifest(branch_code, review_status, mapping_class);

CREATE INDEX IF NOT EXISTS ix_eos_stg_import_manifest_patterns
  ON eos_stg_import_manifest(source_file_pattern, source_sheet_pattern);

CREATE INDEX IF NOT EXISTS ix_eos_stg_import_manifest_row_range
  ON eos_stg_import_manifest(row_num_from, row_num_to);

CREATE INDEX IF NOT EXISTS ix_eos_stg_import_manifest_business_date
  ON eos_stg_import_manifest(business_date);

ALTER TABLE eos_stg_import_manifest OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_stg_import_manifest TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_stg_import_manifest_id_seq TO app_directus;

-- Convenience view: approved deterministic manifest rows only.
CREATE OR REPLACE VIEW v_eos_stg_import_manifest_approved_v1 AS
SELECT
  id,
  branch_code,
  source_file_pattern,
  source_sheet_pattern,
  row_num_from,
  row_num_to,
  business_date,
  mapping_class,
  review_status,
  source_reference,
  notes,
  created_at,
  updated_at
FROM eos_stg_import_manifest
WHERE mapping_class = 'deterministic'
  AND review_status = 'approved';

COMMIT;
