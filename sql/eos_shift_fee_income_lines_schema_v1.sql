-- EOS shift fee/income lines canonical schema (v1)
-- Purpose:
--   Canonical FEE/income transaction table for EOS pilot loads.
--   This is intentionally separate from eos_shift_payment_lines (PAY expense model).
--
-- Scope (v1):
--   - Supports EOSQ 2025 FEE strict pilot path.
--   - Commission split is deferred; commission_amount remains NULL in v1 loads.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_shift_fee_income_lines_schema_v1.sql

BEGIN;

CREATE TABLE IF NOT EXISTS eos_shift_fee_income_lines (
  id BIGSERIAL PRIMARY KEY,
  shift_header_id BIGINT NOT NULL REFERENCES eos_shift_header(id) ON DELETE CASCADE,

  -- Idempotent loader lineage key (from staged candidate id).
  source_candidate_id TEXT NOT NULL UNIQUE,

  -- Core business labels from FEE contract.
  department_label_raw TEXT NOT NULL,
  description_raw TEXT NOT NULL,
  fee_subtype_raw TEXT NOT NULL,
  detail_raw TEXT NULL,
  booking_platform_raw TEXT NULL,

  -- Shared operational dimensions (header remains shared with PAY).
  source_stage TEXT NOT NULL,
  payment_channel TEXT NOT NULL,
  receipt_state TEXT NOT NULL,

  -- Amount model for v1 FEE pilot.
  gross_amount NUMERIC(14,2) NOT NULL,
  vat_amount NUMERIC(14,2) NULL,
  ex_vat_amount NUMERIC(14,2) NULL,

  -- Deferred to later phase; do not split commissions in v1.
  commission_amount NUMERIC(14,2) NULL,

  -- Optional tax code when deterministically resolvable.
  tax_code TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_shift_fee_income_lines_source_stage_chk
    CHECK (source_stage IN ('midshift', 'endshift')),

  CONSTRAINT eos_shift_fee_income_lines_payment_channel_chk
    CHECK (payment_channel IN ('cash', 'non_cash')),

  CONSTRAINT eos_shift_fee_income_lines_receipt_state_chk
    CHECK (receipt_state IN ('with_receipt', 'no_receipt')),

  CONSTRAINT eos_shift_fee_income_lines_tax_code_chk
    CHECK (tax_code IS NULL OR tax_code IN ('ECOTAX', 'VAT')),

  CONSTRAINT eos_shift_fee_income_lines_gross_non_negative_chk
    CHECK (gross_amount >= 0),

  CONSTRAINT eos_shift_fee_income_lines_vat_non_negative_chk
    CHECK (vat_amount IS NULL OR vat_amount >= 0),

  CONSTRAINT eos_shift_fee_income_lines_ex_vat_non_negative_chk
    CHECK (ex_vat_amount IS NULL OR ex_vat_amount >= 0),

  CONSTRAINT eos_shift_fee_income_lines_vat_vs_gross_chk
    CHECK (vat_amount IS NULL OR vat_amount <= gross_amount),

  CONSTRAINT eos_shift_fee_income_lines_ex_vat_vs_gross_chk
    CHECK (ex_vat_amount IS NULL OR ex_vat_amount <= gross_amount),

  CONSTRAINT eos_shift_fee_income_lines_commission_v1_null_chk
    CHECK (commission_amount IS NULL)
);

CREATE INDEX IF NOT EXISTS ix_eos_shift_fee_income_lines_shift_header
  ON eos_shift_fee_income_lines(shift_header_id);

CREATE INDEX IF NOT EXISTS ix_eos_shift_fee_income_lines_stage_channel_receipt
  ON eos_shift_fee_income_lines(source_stage, payment_channel, receipt_state);

CREATE INDEX IF NOT EXISTS ix_eos_shift_fee_income_lines_department_subtype
  ON eos_shift_fee_income_lines(department_label_raw, fee_subtype_raw);

ALTER TABLE eos_shift_fee_income_lines OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_shift_fee_income_lines TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_shift_fee_income_lines_id_seq TO app_directus;

COMMIT;
