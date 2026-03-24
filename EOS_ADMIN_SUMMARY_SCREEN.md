# EOS Admin Summary Screen

## Purpose

Define a future admin-facing screen for cross-cutting EOS discrepancy oversight.
This screen is for summary, escalation visibility, and follow-up monitoring. It is
not the operational EOS workflow and not the manager's case-by-case review screen.

## Main Sections

### Discrepancy Summaries

List detected EOS discrepancy events across locations, departments, and users.
Focus on what was detected, when, where, and how it was routed.

### Manager Outcome Summaries

List manager review outcomes for discrepancy events. Focus on decision, action
taken, reviewer, timestamps, and final outcome.

### Pending Queue Items

List notification queue records still pending, failed, or awaiting processing.
Focus on visibility into routing backlog rather than delivery execution.

### Unresolved Temporary Closures

List temporary closures and emergency handover cases still pending manager review
or final outcome confirmation.

## Suggested Filters

- date range
- location
- department
- event type
- discrepancy status
- manager review outcome status
- created by
- reviewed by
- queue status
- temporary closure / emergency handover only

## Suggested List Columns

### Discrepancy Summary List

- created_at
- location_code
- department_code
- event_type
- discrepancy_type
- discrepancy_amount
- created_by
- status
- admin_summary_required

### Manager Outcome Summary List

- reviewed_at
- location_code
- department_code
- reviewed_by
- decision
- action_type
- final_outcome_status

### Pending Queue List

- created_at
- notification_type
- source_event_id
- primary_recipient_employee_id
- fallback_recipient_employee_id
- status
- error_note

### Unresolved Temporary Closure List

- created_at
- location_code
- department_code
- shift_session_id
- created_by
- status
- manager_review_status

## Why Separate

- Operational EOS is for front-desk shift execution and report capture.
- Manager discrepancy review is for reviewing one discrepancy case at a time.
- Admin summary is cross-cutting and supervisory, combining discrepancies,
  review outcomes, queue state, and unresolved exception workflows in one place.
