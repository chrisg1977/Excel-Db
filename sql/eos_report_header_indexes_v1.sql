-- EOS report-header retrieval indexes (v1)
-- Purpose:
--   Support management retrieval filters and default ordering for
--   `GET /api/eos/reports` and `GET /api/eos/reports/:id`.
--
-- Notes:
--   - PostgreSQL target.
--   - Draft only. This file adds indexes only; it does not create the
--     `eos_report_header` table itself.

BEGIN;

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

COMMIT;
