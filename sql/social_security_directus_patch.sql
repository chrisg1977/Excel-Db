BEGIN;

CREATE TABLE IF NOT EXISTS directus.social_security_category_map (
  id SERIAL PRIMARY KEY,
  raw_category_label TEXT,
  category_code VARCHAR(255),
  enabled BOOLEAN DEFAULT true
);

CREATE TABLE IF NOT EXISTS directus.social_security_rates_import (
  id SERIAL PRIMARY KEY,
  status VARCHAR(255) DEFAULT 'draft' NOT NULL,
  date_created TIMESTAMPTZ,
  batch_id UUID,
  year INTEGER,
  raw_category_label TEXT,
  category_code VARCHAR(255),
  band_from NUMERIC(10,5),
  band_to NUMERIC(10,5),
  employee_rate NUMERIC(10,5),
  employer_rate NUMERIC(10,5),
  total_rate NUMERIC(10,5),
  employee_amount NUMERIC(10,5),
  employer_amount NUMERIC(10,5),
  total_amount NUMERIC(10,5),
  source_url TEXT
);

CREATE TABLE IF NOT EXISTS directus.social_security_rates_live (
  id SERIAL PRIMARY KEY,
  date_created TIMESTAMPTZ,
  year INTEGER,
  raw_category_label TEXT,
  category_code VARCHAR(255),
  band_from NUMERIC(10,5),
  band_to NUMERIC(10,5),
  employee_rate NUMERIC(10,5),
  employer_rate NUMERIC(10,5),
  total_rate NUMERIC(10,5),
  employee_amount NUMERIC(10,5),
  employer_amount NUMERIC(10,5),
  total_amount NUMERIC(10,5),
  source_url TEXT
);

DELETE FROM directus.social_security_category_map a
USING directus.social_security_category_map b
WHERE a.raw_category_label IS NOT NULL
  AND b.raw_category_label IS NOT NULL
  AND a.raw_category_label = b.raw_category_label
  AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_security_category_map_raw_label
  ON directus.social_security_category_map (raw_category_label);

INSERT INTO directus.social_security_category_map (raw_category_label, category_code, enabled)
VALUES
  ('Class 1 Main', 'class1_main', true),
  ('Class 1 Youth', 'class1_youth', true),
  ('Class 1 Pensionable', 'class1_pensionable', true),
  ('Class 1 Part-Time', 'class1_part_time', true)
ON CONFLICT (raw_category_label) DO UPDATE
SET category_code = EXCLUDED.category_code,
    enabled = EXCLUDED.enabled;

WITH hr_policy AS (
  SELECT id
  FROM directus.directus_policies
  WHERE name = 'HR'
  LIMIT 1
), perms(action, collection) AS (
  VALUES
    ('create', 'social_security_rates_import'),
    ('read',   'social_security_rates_import'),
    ('update', 'social_security_rates_import'),
    ('delete', 'social_security_rates_import'),
    ('create', 'social_security_rates_live'),
    ('read',   'social_security_rates_live'),
    ('update', 'social_security_rates_live'),
    ('delete', 'social_security_rates_live'),
    ('create', 'social_security_category_map'),
    ('read',   'social_security_category_map'),
    ('update', 'social_security_category_map'),
    ('delete', 'social_security_category_map')
)
INSERT INTO directus.directus_permissions (collection, action, permissions, validation, presets, fields, policy)
SELECT p.collection, p.action, '{}'::json, '{}'::json, NULL, NULL, h.id
FROM perms p
CROSS JOIN hr_policy h
WHERE NOT EXISTS (
  SELECT 1
  FROM directus.directus_permissions d
  WHERE d.policy = h.id
    AND d.collection = p.collection
    AND d.action = p.action
);

COMMIT;
