-- Full payroll engine model DDL
-- Generated from the agreed MAIN-payroll-first design.
-- This does not remove older payroll tables; it adds the new engine tables.
--
-- Apply with:
--   psql -h localhost -p 55432 -U excel -d exceldb -f sql/payroll_full_engine_ddl.sql

BEGIN;

CREATE TABLE IF NOT EXISTS employee_payroll_terms (
  id BIGSERIAL PRIMARY KEY,
  emp_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  payroll_type TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  employment_type_main TEXT NULL,
  weekly_hours_main NUMERIC(6,2) NULL,
  pay_input_basis_main TEXT NULL,
  input_amount_main NUMERIC(12,2) NULL,
  hourly_rate_main NUMERIC(12,4) NULL,
  timesheet_required BOOLEAN NULL,
  student_flag BOOLEAN NOT NULL DEFAULT FALSE,
  tax_status TEXT NULL,
  annual_vl_entitlement_hours NUMERIC(8,2) NULL,
  annual_sl_entitlement_hours NUMERIC(8,2) NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NULL,
  notes TEXT NULL,
  CONSTRAINT employee_payroll_terms_payroll_type_chk
    CHECK (payroll_type IN ('MAIN', 'PROVIDER', 'THIRDPARTY')),
  CONSTRAINT employee_payroll_terms_employment_type_main_chk
    CHECK (
      employment_type_main IS NULL OR
      employment_type_main IN ('FULL_TIME', 'FULL_TIME_REDUCED', 'PART_TIME', 'CASUAL_PART_TIME')
    ),
  CONSTRAINT employee_payroll_terms_pay_input_basis_main_chk
    CHECK (
      pay_input_basis_main IS NULL OR
      pay_input_basis_main IN ('HOURLY', 'MONTHLY', 'YEARLY')
    ),
  CONSTRAINT employee_payroll_terms_weekly_hours_main_chk
    CHECK (weekly_hours_main IS NULL OR weekly_hours_main >= 0),
  CONSTRAINT employee_payroll_terms_input_amount_main_chk
    CHECK (input_amount_main IS NULL OR input_amount_main >= 0),
  CONSTRAINT employee_payroll_terms_hourly_rate_main_chk
    CHECK (hourly_rate_main IS NULL OR hourly_rate_main >= 0),
  CONSTRAINT employee_payroll_terms_annual_vl_chk
    CHECK (annual_vl_entitlement_hours IS NULL OR annual_vl_entitlement_hours >= 0),
  CONSTRAINT employee_payroll_terms_annual_sl_chk
    CHECK (annual_sl_entitlement_hours IS NULL OR annual_sl_entitlement_hours >= 0),
  CONSTRAINT employee_payroll_terms_dates_chk
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS idx_employee_payroll_terms_emp_payroll_dates
  ON employee_payroll_terms(emp_id, payroll_type, effective_from DESC, effective_to);

CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_payroll_terms_start
  ON employee_payroll_terms(emp_id, payroll_type, effective_from);

CREATE TABLE IF NOT EXISTS payroll_yearly_constants (
  id BIGSERIAL PRIMARY KEY,
  payroll_type TEXT NOT NULL,
  tax_year INTEGER NOT NULL,
  constant_key TEXT NOT NULL,
  constant_value TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'NUMBER',
  effective_from DATE NULL,
  effective_to DATE NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NULL,
  notes TEXT NULL,
  CONSTRAINT payroll_yearly_constants_payroll_type_chk
    CHECK (payroll_type IN ('MAIN', 'PROVIDER', 'THIRDPARTY', 'ALL')),
  CONSTRAINT payroll_yearly_constants_value_type_chk
    CHECK (value_type IN ('NUMBER', 'TEXT', 'DATE', 'BOOLEAN')),
  CONSTRAINT payroll_yearly_constants_tax_year_chk
    CHECK (tax_year BETWEEN 2000 AND 3000),
  CONSTRAINT payroll_yearly_constants_dates_chk
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_yearly_constants_active
  ON payroll_yearly_constants(payroll_type, tax_year, constant_key, COALESCE(effective_from, DATE '2000-01-01'));

CREATE TABLE IF NOT EXISTS payroll_tax_special_rules (
  id BIGSERIAL PRIMARY KEY,
  tax_year INTEGER NOT NULL,
  rule_type TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  final_tax_rate NUMERIC(6,5) NOT NULL,
  income_cap NUMERIC(14,2) NULL,
  annual_income_cap NUMERIC(14,2) NULL,
  max_weekly_hours NUMERIC(6,2) NULL,
  requires_student_flag BOOLEAN NOT NULL DEFAULT FALSE,
  requires_part_time_employment BOOLEAN NOT NULL DEFAULT FALSE,
  requires_overtime_stream BOOLEAN NOT NULL DEFAULT FALSE,
  effective_from DATE NULL,
  effective_to DATE NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NULL,
  notes TEXT NULL,
  CONSTRAINT payroll_tax_special_rules_type_chk
    CHECK (rule_type IN ('PART_TIME_FINAL', 'STUDENT_PART_TIME_FINAL', 'OVERTIME_FINAL')),
  CONSTRAINT payroll_tax_special_rules_rate_chk
    CHECK (final_tax_rate >= 0 AND final_tax_rate <= 1),
  CONSTRAINT payroll_tax_special_rules_income_cap_chk
    CHECK (income_cap IS NULL OR income_cap >= 0),
  CONSTRAINT payroll_tax_special_rules_annual_income_cap_chk
    CHECK (annual_income_cap IS NULL OR annual_income_cap >= 0),
  CONSTRAINT payroll_tax_special_rules_max_weekly_hours_chk
    CHECK (max_weekly_hours IS NULL OR max_weekly_hours >= 0),
  CONSTRAINT payroll_tax_special_rules_dates_chk
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_tax_special_rules
  ON payroll_tax_special_rules(tax_year, rule_type, COALESCE(effective_from, DATE '2000-01-01'));

CREATE TABLE IF NOT EXISTS payroll_leave_type_rules (
  id BIGSERIAL PRIMARY KEY,
  leave_type_id BIGINT NOT NULL REFERENCES leave_types(id) ON DELETE CASCADE,
  payroll_type TEXT NOT NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  payroll_leave_class_default TEXT NOT NULL,
  reduces_vl_entitlement BOOLEAN NOT NULL DEFAULT FALSE,
  reduces_sl_entitlement BOOLEAN NOT NULL DEFAULT FALSE,
  counts_as_unpaid_leave BOOLEAN NOT NULL DEFAULT FALSE,
  counts_for_ssc_zero_week BOOLEAN NOT NULL DEFAULT FALSE,
  reduces_bonus_eligible_days BOOLEAN NOT NULL DEFAULT FALSE,
  affects_gross_deduction BOOLEAN NOT NULL DEFAULT FALSE,
  paid_by TEXT NOT NULL DEFAULT 'EMPLOYER',
  benefit_type TEXT NULL,
  benefit_amount_rule TEXT NULL,
  payslip_visibility TEXT NOT NULL DEFAULT 'SHOW',
  can_convert_to_excess_unpaid BOOLEAN NOT NULL DEFAULT FALSE,
  can_split_by_entitlement BOOLEAN NOT NULL DEFAULT FALSE,
  requires_subtype_selection BOOLEAN NOT NULL DEFAULT FALSE,
  requires_admin_review BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NULL,
  notes TEXT NULL,
  CONSTRAINT payroll_leave_type_rules_payroll_type_chk
    CHECK (payroll_type IN ('MAIN', 'PROVIDER', 'THIRDPARTY')),
  CONSTRAINT payroll_leave_type_rules_class_chk
    CHECK (
      payroll_leave_class_default IN (
        'PAID_VL',
        'PAID_SL',
        'EXPLICIT_UNPAID',
        'GOVT_MATERNITY_SSC_EXCLUDED',
        'EMPLOYER_MATERNITY_PAID',
        'OTHER_PAID',
        'OTHER_UNPAID'
      )
    ),
  CONSTRAINT payroll_leave_type_rules_paid_by_chk
    CHECK (paid_by IN ('EMPLOYER', 'GOVERNMENT', 'BENEFIT', 'UNPAID')),
  CONSTRAINT payroll_leave_type_rules_visibility_chk
    CHECK (payslip_visibility IN ('SHOW', 'HIDE', 'GROUPED')),
  CONSTRAINT payroll_leave_type_rules_dates_chk
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_leave_type_rules_start
  ON payroll_leave_type_rules(leave_type_id, payroll_type, effective_from);

CREATE TABLE IF NOT EXISTS payroll_month_results (
  id BIGSERIAL PRIMARY KEY,
  emp_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  payroll_type TEXT NOT NULL,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  calc_version INTEGER NOT NULL DEFAULT 1,
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NULL,
  employment_type_main TEXT NULL,
  weekly_hours_main NUMERIC(6,2) NULL,
  pay_input_basis_main TEXT NULL,
  input_amount_main NUMERIC(12,2) NULL,
  hourly_rate_main NUMERIC(12,4) NULL,
  tax_status TEXT NULL,
  student_flag BOOLEAN NOT NULL DEFAULT FALSE,
  timesheet_required BOOLEAN NULL,
  income_previous_employment NUMERIC(14,2) NOT NULL DEFAULT 0,
  employment_start_date DATE NULL,
  termination_date DATE NULL,
  annual_vl_entitlement_hours NUMERIC(8,2) NULL,
  annual_sl_entitlement_hours NUMERIC(8,2) NULL,
  prorated_days_on_payroll INTEGER NULL,
  eligible_days_for_leave INTEGER NULL,
  vl_prorated_entitlement NUMERIC(8,2) NULL,
  sl_prorated_entitlement NUMERIC(8,2) NULL,
  vl_taken_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  sl_taken_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  explicit_unpaid_leave_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  auto_unpaid_vl_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  auto_unpaid_sl_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  unpaid_leave_hours_total NUMERIC(8,2) NOT NULL DEFAULT 0,
  unpaid_leave_deduction_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  timesheet_work_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  timesheet_paid_vl_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  timesheet_paid_sl_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  timesheet_unpaid_leave_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  timesheet_overtime_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  timesheet_extra_under_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
  banked_hours_opening NUMERIC(8,2) NOT NULL DEFAULT 0,
  banked_hours_movement NUMERIC(8,2) NOT NULL DEFAULT 0,
  banked_hours_closing NUMERIC(8,2) NOT NULL DEFAULT 0,
  main_base_monthly_wage NUMERIC(12,2) NOT NULL DEFAULT 0,
  normal_rate_extra_pay NUMERIC(12,2) NOT NULL DEFAULT 0,
  under_hours_deduction_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  overtime_pay_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  bonus NUMERIC(12,2) NOT NULL DEFAULT 0,
  performance_bonus NUMERIC(12,2) NOT NULL DEFAULT 0,
  supervisor_bonus NUMERIC(12,2) NOT NULL DEFAULT 0,
  statutory_bonus_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxable_bonus_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_taxable_adjustments NUMERIC(12,2) NOT NULL DEFAULT 0,
  normal_main_income NUMERIC(12,2) NOT NULL DEFAULT 0,
  gross_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  part_time_final_tax_income_current NUMERIC(12,2) NOT NULL DEFAULT 0,
  part_time_progressive_excess_current NUMERIC(12,2) NOT NULL DEFAULT 0,
  student_part_time_final_tax_income_current NUMERIC(12,2) NOT NULL DEFAULT 0,
  student_part_time_progressive_excess_current NUMERIC(12,2) NOT NULL DEFAULT 0,
  overtime_final_tax_income_current NUMERIC(12,2) NOT NULL DEFAULT 0,
  overtime_progressive_excess_current NUMERIC(12,2) NOT NULL DEFAULT 0,
  normal_progressive_income_current NUMERIC(12,2) NOT NULL DEFAULT 0,
  taxable_income_ytd_before_current NUMERIC(14,2) NOT NULL DEFAULT 0,
  normal_progressive_income_ytd_before_current NUMERIC(14,2) NOT NULL DEFAULT 0,
  part_time_income_ytd_before_current NUMERIC(14,2) NOT NULL DEFAULT 0,
  student_part_time_income_ytd_before_current NUMERIC(14,2) NOT NULL DEFAULT 0,
  overtime_income_ytd_before_current NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_paid_ytd_before_current NUMERIC(14,2) NOT NULL DEFAULT 0,
  normal_progressive_income_ytd_after_current NUMERIC(14,2) NOT NULL DEFAULT 0,
  part_time_income_ytd_after_current NUMERIC(14,2) NOT NULL DEFAULT 0,
  student_part_time_income_ytd_after_current NUMERIC(14,2) NOT NULL DEFAULT 0,
  overtime_income_ytd_after_current NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_paid_ytd_after_current NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_on_gross NUMERIC(12,2) NOT NULL DEFAULT 0,
  part_time_final_tax_current NUMERIC(12,2) NOT NULL DEFAULT 0,
  student_part_time_final_tax_current NUMERIC(12,2) NOT NULL DEFAULT 0,
  overtime_final_tax_current NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_employee_tax NUMERIC(12,2) NOT NULL DEFAULT 0,
  ssc_weekly_wage_basis NUMERIC(12,2) NOT NULL DEFAULT 0,
  ssc_zero_weeks_count INTEGER NOT NULL DEFAULT 0,
  ssc_employee NUMERIC(12,2) NOT NULL DEFAULT 0,
  ssc_employer NUMERIC(12,2) NOT NULL DEFAULT 0,
  ssc_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  mlf NUMERIC(12,2) NOT NULL DEFAULT 0,
  net_wage NUMERIC(12,2) NOT NULL DEFAULT 0,
  loan_due_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  loan_override_amount NUMERIC(12,2) NULL,
  loan_deduction_this_month NUMERIC(12,2) NOT NULL DEFAULT 0,
  other_post_net_deductions NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_previously_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  transaction_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  payslip_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  transaction_number TEXT NULL,
  source_funds_label TEXT NULL,
  calc_status TEXT NOT NULL DEFAULT 'DRAFT',
  calc_notes TEXT NULL,
  source_signature TEXT NULL,
  requires_review BOOLEAN NOT NULL DEFAULT FALSE,
  review_reason TEXT NULL,
  CONSTRAINT payroll_month_results_payroll_type_chk
    CHECK (payroll_type IN ('MAIN', 'PROVIDER', 'THIRDPARTY')),
  CONSTRAINT payroll_month_results_period_month_chk
    CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT payroll_month_results_calc_version_chk
    CHECK (calc_version >= 1),
  CONSTRAINT payroll_month_results_calc_status_chk
    CHECK (calc_status IN ('DRAFT', 'CONFIRMED', 'AMENDED')),
  CONSTRAINT payroll_month_results_non_negative_chk
    CHECK (
      income_previous_employment >= 0 AND
      vl_taken_hours >= 0 AND
      sl_taken_hours >= 0 AND
      explicit_unpaid_leave_hours >= 0 AND
      auto_unpaid_vl_hours >= 0 AND
      auto_unpaid_sl_hours >= 0 AND
      unpaid_leave_hours_total >= 0 AND
      unpaid_leave_deduction_amount >= 0 AND
      timesheet_work_hours >= 0 AND
      timesheet_paid_vl_hours >= 0 AND
      timesheet_paid_sl_hours >= 0 AND
      timesheet_unpaid_leave_hours >= 0 AND
      timesheet_overtime_hours >= 0 AND
      main_base_monthly_wage >= 0 AND
      normal_rate_extra_pay >= 0 AND
      under_hours_deduction_amount >= 0 AND
      overtime_pay_amount >= 0 AND
      bonus >= 0 AND
      performance_bonus >= 0 AND
      supervisor_bonus >= 0 AND
      statutory_bonus_amount >= 0 AND
      taxable_bonus_total >= 0 AND
      other_taxable_adjustments >= 0 AND
      normal_main_income >= 0 AND
      gross_total >= 0 AND
      part_time_final_tax_income_current >= 0 AND
      part_time_progressive_excess_current >= 0 AND
      student_part_time_final_tax_income_current >= 0 AND
      student_part_time_progressive_excess_current >= 0 AND
      overtime_final_tax_income_current >= 0 AND
      overtime_progressive_excess_current >= 0 AND
      normal_progressive_income_current >= 0 AND
      taxable_income_ytd_before_current >= 0 AND
      normal_progressive_income_ytd_before_current >= 0 AND
      part_time_income_ytd_before_current >= 0 AND
      student_part_time_income_ytd_before_current >= 0 AND
      overtime_income_ytd_before_current >= 0 AND
      tax_paid_ytd_before_current >= 0 AND
      normal_progressive_income_ytd_after_current >= 0 AND
      part_time_income_ytd_after_current >= 0 AND
      student_part_time_income_ytd_after_current >= 0 AND
      overtime_income_ytd_after_current >= 0 AND
      tax_paid_ytd_after_current >= 0 AND
      tax_on_gross >= 0 AND
      part_time_final_tax_current >= 0 AND
      student_part_time_final_tax_current >= 0 AND
      overtime_final_tax_current >= 0 AND
      total_employee_tax >= 0 AND
      ssc_weekly_wage_basis >= 0 AND
      ssc_zero_weeks_count >= 0 AND
      ssc_employee >= 0 AND
      ssc_employer >= 0 AND
      ssc_total >= 0 AND
      mlf >= 0 AND
      loan_due_amount >= 0 AND
      loan_deduction_this_month >= 0 AND
      other_post_net_deductions >= 0 AND
      paid_previously_amount >= 0
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_month_results_version
  ON payroll_month_results(emp_id, payroll_type, period_year, period_month, calc_version);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_month_results_current
  ON payroll_month_results(emp_id, payroll_type, period_year, period_month)
  WHERE is_current;

CREATE TABLE IF NOT EXISTS payroll_hour_sources (
  id BIGSERIAL PRIMARY KEY,
  emp_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  payroll_type TEXT NOT NULL,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  direction TEXT NOT NULL,
  hours_value NUMERIC(8,2) NOT NULL,
  source_reference TEXT NULL,
  source_date_from DATE NULL,
  source_date_to DATE NULL,
  origin TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NULL,
  CONSTRAINT payroll_hour_sources_payroll_type_chk
    CHECK (payroll_type IN ('MAIN', 'PROVIDER', 'THIRDPARTY')),
  CONSTRAINT payroll_hour_sources_period_month_chk
    CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT payroll_hour_sources_source_type_chk
    CHECK (source_type IN ('BANKED', 'EXTRA', 'OVERTIME', 'UNDER_HOURS')),
  CONSTRAINT payroll_hour_sources_direction_chk
    CHECK (direction IN ('CREDIT', 'DEFICIT')),
  CONSTRAINT payroll_hour_sources_origin_chk
    CHECK (origin IN ('TIMESHEET', 'MANUAL', 'IMPORT_ADJUSTMENT', 'SYSTEM_RECALC')),
  CONSTRAINT payroll_hour_sources_hours_chk
    CHECK (hours_value >= 0),
  CONSTRAINT payroll_hour_sources_dates_chk
    CHECK (source_date_to IS NULL OR source_date_from IS NULL OR source_date_to >= source_date_from)
);

CREATE INDEX IF NOT EXISTS idx_payroll_hour_sources_lookup
  ON payroll_hour_sources(emp_id, payroll_type, period_year, period_month, source_type, direction)
  WHERE is_active;

CREATE TABLE IF NOT EXISTS payroll_hour_decisions (
  id BIGSERIAL PRIMARY KEY,
  emp_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  payroll_type TEXT NOT NULL,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  payroll_result_id BIGINT NULL REFERENCES payroll_month_results(id) ON DELETE SET NULL,
  hour_source_id BIGINT NOT NULL REFERENCES payroll_hour_sources(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  source_type TEXT NOT NULL,
  source_reference TEXT NULL,
  source_date_from DATE NULL,
  source_date_to DATE NULL,
  source_hours_available NUMERIC(8,2) NOT NULL,
  hours_decided NUMERIC(8,2) NOT NULL,
  action TEXT NOT NULL,
  target_payroll_type TEXT NULL,
  target_period_year INTEGER NULL,
  target_period_month INTEGER NULL,
  rate_mode TEXT NULL,
  hourly_rate_used NUMERIC(12,4) NULL,
  overtime_multiplier_used NUMERIC(8,4) NULL,
  overtime_rate_used NUMERIC(12,4) NULL,
  tax_path TEXT NOT NULL DEFAULT 'NONE',
  pay_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  affects_gross_total BOOLEAN NOT NULL DEFAULT FALSE,
  affects_overtime_pay BOOLEAN NOT NULL DEFAULT FALSE,
  affects_transaction_amount BOOLEAN NOT NULL DEFAULT FALSE,
  affects_payslip_value BOOLEAN NOT NULL DEFAULT FALSE,
  user_note TEXT NULL,
  system_note TEXT NULL,
  decision_reason TEXT NULL,
  CONSTRAINT payroll_hour_decisions_payroll_type_chk
    CHECK (payroll_type IN ('MAIN', 'PROVIDER', 'THIRDPARTY')),
  CONSTRAINT payroll_hour_decisions_period_month_chk
    CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT payroll_hour_decisions_source_type_chk
    CHECK (source_type IN ('BANKED', 'EXTRA', 'OVERTIME')),
  CONSTRAINT payroll_hour_decisions_action_chk
    CHECK (action IN ('TRANSFER_NEXT_MONTH', 'PAY_NORMAL', 'PAY_OVERTIME', 'TRANSFER_OTHER_PAYROLL', 'DELETE')),
  CONSTRAINT payroll_hour_decisions_target_payroll_type_chk
    CHECK (target_payroll_type IS NULL OR target_payroll_type IN ('MAIN', 'PROVIDER', 'THIRDPARTY')),
  CONSTRAINT payroll_hour_decisions_target_period_month_chk
    CHECK (target_period_month IS NULL OR target_period_month BETWEEN 1 AND 12),
  CONSTRAINT payroll_hour_decisions_rate_mode_chk
    CHECK (rate_mode IS NULL OR rate_mode IN ('NORMAL', 'OVERTIME')),
  CONSTRAINT payroll_hour_decisions_tax_path_chk
    CHECK (tax_path IN ('NORMAL_PROGRESSIVE', 'OVERTIME_FINAL', 'NONE')),
  CONSTRAINT payroll_hour_decisions_hours_chk
    CHECK (source_hours_available >= 0 AND hours_decided >= 0),
  CONSTRAINT payroll_hour_decisions_rates_chk
    CHECK (
      (hourly_rate_used IS NULL OR hourly_rate_used >= 0) AND
      (overtime_multiplier_used IS NULL OR overtime_multiplier_used >= 0) AND
      (overtime_rate_used IS NULL OR overtime_rate_used >= 0) AND
      pay_amount >= 0 AND
      tax_amount >= 0
    ),
  CONSTRAINT payroll_hour_decisions_target_required_chk
    CHECK (
      action <> 'TRANSFER_OTHER_PAYROLL' OR
      (target_payroll_type IS NOT NULL)
    ),
  CONSTRAINT payroll_hour_decisions_dates_chk
    CHECK (source_date_to IS NULL OR source_date_from IS NULL OR source_date_to >= source_date_from)
);

CREATE INDEX IF NOT EXISTS idx_payroll_hour_decisions_lookup
  ON payroll_hour_decisions(emp_id, payroll_type, period_year, period_month)
  WHERE is_active;

CREATE TABLE IF NOT EXISTS payroll_hour_deficit_decisions (
  id BIGSERIAL PRIMARY KEY,
  emp_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  payroll_type TEXT NOT NULL,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  payroll_result_id BIGINT NULL REFERENCES payroll_month_results(id) ON DELETE SET NULL,
  hour_source_id BIGINT NOT NULL REFERENCES payroll_hour_sources(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  source_type TEXT NOT NULL,
  source_hours_deficit NUMERIC(8,2) NOT NULL,
  source_date_from DATE NULL,
  source_date_to DATE NULL,
  hours_decided NUMERIC(8,2) NOT NULL,
  action TEXT NOT NULL,
  target_payroll_type TEXT NULL,
  target_period_year INTEGER NULL,
  target_period_month INTEGER NULL,
  hourly_rate_used NUMERIC(12,4) NULL,
  deduction_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  affects_gross_total BOOLEAN NOT NULL DEFAULT FALSE,
  affects_transaction_amount BOOLEAN NOT NULL DEFAULT FALSE,
  affects_payslip_value BOOLEAN NOT NULL DEFAULT FALSE,
  user_note TEXT NULL,
  system_note TEXT NULL,
  decision_reason TEXT NULL,
  CONSTRAINT payroll_hour_deficit_decisions_payroll_type_chk
    CHECK (payroll_type IN ('MAIN', 'PROVIDER', 'THIRDPARTY')),
  CONSTRAINT payroll_hour_deficit_decisions_period_month_chk
    CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT payroll_hour_deficit_decisions_source_type_chk
    CHECK (source_type IN ('BANKED', 'UNDER_HOURS')),
  CONSTRAINT payroll_hour_deficit_decisions_action_chk
    CHECK (action IN ('DEDUCT_NOW', 'CARRY_FORWARD', 'TRANSFER_OTHER_PAYROLL', 'WAIVE')),
  CONSTRAINT payroll_hour_deficit_decisions_target_payroll_type_chk
    CHECK (target_payroll_type IS NULL OR target_payroll_type IN ('MAIN', 'PROVIDER', 'THIRDPARTY')),
  CONSTRAINT payroll_hour_deficit_decisions_target_period_month_chk
    CHECK (target_period_month IS NULL OR target_period_month BETWEEN 1 AND 12),
  CONSTRAINT payroll_hour_deficit_decisions_amounts_chk
    CHECK (
      source_hours_deficit >= 0 AND
      hours_decided >= 0 AND
      (hourly_rate_used IS NULL OR hourly_rate_used >= 0) AND
      deduction_amount >= 0
    ),
  CONSTRAINT payroll_hour_deficit_decisions_target_required_chk
    CHECK (
      action <> 'TRANSFER_OTHER_PAYROLL' OR
      (target_payroll_type IS NOT NULL)
    ),
  CONSTRAINT payroll_hour_deficit_decisions_dates_chk
    CHECK (source_date_to IS NULL OR source_date_from IS NULL OR source_date_to >= source_date_from)
);

CREATE INDEX IF NOT EXISTS idx_payroll_hour_deficit_decisions_lookup
  ON payroll_hour_deficit_decisions(emp_id, payroll_type, period_year, period_month)
  WHERE is_active;

CREATE TABLE IF NOT EXISTS payroll_leave_classifications (
  id BIGSERIAL PRIMARY KEY,
  emp_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  payroll_type TEXT NOT NULL,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  payroll_result_id BIGINT NULL REFERENCES payroll_month_results(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  leave_source_type TEXT NOT NULL,
  source_reference TEXT NULL,
  date_from DATE NOT NULL,
  date_to DATE NOT NULL,
  hours_value NUMERIC(8,2) NOT NULL,
  payroll_leave_class TEXT NOT NULL,
  reduces_vl_entitlement BOOLEAN NOT NULL DEFAULT FALSE,
  reduces_sl_entitlement BOOLEAN NOT NULL DEFAULT FALSE,
  counts_as_unpaid_leave BOOLEAN NOT NULL DEFAULT FALSE,
  counts_for_ssc_zero_week BOOLEAN NOT NULL DEFAULT FALSE,
  reduces_bonus_eligible_days BOOLEAN NOT NULL DEFAULT FALSE,
  affects_gross_deduction BOOLEAN NOT NULL DEFAULT FALSE,
  hourly_rate_used NUMERIC(12,4) NULL,
  deduction_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  user_note TEXT NULL,
  system_note TEXT NULL,
  classification_reason TEXT NULL,
  CONSTRAINT payroll_leave_classifications_payroll_type_chk
    CHECK (payroll_type IN ('MAIN', 'PROVIDER', 'THIRDPARTY')),
  CONSTRAINT payroll_leave_classifications_period_month_chk
    CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT payroll_leave_classifications_source_type_chk
    CHECK (
      leave_source_type IN (
        'VL',
        'SL',
        'UNPAID',
        'MATERNITY_GOVT',
        'MATERNITY_EMPLOYER',
        'OTHER_LEAVE'
      )
    ),
  CONSTRAINT payroll_leave_classifications_class_chk
    CHECK (
      payroll_leave_class IN (
        'PAID_VL',
        'PAID_SL',
        'EXCESS_VL_UNPAID',
        'EXCESS_SL_UNPAID',
        'EXPLICIT_UNPAID',
        'GOVT_MATERNITY_SSC_EXCLUDED',
        'EMPLOYER_MATERNITY_PAID',
        'OTHER_PAID',
        'OTHER_UNPAID'
      )
    ),
  CONSTRAINT payroll_leave_classifications_dates_chk
    CHECK (date_to >= date_from),
  CONSTRAINT payroll_leave_classifications_amounts_chk
    CHECK (
      hours_value >= 0 AND
      (hourly_rate_used IS NULL OR hourly_rate_used >= 0) AND
      deduction_amount >= 0
    )
);

CREATE INDEX IF NOT EXISTS idx_payroll_leave_classifications_lookup
  ON payroll_leave_classifications(emp_id, payroll_type, period_year, period_month)
  WHERE is_active;

CREATE TABLE IF NOT EXISTS payroll_bonus_accruals (
  id BIGSERIAL PRIMARY KEY,
  emp_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  payroll_type TEXT NOT NULL,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  payroll_result_id BIGINT NULL REFERENCES payroll_month_results(id) ON DELETE SET NULL,
  bonus_type TEXT NOT NULL,
  bonus_label TEXT NOT NULL,
  full_bonus_amount NUMERIC(12,2) NOT NULL,
  accrual_from DATE NOT NULL,
  accrual_to DATE NOT NULL,
  total_bonus_days INTEGER NOT NULL,
  days_on_payroll_in_accrual INTEGER NOT NULL,
  unpaid_leave_days_in_accrual INTEGER NOT NULL DEFAULT 0,
  eligible_bonus_days INTEGER NOT NULL,
  statutory_bonus_amount NUMERIC(12,2) NOT NULL,
  rule_version TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NULL,
  notes TEXT NULL,
  CONSTRAINT payroll_bonus_accruals_payroll_type_chk
    CHECK (payroll_type IN ('MAIN', 'PROVIDER', 'THIRDPARTY')),
  CONSTRAINT payroll_bonus_accruals_period_month_chk
    CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT payroll_bonus_accruals_days_chk
    CHECK (
      total_bonus_days >= 0 AND
      days_on_payroll_in_accrual >= 0 AND
      unpaid_leave_days_in_accrual >= 0 AND
      eligible_bonus_days >= 0
    ),
  CONSTRAINT payroll_bonus_accruals_amounts_chk
    CHECK (
      full_bonus_amount >= 0 AND
      statutory_bonus_amount >= 0
    ),
  CONSTRAINT payroll_bonus_accruals_dates_chk
    CHECK (accrual_to >= accrual_from)
);

CREATE INDEX IF NOT EXISTS idx_payroll_bonus_accruals_lookup
  ON payroll_bonus_accruals(emp_id, payroll_type, period_year, period_month, bonus_type);

CREATE TABLE IF NOT EXISTS payroll_ssc_zero_weeks (
  id BIGSERIAL PRIMARY KEY,
  emp_id INTEGER NOT NULL REFERENCES employees(emp_id) ON DELETE CASCADE,
  payroll_type TEXT NOT NULL,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL,
  payroll_result_id BIGINT NULL REFERENCES payroll_month_results(id) ON DELETE SET NULL,
  week_from DATE NOT NULL,
  week_to DATE NOT NULL,
  ssc_zero_week BOOLEAN NOT NULL DEFAULT TRUE,
  reason_type TEXT NOT NULL,
  days_covered INTEGER NOT NULL DEFAULT 0,
  hours_covered NUMERIC(8,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  user_note TEXT NULL,
  system_note TEXT NULL,
  CONSTRAINT payroll_ssc_zero_weeks_payroll_type_chk
    CHECK (payroll_type IN ('MAIN', 'PROVIDER', 'THIRDPARTY')),
  CONSTRAINT payroll_ssc_zero_weeks_period_month_chk
    CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT payroll_ssc_zero_weeks_reason_chk
    CHECK (
      reason_type IN (
        'UNPAID_LEAVE',
        'EXCESS_VL_UNPAID',
        'EXCESS_SL_UNPAID',
        'GOVT_MATERNITY',
        'MIXED_UNPAID'
      )
    ),
  CONSTRAINT payroll_ssc_zero_weeks_range_chk
    CHECK (week_to = week_from + 6),
  CONSTRAINT payroll_ssc_zero_weeks_amounts_chk
    CHECK (days_covered >= 0 AND hours_covered >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_ssc_zero_weeks_active
  ON payroll_ssc_zero_weeks(emp_id, payroll_type, week_from)
  WHERE is_active;

COMMIT;
