-- EOS location lifecycle hardening (v1)
-- Purpose:
--   Enforce soft-lifecycle behavior for locations and preserve historical references.

BEGIN;

-- 1) Lifecycle history for status/mode changes.
CREATE TABLE IF NOT EXISTS inv_location_lifecycle_history (
  history_id BIGSERIAL PRIMARY KEY,
  location_id BIGINT NOT NULL REFERENCES inv_location(location_id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by BIGINT REFERENCES app_user(user_id),
  change_reason TEXT,
  old_values JSONB,
  new_values JSONB
);

CREATE INDEX IF NOT EXISTS ix_inv_location_lifecycle_location_ts
  ON inv_location_lifecycle_history(location_id, changed_at DESC);

-- 2) Prevent hard-delete to preserve historical references.
CREATE OR REPLACE FUNCTION fn_inv_location_prevent_delete_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Hard delete is disabled for inv_location. Set is_active=false and availability_status instead.';
END;
$$;

DROP TRIGGER IF EXISTS trg_inv_location_prevent_delete ON inv_location;
CREATE TRIGGER trg_inv_location_prevent_delete
BEFORE DELETE ON inv_location
FOR EACH ROW EXECUTE FUNCTION fn_inv_location_prevent_delete_v1();

-- 3) Track lifecycle-relevant field changes.
CREATE OR REPLACE FUNCTION fn_inv_location_lifecycle_audit_v1()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    NEW.location_name IS DISTINCT FROM OLD.location_name OR
    NEW.location_type IS DISTINCT FROM OLD.location_type OR
    NEW.can_hold_stock IS DISTINCT FROM OLD.can_hold_stock OR
    NEW.can_receive_stock IS DISTINCT FROM OLD.can_receive_stock OR
    NEW.can_issue_stock IS DISTINCT FROM OLD.can_issue_stock OR
    NEW.is_equipment_location IS DISTINCT FROM OLD.is_equipment_location OR
    NEW.can_store_equipment IS DISTINCT FROM OLD.can_store_equipment OR
    NEW.is_active IS DISTINCT FROM OLD.is_active OR
    NEW.availability_status IS DISTINCT FROM OLD.availability_status OR
    NEW.effective_from IS DISTINCT FROM OLD.effective_from OR
    NEW.effective_to IS DISTINCT FROM OLD.effective_to OR
    NEW.parent_location_id IS DISTINCT FROM OLD.parent_location_id OR
    NEW.department_id IS DISTINCT FROM OLD.department_id
  ) THEN
    INSERT INTO inv_location_lifecycle_history (
      location_id,
      old_values,
      new_values
    )
    VALUES (
      NEW.location_id,
      to_jsonb(OLD),
      to_jsonb(NEW)
    );
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inv_location_lifecycle_audit ON inv_location;
CREATE TRIGGER trg_inv_location_lifecycle_audit
BEFORE UPDATE ON inv_location
FOR EACH ROW EXECUTE FUNCTION fn_inv_location_lifecycle_audit_v1();

-- 4) Operating mode view for inventory/equipment lifecycle handling.
CREATE OR REPLACE VIEW vw_inv_location_operating_mode AS
SELECT
  l.location_id,
  l.location_code,
  l.location_name,
  l.department_id,
  d.department_code,
  l.location_type,
  l.can_hold_stock,
  l.can_receive_stock,
  l.can_issue_stock,
  l.is_equipment_location,
  l.can_store_equipment,
  l.is_active,
  l.availability_status,
  l.effective_from,
  l.effective_to,
  CASE
    WHEN l.is_active IS NOT TRUE OR l.availability_status IN ('inactive', 'rented_out', 'under_maintenance', 'unavailable', 'archived')
      THEN 'inactive_or_unavailable'
    WHEN l.can_hold_stock = TRUE AND (l.is_equipment_location = FALSE OR l.can_store_equipment = FALSE)
      THEN 'stock_enabled'
    WHEN l.can_hold_stock = FALSE AND (l.is_equipment_location = TRUE OR l.can_store_equipment = TRUE)
      THEN 'equipment_only'
    WHEN l.can_hold_stock = TRUE AND (l.is_equipment_location = TRUE OR l.can_store_equipment = TRUE)
      THEN 'mixed_stock_and_equipment'
    ELSE 'other'
  END AS operating_mode
FROM inv_location l
JOIN inv_department d ON d.department_id = l.department_id;

COMMIT;
