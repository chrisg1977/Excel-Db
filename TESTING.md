# Testing Guide: Wage Calculator

## Quick Start

Use employee **2018004** for testing (Feb 2026 payroll).

### Option 1: SQL Setup (Fastest)

Run the SQL setup script directly:

```bash
psql -h localhost -p 55432 -U excel -d exceldb < sql/test_setup_2018004.sql
```

This creates:
- Employee 2018004 (40-hour full-timer, €12.50/hr)
- Wage history entry
- MAIN payroll subscription
- 20 timesheet entries (160 hours for Feb 2026)
- Payroll entry container

### Option 2: Python Setup (More Control)

```bash
cd importer
python3 setup_test_payroll.py
```

This does the same as Option 1 but with better error handling and logging.

### Option 3: Import from OpenDental (Real Data)

If you have OpenDental timesheets:

```bash
python3 import_od_timesheets.py --emp-id 2018004 --year 2026 --month 2
```

You'll need to:
1. Configure OpenDental MySQL connection in the script
2. Ensure the empinfo importer has already run (employees exist)

---

## Expected Results

**For Employee 2018004 with 160 hours @ €12.50/hr in Feb 2026:**

### Gross Earnings
```
Base wage = 40 hrs/week × €12.50/hr × (52 weeks/12 months)
         = €216.67/month
         × (160 hours actual / 173.33 contracted hours)
         = €200.00 (approximate)
```

### Contributions (Class B - €22.94 fixed)
- **SS Employee**: €22.94
- **SS Employer**: €22.94
- **MLF**: €0.69

### Tax (SIN category)
- Check `tax_rates_live` for grossing bracket
- Formula: (gross - subtract) × rate
- Typical for low income: ~0

### Net Payment
```
€200.00 (gross) - €22.94 (SS) - €X (tax) = ~€177.06
```

---

## Testing Endpoints

### 1. Preview Wages (No Insert)

**GET** `/payroll/calculate-wages/2018004/2026/2`

Returns calculation preview without inserting payroll_lines.

```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:8055/payroll/calculate-wages/2018004/2026/2 | jq
```

**Response includes:**
- Wage calculation (basic_wage, weekly_wage, ss_class, tax_deducted)
- Social security contributions (employee, employer, mlf)
- Leave entitlements summary
- Bonus calculations

### 2. Calculate Wages (Insert Payroll Lines)

**POST** `/payroll/calculate-wages`

Body:
```json
{
  "employee_id": 2018004,
  "year": 2026,
  "month": 2
}
```

```bash
curl -X POST \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"employee_id": 2018004, "year": 2026, "month": 2}' \
  http://localhost:8055/payroll/calculate-wages | jq
```

**Returns:**
- Payroll lines created
- Link to payroll_entry
- Detailed breakdown

### 3. Bulk Calculate (MAIN Only)

**POST** `/payroll/bulk-calculate-wages`

Body:
```json
{
  "year": 2026,
  "month": 2
}
```

```bash
curl -X POST \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"year": 2026, "month": 2}' \
  http://localhost:8055/payroll/bulk-calculate-wages | jq
```

**Returns:**
- Summary (total processed, failed)
- Employee results (gross, net, SS)
- Error list

### 4. Generate Payslip PDF

**GET** `/payroll/payslip/2018004/2026/2`

```bash
curl -H "Authorization: Bearer TOKEN" \
  http://localhost:8055/payroll/payslip/2018004/2026/2 \
  -o payslip_2018004_202602.pdf
```

Downloads PDF with formatted payslip showing all details.

### 5. Bulk Payslips

**POST** `/payroll/bulk-payslips`

Body:
```json
{
  "year": 2026,
  "month": 2
}
```

Generates payslips for all employees in the period.

---

## Using Python Test Runner

```bash
# Set your Directus token first
export DIRECTUS_TOKEN="your_token_here"

# Or edit the script directly and set API_TOKEN

python3 test_wage_calculator.py
```

Runs all tests sequentially:
1. Preview wages
2. Calculate & insert
3. Generate payslip PDF

---

## Verification Steps

After setup, verify data:

```sql
-- Check employee
SELECT emp_id, name, surname, contracted_hours, tax_status 
FROM employees WHERE emp_id = 2018004;

-- Check wage history  
SELECT emp_id, effective_date, hourly_rate 
FROM wage_history WHERE emp_id = 2018004 
ORDER BY effective_date DESC;

-- Check timesheets
SELECT work_date, hours, hour_type, leave_status 
FROM timesheets WHERE emp_id = 2018004 
ORDER BY work_date;

-- Check subscription
SELECT * FROM payroll_subscriptions WHERE employee_id = 2018004;

-- Check payroll lines (after calculation)
SELECT * FROM payroll_lines 
WHERE emp_id = 2018004 
ORDER BY id DESC LIMIT 1;
```

---

## Troubleshooting

### No timesheets found
→ Run SQL setup again to insert timesheet entries

### "Employee not found"
→ Verify employee 2018004 exists in `employees` table

### "No wage history found"
→ Insert wage_history record manually:
```sql
INSERT INTO wage_history (emp_id, effective_date, hourly_rate)
VALUES (2018004, '2024-01-01'::date, 12.50);
```

### SS contributions = 0
→ Check `social_security_classes` table has 2026 class B (€22.94)

### Tax = 0 unexpectedly
→ Check `tax_rates_live` has entries for year 2026

### Payslip PDF fails
→ Ensure pdfkit is installed: `pip install pdfkit`

---

## Modifying Test Data

Edit `sql/test_setup_2018004.sql` to change:
- Hourly rate (currently €12.50)
- Contracted hours (currently 40)
- Tax status (currently 'SIN')
- Timesheet hours (currently 8/day, Mon-Fri)

Then re-run: `psql ... < test_setup_2018004.sql`
