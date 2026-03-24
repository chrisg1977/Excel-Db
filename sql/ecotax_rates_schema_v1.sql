-- Ecotax policy settings history table.
-- Stores one row per policy period so management can update once yearly while preserving auditability.

CREATE TABLE IF NOT EXISTS ecotax_rates (
  id BIGSERIAL PRIMARY KEY,
  rate_per_night NUMERIC(10,2) NOT NULL,
  charge_age_from SMALLINT NOT NULL,
  max_fee NUMERIC(10,2) NOT NULL,
  effective_from DATE NOT NULL,
  previous_rate_valid_until DATE,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id UUID,
  created_by_email TEXT,
  updated_by_user_id UUID,
  updated_by_email TEXT,
  CONSTRAINT ecotax_rates_rate_non_negative CHECK (rate_per_night >= 0),
  CONSTRAINT ecotax_rates_age_non_negative CHECK (charge_age_from >= 0),
  CONSTRAINT ecotax_rates_max_fee_non_negative CHECK (max_fee >= 0),
  CONSTRAINT ecotax_rates_prev_until_consistent CHECK (
    previous_rate_valid_until IS NULL OR previous_rate_valid_until < effective_from
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ecotax_rates_active_singleton
  ON ecotax_rates ((is_active))
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS ix_ecotax_rates_effective_from
  ON ecotax_rates (effective_from DESC);

CREATE OR REPLACE FUNCTION set_ecotax_rates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ecotax_rates_updated_at ON ecotax_rates;
CREATE TRIGGER trg_ecotax_rates_updated_at
BEFORE UPDATE ON ecotax_rates
FOR EACH ROW
EXECUTE FUNCTION set_ecotax_rates_updated_at();
