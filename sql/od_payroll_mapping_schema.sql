-- Main Payroll Employees (from OpenDental employee + PayrollID)
-- Source: OpenDental employees with PayrollID mapped to userod UserNum

CREATE TABLE IF NOT EXISTS od_payroll_employee_map (
  id BIGSERIAL PRIMARY KEY,
  payroll_id TEXT NOT NULL UNIQUE,
  od_employee_num INTEGER NOT NULL,
  od_user_num INTEGER NOT NULL,
  first_name TEXT,
  last_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_od_payroll_employee_map_payroll_id ON od_payroll_employee_map(payroll_id);
CREATE INDEX IF NOT EXISTS idx_od_payroll_employee_map_user_num ON od_payroll_employee_map(od_user_num);

-- Provider Payroll (from OpenDental provider + CustomID)
-- Source: OpenDental providers with CustomID mapped to userod UserNum

CREATE TABLE IF NOT EXISTS od_provider_map (
  id BIGSERIAL PRIMARY KEY,
  provider_id TEXT NOT NULL UNIQUE,
  od_prov_num INTEGER,
  od_user_num INTEGER NOT NULL,
  abbreviation TEXT,
  first_name TEXT,
  last_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_od_provider_map_provider_id ON od_provider_map(provider_id);
CREATE INDEX IF NOT EXISTS idx_od_provider_map_user_num ON od_provider_map(od_user_num);

-- Link od_payroll_employee_map → Directus employees (main payroll)
CREATE TABLE IF NOT EXISTS od_employee_link (
  id BIGSERIAL PRIMARY KEY,
  directus_employee_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  od_payroll_id TEXT NOT NULL REFERENCES od_payroll_employee_map(payroll_id) ON DELETE CASCADE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (directus_employee_id, od_payroll_id)
);

CREATE INDEX IF NOT EXISTS idx_od_employee_link_directus ON od_employee_link(directus_employee_id);
CREATE INDEX IF NOT EXISTS idx_od_employee_link_payroll_id ON od_employee_link(od_payroll_id);

-- Link od_provider_map → Directus employees/providers (provider payroll)
-- Providers can be employees or external; we track them as payroll contacts
CREATE TABLE IF NOT EXISTS od_provider_link (
  id BIGSERIAL PRIMARY KEY,
  directus_employee_id INTEGER REFERENCES employees(emp_id) ON DELETE CASCADE,
  od_provider_id TEXT NOT NULL REFERENCES od_provider_map(provider_id) ON DELETE CASCADE,
  payroll_type TEXT NOT NULL DEFAULT 'PROVIDER' CHECK (payroll_type IN ('EMPLOYEE', 'PROVIDER', 'BOTH')),
  payment_method TEXT NOT NULL DEFAULT 'CASH' CHECK (payment_method IN ('CASH', 'REVOLUT', 'BANK_TRANSFER')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (od_provider_id, directus_employee_id)
);

CREATE INDEX IF NOT EXISTS idx_od_provider_link_directus ON od_provider_link(directus_employee_id);
CREATE INDEX IF NOT EXISTS idx_od_provider_link_provider_id ON od_provider_link(od_provider_id);
