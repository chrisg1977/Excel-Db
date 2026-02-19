-- ============================================================================
-- Rounding Rules for Contribution Calculations
-- ============================================================================
-- CRITICAL: All contribution calculations must use consistent rounding to ensure
-- no discrepancies (19.00 must always be 19.00, never 19.01)
--
-- RULES:
-- 1. Social Security (employee, employer) & MLF: Round to NEAREST CENT (2 decimal places)
--    SQL: ROUND(value, 2)
--    Example: 19.004 -> 19.00, 19.005 -> 19.01
--
-- 2. Tax contributions: Round DOWN to EURO (0 decimal places, always round down)
--    SQL: FLOOR(value) or TRUNC(value)
--    Example: 19.9 -> 19, 19.1 -> 19, 19.0 -> 19
--
-- 3. Fixed contributions: Use exact values from social_security_classes table
--    (these are pre-rounded and stored as-is)
--
-- 4. Percentage-based contributions: Apply rounding AFTER percentage calculation
--    Formula: ROUND((percentage / 100) * wage, 2) for SS/MLF
--    Formula: FLOOR((percentage / 100) * wage) for tax
--    Do NOT round intermediate calculations; only round final result.
-- ============================================================================

-- Example: Compute social security contribution for a given wage and percentage
-- Employee earning €350/week at 10% + MLF 0.3%
SELECT
  350::numeric AS weekly_wage,
  10.0::numeric AS employee_pct,
  0.3::numeric AS mlf_pct,
  ROUND((10.0 / 100) * 350, 2) AS employee_contribution_ss,
  ROUND((0.3 / 100) * 350, 2) AS mlf_contribution;

-- Result:
-- weekly_wage | employee_pct | mlf_pct | employee_contribution_ss | mlf_contribution
-- 350         | 10.0         | 0.3     | 35.00                   | 1.05

-- Example: Apply rounding in a query joining to social_security_classes
-- (Demonstrates proper rounding in a payroll context)
WITH employee_payroll AS (
  SELECT
    'John' AS name,
    '1965-01-01'::date AS dob,
    350.00::numeric AS weekly_wage,
    2026 AS year
)
SELECT
  ep.name,
  ep.weekly_wage,
  ssc.class_code,
  CASE
    WHEN ssc.employee_fixed IS NOT NULL THEN ssc.employee_fixed
    WHEN ssc.employee_percentage IS NOT NULL THEN ROUND((ssc.employee_percentage / 100) * ep.weekly_wage, 2)
    ELSE NULL
  END AS employee_contribution,
  CASE
    WHEN ssc.mlf_fixed IS NOT NULL THEN ssc.mlf_fixed
    WHEN ssc.mlf_percentage IS NOT NULL THEN
      LEAST(
        ROUND((ssc.mlf_percentage / 100) * ep.weekly_wage, 2),
        COALESCE(ssc.mlf_max, ROUND((ssc.mlf_percentage / 100) * ep.weekly_wage, 2))
      )
    ELSE NULL
  END AS mlf_contribution
FROM employee_payroll ep
JOIN social_security_classes ssc ON ssc.year = ep.year
  AND ep.weekly_wage >= ssc.wage_from
  AND (ssc.wage_to IS NULL OR ep.weekly_wage <= ssc.wage_to)
  AND (ssc.dob_from IS NULL OR ep.dob >= ssc.dob_from)
  AND (ssc.dob_to IS NULL OR ep.dob <= ssc.dob_to);

-- ============================================================================
-- Key Points for Consistency:
-- ============================================================================
-- 1. Always apply ROUND() in queries that compute percentages, not just at display time
-- 2. Use ROUND(value, 2) immediately after (pct / 100) * wage, not later
-- 3. Fixed amounts from the DB should be used as-is (already rounded)
-- 4. MLF caps (mlf_max) should be compared AFTER rounding the percentage amount
-- 5. Test: if you calculate 19.005, confirm it always rounds to 19.01 in SQL and endpoint
-- 6. Test: if you calculate 19.004, confirm it always rounds to 19.00 in SQL and endpoint
-- ============================================================================
