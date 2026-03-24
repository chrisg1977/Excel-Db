-- EOS report-row retrieval indexes (v1)
-- Purpose:
--   Support ordered row retrieval for saved EOS report snapshots.
--
-- Notes:
--   - PostgreSQL target.
--   - Draft only. This file adds indexes only; it does not create the
--     `eos_report_row` table itself.

BEGIN;

CREATE INDEX IF NOT EXISTS ix_eos_report_row_report_header
  ON eos_report_row (report_header_id, display_order, appointment_datetime);

COMMIT;
