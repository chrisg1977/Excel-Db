-- Canonical registry for provider payslip/invoice documents.
-- File uploads can have any source filename; system stores canonical DB-driven filename + target path.

CREATE TABLE IF NOT EXISTS provider_documents (
  id BIGSERIAL PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES od_provider_map(provider_id) ON DELETE CASCADE,
  period_year INTEGER NOT NULL,
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  document_type TEXT NOT NULL CHECK (document_type IN (
    'PROVIDER_PAYSLIP_DRAFT',
    'PROVIDER_PAYSLIP_SIGNED',
    'THIRDPARTY_PROVIDER_INVOICE_DRAFT',
    'THIRDPARTY_PROVIDER_INVOICE_SIGNED'
  )),
  invoice_number TEXT,
  source_filename TEXT,
  canonical_filename TEXT NOT NULL,
  target_directory TEXT NOT NULL,
  target_full_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'READY_TO_SIGN', 'SIGNED', 'ARCHIVED')),
  uploaded_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, period_year, period_month, document_type)
);

CREATE INDEX IF NOT EXISTS idx_provider_documents_provider_period
  ON provider_documents(provider_id, period_year, period_month);

CREATE OR REPLACE FUNCTION fn_update_provider_documents_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_provider_documents_updated ON provider_documents;
CREATE TRIGGER tr_provider_documents_updated
BEFORE UPDATE ON provider_documents
FOR EACH ROW
EXECUTE FUNCTION fn_update_provider_documents_timestamp();
