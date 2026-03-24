-- EOS inventory roles and department scoping seed (v1)
-- Purpose:
--   Seed suggested inventory roles.
--   Seed a baseline role-permission matrix.
--   Provide an effective department-scope view for safe authorization checks.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_inventory_roles_and_scope_seed_v1.sql

BEGIN;

-- =========================================================
-- 1. ROLE CATALOG
-- =========================================================

INSERT INTO app_role (role_code, role_name, is_active)
VALUES
  ('inventory_admin', 'Inventory Admin', TRUE),
  ('store_manager', 'Store Manager', TRUE),
  ('department_manager', 'Department Manager', TRUE),
  ('reception_user', 'Reception User', TRUE),
  ('cashier', 'Cashier', TRUE),
  ('procurement_officer', 'Procurement Officer', TRUE),
  ('clinic_user', 'Clinic User', TRUE),
  ('auditor', 'Auditor', TRUE)
ON CONFLICT (role_code) DO UPDATE
SET
  role_name = EXCLUDED.role_name,
  is_active = EXCLUDED.is_active;

-- =========================================================
-- 2. BASELINE ROLE-PERMISSION MATRIX
-- =========================================================

WITH role_perm(role_code, permission_code) AS (
  VALUES
    -- Inventory admin: full operational access
    ('inventory_admin', 'inv.product.view'),
    ('inventory_admin', 'inv.product.edit'),
    ('inventory_admin', 'inv.stock.view'),
    ('inventory_admin', 'inv.stock.post'),
    ('inventory_admin', 'inv.stock.adjust'),
    ('inventory_admin', 'inv.transfer.create'),
    ('inventory_admin', 'inv.transfer.approve'),
    ('inventory_admin', 'inv.procurement.create'),
    ('inventory_admin', 'inv.procurement.approve'),
    ('inventory_admin', 'inv.reorder.view'),
    ('inventory_admin', 'inv.reorder.convert'),
    ('inventory_admin', 'inv.consumption.post'),
    ('inventory_admin', 'sell.post'),
    ('inventory_admin', 'admin.global'),

    -- Store manager
    ('store_manager', 'inv.product.view'),
    ('store_manager', 'inv.product.edit'),
    ('store_manager', 'inv.stock.view'),
    ('store_manager', 'inv.stock.post'),
    ('store_manager', 'inv.stock.adjust'),
    ('store_manager', 'inv.transfer.create'),
    ('store_manager', 'inv.transfer.approve'),
    ('store_manager', 'inv.reorder.view'),
    ('store_manager', 'inv.reorder.convert'),

    -- Department manager
    ('department_manager', 'inv.product.view'),
    ('department_manager', 'inv.stock.view'),
    ('department_manager', 'inv.stock.post'),
    ('department_manager', 'inv.stock.adjust'),
    ('department_manager', 'inv.transfer.create'),
    ('department_manager', 'inv.consumption.post'),
    ('department_manager', 'inv.reorder.view'),

    -- Reception user
    ('reception_user', 'inv.product.view'),
    ('reception_user', 'inv.stock.view'),

    -- Cashier
    ('cashier', 'inv.product.view'),
    ('cashier', 'inv.stock.view'),
    ('cashier', 'sell.post'),

    -- Procurement officer
    ('procurement_officer', 'inv.product.view'),
    ('procurement_officer', 'inv.stock.view'),
    ('procurement_officer', 'inv.procurement.create'),
    ('procurement_officer', 'inv.procurement.approve'),
    ('procurement_officer', 'inv.reorder.view'),
    ('procurement_officer', 'inv.reorder.convert'),

    -- Clinic user
    ('clinic_user', 'inv.product.view'),
    ('clinic_user', 'inv.stock.view'),
    ('clinic_user', 'inv.consumption.post'),

    -- Auditor
    ('auditor', 'inv.product.view'),
    ('auditor', 'inv.stock.view'),
    ('auditor', 'inv.reorder.view')
)
INSERT INTO app_role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role_perm rp
JOIN app_role r
  ON r.role_code = rp.role_code
JOIN app_permission p
  ON p.permission_code = rp.permission_code
ON CONFLICT DO NOTHING;

-- =========================================================
-- 3. EFFECTIVE DEPARTMENT SCOPE VIEW
-- =========================================================

-- Full/global behavior:
--   If user has admin.global permission via any role, effective scope is full
--   for all active departments.
-- Scoped behavior:
--   Otherwise, scope is taken from app_user_department_scope per department.
--   Missing row => no access.
CREATE OR REPLACE VIEW vw_app_user_effective_department_scope AS
SELECT
  u.user_id,
  d.department_id,
  d.department_code,
  d.department_name,
  CASE
    WHEN EXISTS (
      SELECT 1
      FROM app_user_role ur
      JOIN app_role_permission rp
        ON rp.role_id = ur.role_id
      JOIN app_permission p
        ON p.permission_id = rp.permission_id
      WHERE ur.user_id = u.user_id
        AND p.permission_code = 'admin.global'
    ) THEN 'full'::text
    ELSE (
      SELECT s.scope_level
      FROM app_user_department_scope s
      WHERE s.user_id = u.user_id
        AND s.department_id = d.department_id
    )
  END AS effective_scope_level
FROM app_user u
JOIN inv_department d
  ON d.is_active = TRUE
WHERE u.is_active = TRUE;

COMMIT;

-- Usage examples:
-- 1) User can view only ZABBAR:
--    insert into app_user_department_scope(user_id, department_id, scope_level)
--    values (:user_id, :zabbar_department_id, 'view');
--
-- 2) Same user can post only BLUM and approve only MDCZ:
--    insert into app_user_department_scope(user_id, department_id, scope_level)
--    values (:user_id, :blum_department_id, 'post')
--    on conflict (user_id, department_id) do update set scope_level = excluded.scope_level;
--
--    insert into app_user_department_scope(user_id, department_id, scope_level)
--    values (:user_id, :mdcz_department_id, 'approve')
--    on conflict (user_id, department_id) do update set scope_level = excluded.scope_level;
