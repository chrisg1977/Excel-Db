-- EOS report snapshot detail indexes (v1)
-- Purpose:
--   Support summary and audit retrieval for `GET /api/eos/reports/:id`.
--
-- Notes:
--   - PostgreSQL target.
--   - Draft only. This file adds indexes only; it does not create the
--     `eos_report_summary` or `eos_report_audit` tables themselves.

BEGIN;

CREATE INDEX IF NOT EXISTS ix_eos_report_summary_report_header
  ON eos_report_summary (report_header_id);

CREATE INDEX IF NOT EXISTS ix_eos_report_audit_report_header_acted
  ON eos_report_audit (report_header_id, acted_at ASC, id ASC);

COMMIT;
