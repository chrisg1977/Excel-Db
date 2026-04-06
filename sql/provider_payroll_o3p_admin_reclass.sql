-- Reclassify non-clinical provider-payroll entries to O3P (implemented as THIRDPARTY)
-- and mark them admin-only for visibility controls.

ALTER TABLE payroll_subscriptions
  ADD COLUMN IF NOT EXISTS visibility_scope TEXT NOT NULL DEFAULT 'STANDARD'
  CHECK (visibility_scope IN ('STANDARD', 'ADMIN_ONLY'));

COMMENT ON COLUMN payroll_subscriptions.visibility_scope IS
  'Visibility scope for payroll records. ADMIN_ONLY for sensitive O3P/third-party entries.';

-- Move Manager / Maintenance / HOME-coded entries out of PROVIDER payroll
-- into O3P pathway (mapped to THIRDPARTY in current schema).
UPDATE payroll_subscriptions ps
SET payroll_type = 'THIRDPARTY',
    visibility_scope = 'ADMIN_ONLY',
    updated_at = NOW()
FROM employees e
WHERE ps.employee_id = e.emp_id
  AND ps.payroll_type = 'PROVIDER'
  AND (
    COALESCE(e.position_held, '') ILIKE '%manager%'
    OR COALESCE(e.position_held, '') ILIKE '%maintenance%'
    OR COALESCE(ps.employment_number, '') ILIKE 'home%'
  );
