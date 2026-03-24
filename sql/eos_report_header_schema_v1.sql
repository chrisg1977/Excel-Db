-- EOS report header schema (v1)
-- PostgreSQL
-- Notes:
--   - Append-only snapshot model.
--   - Each header belongs to one accounting period and one shift session.

BEGIN;

CREATE TABLE IF NOT EXISTS eos_report_header (
  id UUID PRIMARY KEY,
  accounting_period_id UUID NOT NULL
    REFERENCES eos_accounting_period(id) ON DELETE RESTRICT,
  shift_session_id UUID NOT NULL
    REFERENCES eos_shift_session(id) ON DELETE RESTRICT,
  location_code TEXT NOT NULL,
  department_code TEXT NOT NULL,
  clinic_code TEXT NOT NULL,
  report_start_at TIMESTAMPTZ NOT NULL,
  report_end_at TIMESTAMPTZ NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by TEXT NOT NULL,
  report_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT eos_report_header_window_chk
    CHECK (report_end_at >= report_start_at),

  CONSTRAINT eos_report_header_report_type_chk
    CHECK (report_type IN ('standard', 'management_exception')),

  CONSTRAINT eos_report_header_status_chk
    CHECK (status IN ('draft', 'saved', 'submitted', 'locked'))
);

CREATE INDEX IF NOT EXISTS ix_eos_report_header_period
  ON eos_report_header (accounting_period_id);

CREATE INDEX IF NOT EXISTS ix_eos_report_header_shift_session
  ON eos_report_header (shift_session_id);

CREATE INDEX IF NOT EXISTS ix_eos_report_header_generated_at
  ON eos_report_header (generated_at DESC);

CREATE INDEX IF NOT EXISTS ix_eos_report_header_status
  ON eos_report_header (status);

COMMIT;
