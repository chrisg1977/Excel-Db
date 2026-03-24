-- Merge legacy payroll data into the new payroll engine tables.
-- Safe to rerun: uses NOT EXISTS / upsert-style patterns where practical.
--
-- Apply after payroll_full_engine_ddl.sql:
--   psql -h localhost -p 55432 -U excel -d exceldb -f sql/payroll_merge_legacy_into_engine.sql

BEGIN;

-- 1. Merge effective payroll terms from existing employee/payroll records.
INSERT INTO employee_payroll_terms (
  emp_id,
  payroll_type,
  effective_from,
  effective_to,
  is_active,
  employment_type_main,
  weekly_hours_main,
  pay_input_basis_main,
  input_amount_main,
  hourly_rate_main,
  timesheet_required,
  student_flag,
  tax_status,
  annual_vl_entitlement_hours,
  annual_sl_entitlement_hours,
  created_by,
  updated_by,
  notes
)
SELECT
  ps.employee_id,
  ps.payroll_type,
  COALESCE(pp.effective_from, et.effective_from, ps.active_from),
  CASE
    WHEN COALESCE(pp.effective_to, et.effective_to, ps.active_to) IS NULL THEN NULL
    WHEN COALESCE(pp.effective_to, et.effective_to, ps.active_to) >= COALESCE(pp.effective_from, et.effective_from, ps.active_from)
      THEN COALESCE(pp.effective_to, et.effective_to, ps.active_to)
    ELSE NULL
  END,
  (
    CASE
      WHEN COALESCE(pp.effective_to, et.effective_to, ps.active_to) IS NULL THEN TRUE
      WHEN COALESCE(pp.effective_to, et.effective_to, ps.active_to) >= COALESCE(pp.effective_from, et.effective_from, ps.active_from)
        THEN FALSE
      ELSE TRUE
    END
  ),
  CASE
    WHEN LOWER(COALESCE(et.employment_type, '')) IN ('full-time', 'full time', 'full_time', 'ft') THEN 'FULL_TIME'
    WHEN LOWER(COALESCE(et.employment_type, '')) IN ('full-time reduced', 'full time reduced', 'full_time_reduced', 'reduced full-time', 'reduced full time') THEN 'FULL_TIME_REDUCED'
    WHEN LOWER(COALESCE(et.employment_type, '')) IN ('part-time', 'part time', 'part_time', 'pt') THEN 'PART_TIME'
    WHEN LOWER(COALESCE(et.employment_type, '')) IN ('part-time casual', 'part time casual', 'casual part-time', 'casual part time', 'casual_part_time') THEN 'CASUAL_PART_TIME'
    ELSE NULL
  END AS employment_type_main,
  COALESCE(et.weekly_hours, efp.fixed_hours_week),
  CASE
    WHEN LOWER(COALESCE(pp.pay_type, '')) IN ('hourly', 'per_hour', 'per hour') THEN 'HOURLY'
    WHEN LOWER(COALESCE(pp.pay_type, '')) IN ('monthly', 'month', 'salary', 'fixed_monthly') THEN 'MONTHLY'
    WHEN LOWER(COALESCE(pp.pay_type, '')) IN ('yearly', 'annual', 'annually') THEN 'YEARLY'
    ELSE NULL
  END AS pay_input_basis_main,
  pp.amount,
  CASE
    WHEN LOWER(COALESCE(pp.pay_type, '')) IN ('hourly', 'per_hour', 'per hour') THEN pp.amount
    WHEN LOWER(COALESCE(pp.pay_type, '')) IN ('monthly', 'month', 'salary', 'fixed_monthly') THEN (pp.amount * 12 / 52 / 40.0)
    WHEN LOWER(COALESCE(pp.pay_type, '')) IN ('yearly', 'annual', 'annually') THEN (pp.amount / 52 / 40.0)
    ELSE NULL
  END AS hourly_rate_main,
  efp.timesheet_required,
  FALSE AS student_flag,
  efp.fs4_status,
  lb.vl_entitlement_hours,
  lb.sl_entitlement_hours,
  'legacy_merge',
  'legacy_merge',
  CONCAT('Merged from payroll_subscriptions / employee_employment_terms / employee_pay_private on ', now()::text)
FROM payroll_subscriptions ps
LEFT JOIN LATERAL (
  SELECT *
  FROM employee_employment_terms et
  WHERE et.emp_id = ps.employee_id
    AND (
      (ps.active_to IS NULL AND et.effective_to IS NULL) OR
      et.effective_to IS NULL OR
      et.effective_to >= ps.active_from
    )
  ORDER BY et.effective_from DESC
  LIMIT 1
) et ON TRUE
LEFT JOIN employee_form_profile efp
  ON efp.emp_id = ps.employee_id
LEFT JOIN LATERAL (
  SELECT *
  FROM employee_pay_private pp
  WHERE pp.emp_id = ps.employee_id
    AND (
      (ps.active_to IS NULL AND pp.effective_to IS NULL) OR
      pp.effective_to IS NULL OR
      pp.effective_to >= ps.active_from
    )
  ORDER BY pp.effective_from DESC
  LIMIT 1
) pp ON TRUE
LEFT JOIN LATERAL (
  SELECT *
  FROM leave_balances lb
  WHERE lb.emp_id = ps.employee_id
  ORDER BY lb.year DESC
  LIMIT 1
) lb ON TRUE
WHERE NOT EXISTS (
  SELECT 1
  FROM employee_payroll_terms ept
  WHERE ept.emp_id = ps.employee_id
    AND ept.payroll_type = ps.payroll_type
    AND ept.effective_from = COALESCE(pp.effective_from, et.effective_from, ps.active_from)
);

-- 2. Merge existing payroll lines/payslips into month results.
INSERT INTO payroll_month_results (
  emp_id,
  payroll_type,
  period_year,
  period_month,
  calc_version,
  is_current,
  created_at,
  created_by,
  updated_at,
  updated_by,
  employment_type_main,
  weekly_hours_main,
  pay_input_basis_main,
  input_amount_main,
  hourly_rate_main,
  tax_status,
  student_flag,
  timesheet_required,
  annual_vl_entitlement_hours,
  annual_sl_entitlement_hours,
  vl_taken_hours,
  sl_taken_hours,
  explicit_unpaid_leave_hours,
  unpaid_leave_hours_total,
  unpaid_leave_deduction_amount,
  timesheet_work_hours,
  timesheet_overtime_hours,
  banked_hours_opening,
  banked_hours_movement,
  banked_hours_closing,
  main_base_monthly_wage,
  normal_rate_extra_pay,
  overtime_pay_amount,
  bonus,
  performance_bonus,
  supervisor_bonus,
  statutory_bonus_amount,
  taxable_bonus_total,
  normal_main_income,
  gross_total,
  normal_progressive_income_current,
  tax_on_gross,
  total_employee_tax,
  ssc_weekly_wage_basis,
  ssc_employee,
  ssc_employer,
  ssc_total,
  mlf,
  net_wage,
  paid_previously_amount,
  transaction_amount,
  payslip_value,
  transaction_number,
  source_funds_label,
  calc_status,
  calc_notes,
  review_reason
)
SELECT
  pl.emp_id,
  COALESCE(psub.payroll_type, 'MAIN') AS payroll_type,
  pe.payroll_year,
  EXTRACT(MONTH FROM pe.payroll_month)::int AS period_month,
  1 AS calc_version,
  TRUE AS is_current,
  pl.created_at,
  'legacy_merge',
  COALESCE(p.created_at, pl.updated_at, pe.updated_at, pl.created_at),
  'legacy_merge',
  CASE
    WHEN LOWER(COALESCE(et.employment_type, '')) IN ('full-time', 'full time', 'full_time', 'ft') THEN 'FULL_TIME'
    WHEN LOWER(COALESCE(et.employment_type, '')) IN ('full-time reduced', 'full time reduced', 'full_time_reduced', 'reduced full-time', 'reduced full time') THEN 'FULL_TIME_REDUCED'
    WHEN LOWER(COALESCE(et.employment_type, '')) IN ('part-time', 'part time', 'part_time', 'pt') THEN 'PART_TIME'
    WHEN LOWER(COALESCE(et.employment_type, '')) IN ('part-time casual', 'part time casual', 'casual part-time', 'casual part time', 'casual_part_time') THEN 'CASUAL_PART_TIME'
    ELSE NULL
  END,
  et.weekly_hours,
  CASE
    WHEN LOWER(COALESCE(pp.pay_type, '')) IN ('hourly', 'per_hour', 'per hour') THEN 'HOURLY'
    WHEN LOWER(COALESCE(pp.pay_type, '')) IN ('monthly', 'month', 'salary', 'fixed_monthly') THEN 'MONTHLY'
    WHEN LOWER(COALESCE(pp.pay_type, '')) IN ('yearly', 'annual', 'annually') THEN 'YEARLY'
    ELSE NULL
  END,
  pp.amount,
  pl.hourly_rate,
  efp.fs4_status,
  FALSE,
  efp.timesheet_required,
  lb.vl_entitlement_hours,
  lb.sl_entitlement_hours,
  COALESCE(pl.annual_leave_taken_hours, 0),
  COALESCE(pl.sick_leave_taken_hours, 0),
  COALESCE(pl.unpaid_leave_hours, 0),
  COALESCE(pl.unpaid_leave_hours, 0),
  ROUND(COALESCE(pl.unpaid_leave_hours, 0) * COALESCE(pl.hourly_rate, 0), 2),
  COALESCE(pl.hours_worked, 0),
  COALESCE(pl.overtime_hours, 0),
  COALESCE(lb.banked_hours_opening, 0),
  COALESCE(pl.banked_hours_new, 0) - COALESCE(pl.banked_hours_used, 0),
  COALESCE(pl.banked_hours_balance, lb.banked_hours_closing, 0),
  GREATEST(COALESCE(pl.gross_earnings, 0) - COALESCE(pl.overtime_payment, 0) - COALESCE(pl.discretionary_bonus, 0) - COALESCE(pl.performance_bonus, 0) - COALESCE(pl.supervisor_bonus, 0) - COALESCE(pl.statutory_bonus_june, 0) - COALESCE(pl.weekly_allowance_march, 0) - COALESCE(pl.statutory_bonus_december, 0) - COALESCE(pl.weekly_allowance_september, 0), 0),
  ROUND(COALESCE(pl.extra_hours_worked, 0) * COALESCE(pl.hourly_rate, 0), 2),
  COALESCE(pl.overtime_payment, 0),
  COALESCE(pl.discretionary_bonus, 0),
  COALESCE(pl.performance_bonus, 0),
  COALESCE(pl.supervisor_bonus, 0),
  COALESCE(pl.statutory_bonus_june, 0) + COALESCE(pl.weekly_allowance_march, 0) + COALESCE(pl.statutory_bonus_december, 0) + COALESCE(pl.weekly_allowance_september, 0),
  COALESCE(pl.discretionary_bonus, 0) + COALESCE(pl.performance_bonus, 0) + COALESCE(pl.supervisor_bonus, 0) + COALESCE(pl.statutory_bonus_june, 0) + COALESCE(pl.weekly_allowance_march, 0) + COALESCE(pl.statutory_bonus_december, 0) + COALESCE(pl.weekly_allowance_september, 0),
  COALESCE(pl.gross_earnings, 0) - COALESCE(pl.overtime_payment, 0),
  COALESCE(pl.gross_earnings, 0) - COALESCE(pl.overtime_payment, 0),
  COALESCE(pl.gross_earnings, 0) - COALESCE(pl.overtime_payment, 0),
  COALESCE(pl.tax_deduction, 0),
  COALESCE(pl.tax_deduction, 0),
  COALESCE(pl.weekly_wage, ROUND(COALESCE(pl.hourly_rate, 0) * COALESCE(et.weekly_hours, 0), 2), 0),
  COALESCE(pl.ss_employee_contribution, 0),
  COALESCE(pl.ss_employer_contribution, 0),
  COALESCE(pl.ss_employee_contribution, 0) + COALESCE(pl.ss_employer_contribution, 0),
  COALESCE(pl.mlf_contribution, 0),
  COALESCE(pl.net_payment, 0),
  COALESCE(p.paid_previously_amount, 0),
  COALESCE(pl.net_payment, 0) - COALESCE(p.paid_previously_amount, 0),
  (COALESCE(pl.gross_earnings, 0) - COALESCE(pl.overtime_payment, 0)) + COALESCE(pl.overtime_payment, 0) + COALESCE(pl.ss_employer_contribution, 0) + COALESCE(pl.mlf_contribution, 0),
  p.bank_transaction_number,
  p.source_funds_label,
  CASE COALESCE(p.status, pe.status, 'DRAFT')
    WHEN 'ISSUED' THEN 'CONFIRMED'
    WHEN 'EMAILED' THEN 'CONFIRMED'
    WHEN 'ARCHIVED' THEN 'AMENDED'
    WHEN 'APPROVED' THEN 'CONFIRMED'
    ELSE 'DRAFT'
  END,
  COALESCE(pl.notes, ''),
  COALESCE(p.review_adjustments::text, '')
FROM payroll_lines pl
JOIN payroll_entries pe
  ON pe.id = pl.payroll_entry_id
LEFT JOIN payslips p
  ON p.payroll_line_id = pl.id
LEFT JOIN LATERAL (
  SELECT *
  FROM payroll_subscriptions ps
  WHERE ps.employee_id = pl.emp_id
    AND ps.active_from <= pe.payroll_month
    AND (ps.active_to IS NULL OR ps.active_to >= pe.payroll_month)
  ORDER BY CASE WHEN ps.payroll_type = 'MAIN' THEN 0 ELSE 1 END, ps.active_from DESC
  LIMIT 1
) psub ON TRUE
LEFT JOIN LATERAL (
  SELECT *
  FROM employee_employment_terms et
  WHERE et.emp_id = pl.emp_id
    AND et.effective_from <= pe.payroll_month
    AND (et.effective_to IS NULL OR et.effective_to >= pe.payroll_month)
  ORDER BY et.effective_from DESC
  LIMIT 1
) et ON TRUE
LEFT JOIN employee_form_profile efp
  ON efp.emp_id = pl.emp_id
LEFT JOIN LATERAL (
  SELECT *
  FROM employee_pay_private pp
  WHERE pp.emp_id = pl.emp_id
    AND pp.effective_from <= pe.payroll_month
    AND (pp.effective_to IS NULL OR pp.effective_to >= pe.payroll_month)
  ORDER BY pp.effective_from DESC
  LIMIT 1
) pp ON TRUE
LEFT JOIN leave_balances lb
  ON lb.emp_id = pl.emp_id
 AND lb.year = pe.payroll_year
WHERE NOT EXISTS (
  SELECT 1
  FROM payroll_month_results pmr
  WHERE pmr.emp_id = pl.emp_id
    AND pmr.payroll_type = COALESCE(psub.payroll_type, 'MAIN')
    AND pmr.period_year = pe.payroll_year
    AND pmr.period_month = EXTRACT(MONTH FROM pe.payroll_month)::int
    AND pmr.calc_version = 1
);

-- 3. Merge statutory bonus accrual snapshots from legacy payroll lines.
INSERT INTO payroll_bonus_accruals (
  emp_id,
  payroll_type,
  period_year,
  period_month,
  payroll_result_id,
  bonus_type,
  bonus_label,
  full_bonus_amount,
  accrual_from,
  accrual_to,
  total_bonus_days,
  days_on_payroll_in_accrual,
  unpaid_leave_days_in_accrual,
  eligible_bonus_days,
  statutory_bonus_amount,
  rule_version,
  created_by,
  updated_by,
  notes
)
SELECT
  pmr.emp_id,
  pmr.payroll_type,
  pmr.period_year,
  pmr.period_month,
  pmr.id,
  sb.payment_month || '_' || sb.bonus_type,
  sb.payment_month || ' ' || sb.bonus_type,
  sb.full_amount,
  sb.accrual_period_from,
  sb.accrual_period_to,
  (sb.accrual_period_to - sb.accrual_period_from + 1),
  (sb.accrual_period_to - sb.accrual_period_from + 1),
  0,
  (sb.accrual_period_to - sb.accrual_period_from + 1),
  CASE
    WHEN sb.payment_month = 'MARCH' THEN COALESCE(pl.weekly_allowance_march, 0)
    WHEN sb.payment_month = 'JUNE' THEN COALESCE(pl.statutory_bonus_june, 0)
    WHEN sb.payment_month = 'SEPTEMBER' THEN COALESCE(pl.weekly_allowance_september, 0)
    WHEN sb.payment_month = 'DECEMBER' THEN COALESCE(pl.statutory_bonus_december, 0)
    ELSE 0
  END,
  'legacy_snapshot',
  'legacy_merge',
  'legacy_merge',
  'Merged from legacy payroll_lines statutory fields'
FROM payroll_month_results pmr
JOIN payroll_entries pe
  ON pe.payroll_year = pmr.period_year
 AND EXTRACT(MONTH FROM pe.payroll_month)::int = pmr.period_month
JOIN payroll_lines pl
  ON pl.payroll_entry_id = pe.id
 AND pl.emp_id = pmr.emp_id
JOIN statutory_bonuses sb
  ON sb.bonus_year = pmr.period_year
 AND sb.payment_month = CASE pmr.period_month
   WHEN 3 THEN 'MARCH'
   WHEN 6 THEN 'JUNE'
   WHEN 9 THEN 'SEPTEMBER'
   WHEN 12 THEN 'DECEMBER'
   ELSE '__NONE__'
 END
WHERE (
    (pmr.period_month = 3 AND COALESCE(pl.weekly_allowance_march, 0) > 0) OR
    (pmr.period_month = 6 AND COALESCE(pl.statutory_bonus_june, 0) > 0) OR
    (pmr.period_month = 9 AND COALESCE(pl.weekly_allowance_september, 0) > 0) OR
    (pmr.period_month = 12 AND COALESCE(pl.statutory_bonus_december, 0) > 0)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM payroll_bonus_accruals pba
    WHERE pba.payroll_result_id = pmr.id
      AND pba.bonus_type = sb.payment_month || '_' || sb.bonus_type
  );

-- 4. Seed yearly constants from existing COLA rows if present.
INSERT INTO payroll_yearly_constants (
  payroll_type,
  tax_year,
  constant_key,
  constant_value,
  value_type,
  effective_from,
  effective_to,
  is_active,
  created_by,
  updated_by,
  notes
)
SELECT
  'MAIN',
  year,
  'COLA_WEEKLY_AMOUNT',
  weekly_amount::text,
  'NUMBER',
  make_date(year, 1, 1),
  make_date(year, 12, 31),
  TRUE,
  'legacy_merge',
  'legacy_merge',
  'Merged from cola_rates'
FROM cola_rates cr
WHERE NOT EXISTS (
  SELECT 1
  FROM payroll_yearly_constants pyc
  WHERE pyc.payroll_type = 'MAIN'
    AND pyc.tax_year = cr.year
    AND pyc.constant_key = 'COLA_WEEKLY_AMOUNT'
);

COMMIT;
