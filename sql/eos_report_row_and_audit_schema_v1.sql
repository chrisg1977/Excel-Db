-- EOS report row + audit schema (v1)
-- PostgreSQL
-- Purpose:
--   Provide persistence tables required by EOS report snapshot endpoints.

BEGIN;

CREATE TABLE IF NOT EXISTS eos_report_row (
  id UUID PRIMARY KEY,
  report_header_id UUID NOT NULL
    REFERENCES eos_report_header(id) ON DELETE CASCADE,
  patient_visit_key TEXT NOT NULL,
  patient_number TEXT NOT NULL,
  surname TEXT NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  treatments TEXT NOT NULL,
  fee_total NUMERIC(12,2) NOT NULL,
  appointment_datetime TIMESTAMPTZ NOT NULL,
  appointment_dismissed_at TIMESTAMPTZ NULL,
  walkout_issued_at TIMESTAMPTZ NULL,
  walkout_status TEXT NOT NULL,
  included BOOLEAN NOT NULL,
  carry_forward BOOLEAN NOT NULL,
  display_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT eos_report_row_walkout_status_chk
    CHECK (walkout_status IN ('printed', 'not_printed', 'unknown'))
);

CREATE TABLE IF NOT EXISTS eos_report_audit (
  id UUID PRIMARY KEY,
  report_header_id UUID NOT NULL
    REFERENCES eos_report_header(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  field_name TEXT NULL,
  old_value TEXT NULL,
  new_value TEXT NULL,
  acted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acted_by TEXT NOT NULL,
  reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_eos_report_row_report_header
  ON eos_report_row (report_header_id, display_order, appointment_datetime);

CREATE INDEX IF NOT EXISTS ix_eos_report_audit_report_header_acted
  ON eos_report_audit (report_header_id, acted_at ASC, id ASC);

COMMIT;
