# EOS Discrepancy Event Model

## Purpose

This note defines the event payload EOS should produce when a discrepancy is detected.

The event is intended for later notification routing, manager review, audit, and summary reporting.

## Suggested Payload

```ts
type EosDiscrepancyEvent = {
  event_id: string;
  event_type: 'opening_cash_mismatch' | 'reconciliation_discrepancy' | 'temporary_handover_discrepancy';
  source_module: string;
  shift_session_id: string;
  report_header_id: string | null;
  location_code: string;
  department_code: string;
  department_id: string | null;
  created_by: string;
  created_at: string;
  discrepancy_type: string;
  discrepancy_amount: number | null;
  note: string | null;
  manager_resolution_preview: unknown;
  admin_summary_required: boolean;
  status: 'detected' | 'pending_notification' | 'pending_manager_review' | 'resolved' | 'closed';
};
```

## Field Notes

- `event_id`
  - unique event identifier
- `event_type`
  - high-level discrepancy category
- `source_module`
  - origin such as `eos_open_shift`, `eos_reconciliation`, or `eos_emergency_handover`
- `shift_session_id`
  - required EOS shift context
- `report_header_id`
  - nullable until a report snapshot exists
- `location_code`
  - reception location context
- `department_code`
  - department context used for manager resolution
- `department_id`
  - nullable until full master-data linkage is available
- `created_by`, `created_at`
  - event creator and timestamp
- `discrepancy_type`
  - specific internal subtype or rule label
- `discrepancy_amount`
  - nullable for non-monetary discrepancy cases
- `note`
  - optional operator or system note
- `manager_resolution_preview`
  - preview/decision payload from manager-resolution logic
- `admin_summary_required`
  - whether admin must be included in summary routing
- `status`
  - current lifecycle state of the discrepancy event

## Suggested Event Types

- `opening_cash_mismatch`
- `reconciliation_discrepancy`
- `temporary_handover_discrepancy`

## Suggested Status Values

- `detected`
- `pending_notification`
- `pending_manager_review`
- `resolved`
- `closed`
