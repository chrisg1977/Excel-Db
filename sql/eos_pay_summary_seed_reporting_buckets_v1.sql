-- EOS PAY SUMMARY reporting bucket seeds (v1)
-- Purpose:
--   Seed stable reporting-category mappings used by PAY SUMMARY views.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_pay_summary_seed_reporting_buckets_v1.sql

BEGIN;

/*
Build-now decision:
- Keep non-department reporting buckets stable in v1.
- Include tax category keys for explicit display mapping.
- department_id stays NULL for these rows.
*/

INSERT INTO eos_reporting_category_map (
  raw_label_norm,
  category_key,
  category_display_name,
  category_type,
  department_id,
  notes,
  is_active
)
VALUES
  -- Non-department reporting buckets (build now)
  ('ADMIN', 'ADMIN', 'Admin', 'reporting_bucket', NULL, 'Confirmed non-department bucket (derived from PAY SUMMARY row)', TRUE),
  ('MHB', 'MHB', 'MHB', 'reporting_bucket', NULL, 'Confirmed non-department bucket (derived from PAY SUMMARY row)', TRUE),
  ('MHB_CLINICS', 'MHB_CLINICS', 'MHB Clinics', 'reporting_bucket', NULL, 'Confirmed non-department bucket (derived from PAY SUMMARY row)', TRUE),
  ('SELL_OTHER_MHB', 'SELL_OTHER_MHB', 'Sell Other (MHB)', 'reporting_bucket', NULL, 'Confirmed non-department bucket (derived from PAY SUMMARY row)', TRUE),

  -- Tax rows (must remain tax + null department)
  ('ECOTAX_REMITTANCE', 'ECOTAX_REMITTANCE', 'ECOTAX Remittance', 'tax', NULL, 'Tax display mapping', TRUE),
  ('VAT_REMITTANCE', 'VAT_REMITTANCE', 'VAT Remittance', 'tax', NULL, 'Tax display mapping', TRUE)
ON CONFLICT (raw_label_norm)
DO UPDATE SET
  category_key = EXCLUDED.category_key,
  category_display_name = EXCLUDED.category_display_name,
  category_type = EXCLUDED.category_type,
  department_id = EXCLUDED.department_id,
  notes = EXCLUDED.notes,
  is_active = EXCLUDED.is_active,
  updated_at = now();

COMMIT;
