# OpenDental Import Service

This service imports OpenDental (MySQL) data into Directus Postgres tables.

## What It Does

### Timesheet events
- Reads OpenDental `clockevent` rows for a date range
- Maps OpenDental `UserNum` to Directus employees via `od_user_map`
- Upserts rows into `timesheet_events` (idempotent by `source_clockevent_num`)
- Writes import stats to `import_log`

### Provider production (fees earned)
- Reads OpenDental `procedurelog` rows for completed procedures (`ProcStatus = 2`)
- Filters by clinician/provider (`od_prov_num`) and month by default (or explicit date range)
- Optionally filters/splits by clinic
- Upserts rows into raw ledger `od_provider_production`
- Writes import stats to `od_provider_production_import_log`

## Prerequisites

- OpenDental MySQL access
- Directus Postgres connection string
- Schema applied from:
  - `sql/od_timesheets_schema.sql`
  - `sql/od_provider_production_schema.sql`
  - `sql/provider_payroll_o3p_admin_reclass.sql` (for O3P/admin-only reclassification patch)
  - `sql/provider_cash_pending_schema.sql` (pending negative cash carry-forward)
  - `sql/provider_documents_schema.sql` (canonical naming and storage registry for payslips/invoices/scans)

## Setup

1. By default, the service loads env vars from `M:\.env` if it exists.
2. To override the path, set `OD_ENV_PATH` before starting the service.
3. Or copy `.env.example` to `.env` in this folder and run here.
4. Install dependencies.
5. Build and run.

## Commands

```bash
set OD_ENV_PATH=M:\.env
npm install
npm run build
npm run start
```

## API

### 1) Timesheets import

`POST /api/od/timesheets/import`

Payload:

```json
{
  "date_from": "2026-02-01",
  "date_to": "2026-02-15",
  "employee_ids": [2018001, 2018002],
  "dry_run": false
}
```

### 2) Provider production import

`POST /api/od/provider-production/import`

Payload (month-default behavior):

```json
{
  "period_month": "2026-03",
  "od_prov_num": 29,
  "dry_run": false
}
```

Payload (explicit date range + clinic split):

```json
{
  "date_from": "2026-03-01",
  "date_to": "2026-03-31",
  "od_prov_num": 29,
  "clinic_nums": [1, 2],
  "split_by_clinic": true,
  "dry_run": false
}
```

### 3) Provider dues preview (fees - lab fees + settlement split)

`POST /api/od/provider-dues/preview`

Payload example (tiered production/lab rules, non-main flow):

```json
{
  "provider_production_total": 12800,
  "lab_fees_total": 2200,
  "production_rule": {
    "mode": "TIERED",
    "tiers": [
      { "up_to_eur": 5000, "percent": 50 },
      { "up_to_eur": null, "percent": 60 }
    ]
  },
  "lab_rule": {
    "mode": "FLAT",
    "percent": 50
  },
  "is_subscribed_main_payroll": false,
  "official_bank_transfer_input": 5000,
  "bank_fees": 15.50,
  "cash_rounding_unit": 10,
  "cash_rounding_mode": "UP"
}
```

### 4) Provider payslip preview (layout-ready payload, no logos/emp info)

`POST /api/od/provider-payslip/preview`

This payload returns the statement sections aligned with your workbook format:
- left column: Date / Day / Amount + total fees
- middle section: fee share %, lab share, other expenses, payslip/bank transfer, cash and pending carry
- right column: other expenses lines
- lab fees section rows

Style flags are fixed as `show_logo=false`, `show_employer_info=false`, `show_employee_info=false`.

```json
{
  "period_label": "Jan-26",
  "provider_name": "Lucia Carini",
  "fee_share_percent": 60,
  "total_fees": 10035,
  "production_lines": [
    { "date": "2026-01-01", "day": "Thu", "amount": 0 },
    { "date": "2026-01-07", "day": "Wed", "amount": 300 }
  ],
  "lab_fee_lines": [
    { "dentist": "LC", "patient": "Fabrizia Cuomo", "job_number": "28480", "fee": 40 }
  ],
  "lab_share_percent": 60,
  "other_expense_lines": [
    { "category": "Fuel", "amount": 120 },
    { "category": "Insurance", "amount": 80 }
  ],
  "payslip_value_or_bank_transfer": 4337.36,
  "bank_fees": 12.45,
  "previous_pending_cash": 0,
  "cash_rounding_unit": 10,
  "cash_rounding_mode": "UP"
}
```

### 5) Provider document plan (print payslip + invoice pathing)

`POST /api/od/provider-documents/plan`

Rules implemented:
- Payslips saved separately from main payroll in: `YYYY Provider Payslips/<month>`
- For non-main providers, invoice is also planned in:
  `YYYY Running Invoices/third party providers/<month>`
- Reserved invoice numbers by month: `001/YYYY`..`012/YYYY` (Jan..Dec).

```json
{
  "provider_id": "2018002",
  "provider_name": "Lucia Carini",
  "period_year": 2026,
  "period_month": 1,
  "is_subscribed_main_payroll": false,
  "root_directory": "D:/PayrollDocs"
}
```

### 6) Register scanned signed document (DB-driven canonical naming)

`POST /api/od/provider-documents/register-scan`

This ignores the original file name for final naming and always stores the database-decided canonical file name/path.

```json
{
  "provider_id": "2018002",
  "period_year": 2026,
  "period_month": 1,
  "document_type": "THIRDPARTY_PROVIDER_INVOICE_SIGNED",
  "source_filename": "scan123.pdf",
  "uploaded_by": "manager",
  "root_directory": "D:/PayrollDocs"
}
```

### 7) Third-party provider invoice preview (format like sample)

`POST /api/od/provider-invoice/preview`

This generates a simple invoice payload aligned with your sample format:
- provider header (name, address, phone)
- invoice date and invoice no
- bill-to block
- one detail line (`Services provided during <period>`)
- total due
- bank remittance block (beneficiary, bank, BIC/SWIFT, IBAN)

```json
{
  "issuer_name": "Dr Eisle Baroni",
  "issuer_address_lines": ["Karmelo Ritchie, Aurora Court 147", "Xghajra, Malta"],
  "issuer_phone": "+35677719114",
  "invoice_number": "001/2026",
  "invoice_date": "30.01.2026",
  "bill_to_lines": ["Chris Gauci", "7", "Sanctuary Street", "Zabbar ZBR 1010"],
  "service_period_label": "Jan 2026",
  "currency": "EUR",
  "official_amount": 792.50,
  "bank_details": {
    "beneficiary": "Eisle Baroni",
    "bank_name": "BNF",
    "bic_swift": "BNIFMTMT",
    "iban": "MT53BNIF14502000000000683159101"
  }
}
```
