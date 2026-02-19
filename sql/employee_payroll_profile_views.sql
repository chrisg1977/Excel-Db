-- Create Comprehensive Employee Payroll Profile View
-- Shows everything HR/Payroll needs in ONE screen

CREATE OR REPLACE VIEW vw_employee_payroll_profile AS
SELECT 
  e.emp_id,
  ec.position_held,
  ec.employment_type,
  ec.weekly_hours,
  ec.department_code,
  COALESCE(STRING_AGG(DISTINCT ps.payroll_type, ', ' ORDER BY ps.payroll_type), 'NOT ASSIGNED') as assigned_payrolls,
  COUNT(CASE WHEN ps.id IS NOT NULL AND ps.active_to IS NULL THEN 1 END) as active_payroll_count,
  MAX(CASE WHEN ps.payroll_type = 'MAIN' THEN 1 ELSE 0 END) as has_main_payroll,
  MAX(CASE WHEN ps.payroll_type = 'PROVIDER' THEN 1 ELSE 0 END) as has_provider_payroll,
  e.email,
  e.phone_primary,
  e.iban,
  CASE 
    WHEN ec.terminated_on IS NULL THEN 'Active'
    WHEN ec.terminated_on < CURRENT_DATE THEN 'Terminated'
    ELSE 'Pending End'
  END as employment_status,
  ec.active_from as employment_start,
  ec.terminated_on,
  ep.amount as current_salary_hourly_rate,
  ep.pay_type,
  CASE WHEN ep.effective_to IS NULL THEN 'Active' ELSE 'Inactive' END as pay_status,
  (SELECT COUNT(*) FROM leave_entitlements WHERE emp_id = e.emp_id) as total_leave_days_entitled,
  (SELECT COUNT(*) FROM leave_balances WHERE emp_id = e.emp_id AND year = EXTRACT(YEAR FROM CURRENT_DATE)) as current_year_leave_records,
  STRING_AGG(DISTINCT ps.employment_number, ', ' ORDER BY ps.employment_number) as payroll_employee_numbers,
  MAX(ps.updated_at) as last_payroll_update
FROM employees e
LEFT JOIN employee_current ec ON e.emp_id = ec.emp_id
LEFT JOIN employee_pay_private ep ON e.emp_id = ep.emp_id
LEFT JOIN payroll_subscriptions ps ON e.emp_id = ps.employee_id AND ps.active_to IS NULL
WHERE e.is_active = TRUE
GROUP BY 
  e.emp_id, ec.position_held, ec.employment_type, ec.weekly_hours, ec.department_code,
  e.email, e.phone_primary, e.iban, ec.terminated_on, ec.active_from,
  ep.amount, ep.pay_type, ep.effective_to
ORDER BY e.emp_id;

COMMENT ON VIEW vw_employee_payroll_profile IS 'Complete employee profile with payroll assignments - shows all info needed for payroll processing in ONE screen';

-- Create variation showing ALL payroll subscriptions (including inactive)
CREATE OR REPLACE VIEW vw_employee_payroll_full_history AS
SELECT 
  ps.id as subscription_id,
  e.emp_id,
  ec.position_held,
  ec.employment_type,
  ps.payroll_type,
  ps.employment_number,
  ps.active_from,
  ps.active_to,
  CASE 
    WHEN ps.active_to IS NULL THEN 'Active'
    WHEN ps.active_to < CURRENT_DATE THEN 'Inactive (Ended)'
    ELSE 'Pending End'
  END as subscription_status,
  ps.is_sync_to_opendental,
  ps.od_sync_status,
  ps.od_employee_num,
  ps.od_provider_num,
  ps.od_sync_date,
  CASE 
    WHEN ec.terminated_on IS NULL THEN 'Active'
    WHEN ec.terminated_on < CURRENT_DATE THEN 'Terminated'
    ELSE 'Pending End'
  END as employment_status,
  e.email
FROM payroll_subscriptions ps
JOIN employees e ON ps.employee_id = e.emp_id
LEFT JOIN employee_current ec ON e.emp_id = ec.emp_id
ORDER BY e.emp_id, ps.payroll_type, ps.active_from DESC;

COMMENT ON VIEW vw_employee_payroll_full_history IS 'All payroll subscription history - useful for auditing payroll changes';

-- Quick Summary View: Which employees are missing payroll assignments
CREATE OR REPLACE VIEW vw_employees_without_payroll AS
SELECT 
  e.emp_id,
  ec.position_held,
  ec.employment_type,
  ec.weekly_hours,
  e.email,
  CASE 
    WHEN ec.terminated_on IS NULL THEN 'Active'
    WHEN ec.terminated_on < CURRENT_DATE THEN 'Terminated'
    ELSE 'Pending End'
  END as employment_status
FROM employees e
LEFT JOIN employee_current ec ON e.emp_id = ec.emp_id
LEFT JOIN payroll_subscriptions ps ON e.emp_id = ps.employee_id AND ps.active_to IS NULL
WHERE e.is_active = TRUE
  AND ps.id IS NULL
ORDER BY ec.position_held, e.emp_id;

COMMENT ON VIEW vw_employees_without_payroll IS 'Lists employees with no active payroll subscription - these need to be assigned to a payroll';

-- Test the views
-- SELECT * FROM vw_employee_payroll_profile LIMIT 5;
-- SELECT * FROM vw_employees_without_payroll;
