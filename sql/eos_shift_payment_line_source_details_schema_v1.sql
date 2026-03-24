-- EOS payment-line source preservation schema (v1)
-- Purpose:
--   Preserve full operational/raw PAY source fields for audit/queryability,
--   while canonical financial columns remain normalized in eos_shift_payment_lines.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_shift_payment_line_source_details_schema_v1.sql

BEGIN;

ALTER TABLE eos_shift_payment_lines
  ADD COLUMN IF NOT EXISTS source_candidate_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_shift_payment_lines_source_candidate_id
  ON eos_shift_payment_lines(source_candidate_id)
  WHERE source_candidate_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS eos_shift_payment_line_source_details (
  id BIGSERIAL PRIMARY KEY,
  shift_payment_line_id BIGINT NOT NULL UNIQUE,
  source_candidate_id TEXT NOT NULL UNIQUE,

  source_table_name TEXT NOT NULL,
  source_family TEXT NOT NULL,
  source_file TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row_num INTEGER NOT NULL,

  raw_business_date_text TEXT NULL,
  raw_shift_text TEXT NULL,
  raw_merchant_text TEXT NULL,
  raw_description_text TEXT NULL,
  raw_type_text TEXT NULL,
  raw_invoice_text TEXT NULL,
  raw_reference_text TEXT NULL,
  raw_assistant_text TEXT NULL,
  raw_payment_method_text TEXT NULL,
  raw_receipt_text TEXT NULL,
  raw_department_text TEXT NULL,
  raw_cost_nature_text TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_shift_payment_line_source_details_fk_line
    FOREIGN KEY (shift_payment_line_id)
    REFERENCES eos_shift_payment_lines(id)
    ON DELETE CASCADE
);

ALTER TABLE eos_shift_payment_line_source_details OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_shift_payment_line_source_details TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_shift_payment_line_source_details_id_seq TO app_directus;

COMMIT;
