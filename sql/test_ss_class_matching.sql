-- Test social security class matching logic

-- Test Case 1: Class A (under 18, wage €100)
WITH test AS (
  SELECT 
    '2010-06-15'::date AS dob,
    100::numeric AS weekly_wage,
    2026 AS year,
    'Class A test (under 18, €100)' AS test_name
)
SELECT 
  t.test_name,
  s.id, s.class_code, s.dob_from, s.dob_to, 
  EXTRACT(YEAR FROM AGE(t.dob)) AS age,
  t.weekly_wage,
  s.wage_from, s.wage_to,
  s.min_age, s.max_age,
  s.employee_fixed, s.mlf_fixed
FROM test t, social_security_classes s
WHERE s.year = t.year
  AND t.weekly_wage >= s.wage_from 
  AND (s.wage_to IS NULL OR t.weekly_wage <= s.wage_to)
  AND (s.dob_from IS NULL OR t.dob >= s.dob_from)
  AND (s.dob_to IS NULL OR t.dob <= s.dob_to)
  AND (s.min_age IS NULL OR EXTRACT(YEAR FROM AGE(t.dob)) >= s.min_age)
  AND (s.max_age IS NULL OR EXTRACT(YEAR FROM AGE(t.dob)) <= s.max_age)
ORDER BY class_code;

-- Test Case 2: Class C pre-1961 (born 1960-12-31, wage €350)
WITH test AS (
  SELECT 
    '1960-12-31'::date AS dob,
    350::numeric AS weekly_wage,
    2026 AS year,
    'Class C pre-1961 test (€350)' AS test_name
)
SELECT 
  t.test_name,
  s.id, s.class_code, s.dob_from, s.dob_to,
  t.weekly_wage,
  s.wage_from, s.wage_to,
  s.employee_percentage, s.mlf_percentage
FROM test t, social_security_classes s
WHERE s.year = t.year
  AND t.weekly_wage >= s.wage_from 
  AND (s.wage_to IS NULL OR t.weekly_wage <= s.wage_to)
  AND (s.dob_from IS NULL OR t.dob >= s.dob_from)
  AND (s.dob_to IS NULL OR t.dob <= s.dob_to)
ORDER BY class_code;

-- Test Case 3: Class D post-1962 (born 1965-01-01, wage €600)
WITH test AS (
  SELECT 
    '1965-01-01'::date AS dob,
    600::numeric AS weekly_wage,
    2026 AS year,
    'Class D post-1962 test (€600)' AS test_name
)
SELECT 
  t.test_name,
  s.id, s.class_code, s.dob_from, s.dob_to,
  t.weekly_wage,
  s.wage_from, s.wage_to,
  s.employee_fixed, s.mlf_fixed
FROM test t, social_security_classes s
WHERE s.year = t.year
  AND t.weekly_wage >= s.wage_from 
  AND (s.wage_to IS NULL OR t.weekly_wage <= s.wage_to)
  AND (s.dob_from IS NULL OR t.dob >= s.dob_from)
  AND (s.dob_to IS NULL OR t.dob <= s.dob_to)
ORDER BY class_code;

-- Test Case 4: Class E (student under 18, wage €100)
WITH test AS (
  SELECT 
    '2010-06-15'::date AS dob,
    100::numeric AS weekly_wage,
    2026 AS year,
    'Class E test (student under 18)' AS test_name
)
SELECT 
  t.test_name,
  s.id, s.class_code,
  EXTRACT(YEAR FROM AGE(t.dob)) AS age,
  s.min_age, s.max_age,
  s.employee_percentage, s.mlf_percentage, s.mlf_max
FROM test t, social_security_classes s
WHERE s.year = t.year
  AND s.class_code = 'E'
  AND (s.min_age IS NULL OR EXTRACT(YEAR FROM AGE(t.dob)) >= s.min_age)
  AND (s.max_age IS NULL OR EXTRACT(YEAR FROM AGE(t.dob)) <= s.max_age);
