# Department Master Model

## Purpose

This note defines the shared department master-data model for the wider operations platform.

It supports:
- EOS assignment
- reporting and accounting location ownership
- department manager responsibility
- cross-location operational handling

## Department Model

Suggested fields:
- `id`
- `code`
- `name`
- `business_unit_id`
- `location_id`
- `default_reception_location_id`
- `manager_responsible_employee_id`
- `department_type`
- `phone_number` nullable
- `is_active`

## Rules

1. `location_id`
   - the physical site where the department belongs

2. `default_reception_location_id`
   - the reception location where EOS is operationally handled

3. `manager_responsible_employee_id`
   - selected from the shared employee / provider master

4. departments may exist at locations with no active reception
   - in that case, EOS must still be handled through the department's `default_reception_location_id`

5. EOS ownership and concurrency happen at reception location, not physical location
   - department physical site does not define EOS shift concurrency
   - the reception location does

## Operational Interpretation

- a department can be physically located in one site while its EOS activity is handled by another site's reception
- reporting and accounting should continue to attach to the department's physical `location_id`
- EOS workflow should attach operational shift ownership to `default_reception_location_id`
