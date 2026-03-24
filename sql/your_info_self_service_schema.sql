-- YOUR INFO self-service tables
-- Apply with:
-- psql -h <host> -p <port> -U <user> -d <db> -f sql/your_info_self_service_schema.sql

BEGIN;

CREATE TABLE IF NOT EXISTS employee_self_service_profile (
  emp_id INTEGER PRIMARY KEY REFERENCES employees(emp_id) ON DELETE CASCADE,
  address_house TEXT NULL,
  address_street TEXT NULL,
  address_city TEXT NULL,
  address_postcode TEXT NULL,
  phone_1 TEXT NULL,
  phone_2 TEXT NULL,
  phone_whatsapp TEXT NULL,
  email TEXT NULL,
  iban TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by_user_id TEXT NULL,
  updated_by_email TEXT NULL
);

CREATE TABLE IF NOT EXISTS employee_self_service_audit_log (
  id BIGSERIAL PRIMARY KEY,
  emp_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  old_value JSONB NULL,
  new_value JSONB NULL,
  change_channel TEXT NOT NULL DEFAULT 'your_info',
  change_reason TEXT NULL,
  changed_by_user_id TEXT NULL,
  changed_by_email TEXT NULL,
  changed_by_role TEXT NULL,
  requires_hr_intervention BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_self_service_audit_emp
  ON employee_self_service_audit_log(emp_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_employee_self_service_audit_field
  ON employee_self_service_audit_log(field_name, created_at DESC);

CREATE TABLE IF NOT EXISTS employee_self_service_change_requests (
  id BIGSERIAL PRIMARY KEY,
  emp_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  request_type TEXT NOT NULL,
  requested_value JSONB NULL,
  requested_by_user_id TEXT NULL,
  requested_by_email TEXT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ NULL,
  resolved_by_user_id TEXT NULL,
  resolved_by_email TEXT NULL,
  resolution_notes TEXT NULL,
  CONSTRAINT employee_self_service_change_requests_type_chk
    CHECK (request_type IN ('marital_status', 'tax_status', 'bank_details', 'other')),
  CONSTRAINT employee_self_service_change_requests_status_chk
    CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_employee_self_service_change_requests_emp
  ON employee_self_service_change_requests(emp_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_employee_self_service_change_requests_status
  ON employee_self_service_change_requests(status, created_at DESC);

CREATE TABLE IF NOT EXISTS employee_bank_change_confirmation (
  id BIGSERIAL PRIMARY KEY,
  audit_log_id BIGINT NOT NULL REFERENCES employee_self_service_audit_log(id) ON DELETE CASCADE,
  emp_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  payroll_period TEXT NOT NULL,
  payroll_kind TEXT NOT NULL,
  confirmed_by_user_id TEXT NOT NULL,
  confirmed_by_email TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT NULL,
  CONSTRAINT employee_bank_change_confirmation_period_chk CHECK (payroll_period ~ '^\\d{4}-\\d{2}$'),
  CONSTRAINT employee_bank_change_confirmation_kind_chk CHECK (payroll_kind IN ('MAIN', 'PROVIDER', 'THIRDPARTY')),
  CONSTRAINT employee_bank_change_confirmation_unique UNIQUE (audit_log_id, payroll_period, payroll_kind)
);

CREATE INDEX IF NOT EXISTS idx_employee_bank_change_confirmation_emp
  ON employee_bank_change_confirmation(emp_id, confirmed_at DESC);

COMMIT;
