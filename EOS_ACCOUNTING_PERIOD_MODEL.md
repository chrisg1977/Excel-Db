# EOS Accounting Period Model

## Purpose

This note defines the monthly accounting-period layer for EOS so the system can replace the legacy JAN, FEB, MAR, APR, MAY, JUN, JUL, AUG, SEPT, OCT, NOV, DEC Excel sheets with a structured period model.

The period layer is intended to support:
- monthly grouping of EOS reports
- retrieval and filtering by month
- month-level locking / closing
- future migration of historical Excel month sheets into EOS-managed periods

## Entity

`eos_accounting_period`

Suggested fields:

```ts
type EosAccountingPeriod = {
  id: string;
  year: number;
  month: number;
  period_code: string;
  period_name: string;
  start_date: string;
  end_date: string;
  is_closed: boolean;
  closed_at: string | null;
  closed_by: string | null;
};
```

Field notes:
- `year`: four-digit year, for example `2026`
- `month`: numeric month `1` through `12`
- `period_code`: canonical sortable code, for example `2026-03`
- `period_name`: user-facing label, for example `MAR 2026`
- `start_date`: inclusive calendar start of the accounting period
- `end_date`: inclusive calendar end of the accounting period
- `is_closed`: whether the period is read-only for operational EOS changes
- `closed_at`: timestamp of the close action
- `closed_by`: user who closed the period

## Location / Department Context

The accounting-period layer sits on top of the real Mediatrix operating model:
- physical locations: Zabbar, Qormi, Gzira, Valletta
- only Zabbar and Qormi currently have active receptions
- each location record should include required `phone_number`

Department assignment rules still apply inside a period:
- a department keeps its physical location for reporting and accounting
- EOS shift ownership is tied to reception location
- a department may therefore belong to one physical location and another default reception location
- departments with no active reception, such as Gzira and Valletta departments, are still reported in their own physical location but their EOS work is performed through another reception location

## Relationship Rules

- Each `eos_report_header` belongs to exactly one `eos_accounting_period`.
- The accounting period is determined from `eos_report_header.report_start_at`.
- `eos_report_header` / `eos_shift_session` should preserve reception-location assignment separately from the department's physical location.
- `eos_report_header` should store either:
  - `accounting_period_id`, or
  - a derived month/year reference resolved at save time
- The preferred implementation is an explicit `accounting_period_id` foreign key on `eos_report_header`.

## Period Assignment Rule

Chosen rule:

- Assign the report to the accounting period that contains `report_start_at`.

Reason:

- EOS reports already use `report_start_at` and `report_end_at` as the controlled report window.
- The opening and extraction flow begins from the selected report start.
- This gives a single deterministic rule even for reports near midnight.

## Operational Rules

- EOS reports must not span accounting periods.
- If `report_start_at` and `report_end_at` fall in different periods, submission must be blocked.
- Closed periods are read-only.
- Management or higher can close periods.
- Period closing should happen only after review of submitted EOS reports for that month.
- Retrieval and reporting screens should allow filtering by `period_code` and `period_name`.
- Retrieval should also be able to distinguish physical department location from reception location when that becomes part of the saved EOS report/search model.

## Migration Note

- Historical Excel month sheets can later be mapped into `eos_accounting_period` records.
- A migration layer can assign imported historical EOS-style report snapshots into the matching month period based on their effective report date.
- This allows old JAN-DEC workbook structures to coexist temporarily while the new period model becomes the canonical month layer.

## Open Decisions

- Whether `end_date` should be stored as inclusive date only or paired with a conventional end-of-day timestamp in backend validation logic.
- Whether period closing should allow privileged reopen actions, and if so, how those reopen actions are audited.
- Whether draft EOS reports may exist in a closed period if they were created before close, or whether close should require all reports in the period to be submitted/locked first.
- Whether management closing permissions should be enforced through a dedicated EOS role or the broader app access-control model.
