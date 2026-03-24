-- Drop conflicting tables and recreate with correct foreign keys
DROP TABLE IF EXISTS government_forms CASCADE;
DROP TABLE IF EXISTS payslips CASCADE;
DROP TABLE IF EXISTS payroll_lines CASCADE;
DROP TABLE IF EXISTS leave_balances CASCADE;
DROP TABLE IF EXISTS wage_history CASCADE;
DROP TABLE IF EXISTS statutory_bonuses CASCADE;
DROP TABLE IF EXISTS payroll_entries CASCADE;

-- ============================================================
-- 1. WAGE HISTORY (Hourly Rate Changes)
-- ============================================================
CREATE TABLE IF NOT EXISTS wage_history (
    id SERIAL PRIMARY KEY,
    emp_id INTEGER NOT NULL REFERENCES employees(emp_id),
    
    effective_date DATE NOT NULL,
    hourly_rate NUMERIC(10,4) NOT NULL,  -- €/hour
    
    -- Change Details
    change_type VARCHAR(50) NOT NULL,  -- NEW_RATE, COLA_INCREASE, PERCENTAGE_INCREASE, ADJUSTMENT
    percentage_increase NUMERIC(5,2),  -- For PERCENTAGE_INCREASE
    reason TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_change_type CHECK (change_type IN ('NEW_RATE', 'COLA_INCREASE', 'PERCENTAGE_INCREASE', 'ADJUSTMENT'))
);

CREATE INDEX idx_wage_history_emp_date ON wage_history(emp_id, effective_date DESC);

-- ============================================================
-- 2. STATUTORY BONUS CONFIGURATION
-- ============================================================
CREATE TABLE IF NOT EXISTS statutory_bonuses (
    id SERIAL PRIMARY KEY,
    bonus_year INTEGER NOT NULL,
    bonus_type VARCHAR(50) NOT NULL,  -- STATUTORY_BONUS, WEEKLY_ALLOWANCE
    payment_month VARCHAR(20) NOT NULL,  -- JUNE, DECEMBER, MARCH, SEPTEMBER
    
    full_amount NUMERIC(10,2) NOT NULL,  -- Full bonus (€135.10, €121.16)
    daily_rate NUMERIC(10,4),  -- €/day (€0.74 for statutory bonus)
    weekly_rate NUMERIC(10,4),  -- €/week (€4.66 for weekly allowance)
    
    -- Period for Accrual
    accrual_period_from DATE NOT NULL,  -- Jan 1 for June, Jul 1 for December, etc
    accrual_period_to DATE NOT NULL,    -- Jun 30 for June, Dec 31 for December, etc
    
    -- Payment Rules
    payment_cutoff_date DATE NOT NULL,  -- For December: max Dec 23
    minimum_hours_worked INTEGER,  -- Minimum hours to qualify
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_bonus_type CHECK (bonus_type IN ('STATUTORY_BONUS', 'WEEKLY_ALLOWANCE')),
    CONSTRAINT chk_payment_month CHECK (payment_month IN ('JANUARY', 'MARCH', 'JUNE', 'SEPTEMBER', 'DECEMBER'))
);

-- ============================================================
-- 3. PAYROLL ENTRIES (Monthly Container)
-- ============================================================
CREATE TABLE IF NOT EXISTS payroll_entries (
    id SERIAL PRIMARY KEY,
    payroll_month DATE NOT NULL,  -- First day of month (2026-02-01)
    payroll_year INTEGER NOT NULL,
    payroll_number VARCHAR(50) UNIQUE,  -- e.g., "FEB2026-001"
    
    -- Dates
    period_from DATE NOT NULL,
    period_to DATE NOT NULL,
    payment_date DATE,  -- Last Friday of month (or Dec 23 maximum for December)
    
    -- Status
    status VARCHAR(50) DEFAULT 'DRAFT',  -- DRAFT, PENDING_APPROVAL, APPROVED, PAID, ARCHIVED
    
    -- Totals (summaries)
    total_employees_processed INTEGER DEFAULT 0,
    total_gross_wages NUMERIC(15,2) DEFAULT 0,
    total_tax_deducted NUMERIC(15,2) DEFAULT 0,
    total_ss_contribution NUMERIC(15,2) DEFAULT 0,
    total_net_wages NUMERIC(15,2) DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_payroll_status CHECK (status IN ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'ARCHIVED'))
);

CREATE INDEX idx_payroll_entries_month ON payroll_entries(payroll_month DESC);

-- ============================================================
-- 4. PAYROLL LINES (Per-Employee Monthly Calculations)
-- ============================================================
CREATE TABLE IF NOT EXISTS payroll_lines (
    id SERIAL PRIMARY KEY,
    payroll_entry_id INTEGER NOT NULL REFERENCES payroll_entries(id) ON DELETE CASCADE,
    emp_id INTEGER NOT NULL REFERENCES employees(emp_id),
    
    -- Wage Calculation
    hourly_rate NUMERIC(10,4) NOT NULL,  -- €/hour on payroll date
    hours_worked NUMERIC(8,2) NOT NULL,  -- Total hours worked this month
    weekly_wage NUMERIC(10,2),  -- Calculated from hours_worked
    
    -- Social Security
    ss_class_code VARCHAR(5),  -- A, B, C, D, E, F
    ss_employee_contribution NUMERIC(10,2) DEFAULT 0,  -- Deducted from employee
    ss_employer_contribution NUMERIC(10,2) DEFAULT 0,  -- Employer burden
    mlf_contribution NUMERIC(10,2) DEFAULT 0,  -- Mutual Lifelong Fund
    
    -- Leave
    annual_leave_taken_hours NUMERIC(8,2) DEFAULT 0,
    sick_leave_taken_hours NUMERIC(8,2) DEFAULT 0,
    unpaid_leave_hours NUMERIC(8,2) DEFAULT 0,
    banked_hours_used NUMERIC(8,2) DEFAULT 0,
    banked_hours_new NUMERIC(8,2) DEFAULT 0,
    banked_hours_balance NUMERIC(8,2) DEFAULT 0,
    
    -- Extra Hours & Overtime
    extra_hours_worked NUMERIC(8,2) DEFAULT 0,  -- Paid at normal rate or banked
    overtime_hours NUMERIC(8,2) DEFAULT 0,  -- 1.5x rate
    overtime_payment NUMERIC(10,2) DEFAULT 0,
    
    -- Bonuses (Statutory)
    statutory_bonus_june NUMERIC(10,2) DEFAULT 0,
    weekly_allowance_march NUMERIC(10,2) DEFAULT 0,
    statutory_bonus_december NUMERIC(10,2) DEFAULT 0,
    weekly_allowance_september NUMERIC(10,2) DEFAULT 0,
    
    -- Bonuses (Discretionary)
    supervisor_bonus NUMERIC(10,2) DEFAULT 0,
    performance_bonus NUMERIC(10,2) DEFAULT 0,
    discretionary_bonus NUMERIC(10,2) DEFAULT 0,
    
    -- Bonus Deductions (based on leave)
    supervisor_bonus_deduction NUMERIC(10,2) DEFAULT 0,
    performance_bonus_deduction NUMERIC(10,2) DEFAULT 0,
    
    -- Tax
    gross_earnings NUMERIC(15,2),  -- Sum of all earnings (wages, bonuses, overtime)
    tax_rate_applied NUMERIC(5,2),  -- e.g., 15%, 25%, etc
    tax_deduction NUMERIC(10,2) DEFAULT 0,  -- Calculated
    
    -- Summary
    net_payment NUMERIC(15,2),  -- Gross - deductions
    total_deductions NUMERIC(15,2),  -- SS + Tax + any other
    
    -- Notes/Comments
    notes TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_payroll_lines_entry ON payroll_lines(payroll_entry_id);
CREATE INDEX idx_payroll_lines_emp ON payroll_lines(emp_id);

-- ============================================================
-- 5. LEAVE BALANCES (Track VL/SL for each employee)
-- ============================================================
CREATE TABLE IF NOT EXISTS leave_balances (
    id SERIAL PRIMARY KEY,
    emp_id INTEGER NOT NULL REFERENCES employees(emp_id),
    year INTEGER NOT NULL,
    
    -- Vacation Leave (VL)
    vl_entitlement_hours NUMERIC(8,2) DEFAULT 0,  -- Annual entitlement
    vl_taken_hours NUMERIC(8,2) DEFAULT 0,
    vl_balance_hours NUMERIC(8,2) DEFAULT 0,
    
    -- Sick Leave (SL)
    sl_entitlement_hours NUMERIC(8,2) DEFAULT 0,  -- Annual entitlement
    sl_taken_hours NUMERIC(8,2) DEFAULT 0,
    sl_balance_hours NUMERIC(8,2) DEFAULT 0,
    
    -- Banked Hours
    banked_hours_opening NUMERIC(8,2) DEFAULT 0,
    banked_hours_added NUMERIC(8,2) DEFAULT 0,
    banked_hours_used NUMERIC(8,2) DEFAULT 0,
    banked_hours_closing NUMERIC(8,2) DEFAULT 0,
    
    -- Maternity Leave
    paid_maternity_weeks INTEGER DEFAULT 0,
    unpaid_maternity_weeks INTEGER DEFAULT 0,
    
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(emp_id, year)
);

-- ============================================================
-- 6. PAYSLIPS (Output Records)
-- ============================================================
CREATE TABLE IF NOT EXISTS payslips (
    id SERIAL PRIMARY KEY,
    payroll_line_id INTEGER NOT NULL REFERENCES payroll_lines(id),
    payroll_entry_id INTEGER NOT NULL REFERENCES payroll_entries(id),
    emp_id INTEGER NOT NULL REFERENCES employees(emp_id),
    
    -- Payslip Details
    payslip_number VARCHAR(50) UNIQUE,
    issue_date DATE,
    payment_date DATE,
    
    -- Signature & Bank Details
    signature_image_url VARCHAR(255),
    bank_transaction_number VARCHAR(50),
    paid_previously_amount NUMERIC(12,2),
    
    -- PDF Storage
    pdf_file_url VARCHAR(255),
    pdf_generated_at TIMESTAMP,
    
    -- Status
    status VARCHAR(50) DEFAULT 'DRAFT',  -- DRAFT, ISSUED, EMAILED, ARCHIVED
    email_sent_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_payslip_status CHECK (status IN ('DRAFT', 'ISSUED', 'EMAILED', 'ARCHIVED'))
);

CREATE INDEX idx_payslips_employee ON payslips(emp_id);
CREATE INDEX idx_payslips_payroll ON payslips(payroll_entry_id);

-- ============================================================
-- 7. GOVERNMENT FORMS (FS5/FS7 Storage)
-- ============================================================
CREATE TABLE IF NOT EXISTS government_forms (
    id SERIAL PRIMARY KEY,
    emp_id INTEGER NOT NULL REFERENCES employees(emp_id),
    form_type VARCHAR(20) NOT NULL,  -- FS5, FS7
    form_month INTEGER,  -- Month (1-12)
    form_year INTEGER,
    
    -- Content
    form_data JSONB,  -- Store form data as JSON
    pdf_file_url VARCHAR(255),
    
    -- Status
    submitted BOOLEAN DEFAULT FALSE,
    submission_date DATE,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_form_type CHECK (form_type IN ('FS5', 'FS7'))
);

-- ============================================================
-- TRIGGERS - Auto-update timestamps
-- ============================================================
CREATE OR REPLACE FUNCTION update_timestamp_payroll()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payroll_entries_update BEFORE UPDATE ON payroll_entries
FOR EACH ROW EXECUTE FUNCTION update_timestamp_payroll();

CREATE TRIGGER trg_payroll_lines_update BEFORE UPDATE ON payroll_lines
FOR EACH ROW EXECUTE FUNCTION update_timestamp_payroll();

CREATE TRIGGER trg_leave_balances_update BEFORE UPDATE ON leave_balances
FOR EACH ROW EXECUTE FUNCTION update_timestamp_payroll();

CREATE TRIGGER trg_government_forms_update BEFORE UPDATE ON government_forms
FOR EACH ROW EXECUTE FUNCTION update_timestamp_payroll();

-- ============================================================
-- VERIFY TABLES CREATED
-- ============================================================
SELECT 'Payroll schema created successfully' as status;
