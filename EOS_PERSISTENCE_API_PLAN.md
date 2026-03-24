# EOS Persistence API Plan

## Purpose

This note defines the first backend API plan for persisting and retrieving EOS data once the operational frontend moves beyond browser-local state.

The API is split into:
- operational endpoints for current shift/session/report creation
- retrieval endpoints for saved EOS report history
- accounting-period lookup for filtering and month-based management review

Retrieval is intentionally separate from the operational EOS screen.

## Real Physical Location Structure

Current physical locations:
- Zabbar: active reception
- Qormi: active reception
- Gzira: no active reception
- Valletta: no active reception

Required master-data rule:
- each location record must include `phone_number`

Departments by physical location:
- Zabbar
  - Mediatrix Dental Clinic - Zabbar (`MDCZ`)
  - MPLUS Clinics (`MPLUS`)
  - Eight Dental Lab
  - Mplus Pharmacy
- Qormi
  - Mediatrix Dental Clinic - Qormi (`MDCQ`)
  - Mediatrix Podiatry Centre
  - Running Lab
  - Flex+
  - MHB
  - Blu-M Central Qormi
- Gzira
  - Blu-M City
  - no active reception; work is handled mostly by Qormi, sometimes Zabbar
- Valletta
  - Blu-M Capital
  - no active reception; work is handled mostly by Qormi

## Physical Location vs Reception Location

- `location` means the physical site where a department exists.
- EOS ownership and concurrency operate on reception location.
- A department may be reported/accounted against one physical location while its EOS work is performed by another reception location.
- `location_code` on `eos_shift_session` refers to reception location, not department physical location.

Departments therefore need both:
- physical location
- default reception location

## Recommended Supporting Master Data

### `location`

Represents a physical site.

Recommended fields:
- `id`
- `code`
- `name`
- `phone_number`
- address fields optional
- `has_active_reception`
- `is_active`

### `business_unit`

- no structural change, but it must be able to operate across multiple physical locations

### `business_unit_location`

- keep as the linking table between business units and locations

### `department`

Recommended fields:
- `id`
- `code`
- `name`
- `business_unit_id`
- `location_id`
- `default_reception_location_id`
- `manager_responsible_employee_id`
- `department_type`
- `is_active`

Department-manager rule:
- `manager_responsible_employee_id` belongs to department master data and must not be hardcoded in EOS routing.
- the responsible manager should be selected from the central employee/provider list, including owner/principal where applicable.

### Recommended `employee` / manager hierarchy planning

Recommended planning fields:
- `id`
- `role`
- `role_level`
- `reports_to_employee_id`
- `is_manager`

Purpose:
- support manager responsibility assignment on departments
- support fallback peer / higher-level escalation
- support later review, approval, and reporting flows without EOS-specific hardcoding

### Recommended central leave model note

Leave data should be stored once in a shared HR/leave domain and reused by:
- HR approval and retrieval
- payroll
- EOS discrepancy notification routing

Shared leave rule:
- this applies to any approved leave type, not only vacation leave / VL
- EOS should not maintain a separate leave roster
- the future EOS notification resolver should read central approved-leave state at the relevant datetime

### Recommended EOS discrepancy notification-routing note

Future service / resolver:
- `resolveDepartmentResponsibleManager(department_id, at_datetime)`

Resolver responsibilities:
- find the department's `manager_responsible_employee_id`
- check whether that responsible manager is on approved leave in the shared HR/leave model
- if unavailable, escalate to a fallback peer or higher-level manager
- if no responsible manager is available, include admin in the escalation / summarization chain
- always include admin in:
  - discrepancy summaries
  - manager review outcome summaries

## Access Model

- Operational users can:
  - create shift sessions
  - create / submit current EOS reports
- Management-or-higher can:
  - retrieve historical saved EOS reports
  - filter reports by accounting period
  - retrieve individual saved report snapshots
  - list periods, especially for closed-period review and management reporting

## Ownership And Concurrency Model

- EOS concurrency is location-based.
- In this model, location-based means reception-location based.
- Concurrent open EOS sessions are allowed in different locations.
- Multiple active open EOS sessions are not allowed for the same `location_code`.
- The department physical site is separate and does not define EOS concurrency.
- The active EOS session is owned by the user who created it.
- If a previous shift for the same location is still active or otherwise unresolved, a new shift must not be opened blindly.
- If the same user reopens the same location's active EOS, the session should resume normally.
- If a different user of the same security level tries to open that location's active EOS, the session must stay blocked for editing and amendment.
- If a manager-or-higher user opens that location's active EOS, takeover is allowed only as an explicit action with a takeover reason.
- When takeover happens, the UI should clearly show: `Amending EOS of [USER]`.

## Recommended Unresolved-Shift Resolution Paths

### A. Resume Previous Shift

- same owner can resume normally
- manager-or-higher can take over and resume with audit

### B. Mark Previous Shift Abandoned

- manager only
- requires reason
- must be audited

### C. Supersede Previous Shift And Start A New One

- manager only
- requires reason
- must be audited
- old shift must be linked to the new shift

## Emergency Handover Mode

Purpose:
- allow safe temporary continuity when the previous shift for the same location was not closed and manager is unavailable

Rules:
- this is not a normal EOS close
- it creates a temporary closure of the previous shift
- it must be marked as pending manager review
- it must be fully audited

### Emergency Handover Workflow

#### A. Previous Shift Temporary Closure

The new user records:
- cash physically found in the cash box
- EPOS end-of-shift values run at handover time
- cheques found
- cash envelope found, or `0` if none / if it remains in the cash box
- Open Dental report run now for the previous shift
- retro report start/end values, because the missed closure may relate to the night before
- discrepancy notes if the maths does not match

#### B. New Shift Start

- found cash becomes the temporary end cash of the previous shift
- the same found cash becomes the actual opening cash of the new shift
- new shift payment counters begin at `0`
- system-recorded channels such as Revolut, bank transfer, and BOV remain part of system history and do not become opening values

## Recommended `eos_shift_session` Ownership Fields

- `created_by`
- `current_owner`
- `taken_over_from_user` nullable
- `taken_over_at` nullable
- `takeover_reason` nullable
- `location_code` for the reception location that owns the EOS shift
- `status`
- `closed_at`
- `closed_by`
- `abandoned_at`
- `abandoned_by`
- `abandon_reason`
- `supersedes_shift_session_id`
- `superseded_by_shift_session_id`
- `emergency_handover_used`
- `previous_shift_session_id`
- `temporary_closed_by`
- `temporary_closed_at`
- `temporary_close_reason`
- `found_cashbox_amount`
- `found_cash_envelope_amount`
- `found_cheques_amount`
- `found_epos_snapshot_json`
- `retro_report_start_at`
- `retro_report_end_at`
- `discrepancy_note`
- `manager_review_status`
- `manager_reviewed_at`
- `manager_reviewed_by`
- `manager_review_note`

## Recommended `eos_shift_session.status` Values

- `open`
- `report_in_progress`
- `submitted`
- `locked`
- `abandoned`
- `superseded`
- `temporary_closed_pending_review`
- `temporary_handover_started`
- `manager_review_required`

These ownership fields are in addition to the core opening-form fields already planned for the shift session.

## Recommended Audit Behavior

Audit should record ownership, takeover, abandonment, and supersede actions with fields equivalent to:
- `action`
- `previous_owner`
- `new_owner`
- `acted_by`
- `acted_at`
- `reason`
- `previous_shift_session_id` nullable
- `new_shift_session_id` nullable

Recommended action values:
- `amend_other_user_eos`
- `manager_takeover`
- `shift_abandoned`
- `shift_superseded`
- `emergency_temporary_close`
- `emergency_handover_started`
- `manager_review_pending`
- `manager_review_completed`

## Recommended discrepancy escalation rule

When EOS detects an opening-cash mismatch or later discrepancy:
- first notify the department's responsible manager from `manager_responsible_employee_id`
- if that manager is on approved leave, notify a fallback peer or higher-level manager
- if no responsible manager is available, include admin in the escalation / summarization chain
- admin must receive:
  - discrepancy summaries
  - manager review outcome summaries

This routing must use shared department / employee / leave data and must not be hardcoded per EOS location.

## Endpoints

### 1. `POST /api/eos/shift-sessions`

Purpose:
- Persist the saved opening form as one `eos_shift_session`

Request shape:

```json
{
  "workstation_id": "host:reception-pc-01",
  "location_code": "ZABBAR",
  "department_code": "MDCZ",
  "clinic_code": "MDCZ",
  "shift_date": "2026-03-12",
  "opening_timestamp": "2026-03-12T07:58:00.000Z",
  "last_shift_closing_cash": 245.00,
  "opening_cash_matches": false,
  "actual_opening_cash": 240.00,
  "opening_override_reason": "Cash counted lower than previous close",
  "opening_override_note": "Verified with supervisor",
  "takeover_reason": null
}
```

Response shape:

```json
{
  "ok": true,
  "shift_session": {
    "id": 1001,
    "status": "open",
    "created_at": "2026-03-12T08:00:12.000Z"
  }
}
```

Validation notes:
- `department_code`, `clinic_code`, `shift_date`, `opening_timestamp`, and `last_shift_closing_cash` are required
- `location_code` is required and it means reception location
- `department_code` still belongs to a department whose physical location may differ from `location_code`
- if `opening_cash_matches = false`, then `actual_opening_cash` and `opening_override_reason` are required
- workstation must be resolved before save
- duplicate shift sessions are not allowed for the same `clinic_code` + `shift_date` + `shift_start_time`
- duplicate active shift sessions are not allowed for the same `location_code`
- unresolved previous shifts for the same `location_code` must be resolved explicitly before a new shift session can be opened
- if the same user opens the same location's active EOS, resume is allowed
- if a different user of the same security level opens the same location's active EOS, the request must be blocked and no amendment is allowed
- if a manager-or-higher user explicitly takes over the active EOS, `takeover_reason` is required and the ownership change must be audited
- if a manager marks the previous shift abandoned, `abandon_reason` is required and the abandonment must be audited
- if a manager supersedes the previous shift and starts a new one, the supersede reason is required, the old and new sessions must be linked, and the action must be audited
- if manager is unavailable, operational users may use Emergency Handover Mode instead of a blind new shift
- emergency handover requires a temporary close reason and notes
- emergency handover must stamp the previous shift as pending manager review and create a new shift linked back to that previous shift

Assignment notes:
- if a department has no active reception, the shift session must still be opened under that department's `default_reception_location_id`
- example: Gzira and Valletta departments are serviced through another reception location rather than their own physical site

Duplicate rule response:

```json
{
  "error": "Shift session already exists"
}
```

with HTTP `409 Conflict`

Recommended same-level ownership conflict response:

```json
{
  "error": "EOS already open by the original user",
  "location_code": "ZABBAR",
  "current_owner": "Aisha"
}
```

with HTTP `409 Conflict`

Recommended manager takeover request behavior:
- takeover must be explicit, not automatic
- request should include a takeover reason
- successful takeover should update `current_owner`, preserve `created_by`, stamp `taken_over_from_user`, `taken_over_at`, and `takeover_reason`
- takeover should write an audit entry such as `manager_takeover`

Recommended unresolved-shift management behavior:
- manager should be offered explicit choices, not an automatic override
- choices should be:
  - resume previous shift
  - mark previous shift abandoned
  - supersede previous shift and start a new one
- abandonment must stamp `status = abandoned`, `abandoned_at`, `abandoned_by`, and `abandon_reason`
- supersede must stamp old shift `status = superseded`, set `superseded_by_shift_session_id`, and set the new shift `supersedes_shift_session_id`
- all of the above must write audit entries

Recommended emergency handover behavior:
- normal user may choose `Emergency handover close previous shift and start new shift` only when manager is unavailable
- previous shift should move to `temporary_closed_pending_review`
- new shift should move to `temporary_handover_started`
- manager review status should be recorded as `manager_review_required`
- the previous and new shift sessions should be linked through `previous_shift_session_id` / supersede-style linkage
- emergency handover must write audit entries for the temporary close and the new handover-started shift

#### Shift-Session Conflict / Resolution Response Contracts

##### 1. Same user resumes existing active shift

Action code:
- `open_shift_exists_same_owner`

Response status:
- `200 OK`

Response body shape:

```json
{
  "ok": true,
  "action_code": "open_shift_exists_same_owner",
  "message": "Active EOS resumed for the same owner",
  "shift_session": {
    "id": 1001,
    "location_code": "ZABBAR",
    "current_owner": "Aisha",
    "status": "open"
  },
  "allowed_actions": ["resume_existing_shift"]
}
```

Allowed actions:
- `resume_existing_shift`

Required reason fields:
- none

##### 2. Same-level different user blocked

Action code:
- `active_shift_owned_by_other_user`

Response status:
- `409 Conflict`

Response body shape:

```json
{
  "ok": false,
  "action_code": "active_shift_owned_by_other_user",
  "message": "EOS is already open by the original user",
  "shift_session": {
    "id": 1001,
    "location_code": "ZABBAR",
    "current_owner": "Aisha",
    "status": "open"
  },
  "allowed_actions": []
}
```

Allowed actions:
- none

Required reason fields:
- none

##### 3. Manager takeover allowed

Action code:
- `manager_takeover_available`

Response status:
- `409 Conflict`

Response body shape:

```json
{
  "ok": false,
  "action_code": "manager_takeover_available",
  "message": "Manager takeover is available for this active EOS",
  "shift_session": {
    "id": 1001,
    "location_code": "ZABBAR",
    "current_owner": "Aisha",
    "status": "open"
  },
  "allowed_actions": ["take_over_and_resume"],
  "required_reason_fields": ["takeover_reason"]
}
```

Allowed actions:
- `take_over_and_resume`

Required reason fields:
- `takeover_reason`

##### 4. Unresolved previous shift with manager options

Action code:
- `unresolved_shift_requires_resolution`

Response status:
- `409 Conflict`

Response body shape:

```json
{
  "ok": false,
  "action_code": "unresolved_shift_requires_resolution",
  "message": "Previous shift is unresolved and must be handled explicitly",
  "shift_session": {
    "id": 1001,
    "location_code": "ZABBAR",
    "current_owner": "Aisha",
    "status": "report_in_progress"
  },
  "allowed_actions": [
    "resume_previous_shift",
    "mark_previous_shift_abandoned",
    "supersede_previous_shift_and_start_new"
  ],
  "required_reason_fields_by_action": {
    "resume_previous_shift": ["takeover_reason"],
    "mark_previous_shift_abandoned": ["abandon_reason"],
    "supersede_previous_shift_and_start_new": ["supersede_reason"]
  }
}
```

Allowed actions:
- `resume_previous_shift`
- `mark_previous_shift_abandoned`
- `supersede_previous_shift_and_start_new`

Required reason fields:
- `resume_previous_shift` -> `takeover_reason`
- `mark_previous_shift_abandoned` -> `abandon_reason`
- `supersede_previous_shift_and_start_new` -> `supersede_reason`

##### 5. Emergency handover mode allowed when manager unavailable

Action code:
- `emergency_handover_available`

Response status:
- `409 Conflict`

Response body shape:

```json
{
  "ok": false,
  "action_code": "emergency_handover_available",
  "message": "Temporary closure pending manager review",
  "shift_session": {
    "id": 1001,
    "location_code": "ZABBAR",
    "current_owner": "Aisha",
    "status": "report_in_progress"
  },
  "allowed_actions": ["emergency_handover_close_previous_and_start_new"],
  "required_reason_fields": ["temporary_close_reason", "discrepancy_note"]
}
```

Allowed actions:
- `emergency_handover_close_previous_and_start_new`

Required reason fields:
- `temporary_close_reason`
- `discrepancy_note`

Access rules:
- operational users allowed
- management also allowed

### 2. `POST /api/eos/reports`

Purpose:
- Persist one EOS report snapshot:
  - `eos_report_header`
  - `eos_report_row[]`
  - `eos_report_summary`
  - `eos_report_audit[]`

Request shape:

```json
{
  "shift_session_id": 1001,
  "department_code": "MDCZ",
  "clinic_code": "MDCZ",
  "report_start_at": "2026-03-12T08:00:00.000Z",
  "report_end_at": "2026-03-12T13:59:00.000Z",
  "report_type": "standard",
  "status": "submitted",
  "rows": [
    {
      "patient_visit_key": "12345",
      "patient_number": "25332",
      "surname": "Borg",
      "name": "Maria",
      "provider": "Dr Ryan",
      "treatments": "Exam, X-rays",
      "fee_total": 35.00,
      "appointment_datetime": "2026-03-12T08:15:00.000Z",
      "appointment_dismissed_at": null,
      "walkout_issued_at": null,
      "walkout_status": "unknown",
      "included": true,
      "carry_forward": false,
      "display_order": 0
    }
  ],
  "summary": {
    "opening_cash": 245.00,
    "payment_total": 1065.00,
    "cash_envelope_total": 120.00,
    "cashbox_expenses_total": 37.00,
    "sell_total": 335.00,
    "fee_total": 845.00,
    "expected_total": 1180.00,
    "actual_total": 1393.00,
    "discrepancy_total": 213.00,
    "manager_alert_created": true
  },
  "audit": [
    {
      "action": "report_loaded",
      "field_name": null,
      "old_value": null,
      "new_value": "MDCZ 2026-03-12T08:00:00.000Z -> 2026-03-12T13:59:00.000Z"
    }
  ]
}
```

Response shape:

```json
{
  "ok": true,
  "report": {
    "id": 5001,
    "accounting_period_id": 202603,
    "status": "submitted",
    "generated_at": "2026-03-12T14:05:00.000Z"
  }
}
```

Validation notes:
- `shift_session_id`, `department_code`, `clinic_code`, `report_start_at`, and `report_end_at` are required
- report period is assigned from `report_start_at`
- report must not span periods / months
- referenced shift session must exist
- closed accounting periods are read-only
- row list must contain grouped visit rows only, not raw procedure lines

Access rules:
- operational users allowed for current report creation / submission
- management also allowed

### 3. `GET /api/eos/reports`

Purpose:
- Retrieve saved EOS reports for management review and reporting
- Support filtering by accounting period and operational dimensions

Request shape:

Query parameters:

```text
period_code=2026-03
clinic_code=MDCZ
department_code=MDCZ
status=submitted
report_type=standard
date_from=2026-03-01
date_to=2026-03-31
page=1
limit=50
```

Response shape:

```json
{
  "ok": true,
  "data": [
    {
      "id": 5001,
      "shift_session_id": 1001,
      "period_code": "2026-03",
      "period_name": "MAR 2026",
      "department_code": "MDCZ",
      "clinic_code": "MDCZ",
      "report_start_at": "2026-03-12T08:00:00.000Z",
      "report_end_at": "2026-03-12T13:59:00.000Z",
      "generated_at": "2026-03-12T14:05:00.000Z",
      "generated_by": "Reception User",
      "report_type": "standard",
      "status": "submitted",
      "manager_alert_created": true,
      "discrepancy_total": 213.00
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 1
  }
}
```

Validation notes:
- `period_code` should be the primary management filter when supplied
- period filters should align to `eos_accounting_period`
- retrieval should return saved snapshots, not rerun live extraction

Access rules:
- management-or-higher only

### 4. `GET /api/eos/reports/:id`

Purpose:
- Retrieve one saved EOS report snapshot in full detail

Request shape:

```text
GET /api/eos/reports/5001
```

Response shape:

```json
{
  "ok": true,
  "report_header": {
    "id": 5001,
    "shift_session_id": 1001,
    "accounting_period_id": 202603,
    "department_code": "MDCZ",
    "clinic_code": "MDCZ",
    "report_start_at": "2026-03-12T08:00:00.000Z",
    "report_end_at": "2026-03-12T13:59:00.000Z",
    "generated_at": "2026-03-12T14:05:00.000Z",
    "generated_by": "Reception User",
    "report_type": "standard",
    "status": "submitted"
  },
  "summary": {
    "opening_cash": 245.00,
    "payment_total": 1065.00,
    "cash_envelope_total": 120.00,
    "cashbox_expenses_total": 37.00,
    "sell_total": 335.00,
    "fee_total": 845.00,
    "expected_total": 1180.00,
    "actual_total": 1393.00,
    "discrepancy_total": 213.00,
    "manager_alert_created": true
  },
  "rows": [],
  "audit": []
}
```

Validation notes:
- `:id` must identify an existing saved report header
- response should include saved rows and saved audit, not re-query Open Dental

Access rules:
- management-or-higher only

### 5. `GET /api/eos/periods`

Purpose:
- List EOS accounting periods for filtering, management retrieval, and close-state review

Request shape:

Query parameters:

```text
year=2026
is_closed=false
```

Response shape:

```json
{
  "ok": true,
  "data": [
    {
      "id": 202603,
      "year": 2026,
      "month": 3,
      "period_code": "2026-03",
      "period_name": "MAR 2026",
      "start_date": "2026-03-01",
      "end_date": "2026-03-31",
      "is_closed": false,
      "closed_at": null,
      "closed_by": null
    }
  ]
}
```

Validation notes:
- return canonical accounting periods only
- do not derive ad hoc months in the API response

Access rules:
- management-or-higher for retrieval usage
- operational users may optionally read the current period if needed later, but that is not required for the first retrieval implementation

## Retrieval Separation Rule

- Historical saved report retrieval must remain separate from the operational EOS screen.
- The operational screen should create and submit current EOS work.
- Management retrieval should use dedicated report-history views and saved report endpoints.

## UI Expectations From The API

- Normal operational users should see a blocked message when another same-level user already owns the location's active EOS.
- Manager-or-higher users should see an explicit takeover choice, not automatic entry.
- During takeover/amendment, the UI should show the visible label: `Amending EOS of [USER]`.
- When an unresolved previous shift exists, the UI should clearly describe that previous shift before any action is taken.
- Normal users should see a blocked message and no amend/bypass action.
- Manager-or-higher users should see explicit unresolved-shift choices: resume, abandon, or supersede.
- If manager is unavailable, normal operational users should see the exception choice:
  - `Emergency handover close previous shift and start new shift`
- The UI should show strong warning text:
  - `Temporary closure pending manager review`
- Reason and notes are required in Emergency Handover Mode.
- The UI should clearly separate:
  - temporary previous shift closure values
  - new shift starting values

## Accounting Behavior

- found cash equals the temporary previous shift ending cash
- the same found cash equals the actual opening cash of the new shift
- new shift EPOS, cheques, and cash envelope counters start from `0`
- system-history channels such as Revolut, bank transfer, and BOV do not become opening values
- any discrepancy found during emergency handover must trigger manager notification and manager review

## Filter Rule

- Saved reports must be filterable by accounting period.
- `period_code` is the preferred month filter for retrieval APIs.

## Implementation Notes

- Carry-forward persistence remains outside this first persistence API plan.
- Walkout and securitylog enrichment must remain annotation-only and must never create new EOS report rows.
- Final role enforcement should align to the app-wide access-control model once the user/role source is finalized.
