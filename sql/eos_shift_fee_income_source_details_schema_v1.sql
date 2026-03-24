-- EOS fee/income source-details sidecar schema (v1)
-- Purpose:
--   Preserve raw FEE A..N source context for auditability and replay.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_shift_fee_income_source_details_schema_v1.sql

BEGIN;

CREATE TABLE IF NOT EXISTS eos_shift_fee_income_source_details (
  id BIGSERIAL PRIMARY KEY,
  shift_fee_income_line_id BIGINT NOT NULL UNIQUE,
  source_candidate_id TEXT NOT NULL UNIQUE,

  source_table_name TEXT NOT NULL,
  source_family TEXT NOT NULL,
  source_file TEXT NOT NULL,
  source_sheet TEXT NOT NULL,
  source_row_num INTEGER NOT NULL,

  -- Raw contract fields (A..N where available in current staged mapping).
  raw_a_transaction_date_text TEXT NULL,
  raw_b_shift_text TEXT NULL,
  raw_c_department_text TEXT NULL,
  raw_d_description_text TEXT NULL,
  raw_e_detail_text TEXT NULL,
  raw_f_booking_platform_text TEXT NULL,
  raw_g_fee_subtype_text TEXT NULL,
  raw_h_gross_amount_text TEXT NULL,
  raw_i_vat_percentage_text TEXT NULL,
  raw_j_vat_amount_text TEXT NULL,
  raw_k_receipt_issued_text TEXT NULL,
  raw_l_payment_method_text TEXT NULL,
  raw_n_user_signing_text TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_shift_fee_income_source_details_fk_line
    FOREIGN KEY (shift_fee_income_line_id)
    REFERENCES eos_shift_fee_income_lines(id)
    ON DELETE CASCADE
);

ALTER TABLE eos_shift_fee_income_source_details OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_shift_fee_income_source_details TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_shift_fee_income_source_details_id_seq TO app_directus;

COMMIT;
