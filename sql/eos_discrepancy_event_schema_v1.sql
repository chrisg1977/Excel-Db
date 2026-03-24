-- eos_discrepancy_event_schema_v1.sql
-- PostgreSQL schema draft for EOS discrepancy event persistence.
--
-- Purpose:
--   Persist EOS discrepancy events for later notification routing,
--   manager review, audit, and admin summary flows.
--
-- Notes:
--   - This is schema DDL only. No runtime wiring is implemented here.
--   - Foreign keys are intentionally not enforced in this first draft because
--     shift-session/report-header/department persistence may be migrated in stages.
--   - `manager_resolution_preview_json` stores preview output from the shared
--     manager-resolution logic at the time the discrepancy event was detected.

BEGIN;

CREATE TABLE IF NOT EXISTS eos_discrepancy_event (
  id UUID PRIMARY KEY,
  event_type TEXT NOT NULL,
  source_module TEXT NOT NULL,
  shift_session_id UUID NULL,
  report_header_id UUID NULL,
  location_code TEXT NOT NULL,
  department_code TEXT NOT NULL,
  department_id UUID NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  discrepancy_type TEXT NOT NULL,
  discrepancy_amount NUMERIC(12,2) NULL,
  note TEXT NULL,
  manager_resolution_preview_json JSONB NULL,
  admin_summary_required BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL,
  CONSTRAINT eos_discrepancy_event_event_type_chk CHECK (
    event_type IN (
      'opening_cash_mismatch',
      'reconciliation_discrepancy',
      'temporary_handover_discrepancy'
    )
  ),
  CONSTRAINT eos_discrepancy_event_status_chk CHECK (
    status IN (
      'detected',
      'pending_notification',
      'pending_manager_review',
      'resolved',
      'closed'
    )
  ),
  CONSTRAINT eos_discrepancy_event_source_module_nonblank_chk CHECK (btrim(source_module) <> ''),
  CONSTRAINT eos_discrepancy_event_location_code_nonblank_chk CHECK (btrim(location_code) <> ''),
  CONSTRAINT eos_discrepancy_event_department_code_nonblank_chk CHECK (btrim(department_code) <> ''),
  CONSTRAINT eos_discrepancy_event_created_by_nonblank_chk CHECK (btrim(created_by) <> ''),
  CONSTRAINT eos_discrepancy_event_discrepancy_type_nonblank_chk CHECK (btrim(discrepancy_type) <> '')
);

CREATE INDEX IF NOT EXISTS ix_eos_discrepancy_event_event_type
  ON eos_discrepancy_event (event_type);

CREATE INDEX IF NOT EXISTS ix_eos_discrepancy_event_location_code
  ON eos_discrepancy_event (location_code);

CREATE INDEX IF NOT EXISTS ix_eos_discrepancy_event_department_code
  ON eos_discrepancy_event (department_code);

CREATE INDEX IF NOT EXISTS ix_eos_discrepancy_event_department_id
  ON eos_discrepancy_event (department_id);

CREATE INDEX IF NOT EXISTS ix_eos_discrepancy_event_created_at
  ON eos_discrepancy_event (created_at);

CREATE INDEX IF NOT EXISTS ix_eos_discrepancy_event_status
  ON eos_discrepancy_event (status);

CREATE INDEX IF NOT EXISTS ix_eos_discrepancy_event_shift_session_id
  ON eos_discrepancy_event (shift_session_id);

CREATE INDEX IF NOT EXISTS ix_eos_discrepancy_event_report_header_id
  ON eos_discrepancy_event (report_header_id);

COMMIT;
