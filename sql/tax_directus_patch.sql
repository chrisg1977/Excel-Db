BEGIN;

-- Align Directus-managed tax tables with extension expectations.
ALTER TABLE directus.tax_rates_import
  ADD COLUMN IF NOT EXISTS category_code VARCHAR(255),
  ADD COLUMN IF NOT EXISTS band_from NUMERIC(10,5),
  ADD COLUMN IF NOT EXISTS band_to NUMERIC(10,5),
  ADD COLUMN IF NOT EXISTS rate NUMERIC(10,5),
  ADD COLUMN IF NOT EXISTS subtract NUMERIC(10,5),
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS status VARCHAR(255) DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS date_created TIMESTAMPTZ;

ALTER TABLE directus.tax_rates_live
  ADD COLUMN IF NOT EXISTS category_code VARCHAR(255),
  ADD COLUMN IF NOT EXISTS band_from NUMERIC(10,5),
  ADD COLUMN IF NOT EXISTS band_to NUMERIC(10,5),
  ADD COLUMN IF NOT EXISTS rate NUMERIC(10,5),
  ADD COLUMN IF NOT EXISTS subtract NUMERIC(10,5),
  ADD COLUMN IF NOT EXISTS source_url TEXT,
  ADD COLUMN IF NOT EXISTS date_created TIMESTAMPTZ;

ALTER TABLE directus.tax_category_map
  ADD COLUMN IF NOT EXISTS enabled BOOLEAN DEFAULT true;

DELETE FROM directus.tax_category_map a
USING directus.tax_category_map b
WHERE a.raw_category_label IS NOT NULL
  AND b.raw_category_label IS NOT NULL
  AND a.raw_category_label = b.raw_category_label
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tax_category_map_raw_label
  ON directus.tax_category_map (raw_category_label);

INSERT INTO directus.tax_category_map (raw_category_label, category_code, enabled)
VALUES
  ('Single Rates', 'sng', true),
  ('Married Rates 1', 'mar1', true),
  ('Married Rates 2', 'mar2', true),
  ('Married Rates', 'mar', true),
  ('Parent Rates 1', 'par1', true),
  ('Parent Rates 2', 'par2', true),
  ('Parent Rates', 'par', true)
ON CONFLICT (raw_category_label) DO UPDATE
SET category_code = EXCLUDED.category_code,
    enabled = EXCLUDED.enabled;

COMMIT;
