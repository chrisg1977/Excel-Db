-- EOS report summary schema (v1)
-- PostgreSQL
-- Notes:
--   - One summary row per report header.
--   - Independent from later discrepancy-review workflows.

BEGIN;

CREATE TABLE IF NOT EXISTS eos_report_summary (
  id UUID PRIMARY KEY,
  report_header_id UUID NOT NULL
    REFERENCES eos_report_header(id) ON DELETE CASCADE,
  opening_cash NUMERIC(12,2) NOT NULL,
  payment_total NUMERIC(12,2) NOT NULL,
  cash_envelope_total NUMERIC(12,2) NOT NULL,
  cashbox_expenses_total NUMERIC(12,2) NOT NULL,
  sell_total NUMERIC(12,2) NOT NULL,
  fee_total NUMERIC(12,2) NOT NULL,
  expected_total NUMERIC(12,2) NOT NULL,
  actual_total NUMERIC(12,2) NOT NULL,
  discrepancy_total NUMERIC(12,2) NOT NULL,
  manager_alert_created BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT ix_eos_report_summary_report_header
    UNIQUE (report_header_id)
);

COMMIT;
