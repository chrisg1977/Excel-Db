-- master_data_seed_reference_v1.sql
-- PostgreSQL seed/reference draft for current Mediatrix physical locations and departments.
--
-- IMPORTANT:
--   - This is current-state reference data for development/planning only.
--   - It is not the final source of truth.
--   - Real phone numbers, business-unit mappings, manager assignments, and some
--     non-final department short codes must be validated before live use.
--   - Departments are seeded with both:
--       1) physical location
--       2) default reception location
--     because EOS is handled by reception location, not always by physical site.
--
-- Assumptions in this draft:
--   - location.code values are:
--       ZABBAR, QORMI, GZIRA, VALLETTA
--   - business_unit rows already exist and can be looked up by the placeholder
--     business_unit_code values below.
--   - manager_responsible_employee_id is left NULL for this draft.
--   - department_type values below are working draft categories, not locked enums.
--   - Placeholder short codes were added where no final operational code was supplied:
--       EDLAB, MPHARM, RUNLAB, FLEXP, BLUMQ, BLUMG
--     Existing provided/known codes retained:
--       MDCZ, MPLUS, MDCQ, PODO, MHB, BLUMV

BEGIN;

WITH location_seed AS (
  SELECT *
  FROM (
    VALUES
      (
        '00000000-0000-0000-0000-00000000a101'::uuid,
        'ZABBAR',
        'Zabbar',
        'TODO-ZABBAR-PHONE',
        true,
        true
      ),
      (
        '00000000-0000-0000-0000-00000000a102'::uuid,
        'QORMI',
        'Qormi',
        'TODO-QORMI-PHONE',
        true,
        true
      ),
      (
        '00000000-0000-0000-0000-00000000a103'::uuid,
        'GZIRA',
        'Gzira',
        'TODO-GZIRA-PHONE',
        false,
        true
      ),
      (
        '00000000-0000-0000-0000-00000000a104'::uuid,
        'VALLETTA',
        'Valletta',
        'TODO-VALLETTA-PHONE',
        false,
        true
      )
  ) AS t(id, code, name, phone_number, has_active_reception, is_active)
)
INSERT INTO location (
  id,
  code,
  name,
  phone_number,
  address_line_1,
  address_line_2,
  has_active_reception,
  is_active,
  created_at,
  updated_at
)
SELECT
  id,
  code,
  name,
  phone_number,
  NULL,
  NULL,
  has_active_reception,
  is_active,
  NOW(),
  NOW()
FROM location_seed
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  phone_number = EXCLUDED.phone_number,
  has_active_reception = EXCLUDED.has_active_reception,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

WITH department_seed AS (
  SELECT *
  FROM (
    VALUES
      (
        '00000000-0000-0000-0000-00000000d101'::uuid,
        'MDCZ',
        'Mediatrix Dental Clinic - Zabbar',
        'MEDIATRIX_DENTAL',
        'ZABBAR',
        'ZABBAR',
        'dental_clinic'
      ),
      (
        '00000000-0000-0000-0000-00000000d102'::uuid,
        'MPLUS',
        'MPLUS Clinics',
        'MPLUS',
        'ZABBAR',
        'ZABBAR',
        'clinic'
      ),
      (
        '00000000-0000-0000-0000-00000000d103'::uuid,
        'EDLAB',
        'Eight Dental Lab',
        'EIGHT_DENTAL_LAB',
        'ZABBAR',
        'ZABBAR',
        'laboratory'
      ),
      (
        '00000000-0000-0000-0000-00000000d104'::uuid,
        'MPHARM',
        'Mplus Pharmacy',
        'MPLUS_PHARMACY',
        'ZABBAR',
        'ZABBAR',
        'pharmacy'
      ),
      (
        '00000000-0000-0000-0000-00000000d105'::uuid,
        'MDCQ',
        'Mediatrix Dental Clinic - Qormi',
        'MEDIATRIX_DENTAL',
        'QORMI',
        'QORMI',
        'dental_clinic'
      ),
      (
        '00000000-0000-0000-0000-00000000d106'::uuid,
        'PODO',
        'Mediatrix Podiatry Centre',
        'MEDIATRIX_PODIATRY',
        'QORMI',
        'QORMI',
        'podiatry_centre'
      ),
      (
        '00000000-0000-0000-0000-00000000d107'::uuid,
        'RUNLAB',
        'Running Lab',
        'RUNNING_LAB',
        'QORMI',
        'QORMI',
        'laboratory'
      ),
      (
        '00000000-0000-0000-0000-00000000d108'::uuid,
        'FLEXP',
        'Flex+',
        'FLEX_PLUS',
        'QORMI',
        'QORMI',
        'clinic'
      ),
      (
        '00000000-0000-0000-0000-00000000d109'::uuid,
        'MHB',
        'MHB',
        'MHB',
        'QORMI',
        'QORMI',
        'clinic'
      ),
      (
        '00000000-0000-0000-0000-00000000d10a'::uuid,
        'BLUMQ',
        'Blu-M Central Qormi',
        'BLUM',
        'QORMI',
        'QORMI',
        'clinic'
      ),
      (
        '00000000-0000-0000-0000-00000000d10b'::uuid,
        'BLUMG',
        'Blu-M City',
        'BLUM',
        'GZIRA',
        'QORMI',
        'clinic'
      ),
      (
        '00000000-0000-0000-0000-00000000d10c'::uuid,
        'BLUMV',
        'Blu-M Capital',
        'BLUM',
        'VALLETTA',
        'QORMI',
        'clinic'
      )
  ) AS t(
    id,
    code,
    name,
    business_unit_code,
    physical_location_code,
    default_reception_location_code,
    department_type
  )
)
INSERT INTO department (
  id,
  code,
  name,
  business_unit_id,
  location_id,
  default_reception_location_id,
  manager_responsible_employee_id,
  department_type,
  phone_number,
  is_active,
  created_at,
  updated_at
)
SELECT
  seed.id,
  seed.code,
  seed.name,
  bu.id,
  physical_location.id,
  default_reception_location.id,
  NULL,
  seed.department_type,
  NULL,
  true,
  NOW(),
  NOW()
FROM department_seed seed
INNER JOIN business_unit bu
  ON bu.code = seed.business_unit_code
INNER JOIN location physical_location
  ON physical_location.code = seed.physical_location_code
INNER JOIN location default_reception_location
  ON default_reception_location.code = seed.default_reception_location_code
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  business_unit_id = EXCLUDED.business_unit_id,
  location_id = EXCLUDED.location_id,
  default_reception_location_id = EXCLUDED.default_reception_location_id,
  department_type = EXCLUDED.department_type,
  phone_number = EXCLUDED.phone_number,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

COMMIT;
