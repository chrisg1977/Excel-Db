-- EOS PRODUCTLIST ingest run-audit schema (v1)
-- Purpose:
--   Persist post-load run tracking so repeated PRODUCTLIST runs are
--   traceable and idempotency can be evidenced.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_product_ingest_run_audit_schema_v1.sql

BEGIN;

CREATE TABLE IF NOT EXISTS eos_product_ingest_run_audit (
  run_id BIGSERIAL PRIMARY KEY,

  run_started_at TIMESTAMPTZ NOT NULL,
  run_finished_at TIMESTAMPTZ NOT NULL,

  source_file TEXT NULL,
  source_sheet TEXT NULL,

  candidate_row_count INTEGER NOT NULL DEFAULT 0,
  deterministic_ready_count INTEGER NOT NULL DEFAULT 0,
  unresolved_count INTEGER NOT NULL DEFAULT 0,

  inserted_root_count INTEGER NOT NULL DEFAULT 0,
  inserted_identity_count INTEGER NOT NULL DEFAULT 0,
  inserted_attributes_count INTEGER NOT NULL DEFAULT 0,
  inserted_pricing_count INTEGER NOT NULL DEFAULT 0,

  skipped_root_count INTEGER NOT NULL DEFAULT 0,
  skipped_identity_count INTEGER NOT NULL DEFAULT 0,
  skipped_attributes_count INTEGER NOT NULL DEFAULT 0,
  skipped_pricing_count INTEGER NOT NULL DEFAULT 0,

  -- Optional update counters for upsert-based tables.
  updated_attributes_count INTEGER NOT NULL DEFAULT 0,
  updated_pricing_count INTEGER NOT NULL DEFAULT 0,

  -- Snapshot counts of canonical product tables.
  master_row_count BIGINT NOT NULL DEFAULT 0,
  identity_row_count BIGINT NOT NULL DEFAULT 0,
  attributes_row_count BIGINT NOT NULL DEFAULT 0,
  pricing_row_count BIGINT NOT NULL DEFAULT 0,

  -- Deltas vs previous run (NULL on first run).
  master_row_delta BIGINT NULL,
  identity_row_delta BIGINT NULL,
  attributes_row_delta BIGINT NULL,
  pricing_row_delta BIGINT NULL,

  -- Stable fingerprints for canonical product tables.
  master_fingerprint TEXT NOT NULL,
  identity_fingerprint TEXT NOT NULL,
  attributes_fingerprint TEXT NOT NULL,
  pricing_fingerprint TEXT NOT NULL,

  idempotency_held BOOLEAN NOT NULL DEFAULT FALSE,

  notes TEXT NULL,
  source_reference TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_product_ingest_run_audit_time_chk
    CHECK (run_finished_at >= run_started_at),

  CONSTRAINT eos_product_ingest_run_audit_non_negative_chk
    CHECK (
      candidate_row_count >= 0
      AND deterministic_ready_count >= 0
      AND unresolved_count >= 0
      AND inserted_root_count >= 0
      AND inserted_identity_count >= 0
      AND inserted_attributes_count >= 0
      AND inserted_pricing_count >= 0
      AND skipped_root_count >= 0
      AND skipped_identity_count >= 0
      AND skipped_attributes_count >= 0
      AND skipped_pricing_count >= 0
      AND updated_attributes_count >= 0
      AND updated_pricing_count >= 0
      AND master_row_count >= 0
      AND identity_row_count >= 0
      AND attributes_row_count >= 0
      AND pricing_row_count >= 0
    ),

  CONSTRAINT eos_product_ingest_run_audit_fingerprint_chk
    CHECK (
      master_fingerprint ~ '^[0-9a-f]{32}$'
      AND identity_fingerprint ~ '^[0-9a-f]{32}$'
      AND attributes_fingerprint ~ '^[0-9a-f]{32}$'
      AND pricing_fingerprint ~ '^[0-9a-f]{32}$'
    )
);

CREATE INDEX IF NOT EXISTS ix_eos_product_ingest_run_audit_finished
  ON eos_product_ingest_run_audit(run_finished_at DESC);

CREATE INDEX IF NOT EXISTS ix_eos_product_ingest_run_audit_created
  ON eos_product_ingest_run_audit(created_at DESC);

ALTER TABLE eos_product_ingest_run_audit OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_product_ingest_run_audit TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_product_ingest_run_audit_run_id_seq TO app_directus;

COMMIT;
