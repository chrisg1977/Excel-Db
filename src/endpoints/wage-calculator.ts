import { defineEndpoint } from '@directus/extensions-sdk';
import type { Router } from 'express';
import {
  calculateWage,
  calculateMediatrixBonusDeduction,
  calculateGovernmentBonusDeduction,
  type DailyHours
} from '../lib/wage-calculator.js';
import {
  calculateLeaveEntitlements,
  validateLeaveUsage,
  hasLeaveEntitlement,
  getSicknessBenefitRate,
  calculateSicknessBenefitDeduction,
  isEligibleForPublicHolidayEntitlements,
  type LeaveEntitlementOutput
} from '../lib/leave-calculator.js';

/**
 * Helper: Get number of Mondays in a month
 */
const getNumberOfMondaysInMonth = (year: number, month: number): number => {
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  let mondayCount = 0;

  for (let d = new Date(firstDay); d <= lastDay; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 1) { // 1 = Monday
      mondayCount++;
    }
  }

  return mondayCount;
};

const toPgLike = (database: any) => ({
  query: async (sql: string, params: any[] = []) => {
    const raw = await database.raw(sql, params);
    if (Array.isArray(raw)) return { rows: raw[0] ?? [] };
    return { rows: raw?.rows ?? [] };
  }
});

export default defineEndpoint((router: Router, { database, logger }: any) => {
  /**
   * POST /payroll/calculate-wages
   * Calculate wages for an employee for a given month
   * Reads timesheets + wage history + subscriptions, writes to payroll_lines
   */
  router.post('/payroll/calculate-wages', async (req: any, res: any) => {
    try {
      const pg = toPgLike(database);
      const { employee_id, payroll_year, payroll_month } = req.body;

      if (!employee_id || !payroll_year || !payroll_month) {
        return res
          .status(400)
          .json({ error: 'Missing employee_id, payroll_year, or payroll_month' });
      }

      // Fetch employee info
      const empResult = await database('vw_employee_current')
        .where('emp_id', employee_id)
        .first();

      if (!empResult) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      // Fetch active wage history entry for the period
      const periodStart = new Date(payroll_year, payroll_month - 1, 1);
      const wageResult = await database('wage_history')
        .where('emp_id', employee_id)
        .where('effective_date', '<=', periodStart.toISOString().split('T')[0])
        .orderBy('effective_date', 'desc')
        .first();

      if (!wageResult) {
        return res.status(400).json({ error: 'No wage history found for this period' });
      }

      // Fetch timesheets for the month
      const periodEnd = new Date(payroll_year, payroll_month, 0);
      const timesheetsResult = await database('timesheets')
        .where('emp_id', employee_id)
        .where('work_date', '>=', periodStart.toISOString().split('T')[0])
        .where('work_date', '<=', periodEnd.toISOString().split('T')[0])
        .orderBy('work_date');

      // Convert timesheets to daily hours format
      const dailyHours: DailyHours[] = timesheetsResult.map((ts: any) => ({
        date: ts.work_date,
        hours: ts.hours,
        hour_type: ts.hour_type,
        leave_status: ts.leave_status || 'PAID'
      }));

      // If no timesheets, create zero-hour entry
      if (dailyHours.length === 0) {
        logger.warn(`No timesheets for employee ${employee_id} in ${payroll_year}-${payroll_month}`);
      }

      // Calculate wage
      const wageCalc = await calculateWage(
        pg,
        {
          employee_id,
          payroll_year,
          payroll_month,
          contracted_hours_per_week: empResult.weekly_hours || 40,
          hourly_rate: wageResult.hourly_rate
        },
        dailyHours,
        empResult.dob
      );

      // Fetch statutory bonuses configuration for this month
      const bonusConfigs = await database('statutory_bonuses')
        .where('active_from', '<=', periodStart.toISOString().split('T')[0])
        .where((qb: any) =>
          qb.whereNull('active_to').orWhere('active_to', '>=', periodStart.toISOString().split('T')[0])
        );

      // Calculate Monday count for MEDIATRIX bonus deduction
      const mondayCount = getNumberOfMondaysInMonth(payroll_year, payroll_month);
      const totalLeaveHours = wageCalc.total_paid_leave_hours + wageCalc.total_unpaid_leave_hours;

      // Fetch active payroll subscriptions for this employee
      const subscriptions = await database('payroll_subscriptions')
        .where('employee_id', employee_id)
        .where('active_from', '<=', periodStart.toISOString().split('T')[0])
        .where((qb: any) =>
          qb.whereNull('active_to').orWhere('active_to', '>=', periodStart.toISOString().split('T')[0])
        );

      if (subscriptions.length === 0) {
        return res.status(400).json({ error: 'Employee has no active payroll subscriptions' });
      }

      // Determine primary payroll type (MAIN if available, else first subscription)
      const mainSub = subscriptions.find((s: any) => s.payroll_type === 'MAIN');
      const primaryPayrollType = mainSub?.payroll_type || subscriptions[0].payroll_type;

      // Calculate leave entitlements for the year (use primary payroll type)
      let leaveEntitlements: LeaveEntitlementOutput | null = null;
      try {
        leaveEntitlements = await calculateLeaveEntitlements(pg, {
          employee_id,
          payroll_year,
          payroll_month,
          ss_class: wageCalc.ss_class,
          payroll_type: primaryPayrollType
        });
      } catch (leaveError) {
        logger.warn(`Failed to calculate leave entitlements for employee ${employee_id}: ${leaveError}`);
        // Continue without leave entitlements (will be null, flagged in response)
      }

      // Validate leave usage and collect any violations
      const leaveViolations = leaveEntitlements ? validateLeaveUsage(leaveEntitlements) : [];

      // Check if payment is due (withheld if leave exceeded or no entitlement)
      const paymentDue = leaveEntitlements ? leaveEntitlements.payment_due : true;
      if (!paymentDue) {
        logger.warn(`Payment withheld for employee ${employee_id}: Leave entitlements have been exceeded or employee has no entitlement.`);
      }

      // Calculate sickness benefit deduction (if SL used beyond first 3 days)
      let sicknessDeduction: any = null;
      if (leaveEntitlements && leaveEntitlements.sl_used_hours_ytd > 0 && primaryPayrollType === 'MAIN') {
        try {
          const benefitRate = await getSicknessBenefitRate(pg, payroll_year, empResult.tax_status);
          sicknessDeduction = calculateSicknessBenefitDeduction(
            wageCalc.total_unpaid_leave_hours,  // Assuming unpaid leave is tracked separately
            wageCalc.basic_wage,
            benefitRate
          );
        } catch (sickError) {
          logger.warn(`Failed to calculate sickness benefit deduction: ${sickError}`);
        }
      }


      // Ensure parent payroll entry exists for the month (required FK on payroll_lines)
      let payrollEntry = await database('payroll_entries')
        .where('payroll_year', payroll_year)
        .where('payroll_month', payroll_month)
        .orderBy('id', 'desc')
        .first();

      if (!payrollEntry) {
        const periodStartIso = periodStart.toISOString().split('T')[0];
        const periodEndIso = periodEnd.toISOString().split('T')[0];
        const inserted = await database('payroll_entries')
          .insert({
            payroll_year,
            payroll_month,
            period_from: periodStartIso,
            period_to: periodEndIso,
            status: 'DRAFT',
            total_employees_processed: 0
          })
          .returning('*');
        payrollEntry = inserted[0];
      }

      // Write payroll lines for each subscription (MAIN, PROVIDER, THIRDPARTY)
      const payrollLines = [];
      for (const sub of subscriptions) {
        // Calculate bonuses based on configuration
        let supervisorBonus = 0;
        let supervisorBonusDeduction = 0;
        let performanceBonus = 0;
        let performanceBonusDeduction = 0;
        let statutoryBonusJune = 0;
        let weeklyAllowanceMarch = 0;
        let statutoryBonusDecember = 0;
        let weeklyAllowanceSeptember = 0;

        // Apply bonuses based on month and configuration
        for (const bc of bonusConfigs) {
          if (bc.bonus_type === 'MEDIATRIX' && bc.bonus_subtype === 'SUPERVISOR') {
            supervisorBonus = bc.amount || 0;
            supervisorBonusDeduction = calculateMediatrixBonusDeduction(
              supervisorBonus,
              wageCalc.contracted_hours_per_week,
              mondayCount,
              totalLeaveHours
            );
          }

          if (bc.bonus_type === 'MEDIATRIX' && bc.bonus_subtype === 'PERFORMANCE') {
            performanceBonus = bc.amount || 0;
            performanceBonusDeduction = calculateMediatrixBonusDeduction(
              performanceBonus,
              wageCalc.contracted_hours_per_week,
              mondayCount,
              totalLeaveHours
            );
          }

          // Government bonuses (monthly in June, December, March, September allowances)
          if (bc.bonus_type === 'GOVERNMENT' && bc.bonus_subtype === 'JUNE' && payroll_month === 6) {
            statutoryBonusJune = bc.amount || 0;
          }

          if (bc.bonus_type === 'GOVERNMENT' && bc.bonus_subtype === 'MARCH_ALLOWANCE' && payroll_month === 3) {
            weeklyAllowanceMarch = bc.amount || 0;
          }

          if (bc.bonus_type === 'GOVERNMENT' && bc.bonus_subtype === 'DECEMBER' && payroll_month === 12) {
            statutoryBonusDecember = bc.amount || 0;
          }

          if (bc.bonus_type === 'GOVERNMENT' && bc.bonus_subtype === 'SEPTEMBER_ALLOWANCE' && payroll_month === 9) {
            weeklyAllowanceSeptember = bc.amount || 0;
          }
        }

        const grossEarnings =
          (wageCalc.basic_wage || 0) +
          supervisorBonus +
          performanceBonus +
          statutoryBonusJune +
          weeklyAllowanceMarch +
          statutoryBonusDecember +
          weeklyAllowanceSeptember -
          supervisorBonusDeduction -
          performanceBonusDeduction;

        // Lookup social security contributions from social_security_classes
        let ssEmployeeContribution = 0;
        let ssEmployerContribution = 0;
        let mlfContribution = 0;

        try {
          const ssClass = await database('social_security_classes')
            .where('year', payroll_year)
            .where('class_code', wageCalc.ss_class)
            .first();

          if (ssClass) {
            // For percentage-based contributions: use weekly wage
            if (ssClass.employee_percentage) {
              ssEmployeeContribution = (wageCalc.weekly_wage * ssClass.employee_percentage) / 100;
            } else if (ssClass.employee_fixed) {
              ssEmployeeContribution = ssClass.employee_fixed;
            }

            if (ssClass.employer_percentage) {
              ssEmployerContribution = (wageCalc.weekly_wage * ssClass.employer_percentage) / 100;
            } else if (ssClass.employer_fixed) {
              ssEmployerContribution = ssClass.employer_fixed;
            }

            // MLF contribution (Maternity Leave Fund)
            if (ssClass.mlf_percentage) {
              mlfContribution = (wageCalc.weekly_wage * ssClass.mlf_percentage) / 100;
              // Apply cap if present (for apprentices)
              if (ssClass.mlf_max && mlfContribution > ssClass.mlf_max) {
                mlfContribution = ssClass.mlf_max;
              }
            } else if (ssClass.mlf_fixed) {
              mlfContribution = ssClass.mlf_fixed;
            }

            // Apply rounding: SS rounds to 2 decimals (cents)
            ssEmployeeContribution = Math.round(ssEmployeeContribution * 100) / 100;
            ssEmployerContribution = Math.round(ssEmployerContribution * 100) / 100;
            mlfContribution = Math.round(mlfContribution * 100) / 100;
          }
        } catch (ssError) {
          logger.warn(`Failed to lookup SS class for ${wageCalc.ss_class}:`, ssError);
          // Continue with zero SS contributions if lookup fails
        }

        const totalDeductions = (wageCalc.tax_deducted || 0) + (sicknessDeduction?.total_benefit_deduction || 0) + ssEmployeeContribution + mlfContribution;
        const netPayment = grossEarnings - totalDeductions;

        const lineData = {
          payroll_entry_id: payrollEntry.id,
          emp_id: employee_id,
          hourly_rate: wageCalc.hourly_rate,
          hours_worked: wageCalc.total_hours_worked,
          weekly_wage: wageCalc.weekly_wage,
          ss_class_code: wageCalc.ss_class,
          ss_employee_contribution: ssEmployeeContribution,
          ss_employer_contribution: ssEmployerContribution,
          mlf_contribution: mlfContribution,
          annual_leave_taken_hours: wageCalc.total_paid_leave_hours,
          sick_leave_taken_hours: 0,
          unpaid_leave_hours: wageCalc.total_unpaid_leave_hours,
          overtime_hours: 0,
          overtime_payment: 0,
          statutory_bonus_june: statutoryBonusJune,
          weekly_allowance_march: weeklyAllowanceMarch,
          statutory_bonus_december: statutoryBonusDecember,
          weekly_allowance_september: weeklyAllowanceSeptember,
          supervisor_bonus: supervisorBonus,
          performance_bonus: performanceBonus,
          supervisor_bonus_deduction: supervisorBonusDeduction,
          performance_bonus_deduction: performanceBonusDeduction,
          gross_earnings: Math.round(grossEarnings * 100) / 100,
          tax_rate_applied: wageCalc.tax_rate,
          tax_deduction: wageCalc.tax_deducted,
          total_deductions: Math.round(totalDeductions * 100) / 100,
          net_payment: Math.round(netPayment * 100) / 100,
          notes: `Calculated from ${sub.payroll_type} subscription ${sub.employment_number || ''}`.trim()
        };

        const result = await database('payroll_lines').insert(lineData).returning('*');
        payrollLines.push(result[0]);
      }

      res.json({
        ok: true,
        employee_id,
        period: `${payroll_year}-${String(payroll_month).padStart(2, '0')}`,
        basic_wage: wageCalc.basic_wage,
        tax_deducted: wageCalc.tax_deducted,
        ss_class: wageCalc.ss_class,
        subscriptions_processed: subscriptions.length,
        payroll_lines_created: payrollLines.length,
        // Leave entitlements overview
        leave_entitlements: leaveEntitlements ? {
          employment_type: leaveEntitlements.employment_type,
          has_no_entitlement: leaveEntitlements.has_no_entitlement,
          payment_due: leaveEntitlements.payment_due,
          vl_prorata_hours: leaveEntitlements.vl_prorata_hours,
          sl_prorata_hours: leaveEntitlements.sl_prorata_hours,
          vl_adjusted_after_unpaid: leaveEntitlements.vl_adjusted_entitlement,
          sl_adjusted_after_unpaid: leaveEntitlements.sl_adjusted_entitlement,
          vl_used_ytd: leaveEntitlements.vl_used_hours_ytd,
          sl_used_ytd: leaveEntitlements.sl_used_hours_ytd,
          vl_remaining: leaveEntitlements.vl_remaining_hours,
          sl_remaining: leaveEntitlements.sl_remaining_hours,
          days_employed_in_year: leaveEntitlements.days_employed_in_year,
          prorata_factor: leaveEntitlements.prorata_factor,
          is_eligible_for_public_holidays: leaveEntitlements.is_eligible_for_public_holidays,
          public_holidays_inlieu_hours: leaveEntitlements.public_holidays_inlieu_hours_applied
        } : null,
        leave_violations: leaveViolations.length > 0 ? leaveViolations : null,
        sickness_benefit_deduction: sicknessDeduction ? {
          total_sick_leave_hours: sicknessDeduction.total_sick_leave_hours,
          sick_leave_days: sicknessDeduction.sick_leave_days,
          days_paid_by_employer: sicknessDeduction.days_paid_by_employer,
          days_subject_to_benefit: sicknessDeduction.days_subject_to_benefit,
          benefit_rate_per_day: sicknessDeduction.benefit_rate_per_day,
          total_benefit_deduction: sicknessDeduction.total_benefit_deduction,
          note: 'First 3 days paid by employer (100%), days 4+ deducted at benefit rate'
        } : null,
        payroll_lines: payrollLines
      });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to calculate wages' });
    }
  });

  /**
   * GET /payroll/calculate-wages/:emp_id/:year/:month
   * Preview wage calculation (dry run, no inserts)
   */
  router.get('/payroll/calculate-wages/:emp_id/:year/:month', async (req: any, res: any) => {
    try {
      const pg = toPgLike(database);
      const empId = Number(req.params.emp_id);
      const year = Number(req.params.year);
      const month = Number(req.params.month);

      if (!Number.isFinite(empId) || !Number.isFinite(year) || !Number.isFinite(month)) {
        return res.status(400).json({ error: 'Invalid parameters' });
      }

      // Fetch employee info
      const empResult = await database('vw_employee_current')
        .where('emp_id', empId)
        .first();

      if (!empResult) {
        return res.status(404).json({ error: 'Employee not found' });
      }

      // Fetch active wage history entry for the period
      const periodStart = new Date(year, month - 1, 1);
      const wageResult = await database('wage_history')
        .where('emp_id', empId)
        .where('effective_date', '<=', periodStart.toISOString().split('T')[0])
        .orderBy('effective_date', 'desc')
        .first();

      if (!wageResult) {
        return res.status(400).json({ error: 'No wage history found for this period' });
      }

      // Fetch timesheets for the month
      const periodEnd = new Date(year, month, 0);
      const timesheetsResult = await database('timesheets')
        .where('emp_id', empId)
        .where('work_date', '>=', periodStart.toISOString().split('T')[0])
        .where('work_date', '<=', periodEnd.toISOString().split('T')[0])
        .orderBy('work_date');

      // Convert to daily hours
      const dailyHours: DailyHours[] = timesheetsResult.map((ts: any) => ({
        date: ts.work_date,
        hours: ts.hours,
        hour_type: ts.hour_type,
        leave_status: ts.leave_status || 'PAID'
      }));

      // Calculate wage
      const wageCalc = await calculateWage(
        pg,
        {
          employee_id: empId,
          payroll_year: year,
          payroll_month: month,
          contracted_hours_per_week: empResult.weekly_hours || 40,
          hourly_rate: wageResult.hourly_rate
        },
        dailyHours,
        empResult.dob
      );

      // Fetch statutory bonuses configuration
      const bonusConfigs = await database('statutory_bonuses')
        .where('active_from', '<=', periodStart.toISOString().split('T')[0])
        .where((qb: any) =>
          qb.whereNull('active_to').orWhere('active_to', '>=', periodStart.toISOString().split('T')[0])
        );

      // Calculate Monday count and bonus deductions
      const mondayCount = getNumberOfMondaysInMonth(year, month);
      const totalLeaveHours = wageCalc.total_paid_leave_hours + wageCalc.total_unpaid_leave_hours;

      let bonusCalculations = {
        supervisor_bonus: 0,
        supervisor_bonus_deduction: 0,
        performance_bonus: 0,
        performance_bonus_deduction: 0,
        statutory_bonus_june: 0,
        weekly_allowance_march: 0,
        statutory_bonus_december: 0,
        weekly_allowance_september: 0
      };

      // Calculate bonuses
      for (const bc of bonusConfigs) {
        if (bc.bonus_type === 'MEDIATRIX' && bc.bonus_subtype === 'SUPERVISOR') {
          bonusCalculations.supervisor_bonus = bc.amount || 0;
          bonusCalculations.supervisor_bonus_deduction = calculateMediatrixBonusDeduction(
            bonusCalculations.supervisor_bonus,
            wageCalc.contracted_hours_per_week,
            mondayCount,
            totalLeaveHours
          );
        }

        if (bc.bonus_type === 'MEDIATRIX' && bc.bonus_subtype === 'PERFORMANCE') {
          bonusCalculations.performance_bonus = bc.amount || 0;
          bonusCalculations.performance_bonus_deduction = calculateMediatrixBonusDeduction(
            bonusCalculations.performance_bonus,
            wageCalc.contracted_hours_per_week,
            mondayCount,
            totalLeaveHours
          );
        }

        if (bc.bonus_type === 'GOVERNMENT' && bc.bonus_subtype === 'JUNE' && month === 6) {
          bonusCalculations.statutory_bonus_june = bc.amount || 0;
        }

        if (bc.bonus_type === 'GOVERNMENT' && bc.bonus_subtype === 'MARCH_ALLOWANCE' && month === 3) {
          bonusCalculations.weekly_allowance_march = bc.amount || 0;
        }

        if (bc.bonus_type === 'GOVERNMENT' && bc.bonus_subtype === 'DECEMBER' && month === 12) {
          bonusCalculations.statutory_bonus_december = bc.amount || 0;
        }

        if (bc.bonus_type === 'GOVERNMENT' && bc.bonus_subtype === 'SEPTEMBER_ALLOWANCE' && month === 9) {
          bonusCalculations.weekly_allowance_september = bc.amount || 0;
        }
      }

      // Calculate leave entitlements for preview
      let leaveEntitlements: LeaveEntitlementOutput | null = null;
      let leaveViolations: any[] = [];
      let sicknessDeduction: any = null;
      
      // Lookup social security contributions from social_security_classes
      let ssEmployeeContribution = 0;
      let ssEmployerContribution = 0;
      let mlfContribution = 0;

      try {
        const ssClass = await database('social_security_classes')
          .where('year', year)
          .where('class_code', wageCalc.ss_class)
          .first();

        if (ssClass) {
          // For percentage-based contributions: use weekly wage
          if (ssClass.employee_percentage) {
            ssEmployeeContribution = (wageCalc.weekly_wage * ssClass.employee_percentage) / 100;
          } else if (ssClass.employee_fixed) {
            ssEmployeeContribution = ssClass.employee_fixed;
          }

          if (ssClass.employer_percentage) {
            ssEmployerContribution = (wageCalc.weekly_wage * ssClass.employer_percentage) / 100;
          } else if (ssClass.employer_fixed) {
            ssEmployerContribution = ssClass.employer_fixed;
          }

          // MLF contribution (Maternity Leave Fund)
          if (ssClass.mlf_percentage) {
            mlfContribution = (wageCalc.weekly_wage * ssClass.mlf_percentage) / 100;
            // Apply cap if present (for apprentices)
            if (ssClass.mlf_max && mlfContribution > ssClass.mlf_max) {
              mlfContribution = ssClass.mlf_max;
            }
          } else if (ssClass.mlf_fixed) {
            mlfContribution = ssClass.mlf_fixed;
          }

          // Apply rounding: SS rounds to 2 decimals (cents)
          ssEmployeeContribution = Math.round(ssEmployeeContribution * 100) / 100;
          ssEmployerContribution = Math.round(ssEmployerContribution * 100) / 100;
          mlfContribution = Math.round(mlfContribution * 100) / 100;
        }
      } catch (ssError) {
        logger.warn(`Failed to lookup SS class for ${wageCalc.ss_class}:`, ssError);
        // Continue with zero SS contributions if lookup fails
      }
      
      // Fetch subscriptions first  (to determine payroll type)
      const subscriptions = await database('payroll_subscriptions')
        .where('employee_id', empId)
        .where('active_from', '<=', periodStart.toISOString().split('T')[0])
        .where((qb: any) =>
          qb.whereNull('active_to').orWhere('active_to', '>=', periodStart.toISOString().split('T')[0])
        );

      const mainSub = subscriptions.find((s: any) => s.payroll_type === 'MAIN');
      const primaryPayrollType = mainSub?.payroll_type || (subscriptions.length > 0 ? subscriptions[0].payroll_type : 'MAIN');

      try {
        leaveEntitlements = await calculateLeaveEntitlements(pg, {
          employee_id: empId,
          payroll_year: year,
          payroll_month: month,
          ss_class: wageCalc.ss_class,
          payroll_type: primaryPayrollType
        });
        leaveViolations = validateLeaveUsage(leaveEntitlements);

        // Calculate sickness benefit deduction
        if (leaveEntitlements.sl_used_hours_ytd > 0 && primaryPayrollType === 'MAIN') {
          const benefitRate = await getSicknessBenefitRate(pg, year, empResult.tax_status);
          sicknessDeduction = calculateSicknessBenefitDeduction(
            wageCalc.total_unpaid_leave_hours,
            wageCalc.basic_wage,
            benefitRate
          );
        }
      } catch (leaveError) {
        logger.warn(`Failed to calculate leave entitlements for employee ${empId}: ${leaveError}`);
      }

      res.json({
        ok: true,
        preview: true,
        employee_id: empId,
        employee_name: `${empResult.name || empResult.first_name || ''} ${empResult.surname || ''}`.trim(),
        period: `${year}-${String(month).padStart(2, '0')}`,
        timesheet_summary: {
          hours_worked: wageCalc.total_hours_worked,
          hours_paid_leave: wageCalc.total_paid_leave_hours,
          hours_unpaid_leave: wageCalc.total_unpaid_leave_hours
        },
        wage_calculation: wageCalc,
        bonus_calculations: bonusCalculations,
        social_security_contributions: {
          class_code: wageCalc.ss_class,
          employee_contribution: ssEmployeeContribution,
          employer_contribution: ssEmployerContribution,
          mlf_contribution: mlfContribution,
          total_employer_cost: ssEmployerContribution + ssEmployeeContribution + mlfContribution
        },
        leave_entitlements: leaveEntitlements ? {
          employment_type: leaveEntitlements.employment_type,
          has_no_entitlement: leaveEntitlements.has_no_entitlement,
          payment_due: leaveEntitlements.payment_due,
          vl_prorata_hours: leaveEntitlements.vl_prorata_hours,
          sl_prorata_hours: leaveEntitlements.sl_prorata_hours,
          vl_adjusted_after_unpaid: leaveEntitlements.vl_adjusted_entitlement,
          sl_adjusted_after_unpaid: leaveEntitlements.sl_adjusted_entitlement,
          vl_used_ytd: leaveEntitlements.vl_used_hours_ytd,
          sl_used_ytd: leaveEntitlements.sl_used_hours_ytd,
          vl_remaining: leaveEntitlements.vl_remaining_hours,
          sl_remaining: leaveEntitlements.sl_remaining_hours,
          days_employed_in_year: leaveEntitlements.days_employed_in_year,
          prorata_factor: leaveEntitlements.prorata_factor,
          is_eligible_for_public_holidays: leaveEntitlements.is_eligible_for_public_holidays,
          public_holidays_inlieu_hours: leaveEntitlements.public_holidays_inlieu_hours_applied
        } : null,
        leave_violations: leaveViolations.length > 0 ? leaveViolations : null,
        sickness_benefit_deduction: sicknessDeduction ? {
          total_sick_leave_hours: sicknessDeduction.total_sick_leave_hours,
          sick_leave_days: sicknessDeduction.sick_leave_days,
          days_paid_by_employer: sicknessDeduction.days_paid_by_employer,
          days_subject_to_benefit: sicknessDeduction.days_subject_to_benefit,
          benefit_rate_per_day: sicknessDeduction.benefit_rate_per_day,
          total_benefit_deduction: sicknessDeduction.total_benefit_deduction,
          note: 'First 3 days paid by employer (100%), days 4+ deducted at benefit rate'
        } : null,
        subscriptions: subscriptions.map((s: any) => ({
          payroll_type: s.payroll_type,
          employment_number: s.employment_number,
          active_from: s.active_from,
          active_to: s.active_to
        }))
      });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to preview wages' });
    }
  });

  /**
   * POST /payroll/bulk-calculate-wages
   * Calculate wages for all employees with MAIN subscriptions for a given month
   * Scope: MAIN subscriptions only
   */
  router.post('/payroll/bulk-calculate-wages', async (req: any, res: any) => {
    try {
      const { year, month } = req.body;

      if (!year || !month) {
        return res.status(400).json({ error: 'Year and month are required' });
      }

      const payroll_year = Number(year);
      const payroll_month = Number(month);

      if (!Number.isFinite(payroll_year) || !Number.isFinite(payroll_month) || payroll_month < 1 || payroll_month > 12) {
        return res.status(400).json({ error: 'Invalid year or month' });
      }

      const periodStart = new Date(payroll_year, payroll_month - 1, 1);
      const periodEnd = new Date(payroll_year, payroll_month, 0);

      // Fetch all MAIN subscriptions active in this period
      const mainSubscriptions = await database('payroll_subscriptions')
        .distinct('employee_id')
        .where('payroll_type', 'MAIN')
        .where('active_from', '<=', periodStart.toISOString().split('T')[0])
        .where((qb: any) =>
          qb.whereNull('active_to').orWhere('active_to', '>=', periodStart.toISOString().split('T')[0])
        );

      if (!mainSubscriptions || mainSubscriptions.length === 0) {
        return res.status(404).json({
          ok: false,
          message: 'No MAIN subscriptions found for this period'
        });
      }

      const pg = toPgLike(database);
      const results: any[] = [];
      let successCount = 0;
      let errorCount = 0;
      const errors: any[] = [];

      // Calculate wages for each employee
      for (const sub of mainSubscriptions) {
        try {
          const empId = sub.employee_id;

          // Fetch employee info
          const empResult = await database('vw_employee_current')
            .where('emp_id', empId)
            .first();

          if (!empResult) {
            errorCount++;
            errors.push({ emp_id: empId, reason: 'Employee not found' });
            continue;
          }

          // Fetch wage history
          const wageResult = await database('wage_history')
            .where('emp_id', empId)
            .where('effective_date', '<=', periodStart.toISOString().split('T')[0])
            .orderBy('effective_date', 'desc')
            .first();

          if (!wageResult) {
            errorCount++;
            errors.push({ emp_id: empId, name: empResult.name || empResult.first_name, reason: 'No wage history found' });
            continue;
          }

          // Aggregate timesheets for the month
          const timeData = await database('timesheets')
            .where('emp_id', empId)
            .whereBetween('work_date', [
              periodStart.toISOString().split('T')[0],
              periodEnd.toISOString().split('T')[0]
            ])
            .select('*');

          const hoursByType: { [key: string]: number } = {};
          for (const t of timeData) {
            hoursByType[t.hour_type] = (hoursByType[t.hour_type] || 0) + (t.hours || 0);
          }

          // Build DailyHours array from timesheet data
          const dailyHours: DailyHours[] = timeData.map((t: any) => ({
            date: t.work_date,
            hours: t.hours || 0,
            hour_type: t.hour_type === 'VACATION' ? 'VACATION_LEAVE' : 
                      t.hour_type === 'SICK' ? 'SICK_LEAVE' :
                      t.hour_type === 'UNPAID' ? 'UNPAID_LEAVE' :
                      t.hour_type === 'MATERNITY' ? 'MATERNITY' :
                      'WORK',
            leave_status: t.leave_status || (t.hour_type === 'WORK' || t.hour_type === 'MATERNITY' ? 'PAID' : 'UNPAID')
          }));

          // Calculate wage
          const wageCalc = await calculateWage(pg, {
            employee_id: empId,
            payroll_year: payroll_year,
            payroll_month: payroll_month,
            hourly_rate: wageResult.hourly_rate,
            contracted_hours_per_week: empResult.contracted_hours || 40
          }, dailyHours, empResult.date_of_birth || null);

          // Fetch leave entitlements
          const mainSub = await database('payroll_subscriptions')
            .where('employee_id', empId)
            .where('payroll_type', 'MAIN')
            .where('active_from', '<=', periodStart.toISOString().split('T')[0])
            .where((qb: any) =>
              qb.whereNull('active_to').orWhere('active_to', '>=', periodStart.toISOString().split('T')[0])
            )
            .first();

          let leaveEntitlements: LeaveEntitlementOutput | null = null;
          try {
            leaveEntitlements = await calculateLeaveEntitlements(pg, {
              employee_id: empId,
              payroll_year,
              payroll_month,
              ss_class: wageCalc.ss_class,
              payroll_type: 'MAIN'
            });
          } catch (e) {
            logger.warn(`Leave calc failed for emp ${empId}:`, e);
          }

          // Lookup SS contributions
          let ssEmployeeContribution = 0;
          let ssEmployerContribution = 0;
          let mlfContribution = 0;

          try {
            const ssClass = await database('social_security_classes')
              .where('year', payroll_year)
              .where('class_code', wageCalc.ss_class)
              .first();

            if (ssClass) {
              if (ssClass.employee_percentage) {
                ssEmployeeContribution = (wageCalc.weekly_wage * ssClass.employee_percentage) / 100;
              } else if (ssClass.employee_fixed) {
                ssEmployeeContribution = ssClass.employee_fixed;
              }

              if (ssClass.employer_percentage) {
                ssEmployerContribution = (wageCalc.weekly_wage * ssClass.employer_percentage) / 100;
              } else if (ssClass.employer_fixed) {
                ssEmployerContribution = ssClass.employer_fixed;
              }

              if (ssClass.mlf_percentage) {
                mlfContribution = (wageCalc.weekly_wage * ssClass.mlf_percentage) / 100;
                if (ssClass.mlf_max && mlfContribution > ssClass.mlf_max) {
                  mlfContribution = ssClass.mlf_max;
                }
              } else if (ssClass.mlf_fixed) {
                mlfContribution = ssClass.mlf_fixed;
              }

              ssEmployeeContribution = Math.round(ssEmployeeContribution * 100) / 100;
              ssEmployerContribution = Math.round(ssEmployerContribution * 100) / 100;
              mlfContribution = Math.round(mlfContribution * 100) / 100;
            }
          } catch (ssError) {
            logger.warn(`SS lookup failed for emp ${empId}:`, ssError);
          }

          // Ensure payroll entry exists
          let payrollEntry = await database('payroll_entries')
            .where('payroll_year', payroll_year)
            .where('payroll_month', payroll_month)
            .orderBy('id', 'desc')
            .first();

          if (!payrollEntry) {
            const inserted = await database('payroll_entries')
              .insert({
                payroll_year,
                payroll_month,
                period_from: periodStart.toISOString().split('T')[0],
                period_to: periodEnd.toISOString().split('T')[0],
                status: 'DRAFT',
                total_employees_processed: 0
              })
              .returning('*');
            payrollEntry = inserted[0];
          }

          // Calculate bonuses
          const bonusConfigs = await database('statutory_bonuses')
            .where('year', payroll_year);

          const mondayCount = getNumberOfMondaysInMonth(payroll_year, payroll_month);
          const totalLeaveHours = wageCalc.total_paid_leave_hours + wageCalc.total_unpaid_leave_hours;

          let bonusAmounts = {
            supervisor: 0,
            supervisor_deduction: 0,
            performance: 0,
            performance_deduction: 0,
            statutory_june: 0,
            weekly_march: 0,
            statutory_december: 0,
            weekly_september: 0
          };

          for (const bc of bonusConfigs) {
            if (bc.bonus_type === 'MEDIATRIX' && bc.bonus_subtype === 'SUPERVISOR') {
              bonusAmounts.supervisor = bc.amount || 0;
              bonusAmounts.supervisor_deduction = calculateMediatrixBonusDeduction(
                bonusAmounts.supervisor,
                empResult.contracted_hours || 40,
                mondayCount,
                totalLeaveHours
              );
            }

            if (bc.bonus_type === 'MEDIATRIX' && bc.bonus_subtype === 'PERFORMANCE') {
              bonusAmounts.performance = bc.amount || 0;
              bonusAmounts.performance_deduction = calculateMediatrixBonusDeduction(
                bonusAmounts.performance,
                empResult.contracted_hours || 40,
                mondayCount,
                totalLeaveHours
              );
            }

            if (bc.bonus_type === 'GOVERNMENT' && bc.bonus_subtype === 'JUNE' && payroll_month === 6) {
              bonusAmounts.statutory_june = bc.amount || 0;
            }

            if (bc.bonus_type === 'GOVERNMENT' && bc.bonus_subtype === 'MARCH_ALLOWANCE' && payroll_month === 3) {
              bonusAmounts.weekly_march = bc.amount || 0;
            }

            if (bc.bonus_type === 'GOVERNMENT' && bc.bonus_subtype === 'DECEMBER' && payroll_month === 12) {
              bonusAmounts.statutory_december = bc.amount || 0;
            }

            if (bc.bonus_type === 'GOVERNMENT' && bc.bonus_subtype === 'SEPTEMBER_ALLOWANCE' && payroll_month === 9) {
              bonusAmounts.weekly_september = bc.amount || 0;
            }
          }

          const grossEarnings =
            (wageCalc.basic_wage || 0) +
            bonusAmounts.supervisor +
            bonusAmounts.performance +
            bonusAmounts.statutory_june +
            bonusAmounts.weekly_march +
            bonusAmounts.statutory_december +
            bonusAmounts.weekly_september -
            bonusAmounts.supervisor_deduction -
            bonusAmounts.performance_deduction;

          const sicknessBenefit = leaveEntitlements?.sl_used_hours_ytd || 0 > 0 ? 
            await getSicknessBenefitRate(pg, payroll_year, empResult.tax_status) : 0;

          const totalDeductions = (wageCalc.tax_deducted || 0) + ssEmployeeContribution + mlfContribution;
          const netPayment = grossEarnings - totalDeductions;

          // Insert payroll line
          const lineData = {
            payroll_entry_id: payrollEntry.id,
            emp_id: empId,
            hourly_rate: wageResult.hourly_rate,
            hours_worked: wageCalc.total_hours_worked,
            weekly_wage: wageCalc.weekly_wage,
            ss_class_code: wageCalc.ss_class,
            ss_employee_contribution: ssEmployeeContribution,
            ss_employer_contribution: ssEmployerContribution,
            mlf_contribution: mlfContribution,
            annual_leave_taken_hours: wageCalc.total_paid_leave_hours,
            sick_leave_taken_hours: 0,
            unpaid_leave_hours: wageCalc.total_unpaid_leave_hours,
            overtime_hours: 0,
            overtime_payment: 0,
            statutory_bonus_june: bonusAmounts.statutory_june,
            weekly_allowance_march: bonusAmounts.weekly_march,
            statutory_bonus_december: bonusAmounts.statutory_december,
            weekly_allowance_september: bonusAmounts.weekly_september,
            supervisor_bonus: bonusAmounts.supervisor,
            performance_bonus: bonusAmounts.performance,
            supervisor_bonus_deduction: bonusAmounts.supervisor_deduction,
            performance_bonus_deduction: bonusAmounts.performance_deduction,
            gross_earnings: Math.round(grossEarnings * 100) / 100,
            tax_rate_applied: wageCalc.tax_rate,
            tax_deduction: wageCalc.tax_deducted,
            total_deductions: Math.round(totalDeductions * 100) / 100,
            net_payment: Math.round(netPayment * 100) / 100,
            notes: `Bulk calculated for MAIN subscription`
          };

          const result = await database('payroll_lines').insert(lineData).returning('*');
          successCount++;
          results.push({
            emp_id: empId,
            name: `${empResult.name || empResult.first_name || ''} ${empResult.surname || ''}`.trim(),
            gross_earnings: Math.round(grossEarnings * 100) / 100,
            net_payment: Math.round(netPayment * 100) / 100,
            ss_employee: ssEmployeeContribution,
            tax_deduction: wageCalc.tax_deducted
          });
        } catch (empError) {
          errorCount++;
          logger.error(`Error processing employee ${sub.employee_id}:`, empError);
          errors.push({
            emp_id: sub.employee_id,
            reason: empError instanceof Error ? empError.message : 'Unknown error'
          });
        }
      }

      res.json({
        ok: true,
        period: `${payroll_year}-${String(payroll_month).padStart(2, '0')}`,
        summary: {
          total_employees_found: mainSubscriptions.length,
          successfully_processed: successCount,
          failed: errorCount
        },
        results,
        errors: errors.length > 0 ? errors : undefined
      });
    } catch (error) {
      logger.error(error);
      res.status(500).json({ error: 'Failed to bulk calculate wages' });
    }
  });
});

