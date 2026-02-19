-- Provider payments table
-- Tracks payments to providers (cash, Revolut, bank transfers)
-- Separate from main payroll system

CREATE TABLE IF NOT EXISTS provider_payments (
  id BIGSERIAL PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES od_provider_map(provider_id) ON DELETE CASCADE,
  payment_date DATE NOT NULL,
  hours NUMERIC(8, 2) NOT NULL,
  amount NUMERIC(12, 2),
  payment_method TEXT NOT NULL DEFAULT 'CASH' 
    CHECK (payment_method IN ('CASH', 'REVOLUT', 'BANK_TRANSFER')),
  payment_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (payment_status IN ('PENDING', 'APPROVED', 'PAID', 'ARCHIVED')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_payments_provider ON provider_payments(provider_id);
CREATE INDEX IF NOT EXISTS idx_provider_payments_date ON provider_payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_provider_payments_status ON provider_payments(payment_status);

-- Audit trigger for provider_payments
CREATE OR REPLACE FUNCTION fn_update_provider_payments_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

DROP TRIGGER IF EXISTS tr_provider_payments_updated ON provider_payments;
CREATE TRIGGER tr_provider_payments_updated
BEFORE UPDATE ON provider_payments
FOR EACH ROW
EXECUTE FUNCTION fn_update_provider_payments_timestamp();
