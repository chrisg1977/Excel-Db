## PAYROLL 1 PROCESSING RULES & CONFIGURATION

**Last Updated:** 2026-02-18  
**Status:** Active  
**Scope:** Full-time (FT) and Part-time/Casual (PT/PT_CASUAL) employees

---

## 📋 **FULL-TIME EMPLOYEES (FT)**

### Payment Schedule
- **Payment Date:** Last Friday of each month
- **Payment Period:** Data from **PREVIOUS month**
- **Example:** 
  - February payroll (issued last Fri of Feb) = January data
  - March payroll (issued last Fri of Mar) = February data

### Data Period
| Month | Payment Date | Data Period | Includes |
|-------|--------------|-------------|----------|
| Jan | 31 Jan (Fri) | Dec 1-31 | Leave, bonuses, pay from Dec |
| Feb | 28 Feb (Fri) | Jan 1-31 | Leave, bonuses, pay from Jan |
| Mar | 31 Mar (Fri) | Feb 1-28 | Leave, bonuses, pay from Feb |

### Leave Processing
- Reported from: 1st to end of **previous month**
- Example: Feb payroll shows leave taken Jan 1-31

### Bonuses
- Calculated from: **Previous month data**
- Example: Feb bonus = mediatrix data from Jan

### Pay Changes
- **Effective Field Required:** `pay_change_effective_from` (DATE)
- Pay changes only apply from the specified date onward
- For FT: Affects that month onwards when processing previous month's data
- Example: If pay increase effective 15-Jan, Feb payroll (Jan data) gets partial/full increase depending on implementation

---

## 📋 **PART-TIME / CASUAL EMPLOYEES (PT, PT_CASUAL)**

### Payment Schedule
- **Payment Date:** First Friday of **FOLLOWING month** (max Saturday if Friday not suitable)
- **Payment Window:** 1st-7th of following month
- **Example:**
  - February PT payroll = issued March 1-7
  - March PT payroll = issued April 1-7

### Data Period
- Uses **ACTUAL month data** (unlike FT)
- Timesheets from 1st to last day of the month

### Data Collection
| Month | Payment Date | Data Period | Hours From | Processing |
|-------|--------------|-------------|------------|------------|
| Jan | Feb 1-7 | Jan 1-31 | Actual TS | Real hours worked |
| Feb | Mar 1-7 | Feb 1-28 | Actual TS | Real hours worked |
| Mar | Apr 1-7 | Mar 1-31 | Actual TS | Real hours worked |

### HR Processing
- HR gets time between month end and payment date to verify timesheets
- Example: Feb hours worked Jan 1-31, HR checks Jan 1-7, payment issued Jan 1-7 (but this seems wrong - need clarification)

---

## 📋 **YEAR ROLLOVER**

### Leave Entitlements
- **Balance Tracking Required:** Actual balance carryover to next year
- Need to track:
  - Leave taken in year (Jan-Dec)
  - Leave accrued in year
  - Leave balance at Dec 31
  - Carryover rules (max days allowed to carry, forfeiture rules)

### Bonus Calculation
- Rolling data from previous month continues into new year
- Jan payroll (paid last Fri Jan) uses Dec data from **previous year**

---

## 🔄 **PAYROLL PROCESSING WORKFLOW**

### FT Processing (Monthly)
```
1. Identify: All employees with employment_type = 'FT'
2. Determine: Last Friday of current month
3. Query: Leave, bonuses, pay data from [previous month start] to [previous month end]
4. Calculate: Gross salary, deductions, net pay
5. Apply: Pay changes where pay_change_effective_from <= data_start_date
6. Generate: Payslip with "Payment Date: [Last Fri]"
7. Status: Ready for payment on last Friday
```

### PT/Casual Processing (Monthly)
```
1. Identify: All employees with employment_type IN ('PT', 'PT_CASUAL')
2. Determine: First Friday of FOLLOWING month (1st-7th window)
3. Query: Actual timesheets [first day] to [last day of current month]
4. HR Step: Check and verify timesheets (between month end and payment date)
5. Calculate: Hours × rate, deductions
6. Generate: Payslip with "Payment Date: [1st-7th of next month]"
7. Status: Issued once HR approves timesheets
```

---

## 🗂️ **DATABASE SCHEMA CONSIDERATIONS**

### Required Fields - Employee Table
- [ ] `employment_type` - Values: 'FT', 'PT', 'PT_CASUAL', etc.
- [ ] `hourly_rate` (for PT/Casual) OR `monthly_salary` (for FT)
- [ ] `pay_change_effective_from` (DATE) - When pay change takes effect

### Required Fields - Payroll Entry Table
- [ ] `payroll_period_start` - First day of data period
- [ ] `payroll_period_end` - Last day of data period
- [ ] `payment_date` - Actual/scheduled payment date
- [ ] `processing_type` - 'FT_SALARY' or 'PT_HOURS'
- [ ] `status` - 'draft', 'calculated', 'approved', 'paid', 'disputed'

### Required Fields - Pay Changes Table
- [ ] `emp_id` 
- [ ] `old_salary` / `old_rate`
- [ ] `new_salary` / `new_rate`
- [ ] `pay_change_effective_from` (DATE)
- [ ] `reason` / `notes`
- [ ] `created_date`

### Required Relations
- Payroll Entry → Employee (many-to-one)
- Payroll Entry → Pay Period (many-to-one)
- Leave entries must link to payroll period
- Timesheet entries must link to payroll period
- Bonuses must link to previous month's data

---

## 📊 **PAYROLL CALENDAR EXAMPLE - 2026**

| Month | Payroll Type | Data Period | Payment Date | Status |
|-------|--------------|-------------|--------------|--------|
| January | FT | Dec 1-31 | 31 Jan (Fri) | Ready |
| January | PT | 1-31 Jan | 1-7 Feb | Ready |
| February | FT | 1-28 Jan | 28 Feb (Fri) | Ready |
| February | PT | 1-28 Feb | 1-7 Mar | Ready |
| March | FT | 1-28 Feb | 31 Mar (Fri) | Pending |
| March | PT | 1-31 Mar | 1-7 Apr | Pending |

---

## ⚠️ **EDGE CASES & VALIDATIONS**

### 1. Pay Changes Mid-Month
- FT: If pay changes on 15th of month, affects next payroll (which uses current month's data)
- PT: If pay changes on 15th, affects current payroll (uses actual month data)

### 2. New Employees
- First month: Process from hire date only
- Leave: Pro-rata based on start date

### 3. Terminated Employees
- Include in payroll up to and including last working day
- Final payslip issued same schedule as employment type

### 4. Leave Carryover
- **At Dec 31:** Finalize leave taken vs. entitled
- **At Jan 1:** New year balance = (Entitled - Taken + Carryover)

### 5. FT Year-End Considerations
- Dec payroll uses Nov data (if paid 31 Dec, it's last Friday)
- Jan payroll uses Dec data (includes Dec holidays/year-end bonuses)

---

## 📝 **QUESTIONS FOR CLARIFICATION**

- [ ] What's the carryover rule for unused leave? (e.g., max 10 days, rest forfeited?)
- [ ] How are bonuses calculated in detail? (percentage? fixed amount? conditions?)
- [ ] Are there other employment types beyond FT, PT, PT_CASUAL?
- [ ] How do public holidays affect both FT and PT calculations?
- [ ] What's the pay_change_effective_from behavior for retroactive changes?
- [ ] Are there other payrolls besides Payroll 1? (You mentioned discussing later)

