-- sql/eos_reporting_indexes_v1.sql
-- Purpose:
--   PostgreSQL indexes for EOS saved-report retrieval and management reporting.
--
-- Scope:
--   - eos_report_header list filtering and ordering
--   - eos_report_summary direct lookup
--   - eos_report_row / eos_report_audit indexes deferred until those tables exist
--
-- Notes:
--   - Uses IF NOT EXISTS for safe repeat runs
--   - Keeps append-only snapshot retrieval in mind
--   - Optimized for:
--       * GET /api/eos/reports
--       * GET /api/eos/reports/:id

BEGIN;

-- =========================
-- eos_report_header
-- Single-column indexes
-- =========================

CREATE INDEX IF NOT EXISTS ix_eos_report_header_generated_at
  ON eos_report_header (generated_at DESC);

CREATE INDEX IF NOT EXISTS ix_eos_report_header_period
  ON eos_report_header (accounting_period_id);

CREATE INDEX IF NOT EXISTS ix_eos_report_header_clinic
  ON eos_report_header (clinic_code);

CREATE INDEX IF NOT EXISTS ix_eos_report_header_department
  ON eos_report_header (department_code);

CREATE INDEX IF NOT EXISTS ix_eos_report_header_location
  ON eos_report_header (location_code);

CREATE INDEX IF NOT EXISTS ix_eos_report_header_shift_session
  ON eos_report_header (shift_session_id);

CREATE INDEX IF NOT EXISTS ix_eos_report_header_generated_by
  ON eos_report_header (generated_by);

CREATE INDEX IF NOT EXISTS ix_eos_report_header_status
  ON eos_report_header (status);

CREATE INDEX IF NOT EXISTS ix_eos_report_header_report_type
  ON eos_report_header (report_type);

CREATE INDEX IF NOT EXISTS ix_eos_report_header_report_start_at
  ON eos_report_header (report_start_at);

-- =========================
-- eos_report_header
-- Composite indexes
-- =========================

CREATE INDEX IF NOT EXISTS ix_eos_report_header_period_generated
  ON eos_report_header (accounting_period_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS ix_eos_report_header_clinic_period_generated
  ON eos_report_header (clinic_code, accounting_period_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS ix_eos_report_header_department_period_generated
  ON eos_report_header (department_code, accounting_period_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS ix_eos_report_header_location_period_generated
  ON eos_report_header (location_code, accounting_period_id, generated_at DESC);

CREATE INDEX IF NOT EXISTS ix_eos_report_header_status_generated
  ON eos_report_header (status, generated_at DESC);

-- Optional but useful if report_type + period filtering becomes common
CREATE INDEX IF NOT EXISTS ix_eos_report_header_report_type_period_generated
  ON eos_report_header (report_type, accounting_period_id, generated_at DESC);

-- Optional but useful if generated_by + period filtering becomes common
CREATE INDEX IF NOT EXISTS ix_eos_report_header_generated_by_period_generated
  ON eos_report_header (generated_by, accounting_period_id, generated_at DESC);

-- =========================
-- eos_report_summary
-- One summary per report
-- =========================

CREATE UNIQUE INDEX IF NOT EXISTS ix_eos_report_summary_report_header
  ON eos_report_summary (report_header_id);

-- =========================
-- Deferred until later schema rollout
-- Apply these when eos_report_row and eos_report_audit exist
-- =========================

-- eos_report_row
-- CREATE INDEX IF NOT EXISTS ix_eos_report_row_report_header
--   ON eos_report_row (report_header_id, display_order, appointment_datetime, id);
-- CREATE INDEX IF NOT EXISTS ix_eos_report_row_patient_visit_key
--   ON eos_report_row (patient_visit_key);
-- CREATE INDEX IF NOT EXISTS ix_eos_report_row_walkout_status
--   ON eos_report_row (walkout_status);
-- CREATE INDEX IF NOT EXISTS ix_eos_report_row_carry_forward
--   ON eos_report_row (carry_forward);
-- CREATE INDEX IF NOT EXISTS ix_eos_report_row_included
--   ON eos_report_row (included);

-- eos_report_audit
-- CREATE INDEX IF NOT EXISTS ix_eos_report_audit_report_header
--   ON eos_report_audit (report_header_id, acted_at ASC, id ASC);
-- CREATE INDEX IF NOT EXISTS ix_eos_report_audit_action
--   ON eos_report_audit (action);

-- For future management filtering by latest snapshots only, if fields are added:
-- CREATE INDEX IF NOT EXISTS ix_eos_report_header_latest_for_shift
--   ON eos_report_header (shift_session_id, is_latest_for_shift, generated_at DESC);

-- For future browsing by snapshot kind/version:
-- CREATE INDEX IF NOT EXISTS ix_eos_report_header_snapshot_kind_generated
--   ON eos_report_header (snapshot_kind, generated_at DESC);

COMMIT;
