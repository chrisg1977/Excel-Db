-- Quick test setup for employee 2018004, Feb 2026
-- Run this SQL directly if Python scripts aren't convenient

-- 1. Ensure employee 2018004 exists
INSERT INTO employees 
(emp_id, name, surname, dob, tax_status, contracted_hours, 
 date_first_employed, employment_type, position_held)
VALUES 
  (2018004, 'John', 'Test', '1980-05-15'::date, 'SIN', 40, 
   '2020-01-01'::date, 'FT', 'Developer')
ON CONFLICT (emp_id) DO NOTHING;

-- 2. Add wage history (€12.50/hr, starting 2024)
INSERT INTO wage_history 
(emp_id, effective_date, hourly_rate, change_type)
VALUES (2018004, '2024-01-01'::date, 12.50, 'INITIAL')
ON CONFLICT DO NOTHING;

-- 3. Create payroll subscription (MAIN)
INSERT INTO payroll_subscriptions
(employee_id, payroll_type, employment_number, active_from)
VALUES (2018004, 'MAIN', 'EMP-2018004', '2024-01-01'::date)
ON CONFLICT DO NOTHING;

-- 4. Clear existing timesheets for Feb 2026
DELETE FROM timesheets 
WHERE emp_id = 2018004 
  AND work_date >= '2026-02-01'::date 
  AND work_date <= '2026-02-28'::date;

-- 5. Insert test timesheets for Feb 2026 (160 hours ~ 40 hrs/week for 4 weeks)
-- Working days only (Mon-Fri), 8 hours per day
INSERT INTO timesheets (emp_id, work_date, hours, hour_type, leave_status) VALUES
-- Week 1 (Feb 2-6)
(2018004, '2026-02-02'::date, 8, 'WORK', 'PAID'),
(2018004, '2026-02-03'::date, 8, 'WORK', 'PAID'),
(2018004, '2026-02-04'::date, 8, 'WORK', 'PAID'),
(2018004, '2026-02-05'::date, 8, 'WORK', 'PAID'),
(2018004, '2026-02-06'::date, 8, 'WORK', 'PAID'),
-- Week 2 (Feb 9-13)
(2018004, '2026-02-09'::date, 8, 'WORK', 'PAID'),
(2018004, '2026-02-10'::date, 8, 'WORK', 'PAID'),
(2018004, '2026-02-11'::date, 8, 'WORK', 'PAID'),
(2018004, '2026-02-12'::date, 8, 'WORK', 'PAID'),
(2018004, '2026-02-13'::date, 8, 'WORK', 'PAID'),
-- Week 3 (Feb 16-20)
(2018004, '2026-02-16'::date, 8, 'WORK', 'PAID'),
(2018004, '2026-02-17'::date, 8, 'WORK', 'PAID'),
(2018004, '2026-02-18'::date, 8, 'WORK', 'PAID'),
(2018004, '2026-02-19'::date, 8, 'WORK', 'PAID'),
(2018004, '2026-02-20'::date, 8, 'WORK', 'PAID'),
-- Week 4 (Feb 23-27)
(2018004, '2026-02-23'::date, 8, 'WORK', 'PAID'),
(2018004, '2026-02-24'::date, 8, 'WORK', 'PAID'),
(2018004, '2026-02-25'::date, 8, 'WORK', 'PAID'),
(2018004, '2026-02-26'::date, 8, 'WORK', 'PAID'),
(2018004, '2026-02-27'::date, 8, 'WORK', 'PAID');

-- 6. Create payroll entry for Feb 2026
INSERT INTO payroll_entries
(payroll_year, payroll_month, period_from, period_to, status)
VALUES (2026, 2, '2026-02-01'::date, '2026-02-28'::date, 'DRAFT')
ON CONFLICT DO NOTHING;

-- Verify setup
SELECT 
  'Employee:' as info, emp_id, contracted_hours, tax_status
FROM employees WHERE emp_id = 2018004
UNION ALL
SELECT 'Wage History:', hr.emp_id::text, effective_date::text, hourly_rate::text
FROM wage_history hr WHERE emp_id = 2018004
UNION ALL
SELECT 'Subscription:', ps.employee_id::text, payroll_type, active_from::text
FROM payroll_subscriptions ps WHERE employee_id = 2018004
UNION ALL
SELECT 'Timesheets:', count(*)::text, sum(hours)::text, 'hours total'
FROM timesheets WHERE emp_id = 2018004 AND work_date >= '2026-02-01'::date;
