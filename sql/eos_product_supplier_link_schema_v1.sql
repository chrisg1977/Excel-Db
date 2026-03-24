-- EOS product/supplier link schema (v1)
-- Purpose:
--   Historical relationship table connecting canonical products to canonical suppliers.
--   Deterministic exact linkage only.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_product_supplier_link_schema_v1.sql

BEGIN;

CREATE TABLE IF NOT EXISTS eos_product_supplier_link (
  id BIGSERIAL PRIMARY KEY,

  product_id BIGINT NOT NULL REFERENCES eos_product_master(id) ON DELETE RESTRICT,
  supplier_id BIGINT NOT NULL REFERENCES eos_supplier_master(id) ON DELETE RESTRICT,

  relationship_type TEXT NOT NULL DEFAULT 'primary_supply',
  effective_from DATE NOT NULL,
  effective_to DATE NULL,

  source_system TEXT NOT NULL DEFAULT 'productlist',
  source_reference TEXT NULL,
  notes TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_product_supplier_link_relationship_type_chk
    CHECK (
      relationship_type IN (
        'primary_supply',
        'secondary_supply',
        'legacy_supply'
      )
    ),

  CONSTRAINT eos_product_supplier_link_date_range_chk
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- Historical version uniqueness for the same product/supplier relationship.
CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_product_supplier_link_version
  ON eos_product_supplier_link(product_id, supplier_id, relationship_type, effective_from);

-- One active row per product/supplier/relationship at a time.
CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_product_supplier_link_active_pair
  ON eos_product_supplier_link(product_id, supplier_id, relationship_type)
  WHERE effective_to IS NULL;

-- At most one active primary supplier per product.
CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_product_supplier_link_primary_active
  ON eos_product_supplier_link(product_id)
  WHERE effective_to IS NULL AND relationship_type = 'primary_supply';

CREATE INDEX IF NOT EXISTS ix_eos_product_supplier_link_supplier
  ON eos_product_supplier_link(supplier_id, effective_from DESC);

CREATE INDEX IF NOT EXISTS ix_eos_product_supplier_link_product
  ON eos_product_supplier_link(product_id, effective_from DESC);

ALTER TABLE eos_product_supplier_link OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_product_supplier_link TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_product_supplier_link_id_seq TO app_directus;

COMMIT;
