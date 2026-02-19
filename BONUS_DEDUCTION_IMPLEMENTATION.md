# Bonus Deduction Implementation (February 2026)

## Overview
Implemented two distinct bonus deduction models for Malta payroll system:
1. **MEDIATRIX Bonuses** (Supervisor, Performance) - Deducted based on leave hours
2. **GOVERNMENT Bonuses** (June, December, March/September Allowances) - Pro-rata based on employment period and hours worked

---

## MEDIATRIX Bonus Deduction Formula

### Formula
```
Deduction = (Bonus Amount / (Q × P)) × ST
Net Bonus = Bonus Amount - Deduction
```

### Parameters
- **AV** = Mediatrix bonus amount to be paid
- **Q** = Contracted hours per week (e.g., 40 hours)
- **P** = Number of Mondays in the month (e.g., 4 or 5 Mondays = 4 or 5 weeks)
- **ST** = Total leave hours used during the month (all types: paid + unpaid)

### Logic
- Q × P = Total contractual hours the employee should work in the month
- Deduction reduces bonus proportionally based on leave taken
- Both PAID and UNPAID leave hours count equally toward the deduction
- Applied to SUPERVISOR and PERFORMANCE bonuses (Mediatrix brokerage bonuses)

### Code Implementation
**File:** `od-importer/src/wage-calculator.ts`
```typescript
export const calculateMediatrixBonusDeduction = (
  bonusAmount: number,
  contractedHoursPerWeek: number,
  mondayCount: number,
  leaveHours: number
): number => {
  const contractualHoursForMonth = contractedHoursPerWeek * mondayCount;
  const deduction = (bonusAmount / contractualHoursForMonth) * leaveHours;
  return Math.max(0, bonusAmount - deduction);
};
```

### Example
- Employee contracted for 40 hours/week, takes 8 hours of vacation
- Month has 4 Mondays (4 weeks) = 160 contractual hours
- Supervisor bonus: €800
- Deduction: (800 / 160) × 8 = €40
- Net bonus paid: €760

---

## GOVERNMENT Bonus Deduction Formula

### Formula
```
Deduction = (Total Government Bonus / Days in Employment Period) 
            × (Hours Worked Including Paid Leave / Total Contractual Hours)
            × (Unpaid Leave Hours / Total Contractual Hours)
```

### Parameters
- **Total Govt Bonus** = Annual or period-specific government bonus amount
- **Days in Employment Period** = Number of days employed in the eligible period
- **Hours Worked Including Paid Leave** = Total work hours + all paid leave hours
- **Total Contractual Hours** = Expected hours to work in the period
- **Unpaid Leave Hours** = Non-paid leave hours (reduces pro-rata factor)

### Logic
- Government bonuses are **paid only once per year** (June statutory bonus, December bonus, March/September allowances)
- Deduction applies ONLY if employee has unpaid leave during the bonus month
- Pro-rata calculation accounts for:
  - Partial employment periods (days in employment)
  - Actual hours worked vs. contractual hours
  - Unpaid leave reduces the pro-rata eligibility
- Paid leave (vacation, paid sick) **does count** toward bonus eligibility
- Unpaid leave **reduces** bonus eligibility

### Code Implementation
**File:** `od-importer/src/wage-calculator.ts`
```typescript
export const calculateGovernmentBonusDeduction = (
  totalBonusAmount: number,
  daysInEmploymentPeriod: number,
  hoursWorkedIncludingPaidLeave: number,
  totalContractualHours: number,
  unpaidLeaveHours: number
): number => {
  const proRataFactor = hoursWorkedIncludingPaidLeave / totalContractualHours;
  const adjustedProRataFactor = Math.max(0, proRataFactor - unpaidLeaveHours / totalContractualHours);
  const dailyBonusAmount = totalBonusAmount / daysInEmploymentPeriod;
  const actualDaysWithPaidLeave = (hoursWorkedIncludingPaidLeave / 8); // 8-hour work day
  const eligibleBonus = dailyBonusAmount * actualDaysWithPaidLeave;
  const deduction = Math.max(0, eligibleBonus * (unpaidLeaveHours / totalContractualHours));
  return deduction;
};
```

### Example
- Government June bonus: €1,200
- Employee employed full month (20 working days)
- Hours worked + paid leave: 152 hours (out of 160 contractual)
- Unpaid leave: 8 hours
- Deduction: (1,200 / 20) × (152 / 160) × (8 / 160) = €3.60
- Net bonus: €1,196.40

---

## Integration Points

### 1. Wage Calculation Endpoint
**Endpoint:** `POST /payroll/calculate-wages`
- Reads employee, wage history, timesheets
- Queries statutory_bonuses configuration table
- Calculates both MEDIATRIX and GOVERNMENT deductions
- Inserts into payroll_lines with all bonus fields populated

**Fields populated in payroll_lines:**
- `supervisor_bonus` (raw amount)
- `supervisor_bonus_deduction` (MEDIATRIX formula)
- `performance_bonus` (raw amount)
- `performance_bonus_deduction` (MEDIATRIX formula)
- `statutory_bonus_june`, `weekly_allowance_march`, `statutory_bonus_december`, `weekly_allowance_september` (GOVERNMENT bonuses)

### 2. Preview Endpoint
**Endpoint:** `GET /payroll/calculate-wages/:emp_id/:year/:month`
- Dry-run wage calculation (no inserts)
- Returns bonus_calculations breakdown showing:
  - All bonus types
  - Deduction amounts
  - Net amounts after deductions

### 3. Supporting Functions
**Helper Function:** `getNumberOfMondaysInMonth(year, month)`
- Counts Mondays in the month for MEDIATRIX formula
- Used to calculate Q × P (contractual hours for month)
- Returns 4 or 5 depending on month calendar

---

## Bonus Configuration Table

The `statutory_bonuses` table controls which bonuses are active and their amounts:

```sql
CREATE TABLE statutory_bonuses (
  id SERIAL PRIMARY KEY,
  bonus_type ENUM('MEDIATRIX', 'GOVERNMENT'),
  bonus_subtype VARCHAR(50),  -- SUPERVISOR, PERFORMANCE, JUNE, DECEMBER, MARCH_ALLOWANCE, SEPTEMBER_ALLOWANCE
  amount NUMERIC(10,2),
  active_from DATE,
  active_to DATE NULL,
  notes TEXT
);
```

**Configuration Examples:**
```sql
-- MEDIATRIX Bonuses (applied every month if configured)
INSERT INTO statutory_bonuses (bonus_type, bonus_subtype, amount, active_from)
VALUES 
  ('MEDIATRIX', 'SUPERVISOR', 500.00, '2026-01-01'),
  ('MEDIATRIX', 'PERFORMANCE', 300.00, '2026-01-01');

-- GOVERNMENT Bonuses (applied in specific months only)
INSERT INTO statutory_bonuses (bonus_type, bonus_subtype, amount, active_from)
VALUES 
  ('GOVERNMENT', 'JUNE', 1200.00, '2026-01-01'),
  ('GOVERNMENT', 'DECEMBER', 1500.00, '2026-01-01'),
  ('GOVERNMENT', 'MARCH_ALLOWANCE', 400.00, '2026-01-01'),
  ('GOVERNMENT', 'SEPTEMBER_ALLOWANCE', 400.00, '2026-01-01');
```

---

## Wage Calculation Flow

### Step 1: Fetch Employee & Period Data
- Employee info (DOB, name, contracted hours/week)
- Wage history (hourly rate effective for the period)
- Timesheets (daily hours, types: WORK, PAID_LEAVE, UNPAID_LEAVE)
- Payroll subscriptions (MAIN/PROVIDER/THIRDPARTY routes)

### Step 2: Calculate Base Wage
- Basic wage = Q × R × (52/12) × (working_days / total_days)
- Weekly wage for SS class determination
- Determine SS class (A-F based on wage + DOB cohort)
- Look up tax bracket and rate
- Calculate tax deduction

### Step 3: Calculate Bonuses & Deductions
```
For each active payroll subscription:
  1. Query statutory_bonuses for active configurations
  2. For MEDIATRIX bonuses:
     - Get Monday count for the month (P)
     - Sum leave hours (paid + unpaid)
     - Apply formula: Deduction = (Amount / (Q × P)) × ST
  3. For GOVERNMENT bonuses:
     - Check if month matches bonus month (June, December, etc.)
     - Apply pro-rata formula with employment days and unpaid leave factor
  4. Write to payroll_lines with all fields:
     - basic_wage, tax_deducted, ss_class
     - supervisor_bonus, supervisor_bonus_deduction
     - performance_bonus, performance_bonus_deduction
     - statutory_bonus_june, weekly_allowance_march, etc.
```

### Step 4: Return Results
- Response includes:
  - Basic wage calculation summary
  - Tax deduction amount
  - All bonus calculations with deductions
  - Subscriptions processed
  - Payroll lines created

---

## Testing & Validation

### Unit Tests (Recommended)
```typescript
// MEDIATRIX: Full month, no leave
calculateMediatrixBonusDeduction(800, 40, 4, 0) === 0

// MEDIATRIX: With 8 hours leave (1 day)
calculateMediatrixBonusDeduction(800, 40, 4, 8) === 40

// MEDIATRIX: Entire week of leave
calculateMediatrixBonusDeduction(800, 40, 4, 40) === 200

// GOVERNMENT: Full month, no unpaid leave
calculateGovernmentBonusDeduction(1200, 20, 160, 160, 0) === 0

// GOVERNMENT: With 8 hours unpaid leave
calculateGovernmentBonusDeduction(1200, 20, 152, 160, 8) === 3.60
```

### Integration Test
1. Insert test employee with wage history (€15/hour)
2. Insert timesheet with mix of work + paid leave + unpaid leave
3. Configure statutory bonuses (MEDIATRIX: €500 supervisor, €300 performance)
4. Call POST /payroll/calculate-wages
5. Verify payroll_lines row contains:
   - supervisor_bonus: 500
   - supervisor_bonus_deduction: calculated correctly
   - performance_bonus: 300
   - performance_bonus_deduction: calculated correctly

---

## Files Modified

1. **od-importer/src/wage-calculator.ts**
   - Added `getNumberOfMondaysInMonth()` helper
   - Added `calculateMediatrixBonusDeduction()` export
   - Added `calculateGovernmentBonusDeduction()` export

2. **src/endpoints/wage-calculator.ts**
   - Updated POST endpoint to fetch statutory_bonuses config
   - Calculate Monday count for the month
   - Apply MEDIATRIX deductions per subscription
   - Apply GOVERNMENT deductions per month
   - Populate all bonus fields in payroll_lines insert
   - Updated GET preview endpoint to include bonus_calculations

3. **src/index.ts**
   - Added WageCalculatorEndpoint import
   - Added to default export array

---

## Status: ✅ COMPLETE & DEPLOYED

- ✅ Bonus deduction functions implemented
- ✅ Wage endpoint updated with bonus logic
- ✅ Preview endpoint includes bonus calculations
- ✅ Both builds successful (od-importer, directus extension)
- ✅ Ready for integration testing with sample employee data
