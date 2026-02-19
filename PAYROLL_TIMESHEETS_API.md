# Payroll Timesheets API Documentation

## Endpoints Summary

### 1. **Import Timesheets from CSV**
```
POST /payroll/timesheets/import-csv
Content-Type: application/json

Request Body:
{
  "csv_data": "emp_id,work_date,hours,hour_type,notes\n2018001,2026-02-01,8,WORK,Normal day\n2018001,2026-02-03,8,SICK_LEAVE,Flu",
  "import_source": "CSV"  // optional, defaults to "CSV"
}

Response (Success):
{
  "status": "success",
  "inserted": 2,
  "total_rows": 2,
  "errors": undefined
}

Response (Partial Success with Errors):
{
  "status": "success",
  "inserted": 1,
  "total_rows": 2,
  "errors": [
    {
      "row": 3,
      "error": "Employee 9999999 not found"
    }
  ]
}
```

### 2. **Import from OpenDental (Placeholder - Not Yet Implemented)**
```
POST /payroll/timesheets/import-opendental
Content-Type: application/json

Request Body:
{
  "start_date": "2026-02-01",
  "end_date": "2026-02-28",
  "opendental_api_url": "https://your-dental.com/api",
  "api_key": "your-api-key"
}

Response (Not Yet Implemented):
{
  "status": "not_implemented",
  "message": "OpenDental API integration not yet configured",
  "instructions": "Please provide OpenDental API documentation so we can implement the connector"
}
```

### 3. **List Timesheets**
```
GET /payroll/timesheets?emp_id=2018001&start_date=2026-02-01&end_date=2026-02-28&hour_type=WORK

Query Parameters (all optional):
- emp_id: Filter by employee ID
- start_date: Filter from date (YYYY-MM-DD)
- end_date: Filter to date (YYYY-MM-DD)
- hour_type: Filter by type (WORK, SICK_LEAVE, VACATION_LEAVE, UNPAID_LEAVE, MATERNITY)

Response:
{
  "count": 5,
  "timesheets": [
    {
      "id": 1,
      "emp_id": 2018001,
      "work_date": "2026-02-01",
      "hours": 8,
      "hour_type": "WORK",
      "leave_status": null,
      "source": "CSV",
      "notes": "Normal day",
      "import_date": "2026-02-16T10:30:00Z",
      "created_at": "2026-02-16T10:30:00Z",
      "updated_at": "2026-02-16T10:30:00Z"
    },
    ...
  ]
}
```

### 4. **Get Monthly Summary (For Payroll Calculation)**
```
GET /payroll/timesheets/summary/:emp_id/:year/:month

Example:
GET /payroll/timesheets/summary/2018001/2026/2

Response:
{
  "emp_id": 2018001,
  "payroll_month": "2026-02-01",
  "summary": {
    "hours_worked": 168,                    // Only actual work hours
    "paid_sick_leave_hours": 8,             // Within entitlement
    "unpaid_sick_leave_hours": 0,           // Over entitlement
    "paid_vacation_leave_hours": 8,         // Within entitlement
    "unpaid_vacation_leave_hours": 0,       // Over entitlement
    "unpaid_leave_hours": 0,                // Unpaid leave (no entitlement)
    "total_paid_hours": 176,                // wages paid for 176 hours
    "total_hours_logged": 176,              // Total hours recorded
    "bonus_calculation_factor": 0.9545      // 168 / 176 = 95.45% of full bonus
  }
}
```

**Note on Bonus Calculation Factor:**
- Only actual work hours count toward bonus qualification
- If employee worked 168 hours and took 8 hours paid leave: bonus = full_amount × 0.9545
- If employee took unpaid leave: still counts in hours_worked calculation, but leave_status=UNPAID

### 5. **Update a Timesheet**
```
PATCH /payroll/timesheets/:id
Content-Type: application/json

Request Body:
{
  "hours": 8,
  "hour_type": "WORK",
  "notes": "Updated note"
}

Response:
{
  "message": "Timesheet updated",
  "timesheet": {
    "id": 1,
    "emp_id": 2018001,
    "work_date": "2026-02-01",
    "hours": 8,
    "hour_type": "WORK",
    "updated_at": "2026-02-16T12:00:00Z"
  }
}
```

### 6. **Delete a Timesheet**
```
DELETE /payroll/timesheets/:id

Response:
{
  "message": "Timesheet deleted",
  "id": 1
}
```

---

## CSV Import Format

**Required Columns:**
- `emp_id`: Employee ID (integer)
- `work_date`: Date in YYYY-MM-DD format
- `hours`: Hours worked (decimal)
- `hour_type`: One of: WORK, SICK_LEAVE, VACATION_LEAVE, UNPAID_LEAVE, MATERNITY
- `notes`: Optional description

**Example CSV:**
```
emp_id,work_date,hours,hour_type,notes
2018001,2026-02-01,8,WORK,Normal day
2018001,2026-02-02,8,WORK,Normal day
2018001,2026-02-03,8,SICK_LEAVE,Flu
2018001,2026-02-04,8,VACATION_LEAVE,Annual leave
2018002,2026-02-01,4,WORK,Half day
2018002,2026-02-02,8,WORK,Normal day
```

---

## Hour Types Explained

| Type | Description | Paid? | Affects Bonus? |
|------|-------------|-------|---|
| **WORK** | Regular work hours | Yes | ✓ Counts toward bonus |
| **SICK_LEAVE** | Sick leave (if within entitlement) | if paid | ✗ Does NOT count toward bonus |
| **VACATION_LEAVE** | Annual vacation (if within entitlement) | if paid | ✗ Does NOT count toward bonus |
| **UNPAID_LEAVE** | Unpaid absence | No | ✗ Does NOT count toward bonus |
| **MATERNITY** | Maternity leave (paid/unpaid per policy) | if paid | ✗ Does NOT count toward bonus |

---

## Leave Status Determination

The system automatically determines if leave is **PAID** or **UNPAID** based on:

1. **Annual Entitlements** (in `leave_entitlements` table):
   - `vacation_leave_hours`: Annual VL entitlement (e.g., 192 hours/year)
   - `sick_leave_hours`: Annual SL entitlement (e.g., 80 hours/year)

2. **YTD Usage**:
   - If `vl_taken_hours < vl_entitlement_hours` → **PAID**
   - If `vl_taken_hours >= vl_entitlement_hours` → **UNPAID**
   - Same logic for sick leave

3. **Carryover**:
   - Carryover hours from previous year count toward current year entitlement

---

## Database Schema

### timesheets
Stores individual day/shift records
- `id`: Primary key
- `emp_id`: FK to employees
- `work_date`: Date of work
- `hours`: Hours worked
- `hour_type`: WORK | SICK_LEAVE | VACATION_LEAVE | UNPAID_LEAVE | MATERNITY
- `leave_status`: PAID | UNPAID (auto-calculated)
- `source`: OPENDENTAL | CSV | MANUAL
- `notes`: Optional notes

### leave_entitlements
Tracks annual leave limits per employee per year
- `emp_id`: FK to employees
- `year`: Year (e.g., 2026)
- `vacation_leave_hours`: Total VL entitlement
- `sick_leave_hours`: Total SL entitlement
- `vacation_leave_used`: YTD used
- `sick_leave_used`: YTD used
- Plus carryover and maternity fields

### VIEW: timesheet_summary_monthly
Pre-calculated monthly summaries (by emp_id + month)
- Groups timesheets by month
- Separates paid vs unpaid leave
- Calculates bonus factor automatically

---

## Next Steps

1. **Populate leave_entitlements** table with employee annual allocations
2. **Configure OpenDental Integration** (once API docs provided)
3. **Implement Wage Calculation Engine** (uses timesheet_summary data)
4. **Implement Bonus Calculations** (uses bonus_calculation_factor)
