-- Sickness Benefits Configuration
-- Daily benefit rates deducted from employee wage for sick leave beyond 3 days

BEGIN;

-- ============================================================
-- 1. SICKNESS BENEFITS RATES (2026)
-- ============================================================

CREATE TABLE IF NOT EXISTS sickness_benefit_rates (
  id SERIAL PRIMARY KEY,
  benefit_year INTEGER NOT NULL,
  family_status VARCHAR(50) NOT NULL,  -- MARRIED, SINGLE, PARENT, OTHER
  daily_rate NUMERIC(10,2) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT sickness_benefit_rates_year_status_key UNIQUE (benefit_year, family_status)
);

-- 2026 Malta Sickness Benefit Rates
-- Married/Parent categories (mar, mar1, mar2, par, par1, par2): €25.81/day
-- Single/Other (sng, other): €17.21/day
INSERT INTO sickness_benefit_rates (benefit_year, family_status, daily_rate, notes) VALUES
(2026, 'MARRIED', 25.81, 'Married / mar1 / mar2 categories'),
(2026, 'PARENT', 25.81, 'Parent / par1 / par2 categories'),
(2026, 'SINGLE', 17.21, 'Single / sng categories'),
(2026, 'OTHER', 17.21, 'Other categories')
ON CONFLICT (benefit_year, family_status) DO UPDATE SET daily_rate = EXCLUDED.daily_rate;

CREATE INDEX IF NOT EXISTS idx_sickness_benefit_year ON sickness_benefit_rates(benefit_year);

-- ============================================================
-- 2. UPDATE PUBLIC HOLIDAYS - ADD ELIGIBILITY RULES
-- ============================================================

-- Add eligibility columns to public_holidays
ALTER TABLE public_holidays
ADD COLUMN IF NOT EXISTS applies_to_categories VARCHAR(100) DEFAULT 'A,B,C,D',  -- SS categories eligible
ADD COLUMN IF NOT EXISTS applies_to_main_payroll_only BOOLEAN DEFAULT TRUE;

-- Update existing holidays: weekday holidays apply to A,B,C,D only
UPDATE public_holidays
SET applies_to_categories = 'A,B,C,D',
    applies_to_main_payroll_only = TRUE
WHERE EXTRACT(YEAR FROM holiday_date) = 2026;

-- ============================================================
-- 3. SICK LEAVE RULES
-- ============================================================

-- CREATE TABLE IF NOT EXISTS sick_leave_rules (
--   id SERIAL PRIMARY KEY,
--   rule_year INTEGER NOT NULL,
--   first_three_days_paid_by VARCHAR(50) DEFAULT 'EMPLOYER',  -- EMPLOYER or FUND
--   employer_pays_percentage NUMERIC(5,2) DEFAULT 100,  -- First 3 days = 100%
--   beyond_three_days_benefit_applicable BOOLEAN DEFAULT TRUE,  -- Days 4+ use benefit rate
--   full_week_absence_ss_applies BOOLEAN DEFAULT FALSE,  -- Mon-Sun absence: no SS contribution
--   notes TEXT,
--   CONSTRAINT sick_leave_rules_year_key UNIQUE (rule_year)
-- );

-- INSERT INTO sick_leave_rules (rule_year, notes) VALUES
-- (2026, 'First 3 days: employer 100%. Days 4+: benefit rate deducted. Full week absence (Mon-Sun): no SS contributions.')
-- ON CONFLICT DO NOTHING;

COMMIT;
