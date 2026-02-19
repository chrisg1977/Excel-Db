-- Create materialized dashboard table for Directus access
-- This table will be accessible via Directus permissions
-- We'll populate it from the view

CREATE TABLE IF NOT EXISTS hr_employee_dashboard (
  id BIGSERIAL PRIMARY KEY,
  emp_id INTEGER NOT NULL,
  surname VARCHAR(255),
  first_name VARCHAR(255),
  position_held TEXT,
  tax_number VARCHAR(50),
  employment_type VARCHAR(50),
  employment_type_normalized VARCHAR(50),
  nationality_category VARCHAR(50),
  nationality_actual VARCHAR(100),
  employment_status VARCHAR(50),
  department_code VARCHAR(50),
  payroll_assignments VARCHAR(255),
  active_payroll_count INTEGER,
  row_color_hex VARCHAR(10),
  color_category VARCHAR(50),
  employment_start_date DATE,
  employment_end_date DATE,
  current_salary_hourly_rate NUMERIC,
  pay_type VARCHAR(50),
  email TEXT,
  phone_primary TEXT,
  leave_days_entitled INTEGER,
  last_payroll_update TIMESTAMP,
  last_refreshed TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(emp_id)
);

-- Populate the table from the view
TRUNCATE TABLE hr_employee_dashboard;

INSERT INTO hr_employee_dashboard (
  emp_id, surname, first_name, position_held, tax_number, employment_type,
  employment_type_normalized, nationality_category, nationality_actual,
  employment_status, department_code, payroll_assignments, active_payroll_count,
  row_color_hex, color_category, employment_start_date, employment_end_date,
  current_salary_hourly_rate, pay_type, email, phone_primary, leave_days_entitled,
  last_payroll_update
)
SELECT 
  emp_id, surname, first_name, position_held, tax_number, employment_type,
  employment_type_normalized, nationality_category, nationality_actual,
  employment_status, department_code, payroll_assignments, active_payroll_count,
  row_color_hex, color_category, employment_start_date, employment_end_date,
  current_salary_hourly_rate, pay_type, email, phone_primary, leave_days_entitled,
  last_payroll_update
FROM vw_hr_employee_dashboard
ORDER BY emp_id;

-- Create indexes for performance
CREATE INDEX idx_hr_dashboard_emp_id ON hr_employee_dashboard(emp_id);
CREATE INDEX idx_hr_dashboard_color ON hr_employee_dashboard(color_category);
CREATE INDEX idx_hr_dashboard_status ON hr_employee_dashboard(employment_status);
CREATE INDEX idx_hr_dashboard_type ON hr_employee_dashboard(employment_type_normalized);
CREATE INDEX idx_hr_dashboard_nationality ON hr_employee_dashboard(nationality_category);

-- Grant permissions to excel user
GRANT SELECT, INSERT, UPDATE, DELETE ON hr_employee_dashboard TO excel;

COMMENT ON TABLE hr_employee_dashboard IS 'HR Employee Payroll Dashboard - materialized from view for Directus access';
COMMENT ON COLUMN hr_employee_dashboard.row_color_hex IS 'Hex color for row based on position category (#2E5090=Dentist, #2D8659=Manager, #5B4D82=Assistant, #D97C3A=Receptionist, #8B7355=Maintenance, #C47ACC=Housekeeping)';
COMMENT ON COLUMN hr_employee_dashboard.color_category IS 'Position category for filtering: DENTIST, MANAGER, ASSISTANT, RECEPTIONIST_TRAINEE, MAINTENANCE, HOUSEKEEPING, OTHER';

-- Create a simple refresh function (optional)
CREATE OR REPLACE FUNCTION refresh_hr_dashboard()
RETURNS void AS $$
BEGIN
  TRUNCATE hr_employee_dashboard;
  INSERT INTO hr_employee_dashboard (
    emp_id, surname, first_name, position_held, tax_number, employment_type,
    employment_type_normalized, nationality_category, nationality_actual,
    employment_status, department_code, payroll_assignments, active_payroll_count,
    row_color_hex, color_category, employment_start_date, employment_end_date,
    current_salary_hourly_rate, pay_type, email, phone_primary, leave_days_entitled,
    last_payroll_update
  )
  SELECT 
    emp_id, surname, first_name, position_held, tax_number, employment_type,
    employment_type_normalized, nationality_category, nationality_actual,
    employment_status, department_code, payroll_assignments, active_payroll_count,
    row_color_hex, color_category, employment_start_date, employment_end_date,
    current_salary_hourly_rate, pay_type, email, phone_primary, leave_days_entitled,
    last_payroll_update
  FROM vw_hr_employee_dashboard
  ORDER BY emp_id;
  
  RAISE NOTICE 'HR Dashboard refreshed at %', NOW();
END;
$$ LANGUAGE plpgsql;

-- Verify data was loaded
SELECT COUNT(*) as employees_in_dashboard FROM hr_employee_dashboard;
SELECT color_category, COUNT(*) FROM hr_employee_dashboard GROUP BY color_category ORDER BY COUNT(*) DESC;
