-- OpenDental provider production import ledger
-- Raw source-of-truth import rows for provider earnings/production.
-- Distinct from provider_payments (which stores settlement/payment outcomes).

CREATE TABLE IF NOT EXISTS od_provider_production (
  id BIGSERIAL PRIMARY KEY,
  import_batch_id BIGINT,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  provider_id TEXT NOT NULL REFERENCES od_provider_map(provider_id) ON DELETE RESTRICT,
  od_prov_num INTEGER NOT NULL,
  proc_date DATE NOT NULL,
  clinic_num INTEGER,
  source_proc_num BIGINT NOT NULL,
  proc_fee_gross NUMERIC(12,2) NOT NULL CHECK (proc_fee_gross >= 0),
  source_system TEXT NOT NULL DEFAULT 'OpenDental',
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_system, source_proc_num, od_prov_num)
);

CREATE INDEX IF NOT EXISTS idx_od_provider_production_provider_period
  ON od_provider_production(provider_id, period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_od_provider_production_prov_date
  ON od_provider_production(od_prov_num, proc_date);

CREATE INDEX IF NOT EXISTS idx_od_provider_production_clinic
  ON od_provider_production(clinic_num);

CREATE OR REPLACE FUNCTION fn_update_od_provider_production_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_od_provider_production_updated ON od_provider_production;
CREATE TRIGGER tr_od_provider_production_updated
BEFORE UPDATE ON od_provider_production
FOR EACH ROW
EXECUTE FUNCTION fn_update_od_provider_production_timestamp();

CREATE TABLE IF NOT EXISTS od_provider_production_import_log (
  id BIGSERIAL PRIMARY KEY,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  od_prov_num INTEGER NOT NULL,
  clinic_nums INTEGER[],
  split_by_clinic BOOLEAN NOT NULL DEFAULT FALSE,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'STARTED' CHECK (status IN ('STARTED', 'COMPLETED', 'FAILED')),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);
