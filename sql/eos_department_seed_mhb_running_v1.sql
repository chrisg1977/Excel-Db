-- EOS canonical department seed: MHB_RUNNING (v1)
-- Purpose:
--   Ensure canonical department exists for alias mapping (MHB Running / MHB Running LAB).
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_department_seed_mhb_running_v1.sql

BEGIN;

-- Upsert-like behavior with explicit update + insert for broad PostgreSQL compatibility.
UPDATE departments
SET name = 'MHB Running'
WHERE upper(abbreviation) = 'MHB_RUNNING'
  AND coalesce(name, '') <> 'MHB Running';

INSERT INTO departments (abbreviation, name)
SELECT 'MHB_RUNNING', 'MHB Running'
WHERE NOT EXISTS (
  SELECT 1
  FROM departments
  WHERE upper(abbreviation) = 'MHB_RUNNING'
);

COMMIT;
