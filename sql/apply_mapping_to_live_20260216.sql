BEGIN;

-- Backup live table
CREATE TABLE IF NOT EXISTS social_security_rates_live_backup_20260216 AS TABLE social_security_rates_live;

-- Apply exact-match mapping to live table
UPDATE social_security_rates_live s
SET category_code = m.category_code
FROM directus.social_security_category_map m
WHERE lower(trim(s.raw_category_label)) = lower(trim(m.raw_category_label))
  AND (s.category_code IS DISTINCT FROM m.category_code);

-- Report results
SELECT count(*) AS total_rows, 
       sum(CASE WHEN category_code IS NOT NULL THEN 1 ELSE 0 END) AS mapped_rows,
       sum(CASE WHEN category_code IS NULL THEN 1 ELSE 0 END) AS unmapped_rows
FROM social_security_rates_live;

SELECT category_code, count(*) AS count
FROM social_security_rates_live 
WHERE category_code IS NOT NULL
GROUP BY category_code 
ORDER BY count DESC;

SELECT id, year, raw_category_label, category_code 
FROM social_security_rates_live 
WHERE category_code IS NULL 
LIMIT 20;

COMMIT;
