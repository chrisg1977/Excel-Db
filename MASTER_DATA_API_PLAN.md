# Master Data API Plan

## Purpose

This note defines the first read-only master-data API plan for the wider operations platform.

These endpoints support:
- dropdowns
- department manager assignment
- EOS location / department lookup
- discrepancy notification-routing preview

No routes are implemented in this note.

## 1. `GET /api/locations`

Purpose:
- list physical locations and reception-capable sites for UI lookup and operational mapping

Expected filters:
- `is_active`
- `has_active_reception`
- `code`

Response shape:
- list of location rows with fields such as:
  - `id`
  - `code`
  - `name`
  - `phone_number`
  - `has_active_reception`
  - `is_active`

Likely access rules:
- authenticated operational users and above
- read-only access

## 2. `GET /api/business-units`

Purpose:
- list business units for department setup, reporting filters, and master-data lookup

Expected filters:
- `is_active`
- `unit_type`
- `code`

Response shape:
- list of business unit rows with fields such as:
  - `id`
  - `code`
  - `name`
  - `unit_type`
  - `is_active`

Likely access rules:
- authenticated operational users and above
- read-only access

## 3. `GET /api/departments`

Purpose:
- list departments for EOS assignment, setup screens, reporting filters, and manager assignment

Expected filters:
- `is_active`
- `business_unit_id`
- `location_id`
- `default_reception_location_id`
- `department_type`
- `code`

Response shape:
- list of department rows with fields such as:
  - `id`
  - `code`
  - `name`
  - `business_unit_id`
  - `location_id`
  - `default_reception_location_id`
  - `manager_responsible_employee_id`
  - `department_type`
  - `phone_number`
  - `is_active`

Likely access rules:
- authenticated operational users and above
- write/update for assignment screens should be restricted separately

## 4. `GET /api/employees`

Purpose:
- list employees/providers for manager assignment, escalation preview, HR use, and payroll reuse

Expected filters:
- `is_active`
- `is_manager`
- `is_provider`
- `role`
- `role_level`

Response shape:
- list of employee rows with fields such as:
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
  - `provider_ref`

Likely access rules:
- authenticated users with appropriate internal access
- personal/contact fields may need role-based filtering

## 5. `GET /api/leave/availability`

Purpose:
- provide shared leave availability lookup for routing, approval, payroll, and planning flows

Expected filters:
- `employee_id`
- `at_datetime`
- `start_at`
- `end_at`
- `status`

Response shape:
- either:
  - availability rows, or
  - a normalized summary such as:
    - `employee_id`
    - `is_available`
    - `matching_leave_request_id`
    - `leave_type`
    - `status`
    - `start_at`
    - `end_at`

Likely access rules:
- internal service and authenticated staff only
- broader HR visibility may differ from EOS/payroll read access

## 6. `GET /api/departments/:id/manager-resolution-preview`

Purpose:
- preview who would receive an EOS discrepancy/alert for a department at a given time

Expected filters:
- path param: `id`
- query:
  - `at_datetime`

Response shape:
- structured resolver preview such as:
  - `department_id`
  - `primary_recipient`
  - `fallback_recipient`
  - `admin_summary_required`
  - `resolution_path`

Likely access rules:
- management, admin, setup users, and internal tooling
- not intended as a public operational-user endpoint by default

## Notes

- these are read endpoints only
- final write/update endpoints for locations, departments, employees, and leave should be planned separately
- manager-resolution logic should remain shared service logic, not duplicated in UI code
