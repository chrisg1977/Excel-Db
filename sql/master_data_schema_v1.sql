-- master_data_schema_v1.sql
-- PostgreSQL draft for shared operations-platform master data.
-- Scope:
--   - location
--   - business_unit
--   - business_unit_location
--   - department
--   - employee
--   - leave_request
--
-- Notes:
--   - UUID values are expected to be supplied by the application/service layer.
--   - UNIQUE constraints on code fields satisfy the requested indexing for those columns.
--   - This is schema DDL only. No runtime code is wired here.

BEGIN;

CREATE TABLE IF NOT EXISTS location (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  address_line_1 TEXT NULL,
  address_line_2 TEXT NULL,
  has_active_reception BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_unit (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  unit_type TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS business_unit_location (
  id UUID PRIMARY KEY,
  business_unit_id UUID NOT NULL REFERENCES business_unit(id),
  location_id UUID NOT NULL REFERENCES location(id),
  is_primary BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_business_unit_location UNIQUE (business_unit_id, location_id)
);

CREATE TABLE IF NOT EXISTS employee (
  id UUID PRIMARY KEY,
  employee_code TEXT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  phone_number TEXT NULL,
  email TEXT NULL,
  role TEXT NOT NULL,
  role_level INTEGER NOT NULL DEFAULT 0,
  reports_to_employee_id UUID NULL REFERENCES employee(id),
  is_manager BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  is_provider BOOLEAN NOT NULL DEFAULT false,
  provider_ref TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_employee_role_level_nonnegative CHECK (role_level >= 0)
);

CREATE TABLE IF NOT EXISTS department (
  id UUID PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  business_unit_id UUID NOT NULL REFERENCES business_unit(id),
  location_id UUID NOT NULL REFERENCES location(id),
  default_reception_location_id UUID NOT NULL REFERENCES location(id),
  manager_responsible_employee_id UUID NULL REFERENCES employee(id),
  department_type TEXT NOT NULL,
  phone_number TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS leave_request (
  id UUID PRIMARY KEY,
  employee_id UUID NOT NULL REFERENCES employee(id),
  leave_type TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL,
  approved_by_employee_id UUID NULL REFERENCES employee(id),
  note TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_leave_request_window_valid CHECK (end_at >= start_at)
);

-- Code indexes are satisfied by UNIQUE constraints on:
--   location.code
--   business_unit.code
--   department.code

CREATE INDEX IF NOT EXISTS ix_department_location_id
  ON department (location_id);

CREATE INDEX IF NOT EXISTS ix_department_default_reception_location_id
  ON department (default_reception_location_id);

CREATE INDEX IF NOT EXISTS ix_department_manager_responsible_employee_id
  ON department (manager_responsible_employee_id);

CREATE INDEX IF NOT EXISTS ix_employee_role
  ON employee (role);

CREATE INDEX IF NOT EXISTS ix_employee_role_level
  ON employee (role_level);

CREATE INDEX IF NOT EXISTS ix_employee_reports_to_employee_id
  ON employee (reports_to_employee_id);

CREATE INDEX IF NOT EXISTS ix_leave_request_employee_id
  ON leave_request (employee_id);

CREATE INDEX IF NOT EXISTS ix_leave_request_status
  ON leave_request (status);

CREATE INDEX IF NOT EXISTS ix_leave_request_start_at
  ON leave_request (start_at);

CREATE INDEX IF NOT EXISTS ix_leave_request_end_at
  ON leave_request (end_at);

COMMIT;
