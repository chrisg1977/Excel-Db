-- Backup existing map and ensure canonical 'mar' and 'par' entries exist
BEGIN;
CREATE TABLE IF NOT EXISTS tax_category_map_backup AS
  TABLE tax_category_map WITH NO DATA;
INSERT INTO tax_category_map_backup SELECT * FROM tax_category_map;

INSERT INTO tax_category_map (raw_category_label, category_code, enabled, created_at)
VALUES
  ('Married Rates', 'mar', true, now()),
  ('Parent Rates', 'par', true, now())
ON CONFLICT (raw_category_label) DO UPDATE
  SET category_code = EXCLUDED.category_code,
      enabled = EXCLUDED.enabled,
      created_at = COALESCE(tax_category_map.created_at, EXCLUDED.created_at);

COMMIT;
