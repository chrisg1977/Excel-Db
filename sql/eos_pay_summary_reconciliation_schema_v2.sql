-- EOS PAY SUMMARY reconciliation schema (v2)
-- Purpose:
--   Store workbook-vs-database metric reconciliation checkpoints for PAY SUMMARY outputs.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_pay_summary_reconciliation_schema_v2.sql

BEGIN;

CREATE TABLE IF NOT EXISTS eos_pay_summary_reconciliation (
  id BIGSERIAL PRIMARY KEY,

  business_month DATE NOT NULL,
  branch_code TEXT NOT NULL,
  category_type TEXT NOT NULL,
  category_key TEXT NOT NULL,
  department_id BIGINT NULL REFERENCES departments(dept_id) ON DELETE RESTRICT,
  metric_key TEXT NOT NULL,

  workbook_value NUMERIC(14,2) NOT NULL,
  db_value NUMERIC(14,2) NOT NULL,
  variance NUMERIC(14,2) NOT NULL,
  variance_abs NUMERIC(14,2) NOT NULL,
  tolerance NUMERIC(14,4) NOT NULL DEFAULT 0.01,

  status TEXT NOT NULL,

  workbook_source_file TEXT NULL,
  workbook_cell_ref TEXT NULL,

  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  checked_by TEXT NULL,
  notes TEXT NULL,

  CONSTRAINT eos_ps_recon_branch_code_chk
    CHECK (branch_code IN ('EOSZ', 'EOSQ', 'EOSBLUM')),

  CONSTRAINT eos_ps_recon_category_type_chk
    CHECK (category_type IN ('department', 'reporting_bucket', 'tax')),

  CONSTRAINT eos_ps_recon_status_chk
    CHECK (status IN ('MATCHED', 'MISMATCHED', 'OVERRIDDEN')),

  CONSTRAINT eos_ps_recon_tolerance_non_negative_chk
    CHECK (tolerance >= 0),

  -- Explicit tax-row protection rule.
  CONSTRAINT eos_ps_recon_tax_rules_chk
    CHECK (
      (category_type = 'tax'
       AND department_id IS NULL
       AND category_key IN ('ECOTAX_REMITTANCE', 'VAT_REMITTANCE'))
      OR
      (category_type <> 'tax'
       AND category_key NOT IN ('ECOTAX_REMITTANCE', 'VAT_REMITTANCE'))
    )
);

-- Required by approved design.
CREATE INDEX IF NOT EXISTS ix_eos_ps_recon_month_branch_cat_metric
  ON eos_pay_summary_reconciliation (business_month, branch_code, category_key, metric_key);

CREATE INDEX IF NOT EXISTS ix_eos_ps_recon_status
  ON eos_pay_summary_reconciliation (status);

-- Helpful operational lookups.
CREATE INDEX IF NOT EXISTS ix_eos_ps_recon_checked_at
  ON eos_pay_summary_reconciliation (checked_at DESC);

CREATE INDEX IF NOT EXISTS ix_eos_ps_recon_department
  ON eos_pay_summary_reconciliation (department_id)
  WHERE department_id IS NOT NULL;

ALTER TABLE eos_pay_summary_reconciliation OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_pay_summary_reconciliation TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_pay_summary_reconciliation_id_seq TO app_directus;

/*
Optional later fields (NOT required now):
- calc_version TEXT
- category_display_name TEXT
- source_workbook_sheet TEXT
*/

COMMIT;
