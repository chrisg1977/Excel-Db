BEGIN;

CREATE TABLE IF NOT EXISTS cola_rates (
  id BIGSERIAL PRIMARY KEY,
  year INTEGER NOT NULL UNIQUE,
  weekly_amount NUMERIC(12,4) NOT NULL,
  standard_weekly_hours NUMERIC(8,4) NOT NULL DEFAULT 40,
  hourly_amount NUMERIC(12,6) GENERATED ALWAYS AS (weekly_amount / NULLIF(standard_weekly_hours, 0)) STORED,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cola_rates_weekly_amount_chk CHECK (weekly_amount >= 0),
  CONSTRAINT cola_rates_weekly_hours_chk CHECK (standard_weekly_hours > 0)
);

ALTER TABLE cola_rates OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON cola_rates TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE cola_rates_id_seq TO app_directus;

COMMIT;
