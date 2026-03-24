-- EOS product pricing history schema (v1)
-- Purpose:
--   Historical, auditable pricing for cost and selling dimensions.
--   New pricing is versioned by effective date and never silently overwritten.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_product_pricing_history_schema_v1.sql

BEGIN;

CREATE TABLE IF NOT EXISTS eos_product_pricing_history (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES eos_product_master(id) ON DELETE RESTRICT,

  effective_from DATE NOT NULL,
  effective_to DATE NULL,

  -- Cost side (PRODUCTLIST H:I:J)
  cost_ex_vat NUMERIC(14,4) NULL,
  cost_vat_rate_pct NUMERIC(7,4) NULL,
  cost_inc_vat NUMERIC(14,4) NULL,

  -- Retail/sell side (PRODUCTLIST K:L:M:N)
  retail_ex_vat NUMERIC(14,4) NULL,
  retail_vat_rate_pct NUMERIC(7,4) NULL,
  retail_vat_amount NUMERIC(14,4) NULL,
  unit_selling_price NUMERIC(14,4) NULL,

  currency_code TEXT NOT NULL DEFAULT 'EUR',

  source_system TEXT NOT NULL DEFAULT 'productlist',
  source_reference TEXT NULL,
  notes TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_product_pricing_history_date_range_chk
    CHECK (effective_to IS NULL OR effective_to >= effective_from),

  CONSTRAINT eos_product_pricing_history_cost_non_negative_chk
    CHECK (
      (cost_ex_vat IS NULL OR cost_ex_vat >= 0)
      AND (cost_inc_vat IS NULL OR cost_inc_vat >= 0)
    ),

  CONSTRAINT eos_product_pricing_history_retail_non_negative_chk
    CHECK (
      (retail_ex_vat IS NULL OR retail_ex_vat >= 0)
      AND (retail_vat_amount IS NULL OR retail_vat_amount >= 0)
      AND (unit_selling_price IS NULL OR unit_selling_price >= 0)
    ),

  CONSTRAINT eos_product_pricing_history_vat_rate_range_chk
    CHECK (
      (cost_vat_rate_pct IS NULL OR (cost_vat_rate_pct >= 0 AND cost_vat_rate_pct <= 100))
      AND (retail_vat_rate_pct IS NULL OR (retail_vat_rate_pct >= 0 AND retail_vat_rate_pct <= 100))
    ),

  CONSTRAINT eos_product_pricing_history_currency_chk
    CHECK (currency_code ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_product_pricing_history_version
  ON eos_product_pricing_history(product_id, effective_from);

CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_product_pricing_history_active
  ON eos_product_pricing_history(product_id)
  WHERE effective_to IS NULL;

CREATE INDEX IF NOT EXISTS ix_eos_product_pricing_history_product
  ON eos_product_pricing_history(product_id, effective_from DESC);

CREATE INDEX IF NOT EXISTS ix_eos_product_pricing_history_currency
  ON eos_product_pricing_history(currency_code);

ALTER TABLE eos_product_pricing_history OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_product_pricing_history TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_product_pricing_history_id_seq TO app_directus;

COMMIT;
