BEGIN;

-- =========================================================
-- SUPPLIER MASTER EXTENSIONS
-- =========================================================

ALTER TABLE inv_supplier
  ADD COLUMN IF NOT EXISTS legal_name TEXT,
  ADD COLUMN IF NOT EXISTS trade_name TEXT,
  ADD COLUMN IF NOT EXISTS vat_number TEXT,
  ADD COLUMN IF NOT EXISTS registration_number TEXT,
  ADD COLUMN IF NOT EXISTS supplier_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS main_phone TEXT,
  ADD COLUMN IF NOT EXISTS main_email TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER,
  ADD COLUMN IF NOT EXISTS minimum_order_qty NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS preferred_order_method TEXT,
  ADD COLUMN IF NOT EXISTS delivery_notes TEXT,
  ADD COLUMN IF NOT EXISTS default_tax_code TEXT,
  ADD COLUMN IF NOT EXISTS notes_internal TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inv_supplier_supplier_status_chk'
  ) THEN
    ALTER TABLE inv_supplier
      ADD CONSTRAINT inv_supplier_supplier_status_chk
      CHECK (supplier_status IN ('active','inactive','suspended','archived','blacklisted'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inv_supplier_preferred_order_method_chk'
  ) THEN
    ALTER TABLE inv_supplier
      ADD CONSTRAINT inv_supplier_preferred_order_method_chk
      CHECK (
        preferred_order_method IS NULL
        OR preferred_order_method IN ('email','phone','portal','whatsapp','in_person','api')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_inv_supplier_status ON inv_supplier(supplier_status, is_active);
CREATE INDEX IF NOT EXISTS ix_inv_supplier_name_status ON inv_supplier(supplier_name, supplier_status);

CREATE TABLE IF NOT EXISTS inv_supplier_category (
  supplier_category_id BIGSERIAL PRIMARY KEY,
  category_code TEXT NOT NULL UNIQUE,
  category_name TEXT NOT NULL,
  category_group TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inv_supplier_category_link (
  supplier_category_link_id BIGSERIAL PRIMARY KEY,
  supplier_id BIGINT NOT NULL REFERENCES inv_supplier(supplier_id) ON DELETE CASCADE,
  supplier_category_id BIGINT NOT NULL REFERENCES inv_supplier_category(supplier_category_id) ON DELETE RESTRICT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (supplier_id, supplier_category_id)
);

CREATE INDEX IF NOT EXISTS ix_inv_supplier_category_link_supplier
  ON inv_supplier_category_link(supplier_id, is_active);

CREATE TABLE IF NOT EXISTS inv_supplier_contact (
  supplier_contact_id BIGSERIAL PRIMARY KEY,
  supplier_id BIGINT NOT NULL REFERENCES inv_supplier(supplier_id) ON DELETE CASCADE,
  contact_name TEXT NOT NULL,
  job_title TEXT,
  phone TEXT,
  mobile TEXT,
  email TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_inv_supplier_contact_supplier
  ON inv_supplier_contact(supplier_id, is_active, is_primary DESC);

CREATE TABLE IF NOT EXISTS inv_supplier_address (
  supplier_address_id BIGSERIAL PRIMARY KEY,
  supplier_id BIGINT NOT NULL REFERENCES inv_supplier(supplier_id) ON DELETE CASCADE,
  address_type TEXT NOT NULL,
  line_1 TEXT NOT NULL,
  line_2 TEXT,
  locality TEXT,
  city TEXT,
  postcode TEXT,
  country TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inv_supplier_address_type_chk
    CHECK (address_type IN ('billing','shipping','service','registered'))
);

CREATE INDEX IF NOT EXISTS ix_inv_supplier_address_supplier
  ON inv_supplier_address(supplier_id, is_active, address_type);

CREATE TABLE IF NOT EXISTS inv_supplier_contract (
  supplier_contract_id BIGSERIAL PRIMARY KEY,
  supplier_id BIGINT NOT NULL REFERENCES inv_supplier(supplier_id) ON DELETE CASCADE,
  contract_type TEXT,
  contract_name TEXT,
  contract_start_date DATE,
  contract_end_date DATE,
  pricing_agreement_notes TEXT,
  sla_notes TEXT,
  warranty_terms_notes TEXT,
  service_contract_flag BOOLEAN NOT NULL DEFAULT FALSE,
  account_manager_name TEXT,
  account_manager_contact TEXT,
  credit_account_number TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inv_supplier_contract_date_chk
    CHECK (contract_end_date IS NULL OR contract_start_date IS NULL OR contract_end_date >= contract_start_date)
);

CREATE INDEX IF NOT EXISTS ix_inv_supplier_contract_supplier
  ON inv_supplier_contract(supplier_id, is_active, contract_end_date);

INSERT INTO inv_supplier_category (category_code, category_name, category_group, is_active)
VALUES
  ('dental_consumables', 'Dental Consumables', 'clinical', TRUE),
  ('dental_equipment', 'Dental Equipment', 'clinical', TRUE),
  ('dental_lab', 'Dental Lab', 'clinical', TRUE),
  ('implants', 'Implants', 'clinical', TRUE),
  ('orthodontics', 'Orthodontics', 'clinical', TRUE),
  ('sterilization', 'Sterilization', 'clinical', TRUE),
  ('pharmaceuticals', 'Pharmaceuticals', 'clinical', TRUE),
  ('retail_products', 'Retail Products', 'retail', TRUE),
  ('skincare', 'Skincare', 'retail', TRUE),
  ('wellness', 'Wellness', 'retail', TRUE),
  ('accessories', 'Accessories', 'retail', TRUE),
  ('furniture', 'Furniture', 'property', TRUE),
  ('appliances', 'Appliances', 'property', TRUE),
  ('linens', 'Linens', 'property', TRUE),
  ('maintenance', 'Maintenance', 'property', TRUE),
  ('cleaning_supplies', 'Cleaning Supplies', 'property', TRUE),
  ('construction', 'Construction', 'property', TRUE),
  ('electrical', 'Electrical', 'property', TRUE),
  ('plumbing', 'Plumbing', 'property', TRUE),
  ('hvac', 'HVAC', 'property', TRUE),
  ('equipment_servicing', 'Equipment Servicing', 'service', TRUE),
  ('maintenance_contractor', 'Maintenance Contractor', 'service', TRUE),
  ('it_software', 'IT / Software', 'service', TRUE),
  ('utilities', 'Utilities', 'service', TRUE),
  ('courier_logistics', 'Courier / Logistics', 'service', TRUE),
  ('waste_disposal', 'Waste Disposal', 'service', TRUE),
  ('security', 'Security', 'service', TRUE)
ON CONFLICT (category_code) DO UPDATE
SET
  category_name = EXCLUDED.category_name,
  category_group = EXCLUDED.category_group,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- =========================================================
-- PRODUCT / SUPPLIER LINK EXTENSIONS
-- =========================================================

ALTER TABLE inv_product_supplier
  ADD COLUMN IF NOT EXISTS supplier_product_name TEXT,
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS currency_code TEXT;

UPDATE inv_product_supplier
SET unit_cost = COALESCE(unit_cost, supplier_cost)
WHERE unit_cost IS NULL;

-- =========================================================
-- PROCUREMENT EXTENSIONS
-- =========================================================

ALTER TABLE inv_purchase_order_header
  ADD COLUMN IF NOT EXISTS location_id BIGINT REFERENCES inv_location(location_id),
  ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'inv_purchase_order_header'::regclass
      AND conname = 'inv_purchase_order_header_status_check'
  ) THEN
    ALTER TABLE inv_purchase_order_header DROP CONSTRAINT inv_purchase_order_header_status_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inv_purchase_order_header_status_lifecycle_chk'
  ) THEN
    ALTER TABLE inv_purchase_order_header
      ADD CONSTRAINT inv_purchase_order_header_status_lifecycle_chk
      CHECK (status IN ('draft','submitted','approved','ordered','part_received','received','cancelled','closed'));
  END IF;
END $$;

ALTER TABLE inv_purchase_order_line
  ADD COLUMN IF NOT EXISTS item_type TEXT NOT NULL DEFAULT 'product',
  ADD COLUMN IF NOT EXISTS asset_template_type TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS expected_date DATE,
  ADD COLUMN IF NOT EXISTS line_notes TEXT;

ALTER TABLE inv_purchase_order_line
  ALTER COLUMN product_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inv_purchase_order_line_item_type_chk'
  ) THEN
    ALTER TABLE inv_purchase_order_line
      ADD CONSTRAINT inv_purchase_order_line_item_type_chk
      CHECK (item_type IN ('product','asset','service','misc'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inv_purchase_order_line_qty_ordered_chk'
  ) THEN
    ALTER TABLE inv_purchase_order_line
      ADD CONSTRAINT inv_purchase_order_line_qty_ordered_chk
      CHECK (COALESCE(ordered_qty, 0) > 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inv_purchase_order_line_unit_cost_chk'
  ) THEN
    ALTER TABLE inv_purchase_order_line
      ADD CONSTRAINT inv_purchase_order_line_unit_cost_chk
      CHECK (COALESCE(unit_cost, 0) >= 0);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS inv_po_request_header (
  po_request_id BIGSERIAL PRIMARY KEY,
  request_number TEXT NOT NULL UNIQUE,
  department_id BIGINT NOT NULL REFERENCES inv_department(department_id),
  location_id BIGINT REFERENCES inv_location(location_id),
  requested_by BIGINT NOT NULL REFERENCES app_user(user_id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','rejected','converted','cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inv_po_request_line (
  po_request_line_id BIGSERIAL PRIMARY KEY,
  po_request_id BIGINT NOT NULL REFERENCES inv_po_request_header(po_request_id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'product' CHECK (item_type IN ('product','asset','service','misc')),
  product_id BIGINT REFERENCES inv_product(product_id),
  description TEXT,
  qty_requested NUMERIC(14,4) NOT NULL,
  unit_cost_estimate NUMERIC(14,4),
  notes TEXT,
  UNIQUE (po_request_id, line_no)
);

CREATE TABLE IF NOT EXISTS inv_goods_receipt_header (
  receipt_id BIGSERIAL PRIMARY KEY,
  receipt_number TEXT NOT NULL UNIQUE,
  po_id BIGINT REFERENCES inv_purchase_order_header(po_id),
  supplier_id BIGINT NOT NULL REFERENCES inv_supplier(supplier_id),
  department_id BIGINT NOT NULL REFERENCES inv_department(department_id),
  location_id BIGINT REFERENCES inv_location(location_id),
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  received_by BIGINT NOT NULL REFERENCES app_user(user_id),
  status TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','posted','cancelled')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS inv_goods_receipt_line (
  receipt_line_id BIGSERIAL PRIMARY KEY,
  receipt_id BIGINT NOT NULL REFERENCES inv_goods_receipt_header(receipt_id) ON DELETE CASCADE,
  po_line_id BIGINT REFERENCES inv_purchase_order_line(po_line_id),
  product_id BIGINT REFERENCES inv_product(product_id),
  item_type TEXT NOT NULL DEFAULT 'product' CHECK (item_type IN ('product','asset','service','misc')),
  description TEXT,
  qty_received NUMERIC(14,4) NOT NULL DEFAULT 0,
  qty_damaged NUMERIC(14,4) NOT NULL DEFAULT 0,
  qty_rejected NUMERIC(14,4) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  line_notes TEXT
);

CREATE INDEX IF NOT EXISTS ix_inv_goods_receipt_po ON inv_goods_receipt_header(po_id, status, receipt_date);
CREATE INDEX IF NOT EXISTS ix_inv_goods_receipt_supplier ON inv_goods_receipt_header(supplier_id, receipt_date DESC);

CREATE TABLE IF NOT EXISTS inv_supplier_invoice_header (
  supplier_invoice_id BIGSERIAL PRIMARY KEY,
  supplier_id BIGINT NOT NULL REFERENCES inv_supplier(supplier_id),
  invoice_number TEXT NOT NULL,
  invoice_date DATE NOT NULL,
  currency_code TEXT NOT NULL DEFAULT 'EUR',
  subtotal NUMERIC(14,4) NOT NULL DEFAULT 0,
  tax_total NUMERIC(14,4) NOT NULL DEFAULT 0,
  total_amount NUMERIC(14,4) NOT NULL DEFAULT 0,
  po_id BIGINT REFERENCES inv_purchase_order_header(po_id),
  receipt_id BIGINT REFERENCES inv_goods_receipt_header(receipt_id),
  status TEXT NOT NULL DEFAULT 'entered' CHECK (status IN ('entered','matched','disputed','approved','paid','cancelled')),
  entered_by BIGINT NOT NULL REFERENCES app_user(user_id),
  approved_by BIGINT REFERENCES app_user(user_id),
  entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  notes TEXT,
  UNIQUE (supplier_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS inv_supplier_invoice_line (
  supplier_invoice_line_id BIGSERIAL PRIMARY KEY,
  supplier_invoice_id BIGINT NOT NULL REFERENCES inv_supplier_invoice_header(supplier_invoice_id) ON DELETE CASCADE,
  po_line_id BIGINT REFERENCES inv_purchase_order_line(po_line_id),
  receipt_line_id BIGINT REFERENCES inv_goods_receipt_line(receipt_line_id),
  product_id BIGINT REFERENCES inv_product(product_id),
  description TEXT,
  qty NUMERIC(14,4) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(14,4) NOT NULL DEFAULT 0,
  line_total NUMERIC(14,4) NOT NULL DEFAULT 0,
  line_notes TEXT
);

-- =========================================================
-- ASSET LIFECYCLE EXTENSIONS
-- =========================================================

ALTER TABLE inv_equipment_asset
  ADD COLUMN IF NOT EXISTS asset_category TEXT,
  ADD COLUMN IF NOT EXISTS manufacturer TEXT,
  ADD COLUMN IF NOT EXISTS model_number TEXT,
  ADD COLUMN IF NOT EXISTS barcode_tag TEXT,
  ADD COLUMN IF NOT EXISTS internal_tag TEXT,
  ADD COLUMN IF NOT EXISTS custodian_employee_id BIGINT REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS supplier_invoice_id BIGINT REFERENCES inv_supplier_invoice_header(supplier_invoice_id),
  ADD COLUMN IF NOT EXISTS po_id BIGINT REFERENCES inv_purchase_order_header(po_id),
  ADD COLUMN IF NOT EXISTS receipt_id BIGINT REFERENCES inv_goods_receipt_header(receipt_id),
  ADD COLUMN IF NOT EXISTS warranty_terms_notes TEXT,
  ADD COLUMN IF NOT EXISTS service_contract_flag BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS installation_date DATE,
  ADD COLUMN IF NOT EXISTS commissioned_date DATE,
  ADD COLUMN IF NOT EXISTS last_service_date DATE,
  ADD COLUMN IF NOT EXISTS next_service_due_date DATE,
  ADD COLUMN IF NOT EXISTS maintenance_notes TEXT,
  ADD COLUMN IF NOT EXISTS disposal_date DATE,
  ADD COLUMN IF NOT EXISTS disposal_reason TEXT,
  ADD COLUMN IF NOT EXISTS disposal_approved_by BIGINT REFERENCES app_user(user_id),
  ADD COLUMN IF NOT EXISTS disposal_method TEXT,
  ADD COLUMN IF NOT EXISTS residual_value NUMERIC(14,4);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inv_equipment_asset_warranty_dates_chk'
  ) THEN
    ALTER TABLE inv_equipment_asset
      ADD CONSTRAINT inv_equipment_asset_warranty_dates_chk
      CHECK (
        warranty_start_date IS NULL
        OR warranty_expiry_date IS NULL
        OR warranty_expiry_date >= warranty_start_date
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inv_equipment_asset_purchase_cost_chk'
  ) THEN
    ALTER TABLE inv_equipment_asset
      ADD CONSTRAINT inv_equipment_asset_purchase_cost_chk
      CHECK (purchase_cost IS NULL OR purchase_cost >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'inv_equipment_asset_disposal_reason_chk'
  ) THEN
    ALTER TABLE inv_equipment_asset
      ADD CONSTRAINT inv_equipment_asset_disposal_reason_chk
      CHECK (
        disposal_reason IS NULL
        OR disposal_reason IN ('obsolete','broken_beyond_repair','sold','donated','scrapped','lost_stolen')
      );
  END IF;
END $$;

DO $$
BEGIN
  -- widen allowed asset status values for lifecycle mode.
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'inv_equipment_asset'::regclass
      AND conname = 'inv_equipment_asset_status_check'
  ) THEN
    ALTER TABLE inv_equipment_asset DROP CONSTRAINT inv_equipment_asset_status_check;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'inv_equipment_asset_status_lifecycle_chk'
  ) THEN
    ALTER TABLE inv_equipment_asset
      ADD CONSTRAINT inv_equipment_asset_status_lifecycle_chk
      CHECK (status IN ('active','in_use','in_storage','under_repair','under_maintenance','inactive','disposed','lost','written_off','maintenance','retired'));
  END IF;
END $$;

ALTER TABLE inv_equipment_location_history
  ADD COLUMN IF NOT EXISTS movement_reason TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE TABLE IF NOT EXISTS inv_asset_maintenance_event (
  maintenance_event_id BIGSERIAL PRIMARY KEY,
  equipment_id BIGINT NOT NULL REFERENCES inv_equipment_asset(equipment_id) ON DELETE CASCADE,
  maintenance_type TEXT NOT NULL CHECK (maintenance_type IN ('preventive','corrective','inspection','calibration','cleaning','emergency_repair')),
  opened_date DATE NOT NULL,
  scheduled_date DATE,
  completed_date DATE,
  supplier_id BIGINT REFERENCES inv_supplier(supplier_id),
  performed_by_text TEXT,
  cost NUMERIC(14,4) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
  issue_summary TEXT,
  work_done TEXT,
  notes TEXT,
  created_by BIGINT REFERENCES app_user(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inv_asset_maintenance_event_date_chk
    CHECK (completed_date IS NULL OR completed_date >= opened_date),
  CONSTRAINT inv_asset_maintenance_event_cost_chk
    CHECK (cost >= 0)
);

CREATE INDEX IF NOT EXISTS ix_inv_asset_maintenance_event_equipment
  ON inv_asset_maintenance_event(equipment_id, status, opened_date DESC);

CREATE INDEX IF NOT EXISTS ix_inv_equipment_asset_status_department
  ON inv_equipment_asset(status, department_id, location_id);

CREATE INDEX IF NOT EXISTS ix_inv_equipment_asset_warranty
  ON inv_equipment_asset(warranty_expiry_date, is_active);

CREATE TABLE IF NOT EXISTS inv_asset_incident (
  asset_incident_id BIGSERIAL PRIMARY KEY,
  equipment_id BIGINT NOT NULL REFERENCES inv_equipment_asset(equipment_id) ON DELETE CASCADE,
  reported_by BIGINT REFERENCES app_user(user_id),
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  downtime_start TIMESTAMPTZ,
  downtime_end TIMESTAMPTZ,
  summary TEXT,
  related_maintenance_event_id BIGINT REFERENCES inv_asset_maintenance_event(maintenance_event_id),
  resolution_notes TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT inv_asset_incident_downtime_chk
    CHECK (downtime_end IS NULL OR downtime_start IS NULL OR downtime_end >= downtime_start)
);

-- =========================================================
-- PERMISSIONS FOR EMPLOYEE-FORM MANAGED ACCESS
-- =========================================================

INSERT INTO app_permission (permission_code, permission_name)
VALUES
  ('supplier.view', 'Supplier View'),
  ('supplier.edit', 'Supplier Edit'),
  ('procurement.request.create', 'Procurement Request Create'),
  ('procurement.po.create', 'Procurement PO Create'),
  ('procurement.po.approve', 'Procurement PO Approve'),
  ('procurement.receipt.post', 'Procurement Receipt Post'),
  ('procurement.invoice.manage', 'Procurement Invoice Manage'),
  ('asset.view', 'Asset View'),
  ('asset.create', 'Asset Create'),
  ('asset.edit', 'Asset Edit'),
  ('asset.move', 'Asset Move'),
  ('asset.maintenance.manage', 'Asset Maintenance Manage'),
  ('asset.dispose', 'Asset Dispose')
ON CONFLICT (permission_code) DO UPDATE
SET permission_name = EXCLUDED.permission_name;

-- map new permissions to existing operational roles.
WITH role_perm(role_code, permission_code) AS (
  VALUES
    ('inventory_admin', 'supplier.view'),
    ('inventory_admin', 'supplier.edit'),
    ('inventory_admin', 'procurement.request.create'),
    ('inventory_admin', 'procurement.po.create'),
    ('inventory_admin', 'procurement.po.approve'),
    ('inventory_admin', 'procurement.receipt.post'),
    ('inventory_admin', 'procurement.invoice.manage'),
    ('inventory_admin', 'asset.view'),
    ('inventory_admin', 'asset.create'),
    ('inventory_admin', 'asset.edit'),
    ('inventory_admin', 'asset.move'),
    ('inventory_admin', 'asset.maintenance.manage'),
    ('inventory_admin', 'asset.dispose'),

    ('procurement_officer', 'supplier.view'),
    ('procurement_officer', 'supplier.edit'),
    ('procurement_officer', 'procurement.request.create'),
    ('procurement_officer', 'procurement.po.create'),
    ('procurement_officer', 'procurement.receipt.post'),
    ('procurement_officer', 'procurement.invoice.manage'),
    ('procurement_officer', 'asset.view'),

    ('store_manager', 'supplier.view'),
    ('store_manager', 'procurement.po.create'),
    ('store_manager', 'procurement.receipt.post'),
    ('store_manager', 'asset.view'),
    ('store_manager', 'asset.create'),
    ('store_manager', 'asset.edit'),
    ('store_manager', 'asset.move'),
    ('store_manager', 'asset.maintenance.manage'),

    ('department_manager', 'supplier.view'),
    ('department_manager', 'procurement.request.create'),
    ('department_manager', 'procurement.po.create'),
    ('department_manager', 'asset.view'),
    ('department_manager', 'asset.move'),

    ('auditor', 'supplier.view'),
    ('auditor', 'asset.view')
)
INSERT INTO app_role_permission (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM role_perm rp
JOIN app_role r ON r.role_code = rp.role_code
JOIN app_permission p ON p.permission_code = rp.permission_code
ON CONFLICT DO NOTHING;

-- =========================================================
-- REPORTING VIEWS
-- =========================================================

CREATE OR REPLACE VIEW vw_inv_supplier_overview AS
SELECT
  s.supplier_id,
  s.supplier_code,
  s.supplier_name,
  s.supplier_status,
  s.is_active,
  s.currency_code,
  s.updated_at,
  (
    SELECT MAX(poh.order_date)
    FROM inv_purchase_order_header poh
    WHERE poh.supplier_id = s.supplier_id
  ) AS last_order_date,
  (
    SELECT COUNT(DISTINCT ps.product_id)
    FROM inv_product_supplier ps
    WHERE ps.supplier_id = s.supplier_id
      AND ps.is_active = TRUE
  ) AS linked_products_count,
  (
    SELECT COUNT(*)
    FROM inv_equipment_asset ea
    WHERE ea.supplier_id = s.supplier_id
  ) AS linked_assets_count
FROM inv_supplier s;

CREATE OR REPLACE VIEW vw_inv_procurement_overview AS
SELECT
  (SELECT COUNT(*) FROM inv_purchase_order_header WHERE status IN ('draft','submitted','approved','ordered','part_received')) AS open_po_count,
  (SELECT COUNT(*) FROM inv_purchase_order_header WHERE expected_date IS NOT NULL AND expected_date < CURRENT_DATE AND status IN ('ordered','part_received')) AS overdue_receipt_count,
  (SELECT COUNT(*) FROM inv_purchase_order_header WHERE status = 'part_received') AS partial_po_count,
  (SELECT COUNT(*) FROM inv_supplier_invoice_header WHERE status IN ('entered','disputed')) AS unmatched_invoice_count;

CREATE OR REPLACE VIEW vw_inv_procurement_spend_by_supplier AS
SELECT
  sih.supplier_id,
  s.supplier_code,
  s.supplier_name,
  sih.currency_code,
  COUNT(*)::bigint AS invoice_count,
  SUM(sih.subtotal)::numeric(14,4) AS subtotal_amount,
  SUM(sih.tax_total)::numeric(14,4) AS tax_amount,
  SUM(sih.total_amount)::numeric(14,4) AS total_amount,
  MAX(sih.invoice_date) AS last_invoice_date
FROM inv_supplier_invoice_header sih
JOIN inv_supplier s ON s.supplier_id = sih.supplier_id
WHERE sih.status <> 'cancelled'
GROUP BY
  sih.supplier_id,
  s.supplier_code,
  s.supplier_name,
  sih.currency_code;

CREATE OR REPLACE VIEW vw_inv_asset_overview AS
SELECT
  ea.equipment_id,
  ea.asset_code,
  ea.asset_name,
  ea.status,
  ea.department_id,
  d.department_code,
  d.department_name,
  ea.location_id,
  l.location_code,
  l.location_name,
  ea.supplier_id,
  s.supplier_name,
  ea.warranty_start_date,
  ea.warranty_expiry_date,
  CASE
    WHEN ea.warranty_start_date IS NULL OR ea.warranty_expiry_date IS NULL THEN 'unknown'
    WHEN CURRENT_DATE > ea.warranty_expiry_date THEN 'expired'
    WHEN ea.warranty_expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_soon'
    ELSE 'under_warranty'
  END AS warranty_status,
  ea.last_service_date,
  ea.next_service_due_date,
  ea.disposal_date,
  ea.disposal_reason
FROM inv_equipment_asset ea
LEFT JOIN inv_department d ON d.department_id = ea.department_id
LEFT JOIN inv_location l ON l.location_id = ea.location_id
LEFT JOIN inv_supplier s ON s.supplier_id = ea.supplier_id;

CREATE OR REPLACE VIEW vw_inv_asset_warranty_alerts AS
SELECT
  ea.equipment_id,
  ea.asset_code,
  ea.asset_name,
  ea.department_id,
  d.department_code,
  d.department_name,
  ea.location_id,
  l.location_code,
  l.location_name,
  ea.supplier_id,
  s.supplier_name,
  ea.warranty_start_date,
  ea.warranty_expiry_date,
  CASE
    WHEN ea.warranty_start_date IS NULL OR ea.warranty_expiry_date IS NULL THEN 'unknown'
    WHEN CURRENT_DATE > ea.warranty_expiry_date THEN 'expired'
    WHEN ea.warranty_expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'expiring_soon'
    ELSE 'under_warranty'
  END AS warranty_status,
  (ea.warranty_expiry_date - CURRENT_DATE) AS days_to_expiry
FROM inv_equipment_asset ea
LEFT JOIN inv_department d ON d.department_id = ea.department_id
LEFT JOIN inv_location l ON l.location_id = ea.location_id
LEFT JOIN inv_supplier s ON s.supplier_id = ea.supplier_id;

CREATE OR REPLACE VIEW vw_inv_asset_maintenance_cost AS
SELECT
  ame.equipment_id,
  ea.asset_code,
  ea.asset_name,
  ame.supplier_id,
  s.supplier_name,
  COUNT(*)::bigint AS maintenance_events,
  SUM(ame.cost)::numeric(14,4) AS total_maintenance_cost,
  MAX(ame.completed_date) AS last_completed_date
FROM inv_asset_maintenance_event ame
JOIN inv_equipment_asset ea ON ea.equipment_id = ame.equipment_id
LEFT JOIN inv_supplier s ON s.supplier_id = ame.supplier_id
GROUP BY
  ame.equipment_id,
  ea.asset_code,
  ea.asset_name,
  ame.supplier_id,
  s.supplier_name;

COMMIT;
