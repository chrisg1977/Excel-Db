BEGIN;

-- Backup existing mapping table
CREATE TABLE IF NOT EXISTS directus.social_security_category_map_backup_20260216 AS TABLE directus.social_security_category_map;

-- Insert canonical A-F mappings if they don't already exist (case-insensitive)
INSERT INTO directus.social_security_category_map (raw_category_label, category_code, enabled)
SELECT v.raw, v.code, true
FROM (
  VALUES
    ('Class A','A'),
    ('Class A (Under 18)','A'),
    ('Class B','B'),
    ('Class C','C'),
    ('Class D','D'),
    ('Class E','E'),
    ('Class F','F')
) AS v(raw, code)
WHERE NOT EXISTS (
  SELECT 1 FROM directus.social_security_category_map m
  WHERE lower(trim(m.raw_category_label)) = lower(trim(v.raw))
);

-- Backup import table
CREATE TABLE IF NOT EXISTS social_security_rates_import_backup_20260216 AS TABLE social_security_rates_import;

-- Apply exact-match mapping to import table (only where it would change)
UPDATE social_security_rates_import s
SET category_code = m.category_code
FROM directus.social_security_category_map m
WHERE lower(trim(s.raw_category_label)) = lower(trim(m.raw_category_label))
  AND (s.category_code IS DISTINCT FROM m.category_code);

-- Reporting
SELECT count(*) AS total_rows, sum(CASE WHEN category_code IS NOT NULL THEN 1 ELSE 0 END) AS mapped_rows FROM social_security_rates_import;
SELECT id, raw_category_label, category_code FROM social_security_rates_import ORDER BY id;

COMMIT;
