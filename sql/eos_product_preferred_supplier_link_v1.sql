-- EOS product preferred supplier extension (v1)
-- Adds product-level preferred supplier pointer for product create/edit form.

BEGIN;

ALTER TABLE inv_product
  ADD COLUMN IF NOT EXISTS preferred_supplier_id BIGINT REFERENCES inv_supplier(supplier_id);

CREATE INDEX IF NOT EXISTS ix_inv_product_preferred_supplier
  ON inv_product(preferred_supplier_id)
  WHERE preferred_supplier_id IS NOT NULL;

COMMIT;
