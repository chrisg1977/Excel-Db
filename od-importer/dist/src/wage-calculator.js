/**
 * Wage calculation engine
 * Converts timesheet events + wage history + SS class rules → payroll line items
 */
// Constants
const WEEKS_PER_MONTH = 52 / 12; // 4.33333...
const WORK_HOURS_PER_DAY = 8;
const WORK_DAYS_PER_WEEK = 5;
/**
 * Calculate days in a month (for working day ratio)
 */
const getDaysInMonth = (year, month) => {
    return new Date(year, month, 0).getDate();
};
/**
 * Get the number of Mondays in a given month.
 * Used for MEDIATRIX bonus deductions: Q*P where P = number of Mondays
 */
const getNumberOfMondaysInMonth = (year, month) => {
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
/**
 * Calculate working days in a month (exclude weekends)
 * Simplified: assume standard 5-day weeks
 */
const getWorkingDaysInMonth = (year, month) => {
    const totalDays = getDaysInMonth(year, month);
    const startDate = new Date(year, month - 1, 1);
    let workingDays = 0;
    for (let i = 0; i < totalDays; i++) {
        const date = new Date(year, month - 1, i + 1);
        const dayOfWeek = date.getDay();
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            // Not Sunday (0) or Saturday (6)
            workingDays += 1;
        }
    }
    return workingDays;
};
/**
 * Calculate basic monthly wage
 * Formula: contracted_hours_per_week × hourly_rate × (52/12) × (working_days_in_month / total_days_in_month)
 */
export const calculateBasicWage = (contractedHoursPerWeek, hourlyRate, year, month) => {
    const workingDays = getWorkingDaysInMonth(year, month);
    const totalDays = getDaysInMonth(year, month);
    const basicWage = contractedHoursPerWeek * hourlyRate * WEEKS_PER_MONTH * (workingDays / totalDays);
    return Math.round(basicWage * 100) / 100; // Round to 2 decimals
};
/**
 * Determine SS class based on weekly wage and date of birth
 * Malta Social Security rules 2026
 */
export const determineSocialSecurityClass = (weeklyWage, dateOfBirth) => {
    // Parse DOB to check age/cohort
    const dob = dateOfBirth ? new Date(dateOfBirth) : new Date();
    const birthDate = dob.getTime();
    const cutoffDate = new Date('1962-01-01').getTime(); // Persons born before this = older cohort
    const isOlderCohort = birthDate < cutoffDate;
    if (weeklyWage <= 221.78) {
        // Category A or B
        const age = new Date().getFullYear() - dob.getFullYear();
        return age < 18 ? 'A' : 'B'; // Under 18 = A, 18+ = B
    }
    if (isOlderCohort) {
        // Persons born pre-1962
        if (weeklyWage <= 451.91)
            return 'C'; // 221.79 - 451.91
        return 'D'; // >= 451.92
    }
    else {
        // Persons born 1962 onwards
        if (weeklyWage <= 544.28)
            return 'C'; // 221.79 - 544.28
        return 'D'; // >= 544.29
    }
};
/**
 * Look up tax bracket and rate from tax_rates_live
 */
export const lookupTaxBracket = async (pg, grossIncome, category) => {
    const result = await pg.query(`SELECT rate, subtract, band_from, band_to
     FROM tax_rates_live
     WHERE category_code = $1
       AND band_from <= $2
       AND (band_to IS NULL OR band_to >= $2)
     LIMIT 1`, [category, grossIncome]);
    if (result.rows.length === 0) {
        throw new Error(`No tax bracket found for category ${category}, income ${grossIncome}`);
    }
    return result.rows[0];
};
/**
 * Calculate tax deduction using Malta formula: (gross - subtract) × rate
 */
export const calculateTax = (grossIncome, taxRate, taxSubtract) => {
    const taxable = Math.max(0, grossIncome - taxSubtract);
    const tax = taxable * taxRate;
    return Math.round(tax * 100) / 100;
};
const ageOnYearEnd = (dob, year) => {
    if (!dob)
        return null;
    const birth = new Date(`${dob}T00:00:00Z`);
    if (Number.isNaN(birth.getTime()))
        return null;
    const yearEnd = new Date(Date.UTC(year, 11, 31));
    let age = yearEnd.getUTCFullYear() - birth.getUTCFullYear();
    const birthdayThisYear = new Date(Date.UTC(year, birth.getUTCMonth(), birth.getUTCDate()));
    if (birthdayThisYear.getTime() > yearEnd.getTime()) {
        age -= 1;
    }
    return age;
};
const roundMoney = (value) => Math.round(value * 100) / 100;
const computeContributionAmount = (wage, fixed, percentage, max) => {
    let amount = 0;
    if (fixed !== null && Number.isFinite(fixed)) {
        amount = fixed;
    }
    else if (percentage !== null && Number.isFinite(percentage)) {
        amount = wage * (percentage / 100);
    }
    if (max !== null && Number.isFinite(max)) {
        amount = Math.min(amount, max);
    }
    return roundMoney(amount);
};
export const lookupSocialSecurityContribution = async (pg, year, weeklyWage, dateOfBirth) => {
    if (weeklyWage <= 0)
        return null;
    const age = ageOnYearEnd(dateOfBirth, year);
    const result = await pg.query(`SELECT
       class_code,
       employee_fixed,
       employee_percentage,
       employer_fixed,
       employer_percentage,
       mlf_fixed,
       mlf_percentage,
       mlf_max
     FROM social_security_classes
     WHERE year = $1
       AND (wage_from IS NULL OR wage_from <= $2)
       AND (wage_to IS NULL OR wage_to >= $2)
       AND ($3::date IS NULL OR dob_from IS NULL OR dob_from::date <= $3::date)
       AND ($3::date IS NULL OR dob_to IS NULL OR dob_to::date >= $3::date)
       AND ($4::int IS NULL OR min_age IS NULL OR min_age <= $4::int)
       AND ($4::int IS NULL OR max_age IS NULL OR max_age >= $4::int)
     ORDER BY
       CASE WHEN dob_from IS NOT NULL OR dob_to IS NOT NULL THEN 0 ELSE 1 END,
       CASE WHEN min_age IS NOT NULL OR max_age IS NOT NULL THEN 0 ELSE 1 END,
       CASE WHEN wage_to IS NULL THEN 1 ELSE 0 END,
       wage_from DESC NULLS LAST
     LIMIT 1`, [year, weeklyWage, dateOfBirth, age]);
    const row = result.rows[0];
    if (!row)
        return null;
    const employeeContribution = computeContributionAmount(weeklyWage, row.employee_fixed === null ? null : Number(row.employee_fixed), row.employee_percentage === null ? null : Number(row.employee_percentage), null);
    const employerContribution = computeContributionAmount(weeklyWage, row.employer_fixed === null ? null : Number(row.employer_fixed), row.employer_percentage === null ? null : Number(row.employer_percentage), null);
    const mlfContribution = computeContributionAmount(weeklyWage, row.mlf_fixed === null ? null : Number(row.mlf_fixed), row.mlf_percentage === null ? null : Number(row.mlf_percentage), row.mlf_max === null ? null : Number(row.mlf_max));
    return {
        class_code: String(row.class_code || '').trim(),
        employee_contribution: employeeContribution,
        employer_contribution: employerContribution,
        mlf_contribution: mlfContribution
    };
};
/**
 * Calculate MEDIATRIX bonus deduction based on leave hours
 * Formula: AV - (AV / (Q*P) * ST)
 * Where:
 *   AV = bonus amount
 *   Q = contracted hours per week
 *   P = number of Mondays in the month
 *   ST = total leave hours (all types: paid + unpaid)
 */
export const calculateMediatrixBonusDeduction = (bonusAmount, contractedHoursPerWeek, mondayCount, leaveHours) => {
    if (bonusAmount <= 0 || contractedHoursPerWeek <= 0 || mondayCount <= 0) {
        return 0;
    }
    const contractualHoursForMonth = contractedHoursPerWeek * mondayCount;
    const deduction = (bonusAmount / contractualHoursForMonth) * leaveHours;
    const netBonus = Math.max(0, bonusAmount - deduction);
    return Math.round(deduction * 100) / 100;
};
/**
 * Calculate GOVERNMENT bonus deduction based on employment period and hours worked
 * Formula: (total_govt_bonus / days_in_employment) * (hours_worked_including_paid_leave / total_hours)
 * Note: Unpaid leave reduces the pro-rata factor
 */
export const calculateGovernmentBonusDeduction = (totalBonusAmount, daysInEmploymentPeriod, hoursWorkedIncludingPaidLeave, totalContractualHours, unpaidLeaveHours) => {
    if (totalBonusAmount <= 0 ||
        daysInEmploymentPeriod <= 0 ||
        totalContractualHours <= 0) {
        return 0;
    }
    // Pro-rata factor: actual hours worked (including paid leave) / total contractual hours
    const proRataFactor = hoursWorkedIncludingPaidLeave / totalContractualHours;
    // Reduce pro-rata by unpaid leave impact
    const adjustedProRataFactor = Math.max(0, proRataFactor - unpaidLeaveHours / totalContractualHours);
    // Daily bonus amount
    const dailyBonusAmount = totalBonusAmount / daysInEmploymentPeriod;
    // Final eligible bonus (before deduction) = daily amount * actual days worked
    const actualDaysWithPaidLeave = (hoursWorkedIncludingPaidLeave / WORK_HOURS_PER_DAY);
    const eligibleBonus = dailyBonusAmount * actualDaysWithPaidLeave;
    // Deduction = eligible bonus reduced by unpaid leave impact
    const deduction = Math.max(0, eligibleBonus * (unpaidLeaveHours / totalContractualHours));
    return Math.round(deduction * 100) / 100;
};
/**
 * Main wage calculation function
 */
export const calculateWage = async (pg, input, dailyHours, dob) => {
    const periodStart = new Date(input.payroll_year, input.payroll_month - 1, 1);
    const periodStr = periodStart.toISOString().slice(0, 7); // YYYY-MM
    // Sum hours by type
    const totalWorked = dailyHours
        .filter((d) => d.hour_type === 'WORK')
        .reduce((sum, d) => sum + d.hours, 0);
    const totalPaidLeave = dailyHours
        .filter((d) => (d.hour_type === 'SICK_LEAVE' || d.hour_type === 'VACATION_LEAVE') &&
        d.leave_status === 'PAID')
        .reduce((sum, d) => sum + d.hours, 0);
    const totalUnpaidLeave = dailyHours
        .filter((d) => (d.hour_type === 'SICK_LEAVE' ||
        d.hour_type === 'VACATION_LEAVE' ||
        d.hour_type === 'UNPAID_LEAVE') &&
        d.leave_status === 'UNPAID')
        .reduce((sum, d) => sum + d.hours, 0);
    // Calculate basic wage
    const basicWage = calculateBasicWage(input.contracted_hours_per_week, input.hourly_rate, input.payroll_year, input.payroll_month);
    // Calculate weekly wage (for SS class determination)
    const weeklyWage = (input.contracted_hours_per_week * input.hourly_rate);
    // Determine SS class
    const ssClass = determineSocialSecurityClass(weeklyWage, dob);
    // Look up tax bracket
    const taxBracket = await lookupTaxBracket(pg, basicWage, 'sng'); // Simplified: using 'sng' code
    const grossTax = basicWage; // Gross income for tax purposes
    const taxDeducted = calculateTax(basicWage, taxBracket.rate, taxBracket.subtract);
    return {
        employee_id: input.employee_id,
        payroll_period: periodStr,
        contracted_hours_per_week: input.contracted_hours_per_week,
        hourly_rate: input.hourly_rate,
        total_hours_worked: totalWorked,
        total_paid_leave_hours: totalPaidLeave,
        total_unpaid_leave_hours: totalUnpaidLeave,
        basic_wage: basicWage,
        weekly_wage: weeklyWage,
        ss_class: ssClass,
        tax_bracket_from: taxBracket.band_from,
        tax_bracket_to: taxBracket.band_to,
        tax_rate: taxBracket.rate,
        tax_subtract: taxBracket.subtract,
        gross_tax: grossTax,
        tax_deducted: taxDeducted
    };
};
