-- Leave Entitlements Configuration Schema
-- Tracks annual leave entitlements, public holidays, and calculation rules for 2026+

BEGIN;

-- ============================================================
-- 1. EMPLOYMENT TYPE & WORK SCHEDULE
-- ============================================================

-- Update employee_employment_terms table to include employment type
-- (If not already present, add these columns)
ALTER TABLE employee_employment_terms 
ADD COLUMN IF NOT EXISTS employment_type VARCHAR(50) 
  CHECK (employment_type IN ('PERMANENT', 'CASUAL_PT', 'CONTRACT', 'SEASONAL'))
  DEFAULT 'PERMANENT';

ALTER TABLE employee_employment_terms
ADD COLUMN IF NOT EXISTS works_saturdays BOOLEAN DEFAULT TRUE;

ALTER TABLE employee_employment_terms
ADD COLUMN IF NOT EXISTS works_sundays BOOLEAN DEFAULT FALSE;

-- ============================================================
-- 2. PUBLIC HOLIDAYS CONFIGURATION (2026)
-- ============================================================

CREATE TABLE IF NOT EXISTS public_holidays (
  id SERIAL PRIMARY KEY,
  holiday_date DATE NOT NULL UNIQUE,
  holiday_name VARCHAR(255) NOT NULL,
  day_of_week VARCHAR(10) NOT NULL,  -- MON, TUE, WED, THU, FRI, SAT, SUN
  hours_adjustment NUMERIC(5,2) DEFAULT 0,  -- 0 if weekday, 8 if Sat/Sun
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert 2026 Malta public holidays
INSERT INTO public_holidays (holiday_date, holiday_name, day_of_week, hours_adjustment, notes) VALUES
('2026-01-01', 'New Year''s Day', 'THU', 0, 'Weekday - counts as 8 work hours'),
('2026-02-10', 'Feast of St Paul''s Shipwreck', 'TUE', 0, 'Weekday - counts as 8 work hours'),
('2026-03-19', 'Feast of St Joseph', 'THU', 0, 'Weekday - counts as 8 work hours'),
('2026-03-31', 'Freedom Day', 'TUE', 0, 'Weekday - counts as 8 work hours'),
('2026-04-03', 'Good Friday', 'FRI', 0, 'Weekday - counts as 8 work hours'),
('2026-05-01', 'Workers'' Day', 'FRI', 0, 'Weekday - counts as 8 work hours'),
('2026-06-07', 'Sette Giugno', 'SUN', 8, 'Sunday - added to VL entitlement (in-lieu hours)'),
('2026-06-29', 'Feast of St Peter and St Paul', 'MON', 0, 'Weekday - counts as 8 work hours'),
('2026-08-15', 'Feast of the Assumption', 'SAT', 8, 'Saturday - added to VL entitlement if works_saturdays = TRUE'),
('2026-09-08', 'Victory Day', 'TUE', 0, 'Weekday - counts as 8 work hours'),
('2026-09-21', 'Independence Day', 'MON', 0, 'Weekday - counts as 8 work hours'),
('2026-12-08', 'Immaculate Conception', 'TUE', 0, 'Weekday - counts as 8 work hours'),
('2026-12-13', 'Republic Day', 'SUN', 8, 'Sunday - added to VL entitlement (in-lieu hours)'),
('2026-12-25', 'Christmas Day', 'FRI', 0, 'Weekday - counts as 8 work hours')
ON CONFLICT (holiday_date) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_public_holidays_date ON public_holidays(holiday_date);

-- ============================================================
-- 3. LEAVE ENTITLEMENTS CONFIGURATION
-- ============================================================

CREATE TABLE IF NOT EXISTS leave_entitlements_config (
  id SERIAL PRIMARY KEY,
  config_year INTEGER NOT NULL UNIQUE,
  vacation_leave_base_hours NUMERIC(8,2) NOT NULL,  -- 192 for 2026
  sick_leave_base_hours NUMERIC(8,2) NOT NULL,      -- 80 for 2026
  public_holiday_inlieu_sunday_hours NUMERIC(8,2) DEFAULT 16,  -- Holidays on Sunday get in-lieu
  public_holiday_inlieu_saturday_hours NUMERIC(8,2) DEFAULT 8,   -- Holidays on Saturday (if works Sat)
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO leave_entitlements_config (config_year, vacation_leave_base_hours, sick_leave_base_hours, notes) VALUES
(2026, 192.00, 80.00, 'Base VL 192 hrs, SL 80 hrs. Adjustments for Sat/Sun holidays and non-Saturday workers.')
ON CONFLICT (config_year) DO NOTHING;

-- ============================================================
-- 4. LEAVE ENTITLEMENTS PER EMPLOYEE (CALCULATED VIEW)
-- ============================================================

-- VIEW: Calculate annual leave entitlement for each employee for a given year
CREATE OR REPLACE VIEW vw_leave_entitlements_annual AS
SELECT 
  e.emp_id,
  EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER AS entitlement_year,
  
  -- Base entitlement
  lec.vacation_leave_base_hours AS vl_base_hours,
  lec.sick_leave_base_hours AS sl_base_hours,
  
  -- In-lieu hours for holidays on Sunday (always counts)
  COUNT(CASE WHEN ph.day_of_week = 'SUN' THEN 1 END) * lec.public_holiday_inlieu_sunday_hours AS vl_inlieu_sunday_hours,
  
  -- In-lieu hours for holidays on Saturday (only if employee doesn't work Saturday)
  COALESCE(
    (SELECT COUNT(CASE WHEN ph.day_of_week = 'SAT' THEN 1 END) * lec.public_holiday_inlieu_saturday_hours
     FROM public_holidays ph
     WHERE EXTRACT(YEAR FROM ph.holiday_date) = EXTRACT(YEAR FROM CURRENT_DATE)
     AND ph.is_active = TRUE
     AND NOT (SELECT et.works_saturdays FROM employee_employment_terms et 
              WHERE et.emp_id = e.emp_id 
              ORDER BY et.effective_from DESC LIMIT 1)),
    0
  ) AS vl_inlieu_saturday_hours,
  
  -- Total annual entitlement (base + adjustments)
  lec.vacation_leave_base_hours
    + COUNT(CASE WHEN ph.day_of_week = 'SUN' THEN 1 END) * lec.public_holiday_inlieu_sunday_hours
    + COALESCE(
        (SELECT COUNT(CASE WHEN ph.day_of_week = 'SAT' THEN 1 END) * lec.public_holiday_inlieu_saturday_hours
         FROM public_holidays ph
         WHERE EXTRACT(YEAR FROM ph.holiday_date) = EXTRACT(YEAR FROM CURRENT_DATE)
         AND ph.is_active = TRUE
         AND NOT (SELECT et.works_saturdays FROM employee_employment_terms et 
                  WHERE et.emp_id = e.emp_id 
                  ORDER BY et.effective_from DESC LIMIT 1)),
        0
      ) AS vl_annual_entitlement_hours,
  
  lec.sick_leave_base_hours AS sl_annual_entitlement_hours,
  
  -- Employment type (from most recent employment terms)
  (SELECT et.employment_type FROM employee_employment_terms et 
   WHERE et.emp_id = e.emp_id 
   ORDER BY et.effective_from DESC LIMIT 1) AS employment_type
  
FROM employees e
CROSS JOIN leave_entitlements_config lec
LEFT JOIN public_holidays ph ON EXTRACT(YEAR FROM ph.holiday_date) = lec.config_year
GROUP BY e.emp_id, lec.config_year, lec.vacation_leave_base_hours, lec.sick_leave_base_hours, 
         lec.public_holiday_inlieu_sunday_hours, lec.public_holiday_inlieu_saturday_hours;

-- ============================================================
-- 5. YEAR-TO-DATE LEAVE USAGE TRACKING
-- ============================================================

-- Extend leave_entitlements table to track YTD usage
-- (Assuming leave_entitlements table already exists from Phase 2)

ALTER TABLE IF EXISTS leave_entitlements
ADD COLUMN IF NOT EXISTS vacation_leave_unused NUMERIC(8,2);

ALTER TABLE IF EXISTS leave_entitlements
ADD COLUMN IF NOT EXISTS sick_leave_unused NUMERIC(8,2);

-- VIEW: Current leave balance for an employee in a given year
CREATE OR REPLACE VIEW vw_leave_balance_ytd AS
SELECT 
  le.emp_id,
  le.year,
  COALESCE(vla.vl_annual_entitlement_hours, 192) AS vl_entitled_hours,
  COALESCE(vla.sl_annual_entitlement_hours, 80) AS sl_entitled_hours,
  le.vacation_leave_used AS vl_used_hours,
  le.sick_leave_used AS sl_used_hours,
  -- Unpaid leave reduces entitlement
  COALESCE(
    (SELECT COALESCE(SUM(ts.hours), 0) FROM timesheets ts
     WHERE ts.emp_id = le.emp_id
     AND EXTRACT(YEAR FROM ts.work_date) = le.year
     AND ts.hour_type = 'UNPAID_LEAVE'),
    0
  ) AS unpaid_leave_hours,
  -- Adjusted entitlements after unpaid leave deduction
  GREATEST(0, 
    COALESCE(vla.vl_annual_entitlement_hours, 192) 
    - COALESCE(
        (SELECT COALESCE(SUM(ts.hours), 0) FROM timesheets ts
         WHERE ts.emp_id = le.emp_id
         AND EXTRACT(YEAR FROM ts.work_date) = le.year
         AND ts.hour_type = 'UNPAID_LEAVE'),
        0
      )
  ) AS vl_adjusted_entitlement,
  
  GREATEST(0,
    COALESCE(vla.sl_annual_entitlement_hours, 80)
    - COALESCE(
        (SELECT COALESCE(SUM(ts.hours), 0) FROM timesheets ts
         WHERE ts.emp_id = le.emp_id
         AND EXTRACT(YEAR FROM ts.work_date) = le.year
         AND ts.hour_type = 'UNPAID_LEAVE'),
        0
      )
  ) AS sl_adjusted_entitlement,
  
  -- Remaining balance
  GREATEST(0,
    COALESCE(vla.vl_annual_entitlement_hours, 192)
    - le.vacation_leave_used
    - COALESCE(
        (SELECT COALESCE(SUM(ts.hours), 0) FROM timesheets ts
         WHERE ts.emp_id = le.emp_id
         AND EXTRACT(YEAR FROM ts.work_date) = le.year
         AND ts.hour_type = 'UNPAID_LEAVE'),
        0
      )
  ) AS vl_remaining_hours,
  
  GREATEST(0,
    COALESCE(vla.sl_annual_entitlement_hours, 80)
    - le.sick_leave_used
    - COALESCE(
        (SELECT COALESCE(SUM(ts.hours), 0) FROM timesheets ts
         WHERE ts.emp_id = le.emp_id
         AND EXTRACT(YEAR FROM ts.work_date) = le.year
         AND ts.hour_type = 'UNPAID_LEAVE'),
        0
      )
  ) AS sl_remaining_hours,
  
  vla.employment_type,
  -- Flag: Employee has no leave entitlement (non-MAIN payroll)
  CASE 
    WHEN vla.employment_type NOT IN ('PERMANENT', 'CASUAL_PT') THEN TRUE
    ELSE FALSE
  END AS has_no_entitlement
  
FROM leave_entitlements le
LEFT JOIN vw_leave_entitlements_annual vla ON le.emp_id = vla.emp_id AND le.year = vla.entitlement_year;

-- ============================================================
-- 6. PRO-RATA LEAVE CALCULATION FOR PAYROLL
-- ============================================================

-- VIEW: Determine pro-rata leave entitlements based on employment period
CREATE OR REPLACE VIEW vw_leave_prorata_for_payroll AS
SELECT 
  le.emp_id,
  le.year,
  et.employment_type,
  
  -- Employment period in year (start to end or current date)
  COALESCE(et.effective_from, make_date(le.year, 1, 1)) AS employment_start,
  COALESCE(et.effective_to, CURRENT_DATE) AS employment_end,
  
  -- Days employed in year
  (COALESCE(et.effective_to, CURRENT_DATE)::DATE
   - GREATEST(COALESCE(et.effective_from, make_date(le.year, 1, 1))::DATE, make_date(le.year, 1, 1))
   + 1)::INTEGER AS days_employed,
  
  -- Pro-rata factor (0 to 1)
  LEAST(1.0,
    (COALESCE(et.effective_to, CURRENT_DATE)::DATE
     - GREATEST(COALESCE(et.effective_from, make_date(le.year, 1, 1))::DATE, make_date(le.year, 1, 1))
     + 1)::NUMERIC
    / 365.0
  ) AS prorata_factor,
  
  -- Entitlements (full year)
  COALESCE(
    (SELECT COALESCE(vla.vl_annual_entitlement_hours, 192)
     FROM vw_leave_entitlements_annual vla
     WHERE vla.emp_id = le.emp_id AND vla.entitlement_year = le.year),
    192
  ) AS vl_full_year_hours,
  
  COALESCE(
    (SELECT COALESCE(vla.sl_annual_entitlement_hours, 80)
     FROM vw_leave_entitlements_annual vla
     WHERE vla.emp_id = le.emp_id AND vla.entitlement_year = le.year),
    80
  ) AS sl_full_year_hours,
  
  -- Pro-rata entitlements
  ROUND(
    COALESCE(
      (SELECT COALESCE(vla.vl_annual_entitlement_hours, 192)
       FROM vw_leave_entitlements_annual vla
       WHERE vla.emp_id = le.emp_id AND vla.entitlement_year = le.year),
      192
    ) * LEAST(1.0,
        (COALESCE(et.effective_to, CURRENT_DATE)::DATE
         - GREATEST(COALESCE(et.effective_from, make_date(le.year, 1, 1))::DATE, make_date(le.year, 1, 1))
         + 1)::NUMERIC
        / 365.0
      ),
    2
  ) AS vl_prorata_hours,
  
  ROUND(
    COALESCE(
      (SELECT COALESCE(vla.sl_annual_entitlement_hours, 80)
       FROM vw_leave_entitlements_annual vla
       WHERE vla.emp_id = le.emp_id AND vla.entitlement_year = le.year),
      80
    ) * LEAST(1.0,
        (COALESCE(et.effective_to, CURRENT_DATE)::DATE
         - GREATEST(COALESCE(et.effective_from, make_date(le.year, 1, 1))::DATE, make_date(le.year, 1, 1))
         + 1)::NUMERIC
        / 365.0
      ),
    2
  ) AS sl_prorata_hours
  
FROM leave_entitlements le
LEFT JOIN employee_employment_terms et 
  ON le.emp_id = et.emp_id 
  AND COALESCE(et.effective_from, make_date(le.year, 1, 1))::DATE <= make_date(le.year, 12, 31)
  AND COALESCE(et.effective_to, CURRENT_DATE)::DATE >= make_date(le.year, 1, 1);

COMMIT;
