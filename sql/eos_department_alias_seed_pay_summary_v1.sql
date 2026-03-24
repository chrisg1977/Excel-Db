-- EOS department alias seeds for PAY SUMMARY category normalization (v1)
-- Purpose:
--   Ensure PAY SUMMARY labels like "MHB Running LAB" resolve to canonical department MHB_RUNNING.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_department_alias_seed_pay_summary_v1.sql
--
-- Assumption:
--   department_alias columns include: department_id, alias_raw, alias_norm, source_system, is_active.
--   If your deployed table differs, adjust INSERT columns accordingly.

BEGIN;

WITH mhb_running AS (
  SELECT dept_id
  FROM departments
  WHERE abbreviation = 'MHB_RUNNING'
  LIMIT 1
)
INSERT INTO department_alias (
  department_id,
  alias_raw,
  alias_norm,
  source_system,
  is_active
)
SELECT m.dept_id, v.alias_raw, v.alias_norm, 'pay_summary_seed_v1', TRUE
FROM mhb_running m
CROSS JOIN (
  VALUES
    ('MHB Running', 'MHB_RUNNING'),
    ('MHB Running LAB', 'MHB_RUNNING_LAB')
) AS v(alias_raw, alias_norm)
ON CONFLICT (alias_norm)
DO UPDATE SET
  department_id = EXCLUDED.department_id,
  alias_raw = EXCLUDED.alias_raw,
  source_system = EXCLUDED.source_system,
  is_active = EXCLUDED.is_active;

-- Safety check: if this returns 0 rows, canonical department MHB_RUNNING is missing.
SELECT COUNT(*) AS mapped_alias_rows_for_mhb_running
FROM department_alias
WHERE alias_norm IN ('MHB_RUNNING', 'MHB_RUNNING_LAB')
  AND is_active = TRUE;

COMMIT;
