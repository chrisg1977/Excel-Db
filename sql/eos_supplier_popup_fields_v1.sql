-- EOS supplier popup fields extension (v1)
-- Adds columns required by inline supplier creation modal payload.

BEGIN;

ALTER TABLE inv_supplier
  ADD COLUMN IF NOT EXISTS notes TEXT;

COMMIT;
