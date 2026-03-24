-- employee_seed_reference_v1.sql
-- PostgreSQL employee/master-data seed reference draft for development only.
--
-- Purpose:
--   Provide representative employee/manager/provider rows for:
--   - department manager assignment
--   - manager-resolution preview
--   - fallback manager logic
--   - EOS discrepancy-routing design/testing
--
-- IMPORTANT:
--   - This is current development/reference data only.
--   - It must later align with the real employee/payroll/HR master.
--   - Names, emails, phone numbers, and employee codes below are placeholders.
--   - UUIDs are placeholder values for repeatable reference seeding.
--   - reports_to_employee_id is populated in a second pass using employee_code lookups.
--   - Current wording adjustments reflected here:
--       * Zabbar manager uses "Clinical Manager"
--       * General manager uses "Office Manager"
--       * Qormi manager placeholder remains as a separate operational manager row for now
--       * Dental Principal is also flagged in admin-oriented role wording
--       * Operational reception labels use "Staff Zabbar" / "Staff Qormi"

BEGIN;

WITH employee_seed AS (
  SELECT *
  FROM (
    VALUES
      (
        '00000000-0000-0000-0000-00000000e001'::uuid,
        'ADMIN001',
        'System',
        'Admin',
        'SYSTEM ADMIN',
        'TODO-ADMIN-PHONE',
        'admin@example.local',
        'admin',
        100,
        NULL,
        true,
        true,
        false,
        NULL
      ),
      (
        '00000000-0000-0000-0000-00000000e002'::uuid,
        'MGMT001',
        'Office',
        'Manager',
        'OFFICE MANAGER',
        'TODO-MGMT-PHONE',
        'office.manager@example.local',
        'office_manager',
        80,
        'ADMIN001',
        true,
        true,
        false,
        NULL
      ),
      (
        '00000000-0000-0000-0000-00000000e003'::uuid,
        'MGRZ001',
        'Clinical',
        'Manager',
        'CLINICAL MANAGER',
        'TODO-ZABBAR-MANAGER-PHONE',
        'clinical.manager@example.local',
        'clinical_manager',
        60,
        'MGMT001',
        true,
        true,
        false,
        NULL
      ),
      (
        '00000000-0000-0000-0000-00000000e004'::uuid,
        'MGRQ001',
        'Qormi',
        'Manager',
        'QORMI MANAGER',
        'TODO-QORMI-MANAGER-PHONE',
        'qormi.manager@example.local',
        'management',
        60,
        'MGMT001',
        true,
        true,
        false,
        NULL
      ),
      (
        '00000000-0000-0000-0000-00000000e005'::uuid,
        'OPZ001',
        'Staff',
        'Zabbar',
        'STAFF ZABBAR',
        'TODO-OPZ-PHONE',
        'staff.zabbar@example.local',
        'operational',
        10,
        'MGRZ001',
        false,
        true,
        false,
        NULL
      ),
      (
        '00000000-0000-0000-0000-00000000e006'::uuid,
        'OPQ001',
        'Staff',
        'Qormi',
        'STAFF QORMI',
        'TODO-OPQ-PHONE',
        'staff.qormi@example.local',
        'operational',
        10,
        'MGRQ001',
        false,
        true,
        false,
        NULL
      ),
      (
        '00000000-0000-0000-0000-00000000e007'::uuid,
        'DRV001',
        'Dental',
        'Principal',
        'DENTAL PRINCIPAL',
        'TODO-DENTAL-PRINCIPAL-PHONE',
        'dental.principal@example.local',
        'admin_principal_provider',
        70,
        'MGMT001',
        true,
        true,
        true,
        'OD-PROV-001'
      ),
      (
        '00000000-0000-0000-0000-00000000e008'::uuid,
        'PROV001',
        'Dental',
        'Provider',
        'DENTAL PROVIDER',
        'TODO-DENTAL-PROVIDER-PHONE',
        'dental.provider@example.local',
        'provider',
        30,
        'DRV001',
        false,
        true,
        true,
        'OD-PROV-002'
      ),
      (
        '00000000-0000-0000-0000-00000000e009'::uuid,
        'PODO001',
        'Podiatry',
        'Provider',
        'PODIATRY PROVIDER',
        'TODO-PODIATRY-PROVIDER-PHONE',
        'podiatry.provider@example.local',
        'provider',
        30,
        'MGRQ001',
        false,
        true,
        true,
        'OD-PROV-003'
      )
  ) AS t(
    id,
    employee_code,
    first_name,
    last_name,
    display_name,
    phone_number,
    email,
    role,
    role_level,
    reports_to_employee_code,
    is_manager,
    is_active,
    is_provider,
    provider_ref
  )
)
INSERT INTO employee (
  id,
  employee_code,
  first_name,
  last_name,
  display_name,
  phone_number,
  email,
  role,
  role_level,
  reports_to_employee_id,
  is_manager,
  is_active,
  is_provider,
  provider_ref,
  created_at,
  updated_at
)
SELECT
  seed.id,
  seed.employee_code,
  seed.first_name,
  seed.last_name,
  seed.display_name,
  seed.phone_number,
  seed.email,
  seed.role,
  seed.role_level,
  NULL,
  seed.is_manager,
  seed.is_active,
  seed.is_provider,
  seed.provider_ref,
  NOW(),
  NOW()
FROM employee_seed seed
ON CONFLICT (employee_code) DO UPDATE
SET
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  display_name = EXCLUDED.display_name,
  phone_number = EXCLUDED.phone_number,
  email = EXCLUDED.email,
  role = EXCLUDED.role,
  role_level = EXCLUDED.role_level,
  is_manager = EXCLUDED.is_manager,
  is_active = EXCLUDED.is_active,
  is_provider = EXCLUDED.is_provider,
  provider_ref = EXCLUDED.provider_ref,
  updated_at = NOW();

-- Hierarchy/reference pass:
--   - OFFICE MANAGER reports to SYSTEM ADMIN
--   - location managers report to OFFICE MANAGER
--   - operational reception staff report to their location manager
--   - providers report to a location manager or principal placeholder
WITH reporting_seed AS (
  SELECT *
  FROM (
    VALUES
      ('MGMT001', 'ADMIN001'),
      ('MGRZ001', 'MGMT001'),
      ('MGRQ001', 'MGMT001'),
      ('OPZ001', 'MGRZ001'),
      ('OPQ001', 'MGRQ001'),
      ('DRV001', 'MGMT001'),
      ('PROV001', 'DRV001'),
      ('PODO001', 'MGRQ001')
  ) AS t(employee_code, reports_to_employee_code)
)
UPDATE employee target
SET
  reports_to_employee_id = manager.id,
  updated_at = NOW()
FROM reporting_seed seed
INNER JOIN employee manager
  ON manager.employee_code = seed.reports_to_employee_code
WHERE target.employee_code = seed.employee_code;

COMMIT;
