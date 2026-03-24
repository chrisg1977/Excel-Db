-- EOS equipment supplier/lifecycle extension (v1)
-- Adds purchasing + warranty fields for equipment assets.

BEGIN;

ALTER TABLE inv_equipment_asset
  ADD COLUMN IF NOT EXISTS supplier_id BIGINT REFERENCES inv_supplier(supplier_id),
  ADD COLUMN IF NOT EXISTS purchase_date DATE,
  ADD COLUMN IF NOT EXISTS purchase_cost NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS warranty_start_date DATE,
  ADD COLUMN IF NOT EXISTS warranty_expiry_date DATE,
  ADD COLUMN IF NOT EXISTS invoice_reference TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE inv_equipment_asset
  DROP CONSTRAINT IF EXISTS ck_inv_equipment_asset_purchase_cost_nonnegative;

ALTER TABLE inv_equipment_asset
  ADD CONSTRAINT ck_inv_equipment_asset_purchase_cost_nonnegative
  CHECK (purchase_cost IS NULL OR purchase_cost >= 0);

ALTER TABLE inv_equipment_asset
  DROP CONSTRAINT IF EXISTS ck_inv_equipment_asset_warranty_date_order;

ALTER TABLE inv_equipment_asset
  ADD CONSTRAINT ck_inv_equipment_asset_warranty_date_order
  CHECK (
    warranty_start_date IS NULL
    OR warranty_expiry_date IS NULL
    OR warranty_start_date <= warranty_expiry_date
  );

CREATE INDEX IF NOT EXISTS ix_inv_equipment_asset_supplier
  ON inv_equipment_asset(supplier_id, is_active, status);

CREATE INDEX IF NOT EXISTS ix_inv_equipment_asset_warranty_expiry
  ON inv_equipment_asset(warranty_expiry_date)
  WHERE warranty_expiry_date IS NOT NULL;

COMMIT;
