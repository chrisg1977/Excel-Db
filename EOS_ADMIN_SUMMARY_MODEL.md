# EOS Admin Summary Model

## Purpose

This note defines what admin should receive from EOS discrepancy workflows.

Admin is part of the summary chain, but admin is not necessarily the primary first-action recipient.

Future delivery can be implemented through email, a dashboard queue, or an internal notification flow.

## 1. Discrepancy Summary

Triggered when a discrepancy is detected.

Suggested fields:

```ts
type EosAdminDiscrepancySummary = {
  summary_id: string;
  discrepancy_event_id: string;
  shift_session_id: string;
  report_header_id: string | null;
  location_code: string;
  department_code: string;
  department_id: string | null;
  created_by: string;
  created_at: string;
  discrepancy_type: string;
  discrepancy_amount: number | null;
  reason_or_note: string | null;
  routing_preview: unknown;
  admin_summary_required: boolean;
};
```

Purpose:
- give admin visibility when a discrepancy is first detected
- preserve the routing preview used at the time of detection

## 2. Manager Outcome Summary

Triggered after manager review or resolution action.

Suggested fields:

```ts
type EosAdminManagerOutcomeSummary = {
  summary_id: string;
  discrepancy_event_id: string;
  shift_session_id: string;
  report_header_id: string | null;
  reviewed_by: string;
  reviewed_at: string;
  decision: string;
  decision_note: string | null;
  manager_action_type: string;
  outcome_status: string;
  resolved_at: string | null;
  closed_at: string | null;
};
```

Purpose:
- show admin what the manager decided
- capture timestamps and final outcome after review/action

## Role Rule

- admin receives discrepancy summaries and manager outcome summaries
- admin may be part of escalation or summarization even when not the first direct recipient
- EOS UI should not hardcode delivery behavior; delivery should be handled by shared backend/service logic
