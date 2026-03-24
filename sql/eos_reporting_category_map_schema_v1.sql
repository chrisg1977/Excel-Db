-- EOS reporting category map (v1)
-- Purpose:
--   Stable mapping for non-department and department/reporting categories used by PAY SUMMARY views.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_reporting_category_map_schema_v1.sql

BEGIN;

CREATE TABLE IF NOT EXISTS eos_reporting_category_map (
	id BIGSERIAL PRIMARY KEY,

	-- Normalized incoming label key, e.g. ADMIN, MHB_CLINICS, SELL_OTHER_MHB
	raw_label_norm TEXT NOT NULL,

	-- Stable internal key used by reporting views.
	category_key TEXT NOT NULL,
	category_display_name TEXT NOT NULL,

	-- department | reporting_bucket | tax
	category_type TEXT NOT NULL,

	-- Nullable for non-department categories and mandatory NULL for tax categories.
	department_id BIGINT NULL REFERENCES departments(dept_id) ON DELETE RESTRICT,

	-- Optional context for why a mapping exists.
	notes TEXT NULL,

	is_active BOOLEAN NOT NULL DEFAULT TRUE,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

	CONSTRAINT eos_reporting_category_map_category_type_chk
		CHECK (category_type IN ('department', 'reporting_bucket', 'tax')),

	-- Enforce normalized uppercase underscore-style label key.
	CONSTRAINT eos_reporting_category_map_raw_label_norm_chk
		CHECK (raw_label_norm = upper(regexp_replace(raw_label_norm, '[^A-Za-z0-9]+', '_', 'g'))),

	-- Explicit tax-row protection rule.
	CONSTRAINT eos_reporting_category_map_tax_rules_chk
		CHECK (
			(category_type = 'tax'
			 AND department_id IS NULL
			 AND category_key IN ('ECOTAX_REMITTANCE', 'VAT_REMITTANCE'))
			OR
			(category_type <> 'tax'
			 AND category_key NOT IN ('ECOTAX_REMITTANCE', 'VAT_REMITTANCE'))
		)
);

-- Unique normalized source label map.
CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_reporting_category_map_raw_label_norm
	ON eos_reporting_category_map(raw_label_norm);

CREATE INDEX IF NOT EXISTS ix_eos_reporting_category_map_active_type
	ON eos_reporting_category_map(is_active, category_type);

CREATE INDEX IF NOT EXISTS ix_eos_reporting_category_map_category_key
	ON eos_reporting_category_map(category_key);

CREATE INDEX IF NOT EXISTS ix_eos_reporting_category_map_department_id
	ON eos_reporting_category_map(department_id)
	WHERE department_id IS NOT NULL;

-- Prevent duplicate active mappings for the same effective category + department pair.
CREATE UNIQUE INDEX IF NOT EXISTS ux_eos_reporting_category_map_key_department_active
	ON eos_reporting_category_map(category_key, COALESCE(department_id, -1))
	WHERE is_active = TRUE;

-- Ownership / grants aligned with repo conventions.
ALTER TABLE eos_reporting_category_map OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_reporting_category_map TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_reporting_category_map_id_seq TO app_directus;

-- Note: updated_at is refreshed by seed upserts currently; add a table trigger later if row-level
-- update tracking must be enforced for all update paths.

COMMIT;
