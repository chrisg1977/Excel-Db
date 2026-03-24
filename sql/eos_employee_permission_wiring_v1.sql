-- EOS employee-form permission wiring (v1)
-- Purpose:
--   Make employee maintenance the source of truth for inventory/SELL access.

BEGIN;

-- Link app_user to employee master when employees table exists.
DO $$
DECLARE
  v_employee_pk TEXT;
BEGIN
  IF to_regclass('public.employees') IS NOT NULL THEN
    ALTER TABLE app_user ADD COLUMN IF NOT EXISTS employee_id BIGINT;

    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'employees'
        AND column_name = 'emp_id'
    ) THEN
      v_employee_pk := 'emp_id';
    ELSIF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'employees'
        AND column_name = 'id'
    ) THEN
      v_employee_pk := 'id';
    ELSE
      v_employee_pk := NULL;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'app_user_employee_fk'
    ) AND v_employee_pk IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE app_user ADD CONSTRAINT app_user_employee_fk FOREIGN KEY (employee_id) REFERENCES employees(%I) ON DELETE SET NULL',
        v_employee_pk
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'app_user_employee_uk'
    ) THEN
      ALTER TABLE app_user
        ADD CONSTRAINT app_user_employee_uk UNIQUE (employee_id);
    END IF;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS eos_employee_inventory_access (
  employee_id BIGINT PRIMARY KEY,
  inventory_access_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sell_access_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  can_approve_sensitive BOOLEAN NOT NULL DEFAULT FALSE,
  can_override_department_scope BOOLEAN NOT NULL DEFAULT FALSE,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  inactive_from DATE,
  updated_by BIGINT REFERENCES app_user(user_id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (inactive_from IS NULL OR inactive_from >= effective_from)
);

CREATE TABLE IF NOT EXISTS eos_employee_permission_override (
  employee_id BIGINT NOT NULL,
  permission_id BIGINT NOT NULL REFERENCES app_permission(permission_id) ON DELETE CASCADE,
  is_enabled BOOLEAN NOT NULL,
  updated_by BIGINT REFERENCES app_user(user_id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, permission_id)
);

CREATE TABLE IF NOT EXISTS eos_employee_department_scope (
  employee_id BIGINT NOT NULL,
  department_id BIGINT NOT NULL REFERENCES inv_department(department_id) ON DELETE CASCADE,
  scope_level TEXT NOT NULL CHECK (scope_level IN ('view', 'post', 'approve', 'full')),
  updated_by BIGINT REFERENCES app_user(user_id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, department_id)
);

CREATE INDEX IF NOT EXISTS ix_eos_employee_scope_department
  ON eos_employee_department_scope(department_id, scope_level);

CREATE INDEX IF NOT EXISTS ix_eos_employee_access_enabled
  ON eos_employee_inventory_access(inventory_access_enabled, sell_access_enabled);

-- Effective permissions: role grants + per-employee overrides, filtered by active employee access window.
CREATE OR REPLACE VIEW vw_eos_employee_effective_permissions AS
WITH base AS (
  SELECT
    a.employee_id,
    p.permission_id,
    p.permission_code,
    TRUE AS granted
  FROM eos_employee_inventory_access a
  JOIN app_user u ON u.employee_id = a.employee_id
  JOIN app_user_role ur ON ur.user_id = u.user_id
  JOIN app_role_permission rp ON rp.role_id = ur.role_id
  JOIN app_permission p ON p.permission_id = rp.permission_id
  WHERE a.inventory_access_enabled = TRUE
    AND a.effective_from <= CURRENT_DATE
    AND (a.inactive_from IS NULL OR a.inactive_from > CURRENT_DATE)
),
overrides AS (
  SELECT
    o.employee_id,
    p.permission_id,
    p.permission_code,
    o.is_enabled AS granted
  FROM eos_employee_permission_override o
  JOIN app_permission p ON p.permission_id = o.permission_id
)
SELECT DISTINCT ON (employee_id, permission_code)
  employee_id,
  permission_id,
  permission_code,
  granted
FROM (
  SELECT * FROM base
  UNION ALL
  SELECT * FROM overrides
) x
ORDER BY employee_id, permission_code, granted DESC;

-- Effective department scope for employee form managed model.
CREATE OR REPLACE VIEW vw_eos_employee_effective_department_scope AS
SELECT
  a.employee_id,
  d.department_id,
  d.department_code,
  d.department_name,
  COALESCE(s.scope_level, 'none') AS scope_level,
  a.can_override_department_scope,
  EXISTS (
    SELECT 1
    FROM vw_eos_employee_effective_permissions ep
    WHERE ep.employee_id = a.employee_id
      AND ep.permission_code = 'admin.global'
      AND ep.granted = TRUE
  ) AS is_global_admin
FROM eos_employee_inventory_access a
CROSS JOIN inv_department d
LEFT JOIN eos_employee_department_scope s
  ON s.employee_id = a.employee_id
 AND s.department_id = d.department_id
WHERE a.inventory_access_enabled = TRUE
  AND a.effective_from <= CURRENT_DATE
  AND (a.inactive_from IS NULL OR a.inactive_from > CURRENT_DATE)
  AND d.is_active = TRUE;

COMMIT;
