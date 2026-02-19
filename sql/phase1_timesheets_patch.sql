BEGIN;

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
