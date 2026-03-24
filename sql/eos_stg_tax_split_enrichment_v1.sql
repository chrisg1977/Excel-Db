-- EOS staged tax-split enrichment layer (v1, optional)
-- Purpose:
--   Provide explicit, reviewable tax split enrichment for tax-coded rows only,
--   without inventing ex_vat/vat amounts.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_stg_tax_split_enrichment_v1.sql
--
-- Assumptions:
--   - v_eos_stg_line_classification_v1 exists and exposes tax_code + total_amount_candidate.
--   - Split overrides come from trusted source docs or audited calculations.
--
-- Deterministic vs manual-reviewed vs unresolved policy:
--   - deterministic: mathematically/audit-backed split, approved
--   - manual_reviewed: human-verified split, approved
--   - unresolved: no approved valid split available
--
-- Loader impact:
--   - eos_stg_to_shift_payment_lines_insert_v1.sql can consume ex_vat_for_loading and
--     vat_for_loading for tax-coded rows only when tax_split_load_safe = true.

BEGIN;

CREATE TABLE IF NOT EXISTS eos_stg_tax_split_overrides (
  candidate_id TEXT PRIMARY KEY,
  ex_vat_amount NUMERIC(14,2) NOT NULL,
  vat_amount NUMERIC(14,2) NOT NULL,
  total_amount NUMERIC(14,2) NOT NULL,

  split_class TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'pending',
  source_reference TEXT NOT NULL,
  notes TEXT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT eos_stg_tax_split_class_chk
    CHECK (split_class IN ('deterministic', 'manual_reviewed')),

  CONSTRAINT eos_stg_tax_split_review_chk
    CHECK (review_status IN ('pending', 'approved', 'rejected')),

  CONSTRAINT eos_stg_tax_split_sum_chk
    CHECK ((ex_vat_amount + vat_amount) = total_amount)
);

CREATE INDEX IF NOT EXISTS ix_eos_stg_tax_split_overrides_review
  ON eos_stg_tax_split_overrides(review_status, split_class);

ALTER TABLE eos_stg_tax_split_overrides OWNER TO schema_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON eos_stg_tax_split_overrides TO app_directus;

CREATE OR REPLACE VIEW v_eos_stg_tax_split_enrichment_v1 AS
WITH base AS (
  SELECT
    c.candidate_id,
    c.branch_code,
    c.source_table_name,
    c.source_family,
    c._source_file,
    c._source_sheet,
    c._row_num,
    c.tax_code,
    c.total_amount_candidate
  FROM v_eos_stg_line_classification_v1 c
),
joined AS (
  SELECT
    b.*,
    o.ex_vat_amount,
    o.vat_amount,
    o.total_amount AS override_total_amount,
    o.split_class,
    o.review_status,
    o.source_reference,
    o.notes,
    (
      o.candidate_id IS NOT NULL
      AND o.review_status = 'approved'
      AND o.total_amount = b.total_amount_candidate
      AND o.split_class IN ('deterministic', 'manual_reviewed')
    ) AS approved_matching_override
  FROM base b
  LEFT JOIN eos_stg_tax_split_overrides o
    ON o.candidate_id = b.candidate_id
)
SELECT
  j.candidate_id,
  j.branch_code,
  j.source_table_name,
  j.source_family,
  j._source_file,
  j._source_sheet,
  j._row_num,
  j.tax_code,
  j.total_amount_candidate,

  j.ex_vat_amount,
  j.vat_amount,
  j.override_total_amount,
  j.split_class,
  j.source_reference AS tax_split_source_reference,
  j.notes AS tax_split_notes,

  CASE
    WHEN j.tax_code IS NULL THEN 'not_required'
    WHEN j.approved_matching_override THEN j.split_class
    ELSE 'unresolved'
  END AS tax_split_status,

  CASE
    WHEN j.tax_code IS NULL THEN TRUE
    WHEN j.approved_matching_override THEN TRUE
    ELSE FALSE
  END AS tax_split_load_safe,

  CASE
    WHEN j.tax_code IS NULL THEN 0::numeric(14,2)
    WHEN j.approved_matching_override THEN j.ex_vat_amount
    ELSE NULL::numeric(14,2)
  END AS ex_vat_for_loading,

  CASE
    WHEN j.tax_code IS NULL THEN 0::numeric(14,2)
    WHEN j.approved_matching_override THEN j.vat_amount
    ELSE NULL::numeric(14,2)
  END AS vat_for_loading,

  CASE
    WHEN j.tax_code IS NULL THEN NULL
    WHEN j.approved_matching_override THEN NULL
    WHEN j.review_status IS DISTINCT FROM 'approved' THEN 'tax_split_not_approved'
    WHEN j.override_total_amount IS DISTINCT FROM j.total_amount_candidate THEN 'tax_split_total_mismatch'
    ELSE 'tax_split_unresolved'
  END AS tax_split_unresolved_reason
FROM joined j;

COMMIT;
