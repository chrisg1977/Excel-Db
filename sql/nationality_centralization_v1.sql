-- Centralize nationality model into two explicit fields:
-- 1) nationality_country (e.g. Maltese, Italian, Albanian)
-- 2) nationality_region  (EU | NON_EU)
-- Keep legacy nationality text synchronized as Country/Region for compatibility.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS nationality_country VARCHAR(64),
  ADD COLUMN IF NOT EXISTS nationality_region VARCHAR(16);

ALTER TABLE employee_current
  ADD COLUMN IF NOT EXISTS nationality_country VARCHAR(64),
  ADD COLUMN IF NOT EXISTS nationality_region VARCHAR(16);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'employees_nationality_region_chk'
  ) THEN
    ALTER TABLE employees
      ADD CONSTRAINT employees_nationality_region_chk
      CHECK (nationality_region IS NULL OR nationality_region IN ('EU', 'NON_EU'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'employee_current_nationality_region_chk'
  ) THEN
    ALTER TABLE employee_current
      ADD CONSTRAINT employee_current_nationality_region_chk
      CHECK (nationality_region IS NULL OR nationality_region IN ('EU', 'NON_EU'));
  END IF;
END $$;

WITH normalized AS (
  SELECT
    emp_id,
    TRIM(COALESCE(nationality, '')) AS nat_raw,
    UPPER(TRIM(COALESCE(nationality, ''))) AS nat_upper,
    TRIM(
      CASE
        WHEN POSITION('/' IN TRIM(COALESCE(nationality, ''))) > 0
          THEN SPLIT_PART(TRIM(COALESCE(nationality, '')), '/', 1)
        ELSE TRIM(COALESCE(nationality, ''))
      END
    ) AS country_raw
  FROM employees
), resolved AS (
  SELECT
    emp_id,
    CASE
      WHEN nat_upper IN ('', 'NAN') THEN NULL
      WHEN UPPER(country_raw) IN ('', 'EU', 'NON-EU', 'NON EU', 'OTHER') THEN NULL
      WHEN UPPER(country_raw) IN ('MALTA', 'MALTESE', 'MT') THEN 'Maltese'
      ELSE INITCAP(LOWER(country_raw))
    END AS country,
    CASE
      WHEN nat_upper IN ('', 'NAN') THEN NULL
      WHEN nat_upper LIKE '%/NON-EU%' OR nat_upper LIKE '%/NON EU%' OR nat_upper LIKE '%/OTHER%' OR nat_upper IN ('NON-EU', 'NON EU', 'OTHER') THEN 'NON_EU'
      WHEN nat_upper LIKE '%/EU%' OR nat_upper = 'EU' THEN 'EU'
      WHEN UPPER(country_raw) IN (
        'MALTA','MALTESE','MT','AUSTRIA','AUSTRIAN','BELGIUM','BELGIAN','BULGARIA','BULGARIAN','CROATIA','CROATIAN',
        'CYPRUS','CYPRIOT','CZECH REPUBLIC','CZECHIA','CZECH','DENMARK','DANISH','ESTONIA','ESTONIAN','FINLAND','FINNISH',
        'FRANCE','FRENCH','GERMANY','GERMAN','GREECE','GREEK','HUNGARY','HUNGARIAN','IRELAND','IRISH','ITALY','ITALIAN',
        'LATVIA','LATVIAN','LITHUANIA','LITHUANIAN','LUXEMBOURG','LUXEMBOURGER','NETHERLANDS','DUTCH','POLAND','POLISH',
        'PORTUGAL','PORTUGUESE','ROMANIA','ROMANIAN','SLOVAKIA','SLOVAK','SLOVENIA','SLOVENIAN','SPAIN','SPANISH','SWEDEN','SWEDISH'
      ) THEN 'EU'
      ELSE 'NON_EU'
    END AS region
  FROM normalized
)
UPDATE employees e
SET
  nationality_country = r.country,
  nationality_region = r.region,
  nationality = CASE
    WHEN r.country IS NULL OR r.region IS NULL THEN NULL
    ELSE r.country || '/' || CASE WHEN r.region = 'EU' THEN 'EU' ELSE 'Non-EU' END
  END
FROM resolved r
WHERE e.emp_id = r.emp_id;

WITH normalized AS (
  SELECT
    emp_id,
    TRIM(COALESCE(nationality, '')) AS nat_raw,
    UPPER(TRIM(COALESCE(nationality, ''))) AS nat_upper,
    TRIM(
      CASE
        WHEN POSITION('/' IN TRIM(COALESCE(nationality, ''))) > 0
          THEN SPLIT_PART(TRIM(COALESCE(nationality, '')), '/', 1)
        ELSE TRIM(COALESCE(nationality, ''))
      END
    ) AS country_raw
  FROM employee_current
), resolved AS (
  SELECT
    emp_id,
    CASE
      WHEN nat_upper IN ('', 'NAN') THEN NULL
      WHEN UPPER(country_raw) IN ('', 'EU', 'NON-EU', 'NON EU', 'OTHER') THEN NULL
      WHEN UPPER(country_raw) IN ('MALTA', 'MALTESE', 'MT') THEN 'Maltese'
      ELSE INITCAP(LOWER(country_raw))
    END AS country,
    CASE
      WHEN nat_upper IN ('', 'NAN') THEN NULL
      WHEN nat_upper LIKE '%/NON-EU%' OR nat_upper LIKE '%/NON EU%' OR nat_upper LIKE '%/OTHER%' OR nat_upper IN ('NON-EU', 'NON EU', 'OTHER') THEN 'NON_EU'
      WHEN nat_upper LIKE '%/EU%' OR nat_upper = 'EU' THEN 'EU'
      WHEN UPPER(country_raw) IN (
        'MALTA','MALTESE','MT','AUSTRIA','AUSTRIAN','BELGIUM','BELGIAN','BULGARIA','BULGARIAN','CROATIA','CROATIAN',
        'CYPRUS','CYPRIOT','CZECH REPUBLIC','CZECHIA','CZECH','DENMARK','DANISH','ESTONIA','ESTONIAN','FINLAND','FINNISH',
        'FRANCE','FRENCH','GERMANY','GERMAN','GREECE','GREEK','HUNGARY','HUNGARIAN','IRELAND','IRISH','ITALY','ITALIAN',
        'LATVIA','LATVIAN','LITHUANIA','LITHUANIAN','LUXEMBOURG','LUXEMBOURGER','NETHERLANDS','DUTCH','POLAND','POLISH',
        'PORTUGAL','PORTUGUESE','ROMANIA','ROMANIAN','SLOVAKIA','SLOVAK','SLOVENIA','SLOVENIAN','SPAIN','SPANISH','SWEDEN','SWEDISH'
      ) THEN 'EU'
      ELSE 'NON_EU'
    END AS region
  FROM normalized
)
UPDATE employee_current ec
SET
  nationality_country = r.country,
  nationality_region = r.region,
  nationality = CASE
    WHEN r.country IS NULL OR r.region IS NULL THEN NULL
    ELSE r.country || '/' || CASE WHEN r.region = 'EU' THEN 'EU' ELSE 'Non-EU' END
  END
FROM resolved r
WHERE ec.emp_id = r.emp_id;

DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['employee_intake', 'persons'] LOOP
    IF to_regclass('public.' || target_table) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS nationality_country VARCHAR(64), ADD COLUMN IF NOT EXISTS nationality_region VARCHAR(16)',
      target_table
    );

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = format('%s_nationality_region_chk', target_table)
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (nationality_region IS NULL OR nationality_region IN (''EU'', ''NON_EU''))',
        target_table,
        format('%s_nationality_region_chk', target_table)
      );
    END IF;

    EXECUTE format($sql$
      WITH normalized AS (
        SELECT
          ctid,
          TRIM(COALESCE(nationality, '')) AS nat_raw,
          UPPER(TRIM(COALESCE(nationality, ''))) AS nat_upper,
          TRIM(
            CASE
              WHEN POSITION('/' IN TRIM(COALESCE(nationality, ''))) > 0
                THEN SPLIT_PART(TRIM(COALESCE(nationality, '')), '/', 1)
              ELSE TRIM(COALESCE(nationality, ''))
            END
          ) AS country_raw
        FROM %I
      ), resolved AS (
        SELECT
          ctid,
          CASE
            WHEN nat_upper IN ('', 'NAN') THEN NULL
            WHEN UPPER(country_raw) IN ('', 'EU', 'NON-EU', 'NON EU', 'OTHER') THEN NULL
            WHEN UPPER(country_raw) IN ('MALTA', 'MALTESE', 'MT') THEN 'Maltese'
            ELSE INITCAP(LOWER(country_raw))
          END AS country,
          CASE
            WHEN nat_upper IN ('', 'NAN') THEN NULL
            WHEN nat_upper LIKE '%%/NON-EU%%' OR nat_upper LIKE '%%/NON EU%%' OR nat_upper LIKE '%%/OTHER%%' OR nat_upper IN ('NON-EU', 'NON EU', 'OTHER') THEN 'NON_EU'
            WHEN nat_upper LIKE '%%/EU%%' OR nat_upper = 'EU' THEN 'EU'
            WHEN UPPER(country_raw) IN (
              'MALTA','MALTESE','MT','AUSTRIA','AUSTRIAN','BELGIUM','BELGIAN','BULGARIA','BULGARIAN','CROATIA','CROATIAN',
              'CYPRUS','CYPRIOT','CZECH REPUBLIC','CZECHIA','CZECH','DENMARK','DANISH','ESTONIA','ESTONIAN','FINLAND','FINNISH',
              'FRANCE','FRENCH','GERMANY','GERMAN','GREECE','GREEK','HUNGARY','HUNGARIAN','IRELAND','IRISH','ITALY','ITALIAN',
              'LATVIA','LATVIAN','LITHUANIA','LITHUANIAN','LUXEMBOURG','LUXEMBOURGER','NETHERLANDS','DUTCH','POLAND','POLISH',
              'PORTUGAL','PORTUGUESE','ROMANIA','ROMANIAN','SLOVAKIA','SLOVAK','SLOVENIA','SLOVENIAN','SPAIN','SPANISH','SWEDEN','SWEDISH'
            ) THEN 'EU'
            ELSE 'NON_EU'
          END AS region
        FROM normalized
      )
      UPDATE %I t
      SET
        nationality_country = r.country,
        nationality_region = r.region,
        nationality = CASE
          WHEN r.country IS NULL OR r.region IS NULL THEN NULL
          ELSE r.country || '/' || CASE WHEN r.region = 'EU' THEN 'EU' ELSE 'Non-EU' END
        END
      FROM resolved r
      WHERE t.ctid = r.ctid;
    $sql$, target_table, target_table);
  END LOOP;
END $$;

CREATE OR REPLACE VIEW vw_employee_current AS
SELECT
  e.emp_id,
  e.person_id,
  nh.surname,
  nh.first_name,
  nh.short_name,
  e.created_at AS file_created_at,
  e.active_from,
  e.terminated_on,
  e.department_code,
  e.pe_number,
  e.tax_owner_number,
  e.nationality,
  e.national_id,
  e.passport_no,
  e.eu_residency_no,
  e.tax_number,
  e.social_security_no,
  e.email,
  e.phone_primary,
  e.phone_secondary,
  e.iban,
  e.address1,
  e.address2,
  e.city,
  e.postcode,
  et.position_held,
  et.weekly_hours,
  et.employment_type,
  tx.fs_status,
  e.nationality_country,
  e.nationality_region
FROM employees e
LEFT JOIN employee_name_history nh ON nh.emp_id = e.emp_id AND nh.effective_to IS NULL
LEFT JOIN employee_employment_terms et ON et.emp_id = e.emp_id AND et.effective_to IS NULL
LEFT JOIN employee_tax_status_history tx ON tx.emp_id = e.emp_id AND tx.effective_to IS NULL;
