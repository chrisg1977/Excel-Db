# EOS Notification Resolver

## Purpose

This note defines the future shared notification resolver:

- `resolveDepartmentResponsibleManager(department_id, at_datetime)`

Its purpose is to resolve who should receive an EOS discrepancy or alert for a department at a given time.

This resolver should be shared service logic and must not be hardcoded inside the EOS UI.

## Resolver Steps

1. Load department
   - fetch the department record for `department_id`
   - read `manager_responsible_employee_id`

2. Find responsible manager
   - load the employee record referenced by `manager_responsible_employee_id`
   - confirm the employee is active

3. Check central leave store
   - query the shared HR leave store for approved leave covering `at_datetime`
   - leave checking must use the central leave model shared by HR, payroll, and EOS

4. If available, notify the responsible manager
   - use the department's responsible manager as the primary recipient

5. If unavailable, resolve fallback manager
   - escalate to a fallback manager using:
     - peer or higher `role_level`
     - optional `reports_to_employee_id` hierarchy traversal
   - prefer a valid active manager rather than EOS-specific hardcoded location rules

6. Include admin in summary flow
   - admin should be included for discrepancy summaries
   - admin should also receive manager review outcome summaries

7. Return a structured result
   - the resolver should return a structured decision payload rather than UI text

## Suggested Result Shape

```ts
type NotificationResolverResult = {
  primary_recipient: string | null;
  fallback_recipient: string | null;
  admin_summary_required: boolean;
  resolution_path: string;
};
```

Suggested meaning:
- `primary_recipient`
  - the employee id or notification target selected as the first direct recipient
- `fallback_recipient`
  - nullable fallback employee id or notification target used when the primary manager is unavailable
- `admin_summary_required`
  - whether admin must be included in the summary chain
- `resolution_path`
  - short machine-readable explanation such as:
    - `responsible_manager_available`
    - `responsible_manager_on_leave_fallback_peer`
    - `responsible_manager_on_leave_fallback_higher`
    - `no_manager_available_admin_summary`

## Fallback / Escalation Rules

- first try the department's `manager_responsible_employee_id`
- if that manager is on approved leave at `at_datetime`, search for:
  - a peer manager at the same `role_level`, where business rules allow
  - otherwise a higher-level manager
- `reports_to_employee_id` can be used to walk the reporting hierarchy
- if no suitable responsible manager is available:
  - escalate through the best available fallback path
  - include admin in the escalation / summary chain

## Shared-Service Rule

- this resolver should be reusable by EOS and any later alerting/reporting workflows
- EOS UI should call a backend/service result and must not embed manager-selection logic directly
- leave, employee hierarchy, and department responsibility must remain centrally maintained master data
