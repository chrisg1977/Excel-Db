-- Payroll 1 Schema Verification & Enhancements
-- Ensure database supports FT/PT payroll processing rules
-- 2026-02-18

-- ============================================================================
-- 1. VERIFY EXISTING STRUCTURE
-- ============================================================================

-- Check: employee_employment_terms has employment_type
-- Status: ✅ EXISTS (confirmed: FT, PT, PT_CASUAL, etc.)

-- Check: employee_pay_private has effective_from/effective_to
-- Status: ✅ EXISTS (tracks pay changes with date ranges)

-- Check: payroll_entries has period_from, period_to, payment_date
-- Status: ✅ EXISTS (structure correct for both FT and PT)

-- Check: payroll_lines has deduction fields
-- Status: ✅ EXISTS (extensive fields for bonuses, leave, etc.)

-- ============================================================================
-- 2. ENHANCE pay_periods TABLE (if needed for schedules)
-- ============================================================================

-- Verify pay_periods can track both FT and PT schedules
-- ADD IF MISSING: payroll_type column to distinguish FT from PT

ALTER TABLE IF EXISTS pay_periods 
ADD COLUMN IF NOT EXISTS payroll_type VARCHAR(50) DEFAULT 'FT' 
CHECK (payroll_type IN ('FT', 'PT', 'BOTH'));

COMMENT ON COLUMN pay_periods.payroll_type IS 'Payroll type: FT (last Friday), PT (first Fri following month)';

-- ============================================================================
-- 3. ADD TRACKING FOR DATA vs PAYMENT MONTH
-- ============================================================================

-- This helps avoid confusion: which data month does this payroll use?
-- For FT: Uses previous month (e.g., Feb payroll = Jan data)
-- For PT: Uses actual month (e.g., Feb payroll = Feb data)

ALTER TABLE IF EXISTS payroll_entries
ADD COLUMN IF NOT EXISTS data_period_month DATE;

COMMENT ON COLUMN payroll_entries.data_period_month IS 'The month whose data is being used (for reference and validation)';

-- Example values after creation:
-- If processing Feb payroll for FT: data_period_month = '2026-01-01'
-- If processing Feb payroll for PT: data_period_month = '2026-02-01'

-- ============================================================================
-- 4. PAYROLL STATUS WORKFLOW
-- ============================================================================

-- Verify payroll_entries.status supports workflow needed:
-- Expected values: 'draft', 'calculating', 'calculated', 'hr_review', 'approved', 'paid', 'disputed', 'cancelled'

-- Update status checks if they're more restrictive
-- Note: Adjust constraints based on actual status values in production

-- ============================================================================
-- 5. VALIDATION VIEWS FOR PAYROLL 1 PROCESSING
-- ============================================================================

-- View: FT Employees Ready for Processing
CREATE OR REPLACE VIEW vw_ft_processing_ready AS
SELECT 
  e.emp_id,
  ee.position_held,
  ee.employment_type,
  ee.effective_from,
  ee.effective_to,
  ep.amount AS monthly_salary,
  ep.effective_from AS salary_effective_from,
  ep.effective_to AS salary_effective_to,
  CASE 
    WHEN ee.effective_to IS NULL THEN 'Active'
    WHEN ee.effective_to < CURRENT_DATE THEN 'Terminated'
    ELSE 'Pending End'
  END AS employment_status
FROM employees e
JOIN employee_employment_terms ee ON e.emp_id = ee.emp_id
JOIN employee_pay_private ep ON e.emp_id = ep.emp_id
WHERE ee.employment_type = 'FT'
  AND ee.effective_from <= CURRENT_DATE
  AND (ee.effective_to IS NULL OR ee.effective_to >= CURRENT_DATE)
  AND ep.pay_type = 'SALARY'
  AND ep.effective_from <= CURRENT_DATE
  AND (ep.effective_to IS NULL OR ep.effective_to >= CURRENT_DATE)
ORDER BY e.emp_id;

COMMENT ON VIEW vw_ft_processing_ready IS 'FT employees eligible for current month processing (uses previous month data)';

-- View: PT/Casual Employees Ready for Processing
CREATE OR REPLACE VIEW vw_pt_processing_ready AS
SELECT 
  e.emp_id,
  ee.position_held,
  ee.employment_type,
  ee.weekly_hours,
  ee.effective_from,
  ee.effective_to,
  ep.amount AS hourly_rate,
  ep.effective_from AS rate_effective_from,
  ep.effective_to AS rate_effective_to,
  CASE 
    WHEN ee.effective_to IS NULL THEN 'Active'
    WHEN ee.effective_to < CURRENT_DATE THEN 'Terminated'
    ELSE 'Pending End'
  END AS employment_status
FROM employees e
JOIN employee_employment_terms ee ON e.emp_id = ee.emp_id
JOIN employee_pay_private ep ON e.emp_id = ep.emp_id
WHERE ee.employment_type IN ('PT', 'PT_CASUAL')
  AND ee.effective_from <= CURRENT_DATE
  AND (ee.effective_to IS NULL OR ee.effective_to >= CURRENT_DATE)
  AND ep.pay_type IN ('HOURLY', 'HOURLY_RATE')
  AND ep.effective_from <= CURRENT_DATE
  AND (ep.effective_to IS NULL OR ep.effective_to >= CURRENT_DATE)
ORDER BY e.emp_id;

COMMENT ON VIEW vw_pt_processing_ready IS 'PT/Casual employees eligible for current month processing (uses actual month data)';

-- Simpler view: FT Payment Dates by Month (fixed)
CREATE OR REPLACE VIEW vw_ft_payment_schedule_2026 AS
WITH months AS (
  SELECT generate_series('2026-01-01'::DATE, '2026-12-31'::DATE, '1 month')::DATE as month_first
),
last_fridays AS (
  SELECT 
    month_first,
    (month_first + INTERVAL '1 month' - INTERVAL '1 day')::DATE as month_last,
    ((month_first + INTERVAL '1 month' - INTERVAL '1 day')::DATE - 
     CASE EXTRACT(DOW FROM (month_first + INTERVAL '1 month' - INTERVAL '1 day')::DATE)
       WHEN 0 THEN 2  -- Sunday, go back 2 days to Friday
       WHEN 1 THEN 3  -- Monday, go back 3 days
       WHEN 2 THEN 4  -- Tuesday
       WHEN 3 THEN 5  -- Wednesday
       WHEN 4 THEN 6  -- Thursday
       WHEN 5 THEN 0  -- Friday, no change
       WHEN 6 THEN 1  -- Saturday, go back 1 day
     END * INTERVAL '1 day')::DATE as last_friday
  FROM months
)
SELECT 
  month_first,
  TO_CHAR(month_first, 'Month YYYY') as month_name,
  month_last,
  last_friday as payment_date,
  (month_first - INTERVAL '1 month')::DATE as data_month_start,
  (month_first - INTERVAL '1 day')::DATE as data_month_end
FROM last_fridays
ORDER BY month_first;

COMMENT ON VIEW vw_ft_payment_schedule_2026 IS 'FT payroll schedule for 2026: Last Friday payments using previous month data';

-- View: PT Payment Dates (First Friday following month)
CREATE OR REPLACE VIEW vw_pt_payment_schedule_2026 AS
WITH months AS (
  SELECT generate_series('2026-01-01'::DATE, '2026-12-31'::DATE, '1 month')::DATE as month_first
),
first_fridays AS (
  SELECT 
    month_first,
    (month_first + INTERVAL '1 month' - INTERVAL '1 day')::DATE as month_last,
    ((month_first + INTERVAL '1 month')::DATE + 
     CASE EXTRACT(DOW FROM (month_first + INTERVAL '1 month')::DATE)
       WHEN 0 THEN 5  -- Sunday, next Friday is in 5 days
       WHEN 1 THEN 4  -- Monday, next Friday is in 4 days
       WHEN 2 THEN 3  -- Tuesday
       WHEN 3 THEN 2  -- Wednesday
       WHEN 4 THEN 1  -- Thursday
       WHEN 5 THEN 0  -- Friday (use this day)
       WHEN 6 THEN 6  -- Saturday, next Friday is in 6 days
     END * INTERVAL '1 day')::DATE as first_friday_next_month
  FROM months
)
SELECT 
  month_first,
  TO_CHAR(month_first, 'Month YYYY') as month_name,
  month_last,
  first_friday_next_month as payment_date,
  month_first as data_month_start,
  month_last as data_month_end
FROM first_fridays
ORDER BY month_first;

COMMENT ON VIEW vw_pt_payment_schedule_2026 IS 'PT payroll schedule for 2026: First Friday of following month using actual month data';

-- ============================================================================
-- 6. INDEXES FOR PAYROLL PROCESSING
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_employee_employment_terms_active 
ON employee_employment_terms(emp_id, employment_type, effective_from, effective_to);

CREATE INDEX IF NOT EXISTS idx_employee_pay_private_by_emp_date 
ON employee_pay_private(emp_id, pay_type, effective_from, effective_to);

CREATE INDEX IF NOT EXISTS idx_payroll_entries_by_period_status 
ON payroll_entries(period_from, period_to, status);

CREATE INDEX IF NOT EXISTS idx_payroll_lines_by_entry_emp 
ON payroll_lines(payroll_entry_id, emp_id);

-- ============================================================================
-- 7. DOCUMENTATION
-- ============================================================================

-- This migration ensures:
-- ✅ employment_type is available for FT vs PT distinction
-- ✅ effective_from/to dates track pay changes
-- ✅ payroll_entries structure supports both FT and PT scheduling
-- ✅ Views available for payroll coordinators to identify ready employees
-- ✅ Payment schedules calculated correctly for both types
-- ✅ Data period tracking prevents confusion about which month's data is used
-- ✅ Indexes optimized for typical payroll queries

-- NEXT STEPS:
-- 1. Test FT processing view: SELECT * FROM vw_ft_processing_ready;
-- 2. Test PT processing view: SELECT * FROM vw_pt_processing_ready;
-- 3. Review payment schedules: SELECT * FROM vw_ft_payment_schedule_2026;
-- 4. Review payment schedules: SELECT * FROM vw_pt_payment_schedule_2026;
-- 5. Create payroll processing stored procedures using these views
