-- Timesheets Table for Hours Tracking
-- Stores raw hours logged (from OpenDental or manual CSV)
-- Links to payroll_lines for monthly aggregation

DROP TABLE IF EXISTS timesheets CASCADE;

-- ============================================================
-- TIMESHEETS (Daily/Weekly hour tracking from OpenDental or CSV)
-- ============================================================
CREATE TABLE IF NOT EXISTS timesheets (
    id SERIAL PRIMARY KEY,
    emp_id INTEGER NOT NULL REFERENCES employees(emp_id),
    
    -- Date & Duration
    work_date DATE NOT NULL,  -- Date of work/leave
    hours NUMERIC(8,2) NOT NULL,  -- Hours logged
    
    -- Type of Hours
    hour_type VARCHAR(20) NOT NULL,  -- WORK, SICK_LEAVE, VACATION_LEAVE, UNPAID_LEAVE, MATERNITY
    
    -- Leave Status (determined after import based on balance)
    leave_status VARCHAR(20),  -- PAID, UNPAID, OVERTIME (populated by system)
    
    -- Source
    source VARCHAR(50) DEFAULT 'MANUAL',  -- OPENDENTAL, CSV, MANUAL
    source_reference_id VARCHAR(100),  -- OpenDental ID or CSV reference
    
    -- Notes
    notes TEXT,  -- e.g., "SL - Flu", "VL - Annual", "OT - Emergency"
    
    -- Payroll Linkage
    payroll_line_id INTEGER REFERENCES payroll_lines(id),  -- Links to monthly payroll entry
    
    -- System
    import_date TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    CONSTRAINT chk_hour_type CHECK (hour_type IN ('WORK', 'SICK_LEAVE', 'VACATION_LEAVE', 'UNPAID_LEAVE', 'MATERNITY')),
    CONSTRAINT chk_leave_status CHECK (leave_status IS NULL OR leave_status IN ('PAID', 'UNPAID', 'OVERTIME'))
);

CREATE INDEX idx_timesheets_emp_date ON timesheets(emp_id, work_date DESC);
CREATE INDEX idx_timesheets_payroll ON timesheets(payroll_line_id);
CREATE INDEX idx_timesheets_emp_month ON timesheets(emp_id, DATE_TRUNC('month', work_date));

-- ============================================================
-- LEAVE ENTITLEMENTS (Annual limits per employee per year)
-- ============================================================
CREATE TABLE IF NOT EXISTS leave_entitlements (
    id SERIAL PRIMARY KEY,
    emp_id INTEGER NOT NULL REFERENCES employees(emp_id),
    year INTEGER NOT NULL,
    
    -- Annual Allocations
    vacation_leave_hours NUMERIC(8,2) DEFAULT 0,  -- Annual VL entitlement
    sick_leave_hours NUMERIC(8,2) DEFAULT 0,      -- Annual SL entitlement
    
    -- YTD Usage (calculated from timesheets)
    vacation_leave_used NUMERIC(8,2) DEFAULT 0,
    sick_leave_used NUMERIC(8,2) DEFAULT 0,
    
    -- Carryover
    vacation_carryover_hours NUMERIC(8,2) DEFAULT 0,  -- From previous year
    sick_carryover_hours NUMERIC(8,2) DEFAULT 0,
    
    -- Maternity
    paid_maternity_weeks INTEGER DEFAULT 0,
    unpaid_maternity_weeks INTEGER DEFAULT 0,
    maternity_used_weeks INTEGER DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(emp_id, year)
);

-- ============================================================
-- VIEW: Monthly Timesheet Summary (for payroll_lines)
-- ============================================================
CREATE OR REPLACE VIEW timesheet_summary_monthly AS
SELECT 
    emp_id,
    DATE_TRUNC('month', work_date)::DATE AS payroll_month,
    
    -- Total Hours by Type
    SUM(CASE WHEN hour_type = 'WORK' THEN hours ELSE 0 END) as hours_worked,
    SUM(CASE WHEN hour_type = 'SICK_LEAVE' AND leave_status = 'PAID' THEN hours ELSE 0 END) as paid_sick_leave_hours,
    SUM(CASE WHEN hour_type = 'SICK_LEAVE' AND leave_status = 'UNPAID' THEN hours ELSE 0 END) as unpaid_sick_leave_hours,
    SUM(CASE WHEN hour_type = 'VACATION_LEAVE' AND leave_status = 'PAID' THEN hours ELSE 0 END) as paid_vacation_leave_hours,
    SUM(CASE WHEN hour_type = 'VACATION_LEAVE' AND leave_status = 'UNPAID' THEN hours ELSE 0 END) as unpaid_vacation_leave_hours,
    SUM(CASE WHEN hour_type = 'UNPAID_LEAVE' THEN hours ELSE 0 END) as unpaid_leave_hours,
    
    -- Totals for Wage Calculation
    SUM(CASE WHEN hour_type IN ('WORK', 'SICK_LEAVE', 'VACATION_LEAVE') AND leave_status = 'PAID' THEN hours ELSE 0 END) as total_paid_hours,
    SUM(hours) as total_hours_logged
    
FROM timesheets
WHERE work_date >= DATE_TRUNC('month', work_date)::DATE
GROUP BY emp_id, DATE_TRUNC('month', work_date)
ORDER BY emp_id, payroll_month DESC;

-- ============================================================
-- FUNCTION: Determine Leave Status (PAID vs UNPAID)
-- ============================================================
CREATE OR REPLACE FUNCTION fn_determine_leave_status(
    p_emp_id INTEGER,
    p_year INTEGER,
    p_hour_type VARCHAR
)
RETURNS VARCHAR AS $$
DECLARE
    v_entitlement NUMERIC;
    v_used NUMERIC;
    v_status VARCHAR;
BEGIN
    IF p_hour_type = 'SICK_LEAVE' THEN
        SELECT sl_entitlement_hours, sl_taken_hours INTO v_entitlement, v_used
        FROM leave_entitlements
        WHERE emp_id = p_emp_id AND year = p_year;
        
        v_used := COALESCE(v_used, 0);
        v_entitlement := COALESCE(v_entitlement, 0);
        
        IF v_used < v_entitlement THEN
            RETURN 'PAID';
        ELSE
            RETURN 'UNPAID';
        END IF;
    
    ELSIF p_hour_type = 'VACATION_LEAVE' THEN
        SELECT vl_entitlement_hours, vl_taken_hours INTO v_entitlement, v_used
        FROM leave_entitlements
        WHERE emp_id = p_emp_id AND year = p_year;
        
        v_used := COALESCE(v_used, 0);
        v_entitlement := COALESCE(v_entitlement, 0);
        
        IF v_used < v_entitlement THEN
            RETURN 'PAID';
        ELSE
            RETURN 'UNPAID';
        END IF;
    
    ELSE
        RETURN NULL;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- FUNCTION: Auto-populate payroll_lines from timesheets
-- ============================================================
CREATE OR REPLACE FUNCTION fn_aggregate_timesheets_to_payroll(
    p_payroll_entry_id INTEGER
)
RETURNS TABLE(
    emp_id INTEGER,
    hours_worked NUMERIC,
    paid_sick_leave NUMERIC,
    unpaid_sick_leave NUMERIC,
    paid_vacation_leave NUMERIC,
    unpaid_vacation_leave NUMERIC,
    total_paid_hours NUMERIC,
    message VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ts.emp_id,
        COALESCE(SUM(CASE WHEN ts.hour_type = 'WORK' THEN ts.hours ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN ts.hour_type = 'SICK_LEAVE' AND ts.leave_status = 'PAID' THEN ts.hours ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN ts.hour_type = 'SICK_LEAVE' AND ts.leave_status = 'UNPAID' THEN ts.hours ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN ts.hour_type = 'VACATION_LEAVE' AND ts.leave_status = 'PAID' THEN ts.hours ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN ts.hour_type = 'VACATION_LEAVE' AND ts.leave_status = 'UNPAID' THEN ts.hours ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN ts.hour_type IN ('WORK', 'SICK_LEAVE', 'VACATION_LEAVE') AND ts.leave_status IN ('PAID', NULL) THEN ts.hours ELSE 0 END), 0),
        'Aggregated to payroll'::VARCHAR
    FROM timesheets ts
    JOIN payroll_entries pe ON ts.work_date >= pe.period_from AND ts.work_date <= pe.period_to
    WHERE pe.id = p_payroll_entry_id
    GROUP BY ts.emp_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- TRIGGERS
-- ============================================================
CREATE OR REPLACE FUNCTION fn_update_timesheet_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_timesheets_update BEFORE UPDATE ON timesheets
FOR EACH ROW EXECUTE FUNCTION fn_update_timesheet_timestamp();

CREATE TRIGGER trg_leave_entitlements_update BEFORE UPDATE ON leave_entitlements
FOR EACH ROW EXECUTE FUNCTION fn_update_timesheet_timestamp();

-- ============================================================
-- VERIFY CREATION
-- ============================================================
SELECT 'Timesheets schema created successfully' as status;
