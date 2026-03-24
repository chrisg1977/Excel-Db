# EOS Period Dashboard API Plan

## 1. GET /api/eos/periods

### Purpose

List EOS accounting periods for management/admin browsing and period selection.

### Expected Filters

- status
- business_unit_id
- location_code
- date range

### Suggested Response Shape

```json
[
  {
    "accounting_period_id": "uuid",
    "period_code": "2026-03",
    "start_at": "2026-03-01T00:00:00Z",
    "end_at": "2026-04-01T00:00:00Z",
    "status": "open"
  }
]
```

### Likely Access Rules

- management / admin only
- read-only

## 2. GET /api/eos/periods/:id/summary

### Purpose

Return summary counts and KPIs for one accounting period.

### Expected Filters

- business_unit_id
- location_code
- department_code

### Suggested Response Shape

```json
{
  "accounting_period_id": "uuid",
  "total_reports": 0,
  "submitted_reports": 0,
  "draft_reports": 0,
  "reports_with_discrepancies": 0,
  "pending_manager_reviews": 0,
  "temporary_closures_pending_review": 0,
  "abandoned_or_superseded_shifts": 0,
  "close_status": "not_ready"
}
```

### Likely Access Rules

- management / admin only
- read-only

## 3. GET /api/eos/periods/:id/reports

### Purpose

List saved EOS report snapshots for one accounting period.

### Expected Filters

- clinic_code
- department_code
- location_code
- generated_by
- report_type
- status
- limit
- offset

### Suggested Response Shape

```json
{
  "items": [
    {
      "report_header_id": "uuid",
      "shift_session_id": "uuid",
      "location_code": "QORMI",
      "clinic_code": "MDCQ",
      "department_code": "MDCQ",
      "generated_at": "2026-03-14T10:00:00Z",
      "generated_by": "placeholder-user",
      "report_type": "standard",
      "status": "draft"
    }
  ],
  "total_count": 1,
  "limit": 50,
  "offset": 0
}
```

### Likely Access Rules

- management / admin only
- read-only

## 4. GET /api/eos/periods/:id/discrepancies

### Purpose

List discrepancy events relevant to one accounting period.

### Expected Filters

- location_code
- department_code
- event_type
- status
- created_by
- limit
- offset

### Suggested Response Shape

```json
{
  "items": [
    {
      "event_id": "uuid",
      "location_code": "ZABBAR",
      "department_code": "MDCZ",
      "event_type": "opening_cash_mismatch",
      "discrepancy_type": "opening_cash_mismatch",
      "discrepancy_amount": 20.0,
      "created_at": "2026-03-14T08:00:00Z",
      "status": "pending_manager_review"
    }
  ],
  "total_count": 1,
  "limit": 50,
  "offset": 0
}
```

### Likely Access Rules

- management / admin only
- read-only

## 5. GET /api/eos/periods/:id/unresolved

### Purpose

List unresolved items that affect period close readiness.

### Expected Filters

- location_code
- department_code
- unresolved_type
- status

### Suggested Response Shape

```json
{
  "items": [
    {
      "item_type": "temporary_closure_pending_review",
      "shift_session_id": "uuid",
      "report_header_id": null,
      "location_code": "QORMI",
      "department_code": "MDCQ",
      "status": "manager_review_required"
    }
  ]
}
```

### Likely Access Rules

- management / admin only
- read-only
