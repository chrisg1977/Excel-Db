# EOS Open Dental Validation Run Guide

## Purpose

Run [sql/eos_opendental_validation_pack_v1.sql](/c:/Users/User/Excel-Db/sql/eos_opendental_validation_pack_v1.sql) against the live Open Dental database before real EOS API wiring.

This pack exists to confirm live-schema facts that the current EOS planning depends on:
- which clinic identifier the backend should use
- which datetime field can support true report-window filtering
- which data defines dental production for EOS
- how to group raw procedure data into one patient-visit row

Do not implement the final API until these points are validated.

## Execution Guidance

1. Connect to the live Open Dental database with a read-only user if available.
2. Open [sql/eos_opendental_validation_pack_v1.sql](/c:/Users/User/Excel-Db/sql/eos_opendental_validation_pack_v1.sql) in your SQL client.
3. Set the session variables at the top of the file:
   - `@clinic_code`
   - `@clinic_num`
   - `@department_code`
   - `@report_start_at`
   - `@report_end_at`
4. Run the pack section by section, not all at once.
5. Start with the `INFORMATION_SCHEMA.COLUMNS` and `INFORMATION_SCHEMA.TABLES` queries in each section.
6. Only run the candidate follow-up queries after the metadata confirms the referenced tables and columns exist.
7. Save screenshots or exported results for each section so the backend query decisions can be reviewed once, then locked down.

Read-only reminder:
- This pack is discovery-only.
- It should run only `SELECT` queries.
- Do not add `INSERT`, `UPDATE`, `DELETE`, `ALTER`, or other schema-changing statements.

## Result Interpretation Checklist

### Clinic Mapping

Look for:
- the actual clinic table name
- the real clinic key column, usually something like `ClinicNum`
- whether a clinic code or label exists directly in Open Dental, or only a clinic name

Confirm:
- whether EOS should filter by `clinic_num` internally
- how `MDCZ`, `MDCQ`, and any future codes map to live clinic records

### Datetime Source Validation

Look for:
- whether `procedurelog.ProcDate` is `DATE` only or true datetime
- whether appointment tables contain a reliable intra-day datetime field
- whether procedures can be tied back to an appointment datetime safely

Confirm:
- the final report-window field for `report_start_at` and `report_end_at`
- whether appointment datetime is required for true shift-window filtering

### Production Definition Validation

Look for:
- which `procedurelog` columns represent status and monetary amount
- whether `ProcStatus = 2` correctly represents completed production in the live system
- whether `ProcFee` is the right amount for EOS production, or whether adjustments/writeoffs require a different source

Confirm:
- the exact production source definition the API must sum

### Patient Identity Validation

Look for:
- whether EOS should display `PatNum`, `ChartNumber`, or another patient-facing number
- the correct surname and name columns for display

Confirm:
- the final source for `patient_number`, `surname`, and `name`

### Provider Validation

Look for:
- the actual provider table
- the correct provider key
- the display-name columns used in the live schema

Confirm:
- what should populate the `provider` field in the API response
- how grouped visits should behave if more than one provider appears in the same visit

### Treatment Description Validation

Look for:
- the table that stores procedure code text and human-readable descriptions
- whether the frontend should display abbreviated codes, descriptions, or both

Confirm:
- the source field used to build the concatenated `treatments` string

### Grouping-Key Validation

Look for:
- any direct link between procedures and appointments
- appointment identifiers or visit-level identifiers
- whether grouping by patient plus appointment datetime is reliable

Confirm:
- the backend strategy for `patient_visit_key`
- whether grouping can be appointment-based, or needs a fallback composite key

## Critical Decision Points

The review must answer these questions before backend implementation:

1. What exact live field defines the EOS report window?
   - If `ProcDate` is only date-level, it is not enough for intra-day EOS filtering.

2. What exact key defines one patient visit?
   - Prefer an appointment/visit identifier if it exists and joins cleanly to production rows.

3. What exact production amount and status rules should be summed?
   - The backend must know whether `procedurelog` + `ProcStatus = 2` + `ProcFee` is correct, or whether another source is required.

## Recommended Next Action

After the live results are reviewed:

1. Update [sql/eos_dental_grouped_production_planning_v1.sql](/c:/Users/User/Excel-Db/sql/eos_dental_grouped_production_planning_v1.sql) with validated table names, joins, datetime source, and grouping rules.
2. Lock the final backend response contract from [EOS_PRODUCTION_API_BACKEND_NOTE.md](/c:/Users/User/Excel-Db/EOS_PRODUCTION_API_BACKEND_NOTE.md).
3. Only then implement the real EOS production API.
