# Department Manager Assignment Plan

## Purpose

This note defines how `department.manager_responsible_employee_id` should be assigned in the wider operations platform.

## Assignment Rule

- The UI source must be a dropdown backed by the shared employee / provider master.
- The selected value is stored on the department record as `manager_responsible_employee_id`.
- This assignment belongs to department master data, not to EOS.
- EOS discrepancy routing uses this assignment as the starting point for manager resolution.
- Changes to the assignment should be audited.
- A future admin/setup UI should manage this assignment centrally.

## Scope Note

- EOS should consume the assigned manager from master data.
- EOS UI must not hardcode or locally maintain department manager responsibility.
