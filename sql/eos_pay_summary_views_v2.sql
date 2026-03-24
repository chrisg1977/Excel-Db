-- EOS PAY SUMMARY views (v2)
-- Purpose:
--   Build branch-level, monthly, and all-branches summary views for EOS PAY SUMMARY reporting.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_pay_summary_views_v2.sql
--
-- IMPORTANT PLACEHOLDER NOTE:
--   Canonical department source is currently assumed as departments(dept_id, abbreviation, name).
--   If production canonical source is catalog-v2-backed, replace the canonical joins below accordingly.
--
-- Mapping clarification:
--   "MHB Running LAB" and "MHB Running" are treated as the same canonical department (MHB_RUNNING)
--   via department_alias alias_norm mapping. They should not be modeled as reporting buckets.

BEGIN;

-- ------------------------------------------------------------
-- 1) Branch-level PAY SUMMARY
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_eos_pay_summary_branch AS
WITH base_operational AS (
  /* REQUIRED SOURCE-CONTRACT FIELDS (current names are placeholders):
     eos_shift_header:
       - id
       - branch_code                    -- EOSZ|EOSQ|EOSBLUM
       - business_date
     eos_shift_payment_lines:
       - shift_header_id
       - category_label_raw
       - department_label_raw
       - source_stage                   -- midshift|endshift
       - cost_nature                    -- running|capital
       - payment_channel                -- cash|non_cash
       - receipt_state                  -- with_receipt|no_receipt
       - ex_vat_amount
       - vat_amount
       - total_amount
       - tax_code                       -- ECOTAX|VAT|null
  */
  SELECT
    h.id AS shift_header_id,
    h.branch_code,
    date_trunc('month', h.business_date)::date AS business_month,
    p.category_label_raw,
    p.department_label_raw,
    p.source_stage,
    p.cost_nature,
    p.payment_channel,
    p.receipt_state,
    p.ex_vat_amount,
    p.vat_amount,
    p.total_amount,
    p.tax_code
  FROM eos_shift_header h
  JOIN eos_shift_payment_lines p
    ON p.shift_header_id = h.id
  WHERE h.branch_code IN ('EOSZ', 'EOSQ', 'EOSBLUM')
),
normalized AS (
  SELECT
    b.*,
    upper(regexp_replace(trim(coalesce(b.department_label_raw, b.category_label_raw, '')), '[^A-Za-z0-9]+', '_', 'g')) AS raw_label_norm
  FROM base_operational b
),
resolved AS (
  SELECT
    n.branch_code,
    n.business_month,

    -- Resolution order:
    -- 1) tax_code -> tax category
    -- 2) department_alias.alias_norm
    -- 3) direct departments.abbreviation normalized match
    -- 4) eos_reporting_category_map
    -- 5) regex-normalized fallback
    CASE
      WHEN n.tax_code IN ('ECOTAX', 'VAT') THEN 'tax'
      WHEN da.department_id IS NOT NULL THEN 'department'
      WHEN d.dept_id IS NOT NULL THEN 'department'
      WHEN rcm.category_type IS NOT NULL THEN rcm.category_type
      ELSE 'reporting_bucket'
    END AS category_type,

    CASE
      WHEN n.tax_code = 'ECOTAX' THEN 'ECOTAX_REMITTANCE'
      WHEN n.tax_code = 'VAT' THEN 'VAT_REMITTANCE'
      WHEN da.department_id IS NOT NULL THEN upper(d_from_alias.abbreviation)
      WHEN d.dept_id IS NOT NULL THEN upper(d.abbreviation)
      WHEN rcm.category_key IS NOT NULL THEN rcm.category_key
      ELSE n.raw_label_norm
    END AS category_key,

    CASE
      WHEN n.tax_code IN ('ECOTAX', 'VAT') THEN NULL::bigint
      WHEN da.department_id IS NOT NULL THEN da.department_id
      WHEN d.dept_id IS NOT NULL THEN d.dept_id
      WHEN rcm.department_id IS NOT NULL THEN rcm.department_id
      ELSE NULL::bigint
    END AS department_id,

    n.cost_nature,
    n.payment_channel,
    n.receipt_state,
    n.ex_vat_amount,
    n.vat_amount,
    n.total_amount
  FROM normalized n
  LEFT JOIN department_alias da
    ON da.alias_norm = n.raw_label_norm
   AND da.is_active = TRUE
  LEFT JOIN departments d_from_alias
    ON d_from_alias.dept_id = da.department_id
  LEFT JOIN departments d
    ON upper(regexp_replace(d.abbreviation, '[^A-Za-z0-9]+', '_', 'g')) = n.raw_label_norm
  LEFT JOIN eos_reporting_category_map rcm
    ON rcm.raw_label_norm = n.raw_label_norm
   AND rcm.is_active = TRUE
)
SELECT
  branch_code,
  business_month,
  category_type,
  category_key,
  department_id,

  SUM(CASE WHEN category_type <> 'tax' AND cost_nature = 'running' AND payment_channel = 'non_cash' THEN ex_vat_amount ELSE 0 END)::numeric(14,2) AS running_non_cash_ex_vat,
  SUM(CASE WHEN category_type <> 'tax' AND cost_nature = 'running' AND payment_channel = 'non_cash' THEN vat_amount ELSE 0 END)::numeric(14,2) AS running_non_cash_vat,
  SUM(CASE WHEN category_type <> 'tax' AND cost_nature = 'running' AND payment_channel = 'cash' AND receipt_state = 'with_receipt' THEN ex_vat_amount ELSE 0 END)::numeric(14,2) AS running_cash_ex_vat,
  SUM(CASE WHEN category_type <> 'tax' AND cost_nature = 'running' AND payment_channel = 'cash' AND receipt_state = 'with_receipt' THEN vat_amount ELSE 0 END)::numeric(14,2) AS running_cash_vat,
  SUM(CASE WHEN category_type <> 'tax' AND cost_nature = 'running' THEN total_amount ELSE 0 END)::numeric(14,2) AS running_total,
  SUM(CASE WHEN category_type <> 'tax' AND cost_nature = 'running' AND receipt_state = 'no_receipt' THEN total_amount ELSE 0 END)::numeric(14,2) AS running_no_receipt_total,

  SUM(CASE WHEN category_type <> 'tax' AND cost_nature = 'capital' AND payment_channel = 'non_cash' THEN ex_vat_amount ELSE 0 END)::numeric(14,2) AS capital_non_cash_ex_vat,
  SUM(CASE WHEN category_type <> 'tax' AND cost_nature = 'capital' AND payment_channel = 'non_cash' THEN vat_amount ELSE 0 END)::numeric(14,2) AS capital_non_cash_vat,
  SUM(CASE WHEN category_type <> 'tax' AND cost_nature = 'capital' AND payment_channel = 'cash' AND receipt_state = 'with_receipt' THEN ex_vat_amount ELSE 0 END)::numeric(14,2) AS capital_cash_ex_vat,
  SUM(CASE WHEN category_type <> 'tax' AND cost_nature = 'capital' AND payment_channel = 'cash' AND receipt_state = 'with_receipt' THEN vat_amount ELSE 0 END)::numeric(14,2) AS capital_cash_vat,
  SUM(CASE WHEN category_type <> 'tax' AND cost_nature = 'capital' THEN total_amount ELSE 0 END)::numeric(14,2) AS capital_total,
  SUM(CASE WHEN category_type <> 'tax' AND cost_nature = 'capital' AND receipt_state = 'no_receipt' THEN total_amount ELSE 0 END)::numeric(14,2) AS capital_no_receipt_total,

  SUM(CASE WHEN category_type = 'tax' AND category_key = 'ECOTAX_REMITTANCE' THEN total_amount ELSE 0 END)::numeric(14,2) AS tax_remittance_ecotax,
  SUM(CASE WHEN category_type = 'tax' AND category_key = 'VAT_REMITTANCE' THEN total_amount ELSE 0 END)::numeric(14,2) AS tax_remittance_vat,

  COUNT(*)::int AS source_row_count,
  'v2'::text AS calc_version
FROM resolved
GROUP BY
  branch_code,
  business_month,
  category_type,
  category_key,
  department_id;

-- ------------------------------------------------------------
-- 2) Monthly view with display metadata
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_eos_pay_summary_monthly AS
SELECT
  b.branch_code,
  b.business_month,
  b.category_type,
  b.category_key,
  b.department_id,

  b.running_non_cash_ex_vat,
  b.running_non_cash_vat,
  b.running_cash_ex_vat,
  b.running_cash_vat,
  b.running_total,
  b.running_no_receipt_total,

  b.capital_non_cash_ex_vat,
  b.capital_non_cash_vat,
  b.capital_cash_ex_vat,
  b.capital_cash_vat,
  b.capital_total,
  b.capital_no_receipt_total,

  b.tax_remittance_ecotax,
  b.tax_remittance_vat,

  (b.running_total + b.capital_total)::numeric(14,2) AS grand_total,
  (b.running_no_receipt_total + b.capital_no_receipt_total)::numeric(14,2) AS total_no_receipt,
  (b.running_non_cash_ex_vat + b.running_cash_ex_vat + b.capital_non_cash_ex_vat + b.capital_cash_ex_vat)::numeric(14,2) AS total_ex_vat,
  (b.running_non_cash_vat + b.running_cash_vat + b.capital_non_cash_vat + b.capital_cash_vat)::numeric(14,2) AS total_vat,

  -- Display priority:
  -- 1) eos_reporting_category_map.category_display_name
  -- 2) canonical department display name
  -- 3) category_key fallback
  COALESCE(rcm.category_display_name, d.name, b.category_key) AS category_display_name,

  (b.category_type = 'department' AND b.department_id IS NOT NULL) AS is_department_row,

  'PENDING'::text AS reconciliation_status,
  b.source_row_count,
  b.calc_version
FROM v_eos_pay_summary_branch b
LEFT JOIN departments d
  ON d.dept_id = b.department_id
LEFT JOIN eos_reporting_category_map rcm
  ON rcm.category_key = b.category_key
 AND rcm.is_active = TRUE;

-- ------------------------------------------------------------
-- 3) All-branches consolidated summary
-- ------------------------------------------------------------
CREATE OR REPLACE VIEW v_eos_summary_all_branches AS
SELECT
  m.business_month,
  m.category_type,
  m.category_key,
  m.department_id,
  m.category_display_name,
  m.is_department_row,

  SUM(CASE WHEN m.branch_code = 'EOSZ' THEN m.grand_total ELSE 0 END)::numeric(14,2) AS eosz_grand_total,
  SUM(CASE WHEN m.branch_code = 'EOSQ' THEN m.grand_total ELSE 0 END)::numeric(14,2) AS eosq_grand_total,
  SUM(CASE WHEN m.branch_code = 'EOSBLUM' THEN m.grand_total ELSE 0 END)::numeric(14,2) AS eosblum_grand_total,

  SUM(m.grand_total)::numeric(14,2) AS all_branches_grand_total,
  SUM(m.running_total)::numeric(14,2) AS all_branches_running_total,
  SUM(m.capital_total)::numeric(14,2) AS all_branches_capital_total,
  SUM(m.tax_remittance_ecotax)::numeric(14,2) AS all_branches_tax_remittance_ecotax,
  SUM(m.tax_remittance_vat)::numeric(14,2) AS all_branches_tax_remittance_vat
FROM v_eos_pay_summary_monthly m
GROUP BY
  m.business_month,
  m.category_type,
  m.category_key,
  m.department_id,
  m.category_display_name,
  m.is_department_row;

COMMIT;
