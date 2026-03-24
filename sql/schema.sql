-- Excel-Db schema + DB role groundwork
-- Apply with:
--   psql -h localhost -p 55432 -U excel -d exceldb -f sql/schema.sql
--
-- Notes:
-- - `app_directus` is the DB login Directus should use (data CRUD, no schema changes).
-- - `schema_admin` owns schema objects and is used only for intentional DDL changes.

BEGIN;

-- ---------------- Roles (idempotent) ----------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_directus') THEN
    CREATE ROLE app_directus LOGIN PASSWORD 'CHANGE_ME_STRONG';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'schema_admin') THEN
    CREATE ROLE schema_admin LOGIN PASSWORD 'CHANGE_ME_STRONG_2';
  END IF;
END
$$;

-- Reduce default risk: no one should be able to CREATE in public schema unless granted.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Ensure schema_admin can manage schema objects, and owns the public schema.
GRANT USAGE, CREATE ON SCHEMA public TO schema_admin;
ALTER SCHEMA public OWNER TO schema_admin;

-- App user can use schema (but cannot CREATE/ALTER/DROP).
GRANT USAGE ON SCHEMA public TO app_directus;

-- Directus internal tables live in their own schema so `app_directus` can bootstrap
-- Directus without being able to CREATE in `public`.
CREATE SCHEMA IF NOT EXISTS directus AUTHORIZATION schema_admin;
GRANT USAGE, CREATE ON SCHEMA directus TO app_directus;

-- Tracks each source file imported (deduped by sha256).
CREATE TABLE IF NOT EXISTS import_files (
  file_id BIGSERIAL PRIMARY KEY,
  source_filename TEXT NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Raw audit trail of every imported row (including errors).
CREATE TABLE IF NOT EXISTS import_rows_raw (
  raw_id BIGSERIAL PRIMARY KEY,
  file_id BIGINT NOT NULL REFERENCES import_files(file_id) ON DELETE CASCADE,
  sheet_name TEXT NOT NULL,
  row_number INTEGER NOT NULL,
  raw_json JSONB NOT NULL,
  parse_status TEXT NOT NULL DEFAULT 'ok',
  error TEXT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Employee core record (stable identifiers + contact/address).
CREATE TABLE IF NOT EXISTS employees (
  emp_id INTEGER PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  national_id VARCHAR(32) NULL,
  social_security_no VARCHAR(32) NULL,
  tax_number VARCHAR(32) NULL,
  nationality VARCHAR(64) NULL,
  nationality_country VARCHAR(64) NULL,
  nationality_region VARCHAR(16) NULL,
  spouse_national_id VARCHAR(32) NULL,
  dob DATE NULL,
  email TEXT NULL,
  phone_primary TEXT NULL,
  phone_secondary TEXT NULL,
  iban TEXT NULL,
  address1 TEXT NULL,
  address2 TEXT NULL,
  city TEXT NULL,
  postcode TEXT NULL,
  CONSTRAINT employees_emp_id_format_chk CHECK (emp_id BETWEEN 1900000 AND 3000999)
);

-- Name history (supports future name changes).
CREATE TABLE IF NOT EXISTS employee_name_history (
  name_id BIGSERIAL PRIMARY KEY,
  emp_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  surname TEXT NOT NULL,
  short_name TEXT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  CONSTRAINT employee_name_history_emp_id_effective_from_key UNIQUE (emp_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_employee_name_current
  ON employee_name_history(emp_id)
  WHERE effective_to IS NULL;

-- Employment terms history.
CREATE TABLE IF NOT EXISTS employee_employment_terms (
  terms_id BIGSERIAL PRIMARY KEY,
  emp_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  position_held TEXT NULL,
  weekly_hours NUMERIC(5,2) NULL,
  employment_type TEXT NULL,
  date_first_employed DATE NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  CONSTRAINT employee_employment_terms_emp_id_effective_from_key UNIQUE (emp_id, effective_from)
);

CREATE INDEX IF NOT EXISTS idx_employee_terms_current
  ON employee_employment_terms(emp_id)
  WHERE effective_to IS NULL;

-- Tracks last used sequential EMPID number per year prefix (YYYY###).
CREATE TABLE IF NOT EXISTS emp_id_sequences (
  year INTEGER PRIMARY KEY,
  last_seq INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT emp_id_sequences_year_chk CHECK (year BETWEEN 1900 AND 3000),
  CONSTRAINT emp_id_sequences_last_seq_chk CHECK (last_seq BETWEEN 0 AND 999)
);

-- ---------------- Views (Directus-friendly) ----------------
-- Current employee view (NO PAY COLUMNS): safe for HR collections.
CREATE OR REPLACE VIEW vw_employee_current AS
SELECT
  e.emp_id,
  nh.surname,
  nh.first_name AS name,
  nh.short_name,
  et.date_first_employed,
  et.position_held,
  et.weekly_hours,
  et.employment_type,
  e.phone_primary,
  e.phone_secondary,
  e.email,
  e.dob,
  e.national_id,
  e.social_security_no,
  e.tax_number,
  e.iban,
  e.address1,
  e.address2,
  e.city,
  e.postcode,
  e.nationality,
  e.nationality_country,
  e.nationality_region,
  e.is_active
FROM employees e
LEFT JOIN LATERAL (
  SELECT nh.first_name, nh.surname, nh.short_name
  FROM employee_name_history nh
  WHERE nh.emp_id = e.emp_id AND nh.effective_to IS NULL
  ORDER BY nh.effective_from DESC
  LIMIT 1
) nh ON TRUE
LEFT JOIN LATERAL (
  SELECT et.date_first_employed, et.position_held, et.weekly_hours, et.employment_type
  FROM employee_employment_terms et
  WHERE et.emp_id = e.emp_id AND et.effective_to IS NULL
  ORDER BY et.effective_from DESC
  LIMIT 1
) et ON TRUE;

-- ---------------- Pay separation ----------------
-- Pay data is stored separately from HR-facing employee tables.
CREATE TABLE IF NOT EXISTS employee_pay_private (
  pay_id BIGSERIAL PRIMARY KEY,
  emp_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  pay_type TEXT NOT NULL, -- e.g. 'salary', 'hourly'
  amount NUMERIC(12,2) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS employee_pay_private_current_idx
  ON employee_pay_private(emp_id)
  WHERE effective_to IS NULL;

-- Private pay view (intended for owner-only Directus permissions).
CREATE OR REPLACE VIEW vw_employee_pay_private AS
SELECT
  e.emp_id,
  nh.first_name,
  nh.surname,
  nh.short_name,
  pp.pay_type,
  pp.amount,
  pp.currency,
  pp.effective_from,
  pp.effective_to,
  pp.notes,
  pp.created_at
FROM employees e
LEFT JOIN LATERAL (
  SELECT nh.*
  FROM employee_name_history nh
  WHERE nh.emp_id = e.emp_id AND nh.effective_to IS NULL
  ORDER BY nh.effective_from DESC
  LIMIT 1
) nh ON TRUE
LEFT JOIN LATERAL (
  SELECT pp.*
  FROM employee_pay_private pp
  WHERE pp.emp_id = e.emp_id AND pp.effective_to IS NULL
  ORDER BY pp.effective_from DESC
  LIMIT 1
) pp ON TRUE;

-- Ensure schema_admin owns the objects (works both for fresh DB and existing DB).
DO $$
DECLARE
  obj RECORD;
BEGIN
  FOR obj IN
    SELECT unnest(ARRAY[
      'import_files',
      'import_rows_raw',
      'employees',
      'employee_name_history',
      'employee_employment_terms',
      'emp_id_sequences',
      'employee_pay_private'
    ]) AS name
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO schema_admin', obj.name);
  END LOOP;

  FOR obj IN
    SELECT unnest(ARRAY[
      'vw_employee_current',
      'vw_employee_pay_private'
    ]) AS name
  LOOP
    EXECUTE format('ALTER VIEW public.%I OWNER TO schema_admin', obj.name);
  END LOOP;

  FOR obj IN
    SELECT c.relname AS seqname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
      AND EXISTS (
        SELECT 1
        FROM pg_depend d
        JOIN pg_class t ON t.oid = d.refobjid
        WHERE d.objid = c.oid
          AND t.relname = ANY (ARRAY[
            'import_files',
            'import_rows_raw',
            'employee_name_history',
            'employee_employment_terms',
            'employee_pay_private'
          ])
      )
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO schema_admin', obj.seqname);
  END LOOP;
END
$$;

-- ---------------- Grants for Directus DB user ----------------
-- Allow CRUD on all tables and sequences (Directus needs sequences for IDENTITY).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_directus;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_directus;

-- Future-proof grants for objects created by schema_admin.
ALTER DEFAULT PRIVILEGES FOR ROLE schema_admin IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_directus;

ALTER DEFAULT PRIVILEGES FOR ROLE schema_admin IN SCHEMA public
GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_directus;

COMMIT;
BEGIN;

-- ---------------- Phase 1: Periods, Weekly Inputs, Banked Hours ----------------
CREATE TABLE IF NOT EXISTS pay_periods (
  id BIGSERIAL PRIMARY KEY,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pay_periods_year_chk CHECK (year BETWEEN 1900 AND 3000),
  CONSTRAINT pay_periods_month_chk CHECK (month BETWEEN 1 AND 12),
  CONSTRAINT pay_periods_status_chk CHECK (status IN ('draft', 'locked', 'posted')),
  CONSTRAINT pay_periods_dates_chk CHECK (period_start <= period_end),
  CONSTRAINT pay_periods_year_month_key UNIQUE (year, month)
);

CREATE INDEX IF NOT EXISTS idx_pay_periods_status
  ON pay_periods(status);

CREATE TABLE IF NOT EXISTS timesheet_weeks (
  id BIGSERIAL PRIMARY KEY,
  pay_period_id BIGINT NOT NULL REFERENCES pay_periods(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE RESTRICT,
  week_start DATE NOT NULL,
  week_end DATE GENERATED ALWAYS AS (week_start + 6) STORED,
  normal_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  overtime_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  leave_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  casual_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  extra_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  banked_hours_delta NUMERIC(8,2) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT timesheet_weeks_unique_week UNIQUE (pay_period_id, employee_id, week_start),
  CONSTRAINT timesheet_weeks_normal_hours_chk CHECK (normal_hours >= 0),
  CONSTRAINT timesheet_weeks_overtime_hours_chk CHECK (overtime_hours >= 0),
  CONSTRAINT timesheet_weeks_leave_hours_chk CHECK (leave_hours >= 0),
  CONSTRAINT timesheet_weeks_casual_hours_chk CHECK (casual_hours >= 0),
  CONSTRAINT timesheet_weeks_extra_hours_chk CHECK (extra_hours >= 0)
);

CREATE INDEX IF NOT EXISTS idx_timesheet_weeks_employee_period
  ON timesheet_weeks(employee_id, pay_period_id);

CREATE INDEX IF NOT EXISTS idx_timesheet_weeks_week_start
  ON timesheet_weeks(week_start);

CREATE TABLE IF NOT EXISTS banked_hours_ledger (
  id BIGSERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE RESTRICT,
  pay_period_id BIGINT NULL REFERENCES pay_periods(id) ON DELETE SET NULL,
  timesheet_week_id BIGINT NULL REFERENCES timesheet_weeks(id) ON DELETE SET NULL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  entry_type TEXT NOT NULL,
  hours_delta NUMERIC(8,2) NOT NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT banked_hours_ledger_entry_type_chk CHECK (entry_type IN ('credit', 'debit', 'adjustment', 'carry_forward')),
  CONSTRAINT banked_hours_ledger_hours_delta_chk CHECK (hours_delta <> 0)
);

CREATE INDEX IF NOT EXISTS idx_banked_hours_ledger_employee_date
  ON banked_hours_ledger(employee_id, entry_date);

ALTER TABLE pay_periods OWNER TO schema_admin;
ALTER TABLE timesheet_weeks OWNER TO schema_admin;
ALTER TABLE banked_hours_ledger OWNER TO schema_admin;

GRANT SELECT, INSERT, UPDATE, DELETE ON pay_periods TO app_directus;
GRANT SELECT, INSERT, UPDATE, DELETE ON timesheet_weeks TO app_directus;
GRANT SELECT, INSERT, UPDATE, DELETE ON banked_hours_ledger TO app_directus;

GRANT USAGE, SELECT, UPDATE ON SEQUENCE pay_periods_id_seq TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE timesheet_weeks_id_seq TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE banked_hours_ledger_id_seq TO app_directus;

COMMIT;

BEGIN;

-- ---------------- Social Security brackets ----------------
CREATE TABLE IF NOT EXISTS social_security_brackets (
  id BIGSERIAL PRIMARY KEY,
  year INTEGER NOT NULL,
  band_from NUMERIC(12,2) NOT NULL,
  band_to NUMERIC(12,2) NULL,
  employee_rate NUMERIC(6,4) NOT NULL,
  employer_rate NUMERIC(6,4) NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ss_brackets_year
  ON social_security_brackets(year);

-- ---------------- Departments ----------------
CREATE TABLE IF NOT EXISTS departments (
  dept_id BIGSERIAL PRIMARY KEY,
  abbreviation VARCHAR(16) NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------- Leave Types ----------------
CREATE TABLE IF NOT EXISTS leave_types (
  id BIGSERIAL PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  default_hours NUMERIC(8,2) NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------- Leave Policies (per dept & year) ----------------
CREATE TABLE IF NOT EXISTS leave_policies (
  id BIGSERIAL PRIMARY KEY,
  year INTEGER NOT NULL,
  dept_id BIGINT NOT NULL REFERENCES departments(dept_id) ON DELETE CASCADE,
  leave_type_id BIGINT NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  entitlement_hours NUMERIC(10,2) NOT NULL,
  carry_forward_percent NUMERIC(5,2) NULL,
  effective_from DATE NULL,
  effective_to DATE NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT leave_policies_unique UNIQUE (year, dept_id, leave_type_id)
);

CREATE INDEX IF NOT EXISTS idx_leave_policies_year_dept
  ON leave_policies(year, dept_id);

-- ---------------- Fiscal / Active Year ----------------
CREATE TABLE IF NOT EXISTS fiscal_settings (
  id BIGSERIAL PRIMARY KEY,
  year INTEGER NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------- COLA (Cost of Living Allowance) ----------------
-- Keep annual weekly COLA and conversion basis so payroll can derive hourly COLA consistently.
CREATE TABLE IF NOT EXISTS cola_rates (
  id BIGSERIAL PRIMARY KEY,
  year INTEGER NOT NULL UNIQUE,
  weekly_amount NUMERIC(12,4) NOT NULL,
  standard_weekly_hours NUMERIC(8,4) NOT NULL DEFAULT 40,
  hourly_amount NUMERIC(12,6) GENERATED ALWAYS AS (weekly_amount / NULLIF(standard_weekly_hours, 0)) STORED,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cola_rates_weekly_amount_chk CHECK (weekly_amount >= 0),
  CONSTRAINT cola_rates_weekly_hours_chk CHECK (standard_weekly_hours > 0)
);

-- Ownership and grants
ALTER TABLE social_security_brackets OWNER TO schema_admin;
ALTER TABLE departments OWNER TO schema_admin;
ALTER TABLE leave_types OWNER TO schema_admin;
ALTER TABLE leave_policies OWNER TO schema_admin;
ALTER TABLE fiscal_settings OWNER TO schema_admin;
ALTER TABLE cola_rates OWNER TO schema_admin;

-- ---------------- Social Security Classes (A-F) ----------------
CREATE TABLE IF NOT EXISTS social_security_classes (
  id BIGSERIAL PRIMARY KEY,
  year INTEGER NOT NULL,
  class_code VARCHAR(4) NOT NULL,
  description TEXT NULL,
  -- DOB cohort bounds (inclusive)
  dob_from DATE NULL,
  dob_to DATE NULL,
  -- Age bounds (alternative to DOB)
  min_age INTEGER NULL,
  max_age INTEGER NULL,
  -- Wage range (weekly)
  wage_from NUMERIC(12,2) NOT NULL,
  wage_to NUMERIC(12,2) NULL,
  -- Contribution: either fixed amounts (EUR) or percentage (0-100)
  employee_fixed NUMERIC(12,2) NULL,
  employee_percentage NUMERIC(6,4) NULL,
  employer_fixed NUMERIC(12,2) NULL,
  employer_percentage NUMERIC(6,4) NULL,
  -- Maternity Leave Fund (MLF)
  mlf_fixed NUMERIC(12,4) NULL,
  mlf_percentage NUMERIC(6,4) NULL,
  mlf_max NUMERIC(12,4) NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT social_security_classes_unique UNIQUE (year, class_code, wage_from, wage_to, dob_from, dob_to)
);

ALTER TABLE social_security_classes OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON social_security_classes TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE social_security_classes_id_seq TO app_directus;

GRANT SELECT, INSERT, UPDATE, DELETE ON social_security_brackets TO app_directus;
GRANT SELECT, INSERT, UPDATE, DELETE ON departments TO app_directus;
GRANT SELECT, INSERT, UPDATE, DELETE ON leave_types TO app_directus;
GRANT SELECT, INSERT, UPDATE, DELETE ON leave_policies TO app_directus;
GRANT SELECT, INSERT, UPDATE, DELETE ON fiscal_settings TO app_directus;
GRANT SELECT, INSERT, UPDATE, DELETE ON cola_rates TO app_directus;

GRANT USAGE, SELECT, UPDATE ON SEQUENCE social_security_brackets_id_seq TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE departments_dept_id_seq TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE leave_types_id_seq TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE leave_policies_id_seq TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE fiscal_settings_id_seq TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE cola_rates_id_seq TO app_directus;

COMMIT;
BEGIN;

-- ---------------- Tax sync staging/live tables ----------------
CREATE TABLE IF NOT EXISTS tax_rates_import (
  id BIGSERIAL PRIMARY KEY,
  batch_id TEXT NOT NULL,
  year INTEGER NOT NULL,
  raw_category_label TEXT NOT NULL,
  category_code TEXT NULL,
  band_from NUMERIC(12,2) NOT NULL,
  band_to NUMERIC(12,2) NULL,
  rate NUMERIC(8,6) NOT NULL,
  subtract NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'draft',
  source_url TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tax_rates_import_status_chk CHECK (status IN ('draft', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_tax_rates_import_batch_id
  ON tax_rates_import(batch_id);

CREATE INDEX IF NOT EXISTS idx_tax_rates_import_year
  ON tax_rates_import(year);

CREATE TABLE IF NOT EXISTS tax_rates_live (
  id BIGSERIAL PRIMARY KEY,
  year INTEGER NOT NULL,
  raw_category_label TEXT NOT NULL,
  category_code TEXT NULL,
  band_from NUMERIC(12,2) NOT NULL,
  band_to NUMERIC(12,2) NULL,
  rate NUMERIC(8,6) NOT NULL,
  subtract NUMERIC(12,2) NOT NULL DEFAULT 0,
  source_url TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tax_rates_live_year
  ON tax_rates_live(year);

CREATE TABLE IF NOT EXISTS tax_category_map (
  id BIGSERIAL PRIMARY KEY,
  raw_category_label TEXT NOT NULL UNIQUE,
  category_code TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO tax_category_map (raw_category_label, category_code, enabled)
VALUES
  ('Single Rates', 'sng', true),
  ('Married Rates 1', 'mar1', true),
  ('Married Rates 2', 'mar2', true),
  ('Married Rates', 'mar', true),
  ('Parent Rates 1', 'par1', true),
  ('Parent Rates 2', 'par2', true),
  ('Parent Rates', 'par', true)
ON CONFLICT (raw_category_label) DO NOTHING;

ALTER TABLE tax_rates_import OWNER TO schema_admin;
ALTER TABLE tax_rates_live OWNER TO schema_admin;
ALTER TABLE tax_category_map OWNER TO schema_admin;

GRANT SELECT, INSERT, UPDATE, DELETE ON tax_rates_import TO app_directus;
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_rates_live TO app_directus;
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_category_map TO app_directus;

GRANT USAGE, SELECT, UPDATE ON SEQUENCE tax_rates_import_id_seq TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE tax_rates_live_id_seq TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE tax_category_map_id_seq TO app_directus;

COMMIT;
