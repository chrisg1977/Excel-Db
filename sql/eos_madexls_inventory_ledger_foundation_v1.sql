-- =========================================================
-- EOS / MADEXLS INVENTORY LEDGER FOUNDATION
-- PostgreSQL
-- =========================================================

-- Optional extension for UUID support if wanted later
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =========================================================
-- 1. MASTER / REFERENCE TABLES
-- =========================================================

CREATE TABLE IF NOT EXISTS inv_department (
    department_id           BIGSERIAL PRIMARY KEY,
    department_code         TEXT NOT NULL UNIQUE,
    department_name         TEXT NOT NULL,
    department_type         TEXT NOT NULL CHECK (
                                department_type IN (
                                    'clinic',
                                    'store',
                                    'retail',
                                    'warehouse',
                                    'virtual',
                                    'admin'
                                )
                             ),
    parent_department_id    BIGINT NULL REFERENCES inv_department(department_id),
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inv_unit_of_measure (
    uom_id                  BIGSERIAL PRIMARY KEY,
    uom_code                TEXT NOT NULL UNIQUE,
    uom_name                TEXT NOT NULL,
    is_base_unit            BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS inv_brand (
    brand_id                BIGSERIAL PRIMARY KEY,
    brand_name              TEXT NOT NULL UNIQUE,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS inv_category (
    category_id             BIGSERIAL PRIMARY KEY,
    category_code           TEXT UNIQUE,
    category_name           TEXT NOT NULL,
    parent_category_id      BIGINT NULL REFERENCES inv_category(category_id),
    is_active               BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS inv_supplier (
    supplier_id             BIGSERIAL PRIMARY KEY,
    supplier_code           TEXT UNIQUE,
    supplier_name           TEXT NOT NULL,
    contact_name            TEXT,
    phone                   TEXT,
    email                   TEXT,
    lead_time_days          INTEGER,
    minimum_order_value     NUMERIC(12,2) NOT NULL DEFAULT 0,
    currency_code           TEXT NOT NULL DEFAULT 'EUR',
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inv_tax_code (
    tax_code_id             BIGSERIAL PRIMARY KEY,
    tax_code                TEXT NOT NULL UNIQUE,
    tax_description         TEXT,
    tax_rate_percent        NUMERIC(8,4) NOT NULL DEFAULT 0
);

-- =========================================================
-- 2. USERS / ROLES / PERMISSIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS app_user (
    user_id                 BIGSERIAL PRIMARY KEY,
    username                TEXT NOT NULL UNIQUE,
    full_name               TEXT NOT NULL,
    email                   TEXT,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_role (
    role_id                 BIGSERIAL PRIMARY KEY,
    role_code               TEXT NOT NULL UNIQUE,
    role_name               TEXT NOT NULL,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS app_user_role (
    user_id                 BIGINT NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    role_id                 BIGINT NOT NULL REFERENCES app_role(role_id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS app_permission (
    permission_id           BIGSERIAL PRIMARY KEY,
    permission_code         TEXT NOT NULL UNIQUE,
    permission_name         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_role_permission (
    role_id                 BIGINT NOT NULL REFERENCES app_role(role_id) ON DELETE CASCADE,
    permission_id           BIGINT NOT NULL REFERENCES app_permission(permission_id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS app_user_department_scope (
    user_id                 BIGINT NOT NULL REFERENCES app_user(user_id) ON DELETE CASCADE,
    department_id           BIGINT NOT NULL REFERENCES inv_department(department_id) ON DELETE CASCADE,
    scope_level             TEXT NOT NULL DEFAULT 'full' CHECK (
                                scope_level IN ('view', 'post', 'approve', 'full')
                             ),
    PRIMARY KEY (user_id, department_id)
);

-- =========================================================
-- 3. PRODUCT CATALOG / SHOPIFY-LIKE PRODUCT FOUNDATION
-- =========================================================

CREATE TABLE IF NOT EXISTS inv_product (
    product_id              BIGSERIAL PRIMARY KEY,
    sku                     TEXT NOT NULL UNIQUE,
    barcode                 TEXT,
    product_name            TEXT NOT NULL,
    product_description     TEXT,
    category_id             BIGINT REFERENCES inv_category(category_id),
    brand_id                BIGINT REFERENCES inv_brand(brand_id),
    base_uom_id             BIGINT NOT NULL REFERENCES inv_unit_of_measure(uom_id),
    tax_code_id             BIGINT REFERENCES inv_tax_code(tax_code_id),

    product_type            TEXT NOT NULL CHECK (
                                product_type IN (
                                    'stock_item',
                                    'consumable',
                                    'service',
                                    'non_stock',
                                    'bundle'
                                )
                             ),

    track_inventory         BOOLEAN NOT NULL DEFAULT TRUE,
    allow_negative_stock    BOOLEAN NOT NULL DEFAULT FALSE,
    is_sellable             BOOLEAN NOT NULL DEFAULT TRUE,
    is_consumable           BOOLEAN NOT NULL DEFAULT TRUE,
    is_purchasable          BOOLEAN NOT NULL DEFAULT TRUE,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,

    default_cost            NUMERIC(14,4) NOT NULL DEFAULT 0,
    default_sell_price      NUMERIC(14,4) NOT NULL DEFAULT 0,

    reorder_enabled         BOOLEAN NOT NULL DEFAULT TRUE,
    reorder_method          TEXT NOT NULL DEFAULT 'min_max' CHECK (
                                reorder_method IN ('none', 'min_max', 'par_level', 'demand_based')
                             ),

    image_url               TEXT,
    search_keywords         TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_inv_product_barcode
    ON inv_product(barcode)
    WHERE barcode IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_inv_product_name
    ON inv_product(product_name);

CREATE INDEX IF NOT EXISTS ix_inv_product_category
    ON inv_product(category_id);

CREATE TABLE IF NOT EXISTS inv_product_supplier (
    product_supplier_id     BIGSERIAL PRIMARY KEY,
    product_id              BIGINT NOT NULL REFERENCES inv_product(product_id) ON DELETE CASCADE,
    supplier_id             BIGINT NOT NULL REFERENCES inv_supplier(supplier_id),
    supplier_sku            TEXT,
    preferred_rank          INTEGER NOT NULL DEFAULT 1,
    supplier_cost           NUMERIC(14,4) NOT NULL DEFAULT 0,
    lead_time_days          INTEGER,
    minimum_order_qty       NUMERIC(14,4) NOT NULL DEFAULT 0,
    is_preferred            BOOLEAN NOT NULL DEFAULT FALSE,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (product_id, supplier_id)
);

-- Department-specific product behavior
CREATE TABLE IF NOT EXISTS inv_product_department (
    product_department_id   BIGSERIAL PRIMARY KEY,
    product_id              BIGINT NOT NULL REFERENCES inv_product(product_id) ON DELETE CASCADE,
    department_id           BIGINT NOT NULL REFERENCES inv_department(department_id) ON DELETE CASCADE,

    is_stocked              BOOLEAN NOT NULL DEFAULT TRUE,
    is_sellable             BOOLEAN NOT NULL DEFAULT TRUE,
    is_consumable           BOOLEAN NOT NULL DEFAULT TRUE,
    default_bin_code        TEXT,

    min_qty                 NUMERIC(14,4) NOT NULL DEFAULT 0,
    max_qty                 NUMERIC(14,4) NOT NULL DEFAULT 0,
    reorder_qty             NUMERIC(14,4) NOT NULL DEFAULT 0,
    par_level_qty           NUMERIC(14,4) NOT NULL DEFAULT 0,

    preferred_supplier_id   BIGINT REFERENCES inv_supplier(supplier_id),
    last_counted_at         TIMESTAMPTZ,

    UNIQUE (product_id, department_id)
);

CREATE INDEX IF NOT EXISTS ix_inv_product_department_reorder
    ON inv_product_department(department_id, preferred_supplier_id);

-- =========================================================
-- 4. INVENTORY DOCUMENT TYPES / POSTING REASONS
-- =========================================================

CREATE TABLE IF NOT EXISTS inv_document_type (
    document_type_code      TEXT PRIMARY KEY,
    document_type_name      TEXT NOT NULL,
    affects_inventory       BOOLEAN NOT NULL DEFAULT TRUE,
    requires_approval       BOOLEAN NOT NULL DEFAULT FALSE,
    source_domain           TEXT NOT NULL CHECK (
                                source_domain IN (
                                    'inventory',
                                    'procurement',
                                    'sell',
                                    'clinic',
                                    'system'
                                )
                             )
);

CREATE TABLE IF NOT EXISTS inv_movement_reason (
    movement_reason_code    TEXT PRIMARY KEY,
    movement_reason_name    TEXT NOT NULL,
    movement_class          TEXT NOT NULL CHECK (
                                movement_class IN (
                                    'receipt',
                                    'issue',
                                    'transfer_out',
                                    'transfer_in',
                                    'adjustment_gain',
                                    'adjustment_loss',
                                    'sale',
                                    'return_in',
                                    'return_out',
                                    'consumption',
                                    'reservation',
                                    'release',
                                    'writeoff'
                                )
                             )
);

-- =========================================================
-- 5. DOCUMENT HEADER / LINES
-- =========================================================

CREATE TABLE IF NOT EXISTS inv_document_header (
    document_id             BIGSERIAL PRIMARY KEY,
    document_type_code      TEXT NOT NULL REFERENCES inv_document_type(document_type_code),
    document_number         TEXT NOT NULL UNIQUE,

    status                  TEXT NOT NULL DEFAULT 'draft' CHECK (
                                status IN (
                                    'draft',
                                    'submitted',
                                    'approved',
                                    'posted',
                                    'cancelled',
                                    'closed'
                                )
                             ),

    source_department_id    BIGINT REFERENCES inv_department(department_id),
    target_department_id    BIGINT REFERENCES inv_department(department_id),

    supplier_id             BIGINT REFERENCES inv_supplier(supplier_id),

    external_source         TEXT,
    external_reference      TEXT,
    notes                   TEXT,

    created_by              BIGINT NOT NULL REFERENCES app_user(user_id),
    approved_by             BIGINT REFERENCES app_user(user_id),
    posted_by               BIGINT REFERENCES app_user(user_id),

    document_date           DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at             TIMESTAMPTZ,
    posted_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_inv_document_header_status
    ON inv_document_header(status, document_type_code, document_date);

CREATE INDEX IF NOT EXISTS ix_inv_document_header_source_target
    ON inv_document_header(source_department_id, target_department_id);

CREATE INDEX IF NOT EXISTS ix_inv_document_header_external
    ON inv_document_header(external_source, external_reference);

CREATE TABLE IF NOT EXISTS inv_document_line (
    document_line_id        BIGSERIAL PRIMARY KEY,
    document_id             BIGINT NOT NULL REFERENCES inv_document_header(document_id) ON DELETE CASCADE,
    line_no                 INTEGER NOT NULL,
    product_id              BIGINT NOT NULL REFERENCES inv_product(product_id),
    uom_id                  BIGINT NOT NULL REFERENCES inv_unit_of_measure(uom_id),

    qty                     NUMERIC(14,4) NOT NULL,
    unit_cost               NUMERIC(14,4) NOT NULL DEFAULT 0,
    unit_price              NUMERIC(14,4) NOT NULL DEFAULT 0,

    lot_number              TEXT,
    expiry_date             DATE,
    serial_number           TEXT,

    line_notes              TEXT,
    UNIQUE (document_id, line_no)
);

CREATE INDEX IF NOT EXISTS ix_inv_document_line_product
    ON inv_document_line(product_id);

-- =========================================================
-- 6. INVENTORY LEDGER
-- =========================================================

CREATE TABLE IF NOT EXISTS inv_ledger (
    ledger_id               BIGSERIAL PRIMARY KEY,

    posting_ts              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    posting_date            DATE NOT NULL DEFAULT CURRENT_DATE,

    product_id              BIGINT NOT NULL REFERENCES inv_product(product_id),
    department_id           BIGINT NOT NULL REFERENCES inv_department(department_id),

    document_id             BIGINT REFERENCES inv_document_header(document_id),
    document_line_id        BIGINT REFERENCES inv_document_line(document_line_id),

    document_type_code      TEXT NOT NULL REFERENCES inv_document_type(document_type_code),
    movement_reason_code    TEXT NOT NULL REFERENCES inv_movement_reason(movement_reason_code),

    qty_in                  NUMERIC(14,4) NOT NULL DEFAULT 0,
    qty_out                 NUMERIC(14,4) NOT NULL DEFAULT 0,
    qty_delta               NUMERIC(14,4) NOT NULL DEFAULT 0,

    unit_cost               NUMERIC(14,4) NOT NULL DEFAULT 0,
    value_in                NUMERIC(14,4) NOT NULL DEFAULT 0,
    value_out               NUMERIC(14,4) NOT NULL DEFAULT 0,
    value_delta             NUMERIC(14,4) NOT NULL DEFAULT 0,

    source_department_id    BIGINT REFERENCES inv_department(department_id),
    target_department_id    BIGINT REFERENCES inv_department(department_id),

    external_source         TEXT,
    external_reference      TEXT,

    posted_by               BIGINT NOT NULL REFERENCES app_user(user_id),
    reversal_of_ledger_id   BIGINT REFERENCES inv_ledger(ledger_id),

    comments                TEXT
);

CREATE INDEX IF NOT EXISTS ix_inv_ledger_product_dept_date
    ON inv_ledger(product_id, department_id, posting_date, ledger_id);

CREATE INDEX IF NOT EXISTS ix_inv_ledger_document
    ON inv_ledger(document_id, document_line_id);

CREATE INDEX IF NOT EXISTS ix_inv_ledger_external
    ON inv_ledger(external_source, external_reference);

CREATE INDEX IF NOT EXISTS ix_inv_ledger_department_date
    ON inv_ledger(department_id, posting_date);

-- =========================================================
-- 7. OPTIONAL DAILY SNAPSHOT / FAST BALANCE LOOKUP
-- =========================================================

CREATE TABLE IF NOT EXISTS inv_stock_balance (
    product_id              BIGINT NOT NULL REFERENCES inv_product(product_id),
    department_id           BIGINT NOT NULL REFERENCES inv_department(department_id),
    on_hand_qty             NUMERIC(14,4) NOT NULL DEFAULT 0,
    reserved_qty            NUMERIC(14,4) NOT NULL DEFAULT 0,
    available_qty           NUMERIC(14,4) NOT NULL DEFAULT 0,
    avg_cost                NUMERIC(14,4) NOT NULL DEFAULT 0,
    last_ledger_id          BIGINT,
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (product_id, department_id)
);

CREATE INDEX IF NOT EXISTS ix_inv_stock_balance_department
    ON inv_stock_balance(department_id, available_qty);

-- =========================================================
-- 8. STOCK COUNT / ADJUSTMENT
-- =========================================================

CREATE TABLE IF NOT EXISTS inv_stock_count_header (
    stock_count_id          BIGSERIAL PRIMARY KEY,
    department_id           BIGINT NOT NULL REFERENCES inv_department(department_id),
    count_date              DATE NOT NULL DEFAULT CURRENT_DATE,
    status                  TEXT NOT NULL DEFAULT 'draft' CHECK (
                                status IN ('draft', 'submitted', 'approved', 'posted', 'cancelled')
                             ),
    created_by              BIGINT NOT NULL REFERENCES app_user(user_id),
    approved_by             BIGINT REFERENCES app_user(user_id),
    posted_by               BIGINT REFERENCES app_user(user_id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at             TIMESTAMPTZ,
    posted_at               TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS inv_stock_count_line (
    stock_count_line_id     BIGSERIAL PRIMARY KEY,
    stock_count_id          BIGINT NOT NULL REFERENCES inv_stock_count_header(stock_count_id) ON DELETE CASCADE,
    line_no                 INTEGER NOT NULL,
    product_id              BIGINT NOT NULL REFERENCES inv_product(product_id),
    system_qty              NUMERIC(14,4) NOT NULL DEFAULT 0,
    counted_qty             NUMERIC(14,4) NOT NULL DEFAULT 0,
    variance_qty            NUMERIC(14,4) NOT NULL DEFAULT 0,
    unit_cost               NUMERIC(14,4) NOT NULL DEFAULT 0,
    variance_value          NUMERIC(14,4) NOT NULL DEFAULT 0,
    UNIQUE (stock_count_id, line_no)
);

-- =========================================================
-- 9. PROCUREMENT / PURCHASE ORDERS / RECEIPTS
-- =========================================================

CREATE TABLE IF NOT EXISTS inv_purchase_order_header (
    po_id                   BIGSERIAL PRIMARY KEY,
    po_number               TEXT NOT NULL UNIQUE,
    supplier_id             BIGINT NOT NULL REFERENCES inv_supplier(supplier_id),
    department_id           BIGINT NOT NULL REFERENCES inv_department(department_id),
    status                  TEXT NOT NULL DEFAULT 'draft' CHECK (
                                status IN ('draft', 'submitted', 'approved', 'ordered', 'part_received', 'received', 'cancelled', 'closed')
                             ),
    order_date              DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_date           DATE,
    currency_code           TEXT NOT NULL DEFAULT 'EUR',
    notes                   TEXT,
    created_by              BIGINT NOT NULL REFERENCES app_user(user_id),
    approved_by             BIGINT REFERENCES app_user(user_id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    approved_at             TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS inv_purchase_order_line (
    po_line_id              BIGSERIAL PRIMARY KEY,
    po_id                   BIGINT NOT NULL REFERENCES inv_purchase_order_header(po_id) ON DELETE CASCADE,
    line_no                 INTEGER NOT NULL,
    product_id              BIGINT NOT NULL REFERENCES inv_product(product_id),
    uom_id                  BIGINT NOT NULL REFERENCES inv_unit_of_measure(uom_id),
    ordered_qty             NUMERIC(14,4) NOT NULL,
    received_qty            NUMERIC(14,4) NOT NULL DEFAULT 0,
    unit_cost               NUMERIC(14,4) NOT NULL DEFAULT 0,
    tax_code_id             BIGINT REFERENCES inv_tax_code(tax_code_id),
    UNIQUE (po_id, line_no)
);

CREATE INDEX IF NOT EXISTS ix_inv_po_supplier_status
    ON inv_purchase_order_header(supplier_id, status, order_date);

-- =========================================================
-- 10. REORDER SUGGESTIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS inv_reorder_suggestion (
    reorder_suggestion_id   BIGSERIAL PRIMARY KEY,
    suggestion_date         DATE NOT NULL DEFAULT CURRENT_DATE,
    department_id           BIGINT NOT NULL REFERENCES inv_department(department_id),
    product_id              BIGINT NOT NULL REFERENCES inv_product(product_id),
    supplier_id             BIGINT REFERENCES inv_supplier(supplier_id),

    on_hand_qty             NUMERIC(14,4) NOT NULL DEFAULT 0,
    reserved_qty            NUMERIC(14,4) NOT NULL DEFAULT 0,
    available_qty           NUMERIC(14,4) NOT NULL DEFAULT 0,
    min_qty                 NUMERIC(14,4) NOT NULL DEFAULT 0,
    max_qty                 NUMERIC(14,4) NOT NULL DEFAULT 0,
    reorder_qty             NUMERIC(14,4) NOT NULL DEFAULT 0,
    suggested_order_qty     NUMERIC(14,4) NOT NULL DEFAULT 0,

    reason_text             TEXT,
    status                  TEXT NOT NULL DEFAULT 'new' CHECK (
                                status IN ('new', 'reviewed', 'converted', 'ignored')
                             ),

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (suggestion_date, department_id, product_id)
);

-- =========================================================
-- 11. SELL PIPELINE INTEGRATION
-- =========================================================

CREATE TABLE IF NOT EXISTS sell_transaction_header (
    sell_txn_id             BIGSERIAL PRIMARY KEY,
    txn_number              TEXT NOT NULL UNIQUE,
    txn_ts                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    department_id           BIGINT NOT NULL REFERENCES inv_department(department_id),
    customer_ref            TEXT,
    status                  TEXT NOT NULL DEFAULT 'completed' CHECK (
                                status IN ('draft', 'completed', 'voided', 'returned')
                             ),
    payment_status          TEXT NOT NULL DEFAULT 'paid' CHECK (
                                payment_status IN ('unpaid', 'partial', 'paid', 'refunded')
                             ),
    source_channel          TEXT NOT NULL DEFAULT 'pos' CHECK (
                                source_channel IN ('pos', 'shopify_like', 'manual', 'api')
                             ),
    created_by              BIGINT NOT NULL REFERENCES app_user(user_id),
    external_reference      TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sell_transaction_line (
    sell_txn_line_id        BIGSERIAL PRIMARY KEY,
    sell_txn_id             BIGINT NOT NULL REFERENCES sell_transaction_header(sell_txn_id) ON DELETE CASCADE,
    line_no                 INTEGER NOT NULL,
    product_id              BIGINT NOT NULL REFERENCES inv_product(product_id),
    qty                     NUMERIC(14,4) NOT NULL,
    unit_price              NUMERIC(14,4) NOT NULL DEFAULT 0,
    unit_cost_snapshot      NUMERIC(14,4) NOT NULL DEFAULT 0,
    tax_code_id             BIGINT REFERENCES inv_tax_code(tax_code_id),
    linked_document_id      BIGINT REFERENCES inv_document_header(document_id),
    UNIQUE (sell_txn_id, line_no)
);

CREATE INDEX IF NOT EXISTS ix_sell_txn_department_ts
    ON sell_transaction_header(department_id, txn_ts);

-- =========================================================
-- 12. CLINICAL / CONSUMPTION INTEGRATION
-- =========================================================

CREATE TABLE IF NOT EXISTS inv_consumption_header (
    consumption_id          BIGSERIAL PRIMARY KEY,
    consumption_number      TEXT NOT NULL UNIQUE,
    department_id           BIGINT NOT NULL REFERENCES inv_department(department_id),
    consumption_ts          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    patient_ref             TEXT,
    provider_ref            TEXT,
    treatment_ref           TEXT,
    chair_ref               TEXT,

    status                  TEXT NOT NULL DEFAULT 'posted' CHECK (
                                status IN ('draft', 'posted', 'cancelled')
                             ),

    created_by              BIGINT NOT NULL REFERENCES app_user(user_id),
    posted_by               BIGINT REFERENCES app_user(user_id),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    posted_at               TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS inv_consumption_line (
    consumption_line_id     BIGSERIAL PRIMARY KEY,
    consumption_id          BIGINT NOT NULL REFERENCES inv_consumption_header(consumption_id) ON DELETE CASCADE,
    line_no                 INTEGER NOT NULL,
    product_id              BIGINT NOT NULL REFERENCES inv_product(product_id),
    qty                     NUMERIC(14,4) NOT NULL,
    unit_cost_snapshot      NUMERIC(14,4) NOT NULL DEFAULT 0,
    linked_document_id      BIGINT REFERENCES inv_document_header(document_id),
    UNIQUE (consumption_id, line_no)
);

-- =========================================================
-- 13. SIMPLE VIEW FOR STOCK ON HAND
-- =========================================================

CREATE OR REPLACE VIEW vw_inv_stock_on_hand AS
SELECT
    l.product_id,
    l.department_id,
    SUM(l.qty_delta) AS on_hand_qty,
    SUM(l.value_delta) AS stock_value
FROM inv_ledger l
GROUP BY l.product_id, l.department_id;

-- =========================================================
-- 14. SIMPLE VIEW FOR PRODUCT SHOPIFY-LIKE LISTING
-- =========================================================

CREATE OR REPLACE VIEW vw_inv_product_listing AS
SELECT
    p.product_id,
    p.sku,
    p.barcode,
    p.product_name,
    p.product_type,
    p.is_active,
    p.is_sellable,
    p.is_purchasable,
    p.is_consumable,
    c.category_name,
    b.brand_name,
    p.default_sell_price,
    p.default_cost,
    p.image_url,
    p.search_keywords
FROM inv_product p
LEFT JOIN inv_category c ON c.category_id = p.category_id
LEFT JOIN inv_brand b ON b.brand_id = p.brand_id;
