-- EOS centralized location model (v1)
-- Purpose:
--   Introduce a core location model shared by inventory and equipment.

BEGIN;

-- =========================================================
-- 1) DEPARTMENT FOUNDATION (UPSERT)
-- =========================================================

INSERT INTO inv_department (department_code, department_name, department_type, is_active)
VALUES
  ('ZABBAR', 'Zabbar', 'clinic', TRUE),
  ('QORMI', 'Qormi', 'clinic', TRUE),
  ('BLUM', 'BluM', 'retail', TRUE),
  ('MDCZ', 'Mediatrix Dental Clinic Zabbar', 'clinic', TRUE),
  ('MPLUS', 'Mplus', 'clinic', TRUE),
  ('CENTRAL_STORE', 'Central Store', 'warehouse', TRUE),
  ('VALLETTA', 'Valletta', 'clinic', TRUE)
ON CONFLICT (department_code) DO UPDATE
SET
  department_name = EXCLUDED.department_name,
  department_type = EXCLUDED.department_type,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- =========================================================
-- 2) CENTRALIZED LOCATION MASTER
-- =========================================================

CREATE TABLE IF NOT EXISTS inv_location (
  location_id BIGSERIAL PRIMARY KEY,
  location_code TEXT NOT NULL UNIQUE,
  location_name TEXT NOT NULL,
  department_id BIGINT NOT NULL REFERENCES inv_department(department_id),
  parent_location_id BIGINT REFERENCES inv_location(location_id),
  location_type TEXT NOT NULL CHECK (
    location_type IN ('store', 'cupboard', 'clinic', 'office', 'apartment', 'cabinet', 'warehouse', 'room', 'temporary', 'external')
  ),
  can_hold_stock BOOLEAN NOT NULL DEFAULT TRUE,
  can_receive_stock BOOLEAN NOT NULL DEFAULT TRUE,
  can_issue_stock BOOLEAN NOT NULL DEFAULT TRUE,
  is_equipment_location BOOLEAN NOT NULL DEFAULT FALSE,
  can_store_equipment BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  availability_status TEXT NOT NULL DEFAULT 'active' CHECK (
    availability_status IN ('active', 'inactive', 'rented_out', 'under_maintenance', 'unavailable', 'archived')
  ),
  notes TEXT,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  effective_to DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX IF NOT EXISTS ix_inv_location_department
  ON inv_location(department_id, is_active, availability_status);

CREATE INDEX IF NOT EXISTS ix_inv_location_parent
  ON inv_location(parent_location_id);

CREATE INDEX IF NOT EXISTS ix_inv_location_behavior
  ON inv_location(can_hold_stock, can_receive_stock, can_issue_stock, can_store_equipment);

-- =========================================================
-- 3) STOCK BY LOCATION + EQUIPMENT HOOKS
-- =========================================================

CREATE TABLE IF NOT EXISTS inv_stock_balance_location (
  product_id BIGINT NOT NULL REFERENCES inv_product(product_id),
  department_id BIGINT NOT NULL REFERENCES inv_department(department_id),
  location_id BIGINT NOT NULL REFERENCES inv_location(location_id),
  on_hand_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
  reserved_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
  in_transit_out_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
  in_transit_in_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
  available_qty NUMERIC(14,4) NOT NULL DEFAULT 0,
  avg_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  last_ledger_id BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, department_id, location_id)
);

CREATE INDEX IF NOT EXISTS ix_inv_stock_balance_location_department
  ON inv_stock_balance_location(department_id, location_id, available_qty);

CREATE TABLE IF NOT EXISTS inv_stock_in_transit_location (
  product_id BIGINT NOT NULL REFERENCES inv_product(product_id),
  source_department_id BIGINT NOT NULL REFERENCES inv_department(department_id),
  source_location_id BIGINT REFERENCES inv_location(location_id),
  target_department_id BIGINT NOT NULL REFERENCES inv_department(department_id),
  target_location_id BIGINT REFERENCES inv_location(location_id),
  in_transit_qty NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (in_transit_qty >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (product_id, source_department_id, source_location_id, target_department_id, target_location_id)
);

CREATE INDEX IF NOT EXISTS ix_inv_stock_in_transit_location_target
  ON inv_stock_in_transit_location(target_department_id, target_location_id, product_id);

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

-- =========================================================
-- 4) LOCATION COLUMNS ON DOCUMENT/LEDGER/TRANSFER
-- =========================================================

ALTER TABLE inv_document_header ADD COLUMN IF NOT EXISTS source_location_id BIGINT REFERENCES inv_location(location_id);
ALTER TABLE inv_document_header ADD COLUMN IF NOT EXISTS target_location_id BIGINT REFERENCES inv_location(location_id);

ALTER TABLE inv_ledger ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES inv_location(location_id);
ALTER TABLE inv_ledger ADD COLUMN IF NOT EXISTS source_location_id BIGINT REFERENCES inv_location(location_id);
ALTER TABLE inv_ledger ADD COLUMN IF NOT EXISTS target_location_id BIGINT REFERENCES inv_location(location_id);

ALTER TABLE inv_transfer_header ADD COLUMN IF NOT EXISTS source_location_id BIGINT REFERENCES inv_location(location_id);
ALTER TABLE inv_transfer_header ADD COLUMN IF NOT EXISTS target_location_id BIGINT REFERENCES inv_location(location_id);

CREATE INDEX IF NOT EXISTS ix_inv_transfer_header_source_target_location
  ON inv_transfer_header(source_department_id, source_location_id, target_department_id, target_location_id);

CREATE INDEX IF NOT EXISTS ix_inv_ledger_location
  ON inv_ledger(location_id, source_location_id, target_location_id);

-- =========================================================
-- 5) LOCATION-AWARE STOCK POSITION VIEW
-- =========================================================

CREATE OR REPLACE VIEW vw_inv_stock_position_by_department AS
SELECT
  l.product_id,
  l.department_id,
  SUM(l.qty_delta) AS on_hand_qty,
  SUM(l.value_delta) AS stock_value
FROM inv_ledger l
GROUP BY
  l.product_id,
  l.department_id;

CREATE OR REPLACE VIEW vw_inv_stock_position_by_location AS
SELECT
  l.product_id,
  l.department_id,
  l.location_id,
  SUM(l.qty_delta) AS on_hand_qty,
  SUM(l.value_delta) AS stock_value
FROM inv_ledger l
WHERE l.location_id IS NOT NULL
GROUP BY
  l.product_id,
  l.department_id,
  l.location_id;

CREATE OR REPLACE VIEW vw_inv_stock_position_expanded AS
SELECT
  s.department_id,
  d.department_code,
  d.department_name,
  s.location_id,
  loc.location_code,
  loc.location_name,
  s.product_id,
  p.sku,
  p.product_name,
  s.on_hand_qty,
  s.stock_value
FROM vw_inv_stock_position_by_location s
JOIN inv_department d ON d.department_id = s.department_id
JOIN inv_location loc ON loc.location_id = s.location_id
JOIN inv_product p ON p.product_id = s.product_id;

CREATE OR REPLACE VIEW vw_inv_equipment_by_location AS
SELECT
  e.equipment_id,
  e.asset_code,
  e.asset_name,
  e.asset_type,
  e.serial_number,
  d.department_code,
  l.location_code,
  l.location_name,
  e.status,
  e.updated_at
FROM inv_equipment_asset e
LEFT JOIN inv_department d ON d.department_id = e.department_id
LEFT JOIN inv_location l ON l.location_id = e.location_id;

-- =========================================================
-- 6) EMPLOYEE LOCATION SCOPE (OPTIONAL RESTRICTION LAYER)
-- =========================================================

CREATE TABLE IF NOT EXISTS app_user_location_scope (
  user_id BIGINT NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES inv_location(location_id) ON DELETE CASCADE,
  scope_level TEXT NOT NULL DEFAULT 'view' CHECK (scope_level IN ('view', 'post', 'approve', 'full')),
  PRIMARY KEY (user_id, location_id)
);

CREATE INDEX IF NOT EXISTS ix_app_user_location_scope_level
  ON app_user_location_scope(location_id, scope_level);

-- =========================================================
-- 7) LOCATION VALIDATION HELPER
-- =========================================================

CREATE OR REPLACE FUNCTION fn_inv_location_validate_transfer_v1(
  p_source_department_id BIGINT,
  p_source_location_id BIGINT,
  p_target_department_id BIGINT,
  p_target_location_id BIGINT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_source inv_location%ROWTYPE;
  v_target inv_location%ROWTYPE;
BEGIN
  IF p_source_location_id IS NOT NULL THEN
    SELECT * INTO v_source FROM inv_location WHERE location_id = p_source_location_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Source location % not found', p_source_location_id;
    END IF;
    IF v_source.department_id <> p_source_department_id THEN
      RAISE EXCEPTION 'Source location not in source department';
    END IF;
    IF v_source.is_active IS NOT TRUE OR v_source.availability_status <> 'active' THEN
      RAISE EXCEPTION 'Source location is not active/available';
    END IF;
    IF v_source.can_issue_stock IS NOT TRUE THEN
      RAISE EXCEPTION 'Source location cannot issue stock';
    END IF;
  END IF;

  IF p_target_location_id IS NOT NULL THEN
    SELECT * INTO v_target FROM inv_location WHERE location_id = p_target_location_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target location % not found', p_target_location_id;
    END IF;
    IF v_target.department_id <> p_target_department_id THEN
      RAISE EXCEPTION 'Target location not in target department';
    END IF;
    IF v_target.is_active IS NOT TRUE OR v_target.availability_status <> 'active' THEN
      RAISE EXCEPTION 'Target location is not active/available';
    END IF;
    IF v_target.can_receive_stock IS NOT TRUE THEN
      RAISE EXCEPTION 'Target location cannot receive stock';
    END IF;
  END IF;
END;
$$;

-- =========================================================
-- 8) V2 TRANSFER FUNCTIONS WITH LOCATION SUPPORT
-- =========================================================

CREATE OR REPLACE FUNCTION fn_inv_transfer_create_v2(
  p_source_department_id BIGINT,
  p_source_location_id BIGINT,
  p_target_department_id BIGINT,
  p_target_location_id BIGINT,
  p_created_by BIGINT,
  p_notes_sender TEXT,
  p_expected_arrival_date DATE,
  p_courier TEXT,
  p_transport_method TEXT,
  p_tracking_number TEXT,
  p_dispatch_reference TEXT,
  p_lines JSONB
)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  v_transfer_id BIGINT;
BEGIN
  PERFORM fn_inv_location_validate_transfer_v1(
    p_source_department_id,
    p_source_location_id,
    p_target_department_id,
    p_target_location_id
  );

  v_transfer_id := fn_inv_transfer_create_v1(
    p_source_department_id,
    p_target_department_id,
    p_created_by,
    p_notes_sender,
    p_expected_arrival_date,
    p_courier,
    p_transport_method,
    p_tracking_number,
    p_dispatch_reference,
    p_lines
  );

  UPDATE inv_transfer_header
  SET
    source_location_id = p_source_location_id,
    target_location_id = p_target_location_id
  WHERE transfer_id = v_transfer_id;

  UPDATE inv_document_header dh
  SET
    source_location_id = p_source_location_id,
    target_location_id = p_target_location_id
  FROM inv_transfer_header th
  WHERE th.transfer_id = v_transfer_id
    AND dh.document_id = th.document_id;

  RETURN v_transfer_id;
END;
$$;

CREATE OR REPLACE FUNCTION fn_inv_transfer_dispatch_v2(
  p_transfer_id BIGINT,
  p_dispatched_by BIGINT,
  p_sender_confirmation BOOLEAN,
  p_notes_sender TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_h inv_transfer_header%ROWTYPE;
BEGIN
  SELECT * INTO v_h FROM inv_transfer_header WHERE transfer_id = p_transfer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % not found', p_transfer_id;
  END IF;

  PERFORM fn_inv_transfer_dispatch_v1(p_transfer_id, p_dispatched_by, p_sender_confirmation, p_notes_sender);

  UPDATE inv_ledger l
  SET
    location_id = v_h.source_location_id,
    source_location_id = v_h.source_location_id,
    target_location_id = v_h.target_location_id
  WHERE l.document_id = v_h.document_id
    AND l.movement_reason_code = 'TRANSFER_OUT';

  INSERT INTO inv_stock_in_transit_location (
    product_id,
    source_department_id,
    source_location_id,
    target_department_id,
    target_location_id,
    in_transit_qty,
    updated_at
  )
  SELECT
    tl.product_id,
    v_h.source_department_id,
    v_h.source_location_id,
    v_h.target_department_id,
    v_h.target_location_id,
    tl.dispatched_qty,
    NOW()
  FROM inv_transfer_line tl
  WHERE tl.transfer_id = p_transfer_id
  ON CONFLICT (product_id, source_department_id, source_location_id, target_department_id, target_location_id)
  DO UPDATE
  SET
    in_transit_qty = inv_stock_in_transit_location.in_transit_qty + EXCLUDED.in_transit_qty,
    updated_at = NOW();

  -- deduct source location stock
  IF v_h.source_location_id IS NOT NULL THEN
    UPDATE inv_stock_balance_location s
    SET
      on_hand_qty = s.on_hand_qty - tl.dispatched_qty,
      available_qty = s.available_qty - tl.dispatched_qty,
      in_transit_out_qty = s.in_transit_out_qty + tl.dispatched_qty,
      updated_at = NOW()
    FROM inv_transfer_line tl
    WHERE tl.transfer_id = p_transfer_id
      AND tl.product_id = s.product_id
      AND s.department_id = v_h.source_department_id
      AND s.location_id = v_h.source_location_id;

    INSERT INTO inv_stock_balance_location (
      product_id, department_id, location_id, on_hand_qty, reserved_qty, in_transit_out_qty, in_transit_in_qty, available_qty, avg_cost, updated_at
    )
    SELECT
      tl.product_id,
      v_h.target_department_id,
      COALESCE(v_h.target_location_id, v_h.source_location_id),
      0,
      0,
      0,
      tl.dispatched_qty,
      0,
      tl.unit_cost,
      NOW()
    FROM inv_transfer_line tl
    WHERE tl.transfer_id = p_transfer_id
      AND v_h.target_location_id IS NOT NULL
    ON CONFLICT (product_id, department_id, location_id)
    DO UPDATE
    SET
      in_transit_in_qty = inv_stock_balance_location.in_transit_in_qty + EXCLUDED.in_transit_in_qty,
      updated_at = NOW();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION fn_inv_transfer_receive_v2(
  p_transfer_id BIGINT,
  p_received_by BIGINT,
  p_receiver_department_id BIGINT,
  p_receiver_location_id BIGINT,
  p_allow_department_override BOOLEAN,
  p_receiver_confirmation BOOLEAN,
  p_notes_receiver TEXT,
  p_lines JSONB
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_h inv_transfer_header%ROWTYPE;
  v_status TEXT;
BEGIN
  SELECT * INTO v_h FROM inv_transfer_header WHERE transfer_id = p_transfer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % not found', p_transfer_id;
  END IF;

  IF p_receiver_location_id IS NOT NULL THEN
    PERFORM fn_inv_location_validate_transfer_v1(
      v_h.source_department_id,
      v_h.source_location_id,
      p_receiver_department_id,
      p_receiver_location_id
    );
  END IF;

  v_status := fn_inv_transfer_receive_v1(
    p_transfer_id,
    p_received_by,
    p_receiver_department_id,
    p_allow_department_override,
    p_receiver_confirmation,
    p_notes_receiver,
    p_lines
  );

  UPDATE inv_ledger l
  SET
    location_id = COALESCE(p_receiver_location_id, v_h.target_location_id),
    source_location_id = v_h.source_location_id,
    target_location_id = COALESCE(p_receiver_location_id, v_h.target_location_id)
  WHERE l.document_id = v_h.document_id
    AND l.movement_reason_code IN ('TRANSFER_IN', 'WRITE_OFF_DAMAGED', 'WRITE_OFF_LOST');

  IF COALESCE(p_receiver_location_id, v_h.target_location_id) IS NOT NULL THEN
    INSERT INTO inv_stock_balance_location (
      product_id, department_id, location_id, on_hand_qty, reserved_qty, in_transit_out_qty, in_transit_in_qty, available_qty, avg_cost, updated_at
    )
    SELECT
      tl.product_id,
      v_h.target_department_id,
      COALESCE(p_receiver_location_id, v_h.target_location_id),
      0,
      0,
      0,
      0,
      0,
      tl.unit_cost,
      NOW()
    FROM inv_transfer_line tl
    WHERE tl.transfer_id = p_transfer_id
    ON CONFLICT (product_id, department_id, location_id)
    DO NOTHING;

    UPDATE inv_stock_balance_location s
    SET
      on_hand_qty = s.on_hand_qty + d.received_now,
      available_qty = s.available_qty + d.received_now,
      in_transit_in_qty = GREATEST(s.in_transit_in_qty - d.processed_now, 0),
      updated_at = NOW()
    FROM (
      SELECT
        tl.product_id,
        SUM(tl.received_qty) AS received_now,
        SUM(tl.received_qty + tl.damaged_qty + tl.lost_qty) AS processed_now
      FROM inv_transfer_line tl
      WHERE tl.transfer_id = p_transfer_id
      GROUP BY tl.product_id
    ) d
    WHERE s.product_id = d.product_id
      AND s.department_id = v_h.target_department_id
      AND s.location_id = COALESCE(p_receiver_location_id, v_h.target_location_id);

    UPDATE inv_stock_in_transit_location t
    SET
      in_transit_qty = GREATEST(t.in_transit_qty - d.processed_now, 0),
      updated_at = NOW()
    FROM (
      SELECT
        tl.product_id,
        SUM(tl.received_qty + tl.damaged_qty + tl.lost_qty) AS processed_now
      FROM inv_transfer_line tl
      WHERE tl.transfer_id = p_transfer_id
      GROUP BY tl.product_id
    ) d
    WHERE t.product_id = d.product_id
      AND t.source_department_id = v_h.source_department_id
      AND t.target_department_id = v_h.target_department_id
      AND t.source_location_id IS NOT DISTINCT FROM v_h.source_location_id
      AND t.target_location_id IS NOT DISTINCT FROM COALESCE(p_receiver_location_id, v_h.target_location_id);
  END IF;

  RETURN v_status;
END;
$$;

-- =========================================================
-- 9) LOCATION SEED DATA
-- =========================================================

WITH dept AS (
  SELECT department_id, department_code
  FROM inv_department
  WHERE department_code IN ('ZABBAR','QORMI','VALLETTA','BLUM')
),
seed(location_code, location_name, department_code, parent_code, location_type, can_hold_stock, can_receive_stock, can_issue_stock, is_equipment_location, can_store_equipment, availability_status, notes) AS (
  VALUES
  ('ZAB_MARY_STORE', 'Zabbar Mary Store', 'ZABBAR', NULL, 'store', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('ZAB_WHITE_CUPBOARD', 'Zabbar White Cupboard', 'ZABBAR', NULL, 'cupboard', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('ZAB_CLINIC_DENTAL_1', 'Zabbar Clinic Dental 1', 'ZABBAR', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('ZAB_CLINIC_DENTAL_2', 'Zabbar Clinic Dental 2', 'ZABBAR', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('ZAB_CLINIC_DENTAL_3', 'Zabbar Clinic Dental 3', 'ZABBAR', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('ZAB_CLINIC_DENTAL_4', 'Zabbar Clinic Dental 4', 'ZABBAR', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('ZAB_CLINIC_DENTAL_5', 'Zabbar Clinic Dental 5', 'ZABBAR', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('ZAB_CLINIC_DENTAL_6', 'Zabbar Clinic Dental 6', 'ZABBAR', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('ZAB_CLINIC_DENTAL_7', 'Zabbar Clinic Dental 7', 'ZABBAR', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('ZAB_CLINIC_DENTAL_STAFF', 'Zabbar Clinic Dental STAFF', 'ZABBAR', NULL, 'room', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('ZAB_CLINIC_MPLUS_4', 'Zabbar Clinic MPLUS 4', 'ZABBAR', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('ZAB_CLINIC_MPLUS_6', 'Zabbar Clinic MPLUS 6', 'ZABBAR', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('ZAB_CLINIC_MPLUS_7', 'Zabbar Clinic MPLUS 7', 'ZABBAR', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('ZAB_CLINIC_MPLUS_8', 'Zabbar Clinic MPLUS 8', 'ZABBAR', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('ZAB_CLINIC_MPLUS_9', 'Zabbar Clinic MPLUS 9', 'ZABBAR', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('ZAB_ROOF_STORE', 'Zabbar Roof Store', 'ZABBAR', NULL, 'store', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('ZAB_CHRIS_OFFICE', 'Chris Zabbar Office', 'ZABBAR', NULL, 'office', TRUE, FALSE, FALSE, TRUE, TRUE, 'active', NULL),
  ('ZAB_MANAGER_OFFICE', 'Zabbar Manager Office', 'ZABBAR', NULL, 'office', TRUE, FALSE, FALSE, TRUE, TRUE, 'active', NULL),
  ('ZAB_2ND_FLOOR', 'Zabbar 2nd Floor', 'ZABBAR', NULL, 'room', TRUE, TRUE, FALSE, FALSE, FALSE, 'active', NULL),
  ('ZAB_PHARMACY_STORE', 'Zabbar Pharmacy Store', 'ZABBAR', NULL, 'store', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('ZAB_PHARMACY', 'Zabbar Pharmacy', 'ZABBAR', NULL, 'room', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('ZAB_WAITING_DISPLAY_1', 'Zabbar Waiting Room Display 1', 'ZABBAR', NULL, 'room', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),

  ('QOR_CLINIC_STORE', 'Qormi Clinic Store', 'QORMI', NULL, 'store', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('QOR_BASEMENT_STORE', 'Qormi Basement Store', 'QORMI', NULL, 'store', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('QOR_WAITING_DISPLAY_1', 'Qormi Waiting Room Display 1', 'QORMI', NULL, 'room', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('QOR_WAITING_DISPLAY_2', 'Qormi Waiting Room Display 2', 'QORMI', NULL, 'room', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('QOR_RECEPTION_SALE', 'Qormi Reception Sale Items', 'QORMI', NULL, 'room', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('QOR_CLINIC_1', 'Qormi Clinic 1', 'QORMI', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('QOR_CLINIC_2', 'Qormi Clinic 2', 'QORMI', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('QOR_CLINIC_3', 'Qormi Clinic 3', 'QORMI', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('QOR_CLINIC_4', 'Qormi Clinic 4', 'QORMI', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('QOR_CLINIC_5', 'Qormi Clinic 5', 'QORMI', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('QOR_CLINIC_6', 'Qormi Clinic 6', 'QORMI', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('QOR_CLINIC_7', 'Qormi Clinic 7', 'QORMI', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('QOR_CLINIC_8', 'Qormi Clinic 8', 'QORMI', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('QOR_LEVEL_1_STORE', 'Qormi Level 1 Store', 'QORMI', NULL, 'store', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('QOR_LEVEL_2_STORE', 'Qormi Level 2 Store', 'QORMI', NULL, 'store', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('QOR_LEVEL_3_STORE', 'Qormi Level 3 Store', 'QORMI', NULL, 'store', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('QOR_LEVEL_4_STORE', 'Qormi Level 4 Store', 'QORMI', NULL, 'store', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('QOR_FLEX', 'Flex', 'QORMI', NULL, 'temporary', TRUE, TRUE, TRUE, TRUE, TRUE, 'active', NULL),
  ('QOR_CHRIS_OFFICE', 'Chris Qormi Office', 'QORMI', NULL, 'office', TRUE, FALSE, FALSE, TRUE, TRUE, 'active', NULL),
  ('QOR_MANAGER_OFFICE', 'Qormi Manager Office', 'QORMI', NULL, 'office', TRUE, FALSE, FALSE, TRUE, TRUE, 'active', NULL),
  ('QOR_BLUM_CENTRAL', 'Qormi BLUM CENTRAL', 'QORMI', NULL, 'external', TRUE, TRUE, FALSE, TRUE, TRUE, 'active', NULL),
  ('QOR_BLUM_APT_1', 'Apartment 1', 'QORMI', 'QOR_BLUM_CENTRAL', 'apartment', TRUE, TRUE, FALSE, TRUE, TRUE, 'active', NULL),
  ('QOR_BLUM_APT_2', 'Apartment 2', 'QORMI', 'QOR_BLUM_CENTRAL', 'apartment', TRUE, TRUE, FALSE, TRUE, TRUE, 'active', NULL),
  ('QOR_BLUM_APT_3', 'Apartment 3', 'QORMI', 'QOR_BLUM_CENTRAL', 'apartment', TRUE, TRUE, FALSE, TRUE, TRUE, 'active', NULL),
  ('QOR_BLUM_APT_4', 'Apartment 4', 'QORMI', 'QOR_BLUM_CENTRAL', 'apartment', TRUE, TRUE, FALSE, TRUE, TRUE, 'active', NULL),
  ('QOR_BLUM_APT_5', 'Apartment 5', 'QORMI', 'QOR_BLUM_CENTRAL', 'apartment', TRUE, TRUE, FALSE, TRUE, TRUE, 'active', NULL),
  ('QOR_BLUM_APT_6', 'Apartment 6', 'QORMI', 'QOR_BLUM_CENTRAL', 'apartment', TRUE, TRUE, FALSE, TRUE, TRUE, 'active', NULL),
  ('QOR_BLUM_APT_7', 'Apartment 7', 'QORMI', 'QOR_BLUM_CENTRAL', 'apartment', TRUE, TRUE, FALSE, TRUE, TRUE, 'active', NULL),
  ('QOR_BLUM_APT_8', 'Apartment 8', 'QORMI', 'QOR_BLUM_CENTRAL', 'apartment', TRUE, TRUE, FALSE, TRUE, TRUE, 'active', NULL),
  ('QOR_BLUM_APT_9', 'Apartment 9', 'QORMI', 'QOR_BLUM_CENTRAL', 'apartment', TRUE, TRUE, FALSE, TRUE, TRUE, 'active', NULL),
  ('QOR_BLUM_APT_10', 'Apartment 10', 'QORMI', 'QOR_BLUM_CENTRAL', 'apartment', TRUE, TRUE, FALSE, TRUE, TRUE, 'active', NULL),
  ('QOR_BLUM_APT_11', 'Apartment 11', 'QORMI', 'QOR_BLUM_CENTRAL', 'apartment', TRUE, TRUE, FALSE, TRUE, TRUE, 'active', NULL),
  ('QOR_BLUM_APT_12', 'Apartment 12', 'QORMI', 'QOR_BLUM_CENTRAL', 'apartment', TRUE, TRUE, FALSE, TRUE, TRUE, 'active', NULL),

  ('VALLETTA_MAIN', 'Valletta', 'VALLETTA', NULL, 'clinic', TRUE, TRUE, TRUE, FALSE, FALSE, 'active', NULL),
  ('BLUM_GZIRA_BEDROOM_CUPBOARD_1', 'Gzira BluM City Cupboard Bedroom 1', 'BLUM', NULL, 'cupboard', TRUE, TRUE, FALSE, TRUE, TRUE, 'active', NULL),
  ('BLUM_GZIRA_CABINET', 'Gzira BluM City Cabinet', 'BLUM', NULL, 'cabinet', TRUE, TRUE, FALSE, TRUE, TRUE, 'active', NULL)
),
upsert_base AS (
  INSERT INTO inv_location (
    location_code,
    location_name,
    department_id,
    parent_location_id,
    location_type,
    can_hold_stock,
    can_receive_stock,
    can_issue_stock,
    is_equipment_location,
    can_store_equipment,
    is_active,
    availability_status,
    notes
  )
  SELECT
    s.location_code,
    s.location_name,
    d.department_id,
    NULL,
    s.location_type,
    s.can_hold_stock,
    s.can_receive_stock,
    s.can_issue_stock,
    s.is_equipment_location,
    s.can_store_equipment,
    TRUE,
    s.availability_status,
    s.notes
  FROM seed s
  JOIN dept d ON d.department_code = s.department_code
  ON CONFLICT (location_code) DO UPDATE
  SET
    location_name = EXCLUDED.location_name,
    department_id = EXCLUDED.department_id,
    location_type = EXCLUDED.location_type,
    can_hold_stock = EXCLUDED.can_hold_stock,
    can_receive_stock = EXCLUDED.can_receive_stock,
    can_issue_stock = EXCLUDED.can_issue_stock,
    is_equipment_location = EXCLUDED.is_equipment_location,
    can_store_equipment = EXCLUDED.can_store_equipment,
    is_active = EXCLUDED.is_active,
    availability_status = EXCLUDED.availability_status,
    notes = EXCLUDED.notes,
    updated_at = NOW()
  RETURNING 1
)
SELECT COUNT(*) FROM upsert_base;

UPDATE inv_location child
SET parent_location_id = parent.location_id,
    updated_at = NOW()
FROM inv_location parent
WHERE child.location_code IN (
  'QOR_BLUM_APT_1','QOR_BLUM_APT_2','QOR_BLUM_APT_3','QOR_BLUM_APT_4','QOR_BLUM_APT_5','QOR_BLUM_APT_6',
  'QOR_BLUM_APT_7','QOR_BLUM_APT_8','QOR_BLUM_APT_9','QOR_BLUM_APT_10','QOR_BLUM_APT_11','QOR_BLUM_APT_12'
)
AND parent.location_code = 'QOR_BLUM_CENTRAL';

COMMIT;
