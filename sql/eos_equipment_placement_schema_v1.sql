-- EOS equipment placement schema (v1)
-- Purpose:
--   Basic equipment/asset placement using centralized department/location model,
--   with movement audit history (moved_by, moved_at, from/to location).
--
-- Scope:
--   - No depreciation/accounting logic.
--   - Placement and movement audit only.

BEGIN;

CREATE TABLE IF NOT EXISTS inv_equipment_asset (
  equipment_id BIGSERIAL PRIMARY KEY,
  asset_code TEXT NOT NULL UNIQUE,
  asset_name TEXT NOT NULL,
  asset_type TEXT,
  serial_number TEXT,
  department_id BIGINT REFERENCES inv_department(department_id),
  location_id BIGINT REFERENCES inv_location(location_id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'maintenance', 'retired')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_inv_equipment_asset_department
  ON inv_equipment_asset(department_id, status);

CREATE INDEX IF NOT EXISTS ix_inv_equipment_asset_location
  ON inv_equipment_asset(location_id, status);

CREATE INDEX IF NOT EXISTS ix_inv_equipment_asset_code
  ON inv_equipment_asset(asset_code);

CREATE TABLE IF NOT EXISTS inv_equipment_location_history (
  history_id BIGSERIAL PRIMARY KEY,
  equipment_id BIGINT NOT NULL REFERENCES inv_equipment_asset(equipment_id) ON DELETE CASCADE,
  from_department_id BIGINT REFERENCES inv_department(department_id),
  from_location_id BIGINT REFERENCES inv_location(location_id),
  to_department_id BIGINT REFERENCES inv_department(department_id),
  to_location_id BIGINT REFERENCES inv_location(location_id),
  moved_by BIGINT REFERENCES app_user(user_id),
  moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reason TEXT
);

CREATE INDEX IF NOT EXISTS ix_inv_equipment_location_history_equipment
  ON inv_equipment_location_history(equipment_id, moved_at DESC);

CREATE INDEX IF NOT EXISTS ix_inv_equipment_location_history_to
  ON inv_equipment_location_history(to_department_id, to_location_id, moved_at DESC);

CREATE INDEX IF NOT EXISTS ix_inv_equipment_location_history_from
  ON inv_equipment_location_history(from_department_id, from_location_id, moved_at DESC);

COMMIT;
