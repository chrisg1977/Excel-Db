# Leave Entitlements System Implementation (February 2026)

## Overview
Implemented comprehensive leave entitlements calculation system with:
- Annual leave (VL) base: 192 hours + adjustments for public holidays
- Sick leave (SL) base: 80 hours minimum
- Pro-rata adjustments based on employment period and type
- Unpaid leave reduces entitlement
- Integrated into wage calculation engine

---

## Leave Entitlements Structure (2026)

### Annual Vacation Leave (VL): 192 Hours Base
**Components:**
1. **Base entitlement**: 192 hours/year (standard)
2. **Public holiday in-lieu (Sunday)**: +16 hours
   - 2 Sundays in 2026: 7 June (Sette Giugno), 13 December (Republic Day)
   - Employees don't normally work Sundays, so these are paid as in-lieu hours
3. **Public holiday in-lieu (Saturday)**: +8 hours (if applicable)
   - 1 Saturday in 2026: 15 August (Feast of the Assumption)
   - Only applies to employees with `works_saturdays = FALSE`
   - Currently: Michaela Camilleri (excludes Saturdays + potentially Sundays)

**2026 Malta Public Holidays (14 total):**
- Weekdays (11): Jan 1, Feb 10, Mar 19, Mar 31, Apr 3, May 1, Jun 29, Sep 8, Sep 21, Dec 8, Dec 25
- Saturdays (1): Aug 15
- Sundays (2): Jun 7, Dec 13

**Calculation Example:**
- Full-time employee (works Mon-Fri, no Sat/Sun exclusion): 192 + 16 = **208 hours/year VL**
- Michaela Camilleri (no Sat work): 192 + 16 + 8 = **216 hours/year VL** (potentially +8 more if no Sunday work)

### Annual Sick Leave (SL): 80 Hours Base
- Minimum statutory entitlement: 80 hours/year
- First 3 days (24 hours): employer pays 100% (no SS contribution)
- Further days: employer pays (full amount - SS benefit minus)
- Full week absence (Mon-Sun, starting Monday): employer pays only first 3 days, no SS contributions from either party
- Applied to MAIN payroll only

---

## Employment Types & Entitlements

**MAIN Payroll (Fiscal, Bank Transfer):**
- Permanent employees: **FULL VL & SL entitlements**
- Casual part-time (SS Classes A-F): **FULL VL & SL entitlements**
- Contract/Seasonal: **FULL VL & SL entitlements**

**PROVIDER & THIRDPARTY Payrolls (Non-fiscal):**
- All employees: **ZERO entitlements**
- No VL, no SL, no government bonuses, no mediatrix bonuses
- No taxes paid either (separate payroll stream)

---

## Pro-Rata Calculation

### Full-Time Employees
- **Method**: Days employed in year / 365 days
- **Applied to**: All entitlements (VL, SL)
- **Formula**: (employment_end_date - employment_start_date + 1) / 365

### Part-Time Employees
- **Method**: Hours employed / full-time equivalent hours
- **Applied to**: Scaled down based on weekly hours contracted
- **Formula**: (part_time_hours / 40) × annual_entitlement

### Examples

**Permanent employee, employed full year (Jan 1 - Dec 31):**
- Pro-rata factor: 365/365 = 1.0
- VL entitlement: 192 + 16 = **208 hours**
- SL entitlement: **80 hours**

**Employee hired mid-year (Mar 1):**
- Days employed: 306 (Mar 1 - Dec 31)
- Pro-rata factor: 306/365 = 0.838
- VL entitlement: (192 + 16) × 0.838 = **174 hours**
- SL entitlement: 80 × 0.838 = **67 hours**

**Part-time employee hired full year (20 hrs/week vs 40 hrs/week):**
- Pro-rata factor: 20/40 = 0.5
- VL entitlement: 208 × 0.5 = **104 hours**
- SL entitlement: 80 × 0.5 = **40 hours**

---

## Unpaid Leave Impact

**Rule**: Unpaid leave reduces annual entitlement

**Logic:**
1. Calculate full pro-rata entitlement
2. Subtract unpaid leave hours taken YTD
3. Result: Adjusted entitlement
4. Calculate remaining balance: Adjusted - Used

**Example:**
- Pro-rata VL entitlement: 208 hours
- Unpaid leave taken YTD: 40 hours
- Adjusted VL entitlement: 208 - 40 = **168 hours**
- VL used YTD: 50 hours
- Remaining VL: 168 - 50 = **118 hours**

---

## Database Schema

### public_holidays Table
Stores all public holidays with day-of-week and in-lieu hour adjustments.

**Columns:**
- `holiday_date` (DATE, UNIQUE)
- `holiday_name` (VARCHAR)
- `day_of_week` (MON | TUE | WED | THU | FRI | SAT | SUN)
- `hours_adjustment` (0 for weekdays, 8 for Sat/Sun, 16 for dual holidays)
- `is_active` (BOOLEAN)

**2026 Data:**
- 14 public holidays loaded
- 2 Sundays (in-lieu +16 hrs each)
- 1 Saturday (in-lieu +8 hrs, if applicable)
- 11 weekdays (counts as work days, not leave)

### leave_entitlements_config Table
Stores annual base leave entitlements per year.

**Columns:**
- `config_year` (INTEGER, UNIQUE)
- `vacation_leave_base_hours` (192 for 2026)
- `sick_leave_base_hours` (80 for 2026)
- `public_holiday_inlieu_sunday_hours` (16)
- `public_holiday_inlieu_saturday_hours` (8)

### Views

**vw_leave_entitlements_annual**
- Calculates annual leave entitlement per employee
- Full year amount (base + public holiday adjustments)
- Considers Saturday/Sunday work schedule

**vw_leave_balance_ytd**
- Current leave balance for each employee in a given year
- VL/SL used YTD
- Unpaid leave reduction
- Remaining balance
- Flags if exceeded

**vw_leave_prorata_for_payroll**
- Pro-rata entitlements for partial employment periods
- Days/hours employed in year
- Pro-rata factor (0-1)
- Adjusted entitlements

---

## Integration with Wage Calculation

### Endpoint: POST /payroll/calculate-wages

**New Behavior:**
1. Fetch employee wage and timesheet data (existing)
2. **Calculate leave entitlements for the year** (NEW)
   - Determine employment type and period
   - Fetch pro-rata entitlements
   - Calculate YTD leave usage
   - Reduce by unpaid leave taken
   - Check if exceeded
3. Validate leave usage and collect violations (NEW)
4. Write payroll_lines with all information (existing)

**Response Now Includes:**
```json
{
  "leave_entitlements": {
    "employment_type": "PERMANENT",
    "has_no_entitlement": false,
    "vl_prorata_hours": 208.0,
    "sl_prorata_hours": 80.0,
    "vl_adjusted_after_unpaid": 168.0,  // Reduced by unpaid leave
    "sl_adjusted_after_unpaid": 80.0,
    "vl_used_ytd": 50.0,
    "sl_used_ytd": 10.0,
    "vl_remaining": 118.0,
    "sl_remaining": 70.0,
    "days_employed_in_year": 365,
    "prorata_factor": 1.0
  },
  "leave_violations": [
    {
      "type": "VL_EXCEEDED",
      "message": "Vacation Leave exceeded by 20 hours...",
      "hours_over": 20.0
    }
  ]
}
```

### Endpoint: GET /payroll/calculate-wages/:emp_id/:year/:month

**Preview now includes:**
- Full leave entitlements breakdown
- Any violations flagged
- Dry-run (no database writes)

### TypeScript Modules

**od-importer/src/leave-calculator.ts**
- `calculateLeaveEntitlements()`: Main function to calculate annual entitlements
- `hasLeaveEntitlement()`: Check if payroll type/employment type has entitlements
- `validateLeaveUsage()`: Return array of violations
- Types: `LeaveEntitlementInput`, `LeaveEntitlementOutput`, `LeaveViolation`

---

## Payroll Processing Rules

### MAIN Payroll
- **VL Entitlement**: YES (192 + adjustments, pro-rata, less unpaid)
- **SL Entitlement**: YES (80 hours, pro-rata, less unpaid)
- **Leave Usage Validation**: YES (flags if exceeded)
- **Govern Bonuses**: YES (June, December, March/Sept allowances)
- **Taxes**: YES (calculated normally)

### PROVIDER Payroll
- **VL Entitlement**: NO (0 hours)
- **SL Entitlement**: NO (0 hours)
- **Government Bonuses**: NO
- **Mediatrix Bonuses**: NO
- **Taxes**: NO

### THIRDPARTY Payroll
- Same as PROVIDER: zero entitlements, no bonuses, no taxes
- Used for HR to manage temporary/external contractors

---

## Employee Schedule Exclusions

### Works_Saturdays Column
- `TRUE` (default): Employee works 5-day week (Mon-Fri)
- `FALSE`: Employee doesn't work Saturdays
  - Saturday public holidays count as in-lieu VL hours (+8)
  - Example: Michaela Camilleri

### Works_Sundays Column (Future)
- `TRUE`: Employee works Sundays (potentially)
- `FALSE` (default): Employee doesn't work Sundays
  - Sunday public holidays count as in-lieu VL hours (+16)
  - When Sundays are excluded, employees get additional in-lieu for Sunday holidays

---

## Status: ✅ COMPLETE & DEPLOYED

**Schema Created:**
- ✅ public_holidays (14 × 2026 holidays)
- ✅ leave_entitlements_config (2026 base rates)
- ✅ vw_leave_entitlements_annual (full-year calc)
- ✅ vw_leave_balance_ytd (current balance)
- ✅ vw_leave_prorata_for_payroll (pro-rata calc)

**Code Implemented:**
- ✅ od-importer/src/leave-calculator.ts (core logic)
- ✅ src/endpoints/wage-calculator.ts (integration)
- ✅ POST /payroll/calculate-wages (with leave info)
- ✅ GET /payroll/calculate-wages/:emp/:year/:month (preview)

**Builds:**
- ✅ od-importer compilation successful
- ✅ Directus extension build successful

**Ready For:**
- Testing with sample employees
- Running full month payroll calculations
- Flagging leave entitlement violations
- Generating payslips with leave breakdown
