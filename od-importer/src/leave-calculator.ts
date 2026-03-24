/**
 * Leave Entitlements Calculation Engine
 * Calculates annual leave and sick leave entitlements with pro-rata adjustments
 * Based on employment type, period, and public holidays
 */

import type { Pool as PgPool } from 'pg';

export type LeaveEntitlementInput = {
  employee_id: number;
  payroll_year: number;
  payroll_month: number;
  ss_class?: string;  // A-F: A,B,C,D are eligible; E,F are not
  payroll_type?: string;  // MAIN, PROVIDER, THIRDPARTY
};

export type LeaveEntitlementOutput = {
  employee_id: number;
  employment_type: string;
  ss_class?: string;  // A-F
  year: number;
  has_no_entitlement: boolean; // true for PROVIDER/THIRDPARTY/CASUAL_PT
  
  // Full year entitlement
  vl_annual_entitlement_hours: number;
  sl_annual_entitlement_hours: number;
  
  // Employment period for pro-rata
  employment_start_date: string; // ISO date
  employment_end_date: string;   // ISO date or current date
  days_employed_in_year: number;
  prorata_factor: number; // 0-1
  
  // Pro-rata adjusted entitlements
  vl_prorata_hours: number;
  sl_prorata_hours: number;
  
  // Adjusted for unpaid leave taken YTD
  unpaid_leave_hours_ytd: number;
  vl_adjusted_entitlement: number;
  sl_adjusted_entitlement: number;
  
  // YTD usage
  vl_used_hours_ytd: number;
  sl_used_hours_ytd: number;
  
  // Remaining balance
  vl_remaining_hours: number;
  sl_remaining_hours: number;
  
  // Flags
  vl_exceeded: boolean;
  sl_exceeded: boolean;
  
  // Public holiday eligibility (A,B,C,D only)
  is_eligible_for_public_holidays: boolean;  // true if A,B,C,D on MAIN payroll
  public_holidays_inlieu_hours_applied: number;  // How many hours added from Sunday/Sat holidays
  
  // Payment eligibility (false if leave exceeded, no payment due to employee)
  payment_due: boolean;  // false if VL or SL exceeded
};

const toIsoDate = (value: unknown, fallback: string): string => {
  if (!value) return fallback;
  if (value instanceof Date) {
    return value.toISOString().split('T')[0];
  }
  const raw = String(value).trim();
  if (!raw) return fallback;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return parsed.toISOString().split('T')[0];
};

/**
 * Determine if employee has leave entitlement based on payroll subscription type and employment type
 * ELIGIBLE (MAIN payroll only): PERMANENT, CONTRACT, SEASONAL
 * NOT ELIGIBLE (zero entitlement): PROVIDER/THIRDPARTY, CASUAL_PT, part-timers
 */
export const hasLeaveEntitlement = (payrollType: string, employmentType?: string): boolean => {
  // PROVIDER and THIRDPARTY have zero entitlement
  if (payrollType !== 'MAIN') {
    return false;
  }
  
  // MAIN payroll: exclude CASUAL_PT (no entitlement)
  if (employmentType &&['CASUAL_PT', 'PART_TIME', 'CASUAL'].includes(employmentType.toUpperCase())) {
    return false;
  }
  
  // PERMANENT, CONTRACT, SEASONAL: eligible for leave
  return true;
};

/**
 * Fetch and calculate leave entitlements for an employee in a given year
 * Includes pro-rata adjustment for employment period and unpaid leave reduction
 */
export const calculateLeaveEntitlements = async (
  pg: PgPool,
  input: LeaveEntitlementInput
): Promise<LeaveEntitlementOutput> => {
  const { employee_id, payroll_year } = input;

  // Fetch annual entitlements (from vw_leave_entitlements_annual)
  const entitlementResult = await pg.query(
    `SELECT 
      employment_type,
      vl_annual_entitlement_hours,
      sl_annual_entitlement_hours
    FROM vw_leave_entitlements_annual
    WHERE emp_id = $1 AND entitlement_year = $2`,
    [employee_id, payroll_year]
  );

  if (entitlementResult.rows.length === 0) {
    // Default entitlements if view returns no rows
    return {
      employee_id,
      employment_type: 'UNKNOWN',
      year: payroll_year,
      has_no_entitlement: true,
      vl_annual_entitlement_hours: 0,
      sl_annual_entitlement_hours: 0,
      employment_start_date: `${payroll_year}-01-01`,
      employment_end_date: new Date().toISOString().split('T')[0],
      days_employed_in_year: 365,
      prorata_factor: 1.0,
      vl_prorata_hours: 0,
      sl_prorata_hours: 0,
      unpaid_leave_hours_ytd: 0,
      vl_adjusted_entitlement: 0,
      sl_adjusted_entitlement: 0,
      vl_used_hours_ytd: 0,
      sl_used_hours_ytd: 0,
      vl_remaining_hours: 0,
      sl_remaining_hours: 0,
      vl_exceeded: false,
      sl_exceeded: false,
      payment_due: false,  // No entitlement = no payment due
      is_eligible_for_public_holidays: isEligibleForPublicHolidayEntitlements(input.ss_class, input.payroll_type),
      public_holidays_inlieu_hours_applied: 0
    };
  }

  const entitlementData = entitlementResult.rows[0];
  const employmentType = entitlementData.employment_type || 'UNKNOWN';

  // Fetch pro-rata entitlements (from vw_leave_prorata_for_payroll)
  const prorataResult = await pg.query(
    `SELECT 
      employment_start,
      employment_end,
      days_employed,
      prorata_factor,
      vl_prorata_hours,
      sl_prorata_hours
    FROM vw_leave_prorata_for_payroll
    WHERE emp_id = $1 AND year = $2`,
    [employee_id, payroll_year]
  );

  const prorataData = prorataResult.rows[0] || {
    employment_start: `${payroll_year}-01-01`,
    employment_end: new Date().toISOString().split('T')[0],
    days_employed: 365,
    prorata_factor: 1.0,
    vl_prorata_hours: entitlementData.vl_annual_entitlement_hours || 192,
    sl_prorata_hours: entitlementData.sl_annual_entitlement_hours || 80
  };

  // Fetch YTD leave usage
  const usageResult = await pg.query(
    `SELECT 
      COALESCE(SUM(CASE WHEN hour_type = 'VACATION_LEAVE' THEN hours ELSE 0 END), 0) AS vl_used,
      COALESCE(SUM(CASE WHEN hour_type = 'SICK_LEAVE' THEN hours ELSE 0 END), 0) AS sl_used,
      COALESCE(SUM(CASE WHEN hour_type = 'UNPAID_LEAVE' THEN hours ELSE 0 END), 0) AS unpaid_used
    FROM timesheets
    WHERE emp_id = $1 
      AND EXTRACT(YEAR FROM work_date) = $2`,
    [employee_id, payroll_year]
  );

  const usageData = usageResult.rows[0] || {
    vl_used: 0,
    sl_used: 0,
    unpaid_used: 0
  };

  // Calculate adjusted entitlements (reduced by unpaid leave)
  const vlAdjusted = Math.max(0, prorataData.vl_prorata_hours - usageData.unpaid_used);
  const slAdjusted = Math.max(0, prorataData.sl_prorata_hours - usageData.unpaid_used);

  // Calculate remaining balance
  const vlRemaining = Math.max(0, vlAdjusted - usageData.vl_used);
  const slRemaining = Math.max(0, slAdjusted - usageData.sl_used);

  // Check if exceeded
  const vlExceeded = usageData.vl_used > vlAdjusted;
  const slExceeded = usageData.sl_used > slAdjusted;

  return {
    employee_id,
    employment_type: employmentType,
    year: payroll_year,
    has_no_entitlement: !['PERMANENT', 'CASUAL_PT', 'CONTRACT'].includes(employmentType),
    
    vl_annual_entitlement_hours: entitlementData.vl_annual_entitlement_hours || 192,
    sl_annual_entitlement_hours: entitlementData.sl_annual_entitlement_hours || 80,
    
    employment_start_date: toIsoDate(prorataData.employment_start, `${payroll_year}-01-01`),
    employment_end_date: toIsoDate(prorataData.employment_end, new Date().toISOString().split('T')[0]),
    days_employed_in_year: prorataData.days_employed || 365,
    prorata_factor: Math.min(1.0, prorataData.prorata_factor || 1.0),
    
    vl_prorata_hours: Math.round(prorataData.vl_prorata_hours * 100) / 100,
    sl_prorata_hours: Math.round(prorataData.sl_prorata_hours * 100) / 100,
    
    unpaid_leave_hours_ytd: Math.round(usageData.unpaid_used * 100) / 100,
    vl_adjusted_entitlement: Math.round(vlAdjusted * 100) / 100,
    sl_adjusted_entitlement: Math.round(slAdjusted * 100) / 100,
    
    vl_used_hours_ytd: Math.round(usageData.vl_used * 100) / 100,
    sl_used_hours_ytd: Math.round(usageData.sl_used * 100) / 100,
    
    vl_remaining_hours: Math.round(vlRemaining * 100) / 100,
    sl_remaining_hours: Math.round(slRemaining * 100) / 100,
    
    vl_exceeded: vlExceeded,
    sl_exceeded: slExceeded,
    
    is_eligible_for_public_holidays: isEligibleForPublicHolidayEntitlements(input.ss_class, input.payroll_type),
    public_holidays_inlieu_hours_applied: entitlementData.vl_annual_entitlement_hours ? 
      (entitlementData.vl_annual_entitlement_hours - 192) : 0,  // Difference from base 192 hours
    
    payment_due: !(vlExceeded || slExceeded || !['PERMANENT', 'CASUAL_PT', 'CONTRACT'].includes(employmentType))  // No payment if VL/SL exceeded or no entitlement
  };
};

/**
 * Validate leave usage against entitlements
 * Returns array of violations if employee exceeded entitlements
 */
export type LeaveViolation = {
  type: 'VL_EXCEEDED' | 'SL_EXCEEDED' | 'NO_ENTITLEMENT';
  message: string;
  hours_over?: number;
};

export const validateLeaveUsage = (entitlements: LeaveEntitlementOutput): LeaveViolation[] => {
  const violations: LeaveViolation[] = [];

  if (entitlements.has_no_entitlement) {
    // PROVIDER/THIRDPARTY employees should not have any leave usage
    if (entitlements.vl_used_hours_ytd > 0 || entitlements.sl_used_hours_ytd > 0) {
      violations.push({
        type: 'NO_ENTITLEMENT',
        message: `Employee (${entitlements.employment_type}) on PROVIDER/THIRDPARTY payroll has no leave entitlement but has used ${entitlements.vl_used_hours_ytd} VL + ${entitlements.sl_used_hours_ytd} SL hours.`
      });
    }
    return violations;
  }

  if (entitlements.vl_exceeded) {
    const over = entitlements.vl_used_hours_ytd - entitlements.vl_adjusted_entitlement;
    violations.push({
      type: 'VL_EXCEEDED',
      message: `Vacation Leave exceeded by ${Math.round(over * 100) / 100} hours (used ${entitlements.vl_used_hours_ytd} of ${entitlements.vl_adjusted_entitlement} entitled)`,
      hours_over: Math.round(over * 100) / 100
    });
  }

  if (entitlements.sl_exceeded) {
    const over = entitlements.sl_used_hours_ytd - entitlements.sl_adjusted_entitlement;
    violations.push({
      type: 'SL_EXCEEDED',
      message: `Sick Leave exceeded by ${Math.round(over * 100) / 100} hours (used ${entitlements.sl_used_hours_ytd} of ${entitlements.sl_adjusted_entitlement} entitled)`,
      hours_over: Math.round(over * 100) / 100
    });
  }

  return violations;
};

/**
 * Determine if payment is due to employee based on leave exceeded
 * Rule: If VL or SL exceeded, no payment is due to employee
 */
export const isPaymentDue = (entitlements: LeaveEntitlementOutput): boolean => {
  // No payment if leave has been exceeded
  if (entitlements.vl_exceeded || entitlements.sl_exceeded) {
    return false;
  }
  
  // No payment if employee has no entitlement
  if (entitlements.has_no_entitlement) {
    return false;
  }
  
  // Payment is due
  return true;
};

/**
 * Determine if SS class is eligible for public holiday entitlements
 * Only A, B, C, D are eligible (full-time employees)
 * E, F (students/apprentices) are NOT eligible
 */
export const isEligibleForPublicHolidayEntitlements = (ssClass?: string, payrollType?: string): boolean => {
  if (payrollType && payrollType !== 'MAIN') {
    return false; // PROVIDER/THIRDPARTY not eligible
  }

  if (!ssClass) {
    return false; // Unknown SS class is not eligible
  }

  return ['A', 'B', 'C', 'D'].includes(ssClass.toUpperCase());
};

/**
 * Fetch sickness benefit rate for an employee based on family status/tax category
 * Returns daily benefit amount deducted for sick leave days 4+
 */
export const getSicknessBenefitRate = async (
  pg: PgPool,
  payrollYear: number,
  taxCategory?: string  // sng, mar, mar1, mar2, par, par1, par2
): Promise<number> => {
  if (!taxCategory) {
    return 17.21; // Default to single rate
  }

  // Map tax categories to family status
  let familyStatus = 'SINGLE';
  if (['mar', 'mar1', 'mar2'].includes(taxCategory.toLowerCase())) {
    familyStatus = 'MARRIED';
  } else if (['par', 'par1', 'par2'].includes(taxCategory.toLowerCase())) {
    familyStatus = 'PARENT';
  }

  const result = await pg.query(
    `SELECT daily_rate FROM sickness_benefit_rates
     WHERE benefit_year = $1 AND family_status = $2`,
    [payrollYear, familyStatus]
  );

  return result.rows.length > 0 ? parseFloat(result.rows[0].daily_rate) : 17.21;
};

/**
 * Calculate sickness benefit deduction for sick leave
 * Rules:
 * - First 3 days: Employer pays 100% (no deduction from benefit)
 * - Days 4+: Benefit rate (€25.81 or €17.21/day) is deducted from wage
 * - Full week absence (Mon-Sun starting Monday): No SS contributions
 */
export type SicknessBenefitDeduction = {
  total_sick_leave_hours: number;
  sick_leave_days: number;  // hours / 8
  days_paid_by_employer: number;  // First 3 days
  days_subject_to_benefit: number;  // Days 4+
  benefit_rate_per_day: number;
  total_benefit_deduction: number;  // Days 4+ × rate
  net_wage_after_deduction: number;  // Wage to pay after SL deduction
};

export const calculateSicknessBenefitDeduction = (
  sicklLeaveHoursUsed: number,
  grossWage: number,
  benefitRatePerDay: number
): SicknessBenefitDeduction => {
  const HOURS_PER_DAY = 8;
  const EMPLOYER_PAID_DAYS = 3;

  const sicklLeaveDays = Math.ceil(sicklLeaveHoursUsed / HOURS_PER_DAY);
  const daysSubjectToBenefit = Math.max(0, sicklLeaveDays - EMPLOYER_PAID_DAYS);
  const totalBenefitDeduction = daysSubjectToBenefit * benefitRatePerDay;

  return {
    total_sick_leave_hours: sicklLeaveHoursUsed,
    sick_leave_days: sicklLeaveDays,
    days_paid_by_employer: Math.min(EMPLOYER_PAID_DAYS, sicklLeaveDays),
    days_subject_to_benefit: daysSubjectToBenefit,
    benefit_rate_per_day: Math.round(benefitRatePerDay * 100) / 100,
    total_benefit_deduction: Math.round(totalBenefitDeduction * 100) / 100,
    net_wage_after_deduction: Math.round((grossWage - totalBenefitDeduction) * 100) / 100
  };
};
