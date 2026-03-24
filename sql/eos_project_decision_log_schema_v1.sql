-- EOS project decision/instruction log schema (v1)
-- Purpose:
--   Persist cross-session implementation decisions, interpretations, exclusions,
--   deferred items, and loader/audit rules for EOS workstreams.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_project_decision_log_schema_v1.sql

BEGIN;

CREATE TABLE IF NOT EXISTS eos_project_decision_log (
  id BIGSERIAL PRIMARY KEY,

  decision_date DATE NOT NULL,

  decision_category TEXT NOT NULL,
  project_area TEXT NOT NULL,

  title TEXT NOT NULL,
  decision_text TEXT NOT NULL,
  rationale TEXT NOT NULL,
  source_reference TEXT NULL,

  applies_from DATE NOT NULL,
  applies_to DATE NULL,

  status TEXT NOT NULL DEFAULT 'active',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_project_decision_log_category_chk
    CHECK (
      decision_category IN (
        'sheet_interpretation',
        'data_rule',
        'exclusion',
        'deferred_item',
        'modeling_decision',
        'loader_rule',
        'audit_rule'
      )
    ),

  CONSTRAINT eos_project_decision_log_project_area_chk
    CHECK (
      project_area IN (
        'PAY',
        'FEE',
        'SELL',
        'PRODUCTLIST',
        'SUPPLIER',
        'STOCK',
        'COMMISSION',
        'GENERAL'
      )
    ),

  CONSTRAINT eos_project_decision_log_status_chk
    CHECK (status IN ('active', 'superseded', 'deferred')),

  CONSTRAINT eos_project_decision_log_date_range_chk
    CHECK (applies_to IS NULL OR applies_to >= applies_from),

  CONSTRAINT eos_project_decision_log_title_area_from_uk
    UNIQUE (title, project_area, applies_from)
);

CREATE INDEX IF NOT EXISTS ix_eos_project_decision_log_category_area_status
  ON eos_project_decision_log(decision_category, project_area, status);

CREATE INDEX IF NOT EXISTS ix_eos_project_decision_log_decision_date
  ON eos_project_decision_log(decision_date DESC);

CREATE INDEX IF NOT EXISTS ix_eos_project_decision_log_active_window
  ON eos_project_decision_log(project_area, applies_from, applies_to)
  WHERE status = 'active';

ALTER TABLE eos_project_decision_log OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_project_decision_log TO app_directus;
GRANT USAGE, SELECT, UPDATE ON SEQUENCE eos_project_decision_log_id_seq TO app_directus;

-- Initial baseline decisions (idempotent upserts by title + project_area + applies_from)
INSERT INTO eos_project_decision_log (
  decision_date,
  decision_category,
  project_area,
  title,
  decision_text,
  rationale,
  source_reference,
  applies_from,
  applies_to,
  status
)
VALUES
(
  DATE '2026-03-14',
  'deferred_item',
  'COMMISSION',
  'Commission model deferred pending manager files/rules',
  'Commission model design and loader logic remain deferred until manager-provided source files and explicit calculation rules are supplied.',
  'Prevents speculative commission behavior and protects accounting correctness.',
  'EOS project directive 2026-03-14',
  DATE '2026-03-14',
  NULL,
  'deferred'
),
(
  DATE '2026-03-14',
  'exclusion',
  'PRODUCTLIST',
  'PRODUCTLIST row 152 excluded',
  'Row 152 is explicitly excluded from PRODUCTLIST pipeline processing.',
  'Known deprecated/non-loadable row; exclusion keeps canonical product state clean.',
  'sql/v_eos_productlist_raw_v1.sql',
  DATE '2026-03-14',
  NULL,
  'active'
),
(
  DATE '2026-03-14',
  'data_rule',
  'PRODUCTLIST',
  'Missing PRODUCTLIST H treated as zero only for free-of-charge',
  'Missing H (cost ex VAT) is treated as 0 only under approved free-of-charge handling; otherwise missing required pricing remains unresolved/rejected.',
  'Allows approved free-of-charge normalization while preserving strict reject-first behavior for invalid pricing gaps.',
  'sql/v_eos_productlist_candidates_v1.sql',
  DATE '2026-03-14',
  NULL,
  'active'
),
(
  DATE '2026-03-14',
  'data_rule',
  'PRODUCTLIST',
  'Barcode special identity rule approved',
  'Non-digit barcode values are accepted as identity_type=special_identity with normalized identity_value_norm, instead of being discarded.',
  'Preserves deterministic product identity matching for legacy/non-numeric supplier labels.',
  'sql/v_eos_productlist_candidates_v1.sql',
  DATE '2026-03-14',
  NULL,
  'active'
),
(
  DATE '2026-03-14',
  'modeling_decision',
  'PRODUCTLIST',
  'Secondary/distributor barcode field supported',
  'Secondary barcode (distributor_barcode) is supported and loaded as an additional non-primary identity when present and unique.',
  'Improves supplier/product matching without replacing primary barcode identity.',
  'sql/eos_stg_to_product_master_insert_v1.sql',
  DATE '2026-03-14',
  NULL,
  'active'
),
(
  DATE '2026-03-14',
  'modeling_decision',
  'GENERAL',
  'PAY and FEE use separate canonical paths',
  'PAY and FEE are modeled and loaded through separate canonical tables/paths; they are not merged into a single transaction table.',
  'Maintains clearer accounting semantics and supports source-specific rule enforcement.',
  'sql/eos_shift_payment_lines_schema_v1.sql; sql/eos_shift_fee_income_lines_schema_v1.sql',
  DATE '2026-03-14',
  NULL,
  'active'
),
(
  DATE '2026-03-14',
  'sheet_interpretation',
  'GENERAL',
  'ENTRY sheet is reference/master only',
  'ENTRY sheet is interpreted as reference/master-data input and must not be treated as direct transaction-line source.',
  'Avoids contamination of operational transaction loaders with reference metadata rows.',
  'sql/eos_workbook_interpretation_correction_v1.md',
  DATE '2026-03-14',
  NULL,
  'active'
),
(
  DATE '2026-03-14',
  'sheet_interpretation',
  'GENERAL',
  'PAY SUMMARY is reconciliation/reporting only',
  'PAY SUMMARY is interpreted as reconciliation/reporting layer and must not be used as direct transaction-line input.',
  'Protects canonical transaction lineage and prevents aggregate-row double counting.',
  'sql/eos_workbook_interpretation_correction_v1.md',
  DATE '2026-03-14',
  NULL,
  'active'
)
ON CONFLICT (title, project_area, applies_from) DO UPDATE
SET
  decision_date = EXCLUDED.decision_date,
  decision_category = EXCLUDED.decision_category,
  decision_text = EXCLUDED.decision_text,
  rationale = EXCLUDED.rationale,
  source_reference = EXCLUDED.source_reference,
  applies_to = EXCLUDED.applies_to,
  status = EXCLUDED.status,
  updated_at = now();

COMMIT;

-- Sample retrieval query:
-- SELECT id, decision_date, project_area, decision_category, title, status
-- FROM eos_project_decision_log
-- ORDER BY decision_date DESC, id DESC
-- LIMIT 20;
