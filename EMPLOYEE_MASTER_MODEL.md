# Employee Master Model

## Purpose

This note defines the shared employee / manager master-data model needed to support:
- EOS discrepancy routing
- department manager assignment
- fallback manager resolution
- HR leave storage and approval flows
- payroll reuse

This is a shared master-data model, not an EOS-only structure.

## Employee Model

Suggested fields:
- `id`
- `employee_code`
- `first_name`
- `last_name`
- `display_name`
- `phone_number`
- `email`
- `role`
- `role_level`
- `reports_to_employee_id`
- `is_manager`
- `is_active`
- `is_provider`
- `provider_ref` nullable

## Field Purpose Notes

- `display_name`
  - user-facing name for EOS, HR, payroll, and review/audit screens
- `role`
  - business or system role label
- `role_level`
  - normalized hierarchy level used for peer-or-higher fallback logic
- `reports_to_employee_id`
  - direct reporting line for escalation and hierarchy traversal
- `is_manager`
  - explicit manager flag to simplify manager filtering without relying only on title text
- `is_provider`
  - marks providers/doctors where the employee master is shared with provider-linked structures
- `provider_ref`
  - optional link to the provider source record when the employee is also a provider

## Rules

### Department Manager Assignment

- `manager_responsible_employee_id` on `department` must reference this employee master.
- the responsible manager belongs to department master data, not EOS-specific hardcoded logic.

### Hierarchy And Fallback

- `reports_to_employee_id` supports escalation hierarchy.
- `role_level` supports peer-or-higher fallback logic.
- fallback routing should prefer:
  - the department's responsible manager first
  - if unavailable, a peer manager at the same `role_level` where business rules allow
  - otherwise a higher-level manager through hierarchy traversal
  - if no suitable manager is available, admin must be included in the escalation / summary chain

### Shared Usage

- this employee master is shared by EOS, HR, and payroll
- EOS uses it for department-manager responsibility and discrepancy escalation
- HR uses it for employee identity, leave ownership, and approval routing
- payroll uses it for employee identity and cross-module reporting alignment

## Related Planning

- department master should store `manager_responsible_employee_id`
- central leave records should reference this employee master
- future EOS resolver example:
  - `resolveDepartmentResponsibleManager(department_id, at_datetime)`

That resolver should:
- resolve the department's responsible manager from this model
- check central approved leave status
- escalate through peer-or-higher manager logic using `role_level` and `reports_to_employee_id`
- include admin in summary/escalation flows when no responsible manager is available
