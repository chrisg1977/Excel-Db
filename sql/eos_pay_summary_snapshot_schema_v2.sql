-- EOS PAY SUMMARY monthly snapshot schema (v2)
-- Purpose:
--   Persist monthly PAY SUMMARY outputs for stable reporting, versioning, and publish workflows.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_pay_summary_snapshot_schema_v2.sql

BEGIN;

CREATE TABLE IF NOT EXISTS eos_pay_summary_monthly_snapshot (
  id BIGSERIAL PRIMARY KEY,

  business_month DATE NOT NULL,
  branch_code TEXT NOT NULL,
  category_type TEXT NOT NULL,
  category_key TEXT NOT NULL,

  -- Department link is nullable for reporting buckets and must be NULL for tax rows.
  department_id BIGINT NULL REFERENCES departments(dept_id) ON DELETE RESTRICT,

  category_display_name TEXT NOT NULL,
  is_department_row BOOLEAN NOT NULL DEFAULT FALSE,

  running_non_cash_ex_vat NUMERIC(14,2) NOT NULL DEFAULT 0,
  running_non_cash_vat NUMERIC(14,2) NOT NULL DEFAULT 0,
  running_cash_ex_vat NUMERIC(14,2) NOT NULL DEFAULT 0,
  running_cash_vat NUMERIC(14,2) NOT NULL DEFAULT 0,
  running_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  running_no_receipt_total NUMERIC(14,2) NOT NULL DEFAULT 0,

  capital_non_cash_ex_vat NUMERIC(14,2) NOT NULL DEFAULT 0,
  capital_non_cash_vat NUMERIC(14,2) NOT NULL DEFAULT 0,
  capital_cash_ex_vat NUMERIC(14,2) NOT NULL DEFAULT 0,
  capital_cash_vat NUMERIC(14,2) NOT NULL DEFAULT 0,
  capital_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  capital_no_receipt_total NUMERIC(14,2) NOT NULL DEFAULT 0,

  tax_remittance_ecotax NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_remittance_vat NUMERIC(14,2) NOT NULL DEFAULT 0,

  grand_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_no_receipt NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_ex_vat NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_vat NUMERIC(14,2) NOT NULL DEFAULT 0,

  source_row_count INTEGER NOT NULL DEFAULT 0,
  calc_version TEXT NOT NULL DEFAULT 'v2',

  published_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Placeholder decision: keep as TEXT for now; may migrate to directus_users UUID/FK later.
  published_by TEXT NULL,

  -- Placeholder decision: keep as TEXT for now; may migrate to FK later.
  source_import_batch_id TEXT NULL,

  reconciliation_status TEXT NOT NULL DEFAULT 'PENDING',
  reconciliation_notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_ps_snapshot_branch_code_chk
    CHECK (branch_code IN ('EOSZ', 'EOSQ', 'EOSBLUM')),

  CONSTRAINT eos_ps_snapshot_category_type_chk
    CHECK (category_type IN ('department', 'reporting_bucket', 'tax')),

  -- Explicit tax-row protection rule.
  CONSTRAINT eos_ps_snapshot_tax_rules_chk
    CHECK (
      (category_type = 'tax'
       AND department_id IS NULL
       AND category_key IN ('ECOTAX_REMITTANCE', 'VAT_REMITTANCE'))
      OR
      (category_type <> 'tax'
       AND category_key NOT IN ('ECOTAX_REMITTANCE', 'VAT_REMITTANCE'))
    )
);

-- Required pattern: unique index expression instead of table-level UNIQUE with COALESCE.
CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_ps_snapshot_key
  ON eos_pay_summary_monthly_snapshot (
    business_month,
    branch_code,
    category_type,
    category_key,
    calc_version,
    (COALESCE(department_id, -1))
  );

CREATE INDEX IF NOT EXISTS ix_eos_ps_snapshot_month_branch
  ON eos_pay_summary_monthly_snapshot (business_month, branch_code);

CREATE INDEX IF NOT EXISTS ix_eos_ps_snapshot_category
  ON eos_pay_summary_monthly_snapshot (category_type, category_key);

CREATE INDEX IF NOT EXISTS ix_eos_ps_snapshot_department
  ON eos_pay_summary_monthly_snapshot (department_id)
  WHERE department_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_eos_ps_snapshot_recon_status
  ON eos_pay_summary_monthly_snapshot (reconciliation_status);

ALTER TABLE eos_pay_summary_monthly_snapshot OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_pay_summary_monthly_snapshot TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_pay_summary_monthly_snapshot_id_seq TO app_directus;

COMMIT;
