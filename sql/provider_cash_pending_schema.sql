-- Tracks carried pending cash (loan-like negative cash) per provider per period.
-- If a period cash is negative, it is stored and automatically deducted from first future positive period.

CREATE TABLE IF NOT EXISTS provider_cash_pending (
  id BIGSERIAL PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES od_provider_map(provider_id) ON DELETE CASCADE,
  period_label TEXT NOT NULL,
  pending_in NUMERIC(12,2) NOT NULL DEFAULT 0,
  pending_out NUMERIC(12,2) NOT NULL DEFAULT 0,
  cash_before_pending NUMERIC(12,2) NOT NULL DEFAULT 0,
  cash_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, period_label)
);

CREATE INDEX IF NOT EXISTS idx_provider_cash_pending_provider
  ON provider_cash_pending(provider_id, period_label);

CREATE OR REPLACE FUNCTION fn_update_provider_cash_pending_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_provider_cash_pending_updated ON provider_cash_pending;
CREATE TRIGGER tr_provider_cash_pending_updated
BEFORE UPDATE ON provider_cash_pending
FOR EACH ROW
EXECUTE FUNCTION fn_update_provider_cash_pending_timestamp();
