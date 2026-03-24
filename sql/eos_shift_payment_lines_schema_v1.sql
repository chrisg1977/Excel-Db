-- EOS shift payment lines source-contract schema (v1)
-- Purpose:
--   Canonical operational payment lines source for PAY SUMMARY derivation.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_shift_payment_lines_schema_v1.sql

BEGIN;

CREATE TABLE IF NOT EXISTS eos_shift_payment_lines (
  id BIGSERIAL PRIMARY KEY,
  shift_header_id BIGINT NOT NULL REFERENCES eos_shift_header(id) ON DELETE CASCADE,

  category_label_raw TEXT NULL,
  department_label_raw TEXT NULL,

  source_stage TEXT NOT NULL,
  cost_nature TEXT NOT NULL,
  payment_channel TEXT NOT NULL,
  receipt_state TEXT NOT NULL,

  ex_vat_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,2) NOT NULL DEFAULT 0,

  tax_code TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_shift_payment_lines_source_stage_chk
    CHECK (source_stage IN ('midshift', 'endshift')),

  CONSTRAINT eos_shift_payment_lines_cost_nature_chk
    CHECK (cost_nature IN ('running', 'capital')),

  CONSTRAINT eos_shift_payment_lines_payment_channel_chk
    CHECK (payment_channel IN ('cash', 'non_cash')),

  CONSTRAINT eos_shift_payment_lines_receipt_state_chk
    CHECK (receipt_state IN ('with_receipt', 'no_receipt')),

  CONSTRAINT eos_shift_payment_lines_tax_code_chk
    CHECK (tax_code IS NULL OR tax_code IN ('ECOTAX', 'VAT'))
);

CREATE INDEX IF NOT EXISTS ix_eos_shift_payment_lines_shift_header
  ON eos_shift_payment_lines(shift_header_id);

CREATE INDEX IF NOT EXISTS ix_eos_shift_payment_lines_stage_nature_channel_receipt
  ON eos_shift_payment_lines(source_stage, cost_nature, payment_channel, receipt_state);

CREATE INDEX IF NOT EXISTS ix_eos_shift_payment_lines_category_department
  ON eos_shift_payment_lines(category_label_raw, department_label_raw);

ALTER TABLE eos_shift_payment_lines OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_shift_payment_lines TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_shift_payment_lines_id_seq TO app_directus;

-- Note: updated_at is app-managed for now; add trigger-based stamping later if required.
-- Note: tax rows are identified by tax_code and will be separated into remittance categories in reporting views.

COMMIT;
