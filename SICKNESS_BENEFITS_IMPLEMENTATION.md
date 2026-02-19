# Sickness Benefits & Public Holiday Eligibility (February 2026)

## Overview
Implemented sickness benefit deduction system and refined public holiday entitlements eligibility based on:
- SS category (A-F): Only A, B, C, D eligible for public holiday entitlements
- Family status: Determines daily sickness benefit rate (€25.81 vs €17.21)
- Employment type: MAIN payroll only (PROVIDER/THIRDPARTY excluded)

---

## Sickness Benefit Rates (2026 Malta)

### Daily Benefit Deduction (Days 4+)
Applies when employee uses sick leave beyond the first 3 days paid by employer.

**Married / Parent Categories:**
- Mar, Mar1, Mar2, Par, Par1, Par2 → **€25.81/day**

**Single / Other Categories:**
- Sng (Single), Other → **€17.21/day**

### Payment Rules
1. **Days 1-3**: Employer pays 100% (fully paid return-to-work benefit)
   - No deduction from wage
   - Employee gets full daily wage

2. **Days 4+**: Benefit deduction applies
   - Employer pays reduced amount (€25.81 or €17.21 per day)
   - Difference deducted from gross wage
   - Formula: (Days 4+ × benefit_rate) deducted from wage

3. **Full-Week Absence** (Mon-Sun starting Monday)
   - Special rule: No SS contributions from either party
   - Employer pays only first 3 days
   - Implementation: Tracked separately in system

### Examples

**Married employee, sick 5 days:**
- Days 1-3: Employer pays 100% (€0 deduction)
- Days 4-5: Employer pays benefit rate (€25.81/day)
- Deduction: 2 days × €25.81 = **€51.62**
- Wage reduction: Gross wage minus €51.62

**Single employee, sick 4 days:**
- Days 1-3: Employer pays 100% (€0 deduction)
- Day 4: Employer pays benefit rate (€17.21)
- Deduction: 1 day × €17.21 = **€17.21**
- Wage reduction: Gross wage minus €17.21

---

## Public Holiday Entitlements Eligibility

### Who Qualifies for Public Holiday In-Lieu Hours?
**ELIGIBLE (Get in-lieu hours added to VL):**
- SS Categories: **A, B, C, D** (full-time employees)  
- Payroll: **MAIN only**
- Holidays: Sunday (16 hours) + Saturday (8 hours, if applicable)

**NOT ELIGIBLE (No in-lieu hours):**
- SS Categories: **E, F** (students/apprentices)
- Part-timers (PT)
- PROVIDER payroll
- THIRDPARTY payroll

### 2026 Malta Public Holiday Adjustments

**Category A, B, C, D on MAIN Payroll:**
- Base VL: 192 hours
- +16 hours for 2 Sundays (Jun 7, Dec 13): **208 hours total**
- +8 additional hours if not working Saturdays (Aug 15 holiday)
- Max with no-Saturday: **216 hours VL/year**

**Category E, F, Part-timers, PROVIDER/THIRDPARTY:**
- Base VL: 192 hours
- No adjustments for public holidays
- **192 hours VL/year**

### Holiday In-Lieu Logic
```
If (SS_Class in [A, B, C, D] AND Payroll_Type = MAIN):
  For each public holiday on Sunday:
    Add 16 hours to annual VL
  For each public holiday on Saturday (only if works_saturdays = FALSE):
    Add 8 hours to annual VL
```

---

## Database Changes

### sickness_benefit_rates Table
Stores daily benefit deduction rates for employees based on family status.

**Columns:**
- `benefit_year` (INTEGER): 2026
- `family_status` (VARCHAR): MARRIED, PARENT, SINGLE, OTHER
- `daily_rate` (NUMERIC): €25.81 or €17.21

**2026 Data:**
- MARRIED: €25.81/day
- PARENT: €25.81/day
- SINGLE: €17.21/day
- OTHER: €17.21/day

### public_holidays Table (Enhanced)
Added eligibility rules to track which employees qualify.

**New Columns:**
- `applies_to_categories` (VARCHAR): 'A,B,C,D' (SS classes eligible)
- `applies_to_main_payroll_only` (BOOLEAN): TRUE (PROVIDER/THIRDPARTY excluded)

---

## Integration with Wage Calculation

### Endpoint: POST /payroll/calculate-wages

**Sickness Benefit Deduction Calculation:**
1. Fetch employee's sick leave usage YTD
2. Get sickness benefit rate based on tax family status
3. Calculate days subject to benefit (SL days 4+)
4. Calculate deduction: (days_4+ × benefit_rate)
5. Return deduction info in response

**Response Includes:**
```json
{
  "sickness_benefit_deduction": {
    "total_sick_leave_hours": 32.0,      // Total hours used YTD
    "sick_leave_days": 4,                // 32 hours / 8 = 4 days
    "days_paid_by_employer": 3,          // First 3 days (100%)
    "days_subject_to_benefit": 1,        // Days 4+ (reduced rate)
    "benefit_rate_per_day": 25.81,       // €25.81 for married/parent
    "total_benefit_deduction": 25.81,    // 1 day × €25.81
    "note": "First 3 days paid by employer (100%), days 4+ deducted at benefit rate"
  }
}
```

### Endpoint: GET /payroll/calculate-wages/:emp_id/:year/:month

**Preview Includes:**
- Public holiday eligibility: `is_eligible_for_public_holidays`
- In-lieu hours applied: `public_holidays_inlieu_hours`
- Sickness benefit deduction (same as POST endpoint)

---

## Leave Entitlements Output Fields

### Enhanced LeaveEntitlementOutput
```typescript
{
  is_eligible_for_public_holidays: boolean;     // true if A,B,C,D on MAIN
  public_holidays_inlieu_hours_applied: number; // 16, 24, 8, etc.
}
```

**Examples:**
- Category A on MAIN: `is_eligible_for_public_holidays = true`, hours = 16 (2 Sundays)
- Category E on MAIN: `is_eligible_for_public_holidays = false`, hours = 0
- Category B, PT on MAIN: `is_eligible_for_public_holidays = false`, hours = 0 (part-timer not eligible)

---

## Wage Calculation Impact

### Gross Wage → Net Wage
```
Gross Wage
- Sickness Benefit Deduction (days 4+ × rate)
= Net Wage (after SL benefit deduction)
- Taxes
- SS Contributions
= Final Net Pay
```

### Example Payroll Calculation
**Employee: Married (Mar category), Permanent, MAIN Payroll**
- Basic wage: €2,000
- Sick leave this month: 16 hours (2 days: Day 1 & 2)
- YTD sick leave: 40 hours (5 days)
  - Days 1-3: Covered (zero deduction)
  - Days 4-5: Subject to benefit deduction
- Sickness benefit rate: €25.81/day
- **Benefit deduction**: 2 days × €25.81 = **€51.62**
- Wage after SL deduction: €2,000 - €51.62 = **€1,948.38**
- Tax (based on €1,948.38)
- SS (based on €1,948.38)
- **Final net pay**: €1,948.38 - tax - SS

---

## Code Implementation

### leave-calculator.ts (od-importer)
- `isEligibleForPublicHolidayEntitlements(ssClass, payrollType)`: Check category A-F eligibility
- `getSicknessBenefitRate(pg, year, taxCategory)`: Fetch daily benefit deduction rate
- `calculateSicknessBenefitDeduction(slHours, grossWage, benefitRate)`: Calculate deduction amount
- `SicknessBenefitDeduction` type: Output structure with breakdown

### wage-calculator.ts (Directus endpoint)
- Import sickness benefit functions
- Pass ss_class and payroll_type to leave calculation
- Calculate benefit rate based on tax category
- Calculate deduction for days 4+ of sick leave
- Include in POST and GET response payloads

---

## Status: ✅ COMPLETE & DEPLOYED

**Database:**
- ✅ sickness_benefit_rates table created (4 family statuses × 2026)
- ✅ public_holidays table enhanced with eligibility rules
- ✅ All 2026 Malta holidays configured (14 total)

**Code:**
- ✅ leave-calculator.ts: Sickness benefit + eligibility functions
- ✅ wage-calculator endpoint: Integration with wage calculation
- ✅ Both POST and GET endpoints return sickness deduction

**Builds:**
- ✅ od-importer: Compiles successfully
- ✅ Directus extension: Compiles successfully

**Ready for:**
- Testing wage calculations with sick leave usage
- Validating benefit deduction amounts
- Checking public holiday eligibility by SS category
- Running full payroll with sickness benefit deductions applied
