# EOS Production API Backend Note

Purpose: document the grouped-row extraction contract before writing any real Open Dental SQL.

## Suggested Endpoint

`GET /api/eos/production-visits`

This endpoint should return EOS production rows already grouped for frontend display.

## Required Filters

Accepted query filters:

- `clinic_code` or `clinic_num`
- `report_start_at`
- `report_end_at`
- `department_code`

Notes:

- Prefer `clinic_code` at the frontend/backend contract boundary.
- `clinic_num` may still be supported if the backend needs direct Open Dental clinic mapping.
- `report_start_at` and `report_end_at` should define the exact report window used by EOS.

## Response Contract

Each returned row should follow this shape:

```json
{
  "time": "08:15",
  "patient_number": "25332",
  "surname": "Borg",
  "name": "Maria",
  "treatments": "Exam, X-rays",
  "provider": "Dr Ryan",
  "fee_total": 35.0,
  "clinic_code": "MDCZ",
  "department_code": "MDCZ",
  "patient_visit_key": "optional",
  "source_proc_count": 2,
  "appointment_datetime": "2026-03-11T08:15:00"
}
```

Optional fields:

- `patient_visit_key`
- `source_proc_count`
- `appointment_datetime`

## Grouping Rules

- One response row must represent one grouped patient visit / appointment occurrence within the selected clinic and report window.
- The response must not expose raw procedure lines directly to the EOS frontend grid.
- `treatments` should be a concatenated display string for the grouped visit.
- `provider` should be the display provider for the grouped visit row.
- `fee_total` should be the summed production amount for the grouped visit row.

## Internal Extraction Note

- Raw procedure extraction may still happen internally before grouping.
- Backend processing can pull raw Open Dental production/procedure rows first, then group them into the EOS response contract.

## Carry-Forward Note

- Excluded rows from the EOS frontend will later need persistence to carry-forward storage for the next shift.
- That persistence is separate from the extraction endpoint, but the grouped row contract should remain stable enough to support it.

## Future Walkout Exception Note

- Walkout/securitylog data, if added later, must only enrich existing grouped EOS visit rows and must never create new patient rows.
- If a grouped visit row has no matched walkout print, the reporting surface should display the literal text `NO WALK OUT PRINTED`.
- Missing-walkout exception reports should be saved for later retrieval and audit.
- Retrieval access for those saved reports should be restricted to management or higher.
- Whether those saved reports belong in the Handover / To Do flow or in a dedicated EOS management report should be decided separately from this extraction endpoint.
