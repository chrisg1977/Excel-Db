-- Unified payroll subscription tracking
-- Employees can be on MAIN, PROVIDER, THIRDPARTY in any combination
-- Each subscription can have its own employment number(s)

CREATE TABLE IF NOT EXISTS payroll_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  payroll_type TEXT NOT NULL CHECK (payroll_type IN ('MAIN', 'PROVIDER', 'THIRDPARTY')),
  employment_number TEXT NOT NULL, -- e.g., 2018001, LC, RG (can have multiple per person/type)
  active_from DATE NOT NULL DEFAULT CURRENT_DATE,
  active_to DATE,
  is_sync_to_opendental BOOLEAN NOT NULL DEFAULT TRUE,
  od_sync_status TEXT NOT NULL DEFAULT 'PENDING' 
    CHECK (od_sync_status IN ('PENDING', 'SYNCED', 'FAILED', 'SKIPPED')),
  od_sync_error TEXT,
  od_employee_num INTEGER, -- filled after sync to OpenDental (employee)
  od_provider_num INTEGER, -- filled after sync to OpenDental (provider)
  od_sync_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (employee_id, payroll_type, employment_number)
);

CREATE INDEX IF NOT EXISTS idx_payroll_subscriptions_employee ON payroll_subscriptions(employee_id);
CREATE INDEX IF NOT EXISTS idx_payroll_subscriptions_type ON payroll_subscriptions(payroll_type);
CREATE INDEX IF NOT EXISTS idx_payroll_subscriptions_active ON payroll_subscriptions(active_from, active_to);
CREATE INDEX IF NOT EXISTS idx_payroll_subscriptions_od_sync ON payroll_subscriptions(is_sync_to_opendental, od_sync_status);

-- Audit trigger
CREATE OR REPLACE FUNCTION fn_update_payroll_subscriptions_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

DROP TRIGGER IF EXISTS tr_payroll_subscriptions_updated ON payroll_subscriptions;
CREATE TRIGGER tr_payroll_subscriptions_updated
BEFORE UPDATE ON payroll_subscriptions
FOR EACH ROW
EXECUTE FUNCTION fn_update_payroll_subscriptions_timestamp();

-- View: current active subscriptions per employee
CREATE OR REPLACE VIEW vw_payroll_subscriptions_active AS
SELECT 
  ps.*,
  ec.first_name,
  ec.surname,
  ec.position_held
FROM payroll_subscriptions ps
JOIN vw_employee_current ec ON ps.employee_id = ec.emp_id
WHERE ps.active_to IS NULL
  OR ps.active_to >= CURRENT_DATE
ORDER BY ps.employee_id, ps.payroll_type;

-- View: pending OpenDental syncs
CREATE OR REPLACE VIEW vw_payroll_subscriptions_pending_sync AS
SELECT * FROM payroll_subscriptions
WHERE is_sync_to_opendental = TRUE
  AND od_sync_status = 'PENDING'
  AND (active_to IS NULL OR active_to >= CURRENT_DATE)
ORDER BY created_at;
