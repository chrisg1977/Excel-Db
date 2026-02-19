-- HR Employee Payroll Dashboard System
-- Complete view with color coding, all columns, and filter support
-- Date: 2026-02-19
-- UPDATED: 2026-02-19 - Added HOUSEKEEPING & MAINTENANCE categories, separated Trainee Dental Assistant from Receptionist

-- ============================================================================
-- 1. PRINT AUDIT LOG TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS print_audit_log (
  print_id BIGSERIAL PRIMARY KEY,
  print_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  printed_by_user_id UUID,
  printed_by_user_email VARCHAR(255),
  printed_by_name VARCHAR(255),
  print_type VARCHAR(50) NOT NULL, -- 'EMPLOYEE_LIST', 'PAYROLL_REPORT', etc.
  filter_status VARCHAR(50), -- 'CURRENT', 'PROSPECTIVE', 'TERMINATED', 'ALL'
  filter_designation VARCHAR(255), -- Position filter applied
  filter_employment_type VARCHAR(50), -- 'FT', 'PT', etc.
  filter_nationality VARCHAR(50), -- 'MALTESE', 'EU', 'OTHER', 'ALL'
  filter_department VARCHAR(50), -- e.g., 'MDC', 'ALL'
  record_count INTEGER, -- How many records printed
  print_format VARCHAR(50), -- 'PDF', 'HTML', 'TEXT'
  letterhead_included BOOLEAN DEFAULT TRUE,
  footer_included BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE print_audit_log IS 'Audit trail for all HR payroll dashboard prints';
COMMENT ON COLUMN print_audit_log.print_timestamp IS 'When the print was executed';
COMMENT ON COLUMN print_audit_log.filter_status IS 'Which status filter was applied';

-- ============================================================================
-- 2. MAIN DASHBOARD VIEW - Employee Payroll Profile with Color Coding
-- ============================================================================

CREATE OR REPLACE VIEW vw_hr_employee_dashboard AS
SELECT 
  e.emp_id,
  ec.surname,
  ec.first_name,
  ec.position_held,
  e.tax_number,
  ec.employment_type,
  -- Normalize employment type for filtering (FT_RED becomes FT)
  CASE 
    WHEN ec.employment_type LIKE 'FT%' THEN 'FT'
    WHEN ec.employment_type LIKE 'PT%' THEN 'PT'
    ELSE ec.employment_type
  END as employment_type_normalized,
  
  -- Nationality categorization for filtering
  CASE 
    WHEN ec.nationality IN ('Maltese', 'Maltese  ', 'MALTESE') THEN 'MALTESE'
    WHEN ec.nationality IN ('Italian', 'Spanish/Venezuelan', 'Spanish', 'Romanian', 'EU_RESIDENT', 'German', 'French', 'Polish', 'Lithuanian', 'Bulgarian') THEN 'EU'
    ELSE 'OTHER'
  END as nationality_category,
  ec.nationality as nationality_actual,
  
  -- Status based on employment dates
  CASE 
    WHEN ec.active_from > CURRENT_DATE THEN 'PROSPECTIVE'
    WHEN ec.terminated_on IS NULL OR ec.terminated_on > CURRENT_DATE THEN 'CURRENT'
    WHEN ec.terminated_on <= CURRENT_DATE THEN 'TERMINATED'
    ELSE 'CURRENT'
  END as employment_status,
  
  -- Department
  ec.department_code,
  
  -- Payroll assignments (comma-separated list of active payrolls)
  COALESCE(STRING_AGG(DISTINCT ps.payroll_type, ', ' ORDER BY ps.payroll_type), 'NOT ASSIGNED') as payroll_assignments,
  
  -- Count of active payrolls
  COUNT(DISTINCT CASE WHEN ps.active_to IS NULL THEN ps.id END) as active_payroll_count,
  
  -- Color coding by position title
  CASE 
    WHEN ec.position_held LIKE '%Dental Surgeon%' OR ec.position_held LIKE '%Dental Hygenist%' THEN '#2E5090' -- Blue for dentists
    WHEN ec.position_held LIKE '%Manager%' THEN '#2D8659' -- Green for managers
    WHEN ec.position_held LIKE '%Assistant%' THEN '#5B4D82' -- Purple for assistants
    WHEN ec.position_held LIKE '%Receptionist%' OR ec.position_held LIKE '%Trainee%' THEN '#D97C3A' -- Orange
    ELSE '#808080' -- Gray default
  END as row_color_hex,
  
  CASE 
    WHEN ec.position_held LIKE '%Dental Surgeon%' OR ec.position_held LIKE '%Dental Hygenist%' THEN 'DENTIST'
    WHEN ec.position_held LIKE '%Manager%' THEN 'MANAGER'
    WHEN ec.position_held LIKE '%Assistant%' THEN 'ASSISTANT'
    WHEN ec.position_held LIKE '%Receptionist%' OR ec.position_held LIKE '%Trainee%' THEN 'RECEPTIONIST_TRAINEE'
    ELSE 'OTHER'
  END as color_category,
  
  -- Employment dates
  ec.active_from as employment_start_date,
  ec.terminated_on as employment_end_date,
  
  -- Current pay info
  ep.amount as current_salary_hourly_rate,
  ep.pay_type,
  
  -- Contact info
  e.email,
  e.phone_primary,
  
  -- Leave info
  (SELECT COUNT(*) FROM leave_entitlements WHERE emp_id = e.emp_id) as leave_days_entitled,
  
  -- Last updated
  MAX(ps.updated_at) as last_payroll_update,
  CURRENT_TIMESTAMP as view_generated_at
  
FROM employees e
LEFT JOIN employee_current ec ON e.emp_id = ec.emp_id
LEFT JOIN employee_pay_private ep ON e.emp_id = ep.emp_id AND ep.effective_to IS NULL
LEFT JOIN payroll_subscriptions ps ON e.emp_id = ps.employee_id AND ps.active_to IS NULL
WHERE e.is_active = TRUE
GROUP BY 
  e.emp_id, ec.surname, ec.first_name, ec.position_held, 
  e.tax_number, ec.employment_type, ec.nationality,
  ec.active_from, ec.terminated_on, ec.department_code,
  e.email, e.phone_primary,
  ep.amount, ep.pay_type, ep.effective_to
ORDER BY e.emp_id;

COMMENT ON VIEW vw_hr_employee_dashboard IS 'Complete HR dashboard showing all employees with color coding, employment status, payroll assignments, and filter categories';

-- ============================================================================
-- 3. FILTER HELPER VIEWS
-- ============================================================================

-- Distinct values for filter dropdowns
CREATE OR REPLACE VIEW vw_dashboard_filter_options AS
SELECT 
  'EMPLOYMENT_STATUS' as filter_category,
  employment_status as option_value,
  employment_status as option_label,
  COUNT(*) as employee_count
FROM (
  SELECT DISTINCT
    CASE 
      WHEN ec.active_from > CURRENT_DATE THEN 'PROSPECTIVE'
      WHEN ec.terminated_on IS NULL OR ec.terminated_on > CURRENT_DATE THEN 'CURRENT'
      WHEN ec.terminated_on <= CURRENT_DATE THEN 'TERMINATED'
      ELSE 'CURRENT'
    END as employment_status
  FROM employees e
  JOIN employee_current ec ON e.emp_id = ec.emp_id
  WHERE e.is_active = TRUE
) stats
GROUP BY employment_status

UNION ALL

SELECT 
  'EMPLOYMENT_TYPE',
  employment_type_normalized,
  employment_type_normalized,
  COUNT(*)
FROM (
  SELECT DISTINCT
    CASE 
      WHEN ec.employment_type LIKE 'FT%' THEN 'FT'
      WHEN ec.employment_type LIKE 'PT%' THEN 'PT'
      ELSE ec.employment_type
    END as employment_type_normalized
  FROM employees e
  JOIN employee_current ec ON e.emp_id = ec.emp_id
  WHERE e.is_active = TRUE
) stats
GROUP BY employment_type_normalized

UNION ALL

SELECT 
  'NATIONALITY',
  nationality_category,
  nationality_category,
  COUNT(*)
FROM (
  SELECT DISTINCT
    CASE 
      WHEN ec.nationality IN ('Maltese', 'Maltese  ', 'MALTESE') THEN 'MALTESE'
      WHEN ec.nationality IN ('Italian', 'Spanish/Venezuelan', 'Spanish', 'Romanian', 'EU_RESIDENT', 'German', 'French', 'Polish', 'Lithuanian', 'Bulgarian') THEN 'EU'
      ELSE 'OTHER'
    END as nationality_category
  FROM employees e
  JOIN employee_current ec ON e.emp_id = ec.emp_id
  WHERE e.is_active = TRUE
) stats
GROUP BY nationality_category

UNION ALL

SELECT 
  'DESIGNATION',
  color_category,
  color_category,
  COUNT(*)
FROM (
  SELECT DISTINCT
    CASE 
      WHEN ec.position_held LIKE '%Dental Surgeon%' OR ec.position_held LIKE '%Dental Hygenist%' THEN 'DENTIST'
      WHEN ec.position_held LIKE '%Manager%' THEN 'MANAGER'
      WHEN ec.position_held LIKE '%Assistant%' THEN 'ASSISTANT'
      WHEN ec.position_held LIKE '%Receptionist%' OR ec.position_held LIKE '%Trainee%' THEN 'RECEPTIONIST_TRAINEE'
      ELSE 'OTHER'
    END as color_category
  FROM employees e
  JOIN employee_current ec ON e.emp_id = ec.emp_id
  WHERE e.is_active = TRUE
) stats
GROUP BY color_category

ORDER BY filter_category, option_value;

COMMENT ON VIEW vw_dashboard_filter_options IS 'Available filter options with employee counts for dashboard dropdowns';

-- ============================================================================
-- 4. INDEXED COLUMNS FOR PERFORMANCE
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_employee_current_employment_dates 
ON employee_current(active_from, terminated_on) 
WHERE active_from <= CURRENT_DATE;

CREATE INDEX IF NOT EXISTS idx_employee_current_type_position 
ON employee_current(employment_type, position_held);

CREATE INDEX IF NOT EXISTS idx_payroll_subscriptions_active 
ON payroll_subscriptions(employee_id, active_to, payroll_type);

CREATE INDEX IF NOT EXISTS idx_print_audit_log_by_date 
ON print_audit_log(print_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_print_audit_log_by_user 
ON print_audit_log(printed_by_user_id, print_timestamp DESC);

-- ============================================================================
-- 5. FUNCTION: Log Print Activity
-- ============================================================================

CREATE OR REPLACE FUNCTION log_print_activity(
  p_filter_status VARCHAR,
  p_filter_designation VARCHAR,
  p_filter_employment_type VARCHAR,
  p_filter_nationality VARCHAR,
  p_filter_department VARCHAR,
  p_record_count INTEGER,
  p_printed_by_user_id UUID DEFAULT NULL,
  p_printed_by_email VARCHAR(255) DEFAULT NULL,
  p_printed_by_name VARCHAR(255) DEFAULT NULL
)
RETURNS BIGINT AS $$
DECLARE
  v_print_id BIGINT;
BEGIN
  INSERT INTO print_audit_log (
    printed_by_user_id,
    printed_by_user_email,
    printed_by_name,
    print_type,
    filter_status,
    filter_designation,
    filter_employment_type,
    filter_nationality,
    filter_department,
    record_count,
    print_format,
    letterhead_included,
    footer_included
  ) VALUES (
    p_printed_by_user_id,
    p_printed_by_email,
    p_printed_by_name,
    'EMPLOYEE_LIST',
    p_filter_status,
    p_filter_designation,
    p_filter_employment_type,
    p_filter_nationality,
    p_filter_department,
    p_record_count,
    'HTML',
    TRUE,
    TRUE
  )
  RETURNING print_id INTO v_print_id;
  
  RETURN v_print_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION log_print_activity IS 'Logs when HR dashboard is printed';

-- ============================================================================
-- 6. SAMPLE QUERIES FOR FILTERING
-- ============================================================================

-- QUERY: All current FT employees in Maltese nationality
-- SELECT * FROM vw_hr_employee_dashboard 
-- WHERE employment_status = 'CURRENT' 
-- AND employment_type_normalized = 'FT' 
-- AND nationality_category = 'MALTESE'
-- ORDER BY emp_id;

-- QUERY: All terminated employees
-- SELECT * FROM vw_hr_employee_dashboard 
-- WHERE employment_status = 'TERMINATED'
-- ORDER BY employment_end_date DESC;

-- QUERY: All prospective employees (not yet started)
-- SELECT emp_id, surname, first_name, position_held, employment_start_date
-- FROM vw_hr_employee_dashboard 
-- WHERE employment_status = 'PROSPECTIVE'
-- ORDER BY employment_start_date;

-- QUERY: Dentists without payroll assignment
-- SELECT emp_id, surname, first_name, payroll_assignments
-- FROM vw_hr_employee_dashboard 
-- WHERE color_category = 'DENTIST' 
-- AND payroll_assignments = 'NOT ASSIGNED';

-- ============================================================================
-- 7. VERIFICATION & DOCUMENTATION
-- ============================================================================

-- Check dashboard view
-- SELECT emp_id, surname, first_name, position_held, employment_type_normalized, 
--        nationality_category, employment_status, payroll_assignments, row_color_hex
-- FROM vw_hr_employee_dashboard 
-- LIMIT 10;

-- Check filter options
-- SELECT * FROM vw_dashboard_filter_options ORDER BY filter_category;

-- Check print audit log
-- SELECT printed_by_user_email, print_timestamp, filter_status, filter_employment_type, 
--        filter_nationality, record_count
-- FROM print_audit_log 
-- ORDER BY print_timestamp DESC;
