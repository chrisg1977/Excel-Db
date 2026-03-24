-- EOS PAY SUMMARY validation queries (v2)
-- Purpose:
--   Quick validation checks for mapping, tax rules, branch codes, and summary consistency.
--
-- Usage:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_pay_summary_validation_queries_v2.sql
--
-- Notes:
--   - Some queries depend on views created later in sequence (v_eos_pay_summary_*).
--   - Keep this file idempotent/read-only; no schema changes.

-- ============================================================
-- 1) Mapping table sanity
-- ============================================================

SELECT
  'map_total_rows' AS check_name,
  COUNT(*)::bigint AS value
FROM eos_reporting_category_map;

SELECT
  'map_active_rows' AS check_name,
  COUNT(*)::bigint AS value
FROM eos_reporting_category_map
WHERE is_active = TRUE;

SELECT
  raw_label_norm,
  category_key,
  category_type,
  department_id,
  is_active
FROM eos_reporting_category_map
ORDER BY raw_label_norm;

-- Tax-row protection (mapping table)
SELECT
  id,
  raw_label_norm,
  category_key,
  category_type,
  department_id
FROM eos_reporting_category_map
WHERE (category_type = 'tax' AND (department_id IS NOT NULL OR category_key NOT IN ('ECOTAX_REMITTANCE', 'VAT_REMITTANCE')))
   OR (category_type <> 'tax' AND category_key IN ('ECOTAX_REMITTANCE', 'VAT_REMITTANCE'));

-- ============================================================
-- 2) Snapshot table sanity
-- ============================================================

SELECT
  'snapshot_total_rows' AS check_name,
  COUNT(*)::bigint AS value
FROM eos_pay_summary_monthly_snapshot;

SELECT
  branch_code,
  COUNT(*)::bigint AS rows_per_branch
FROM eos_pay_summary_monthly_snapshot
GROUP BY branch_code
ORDER BY branch_code;

-- Invalid branch code rows (should be none)
SELECT *
FROM eos_pay_summary_monthly_snapshot
WHERE branch_code NOT IN ('EOSZ', 'EOSQ', 'EOSBLUM');

-- Tax-row protection (snapshot)
SELECT *
FROM eos_pay_summary_monthly_snapshot
WHERE (category_type = 'tax' AND (department_id IS NOT NULL OR category_key NOT IN ('ECOTAX_REMITTANCE', 'VAT_REMITTANCE')))
   OR (category_type <> 'tax' AND category_key IN ('ECOTAX_REMITTANCE', 'VAT_REMITTANCE'));

-- Optional quick duplicate key probe (should return zero rows under unique index)
SELECT
  business_month,
  branch_code,
  category_type,
  category_key,
  calc_version,
  COALESCE(department_id, -1) AS department_id_norm,
  COUNT(*) AS dup_count
FROM eos_pay_summary_monthly_snapshot
GROUP BY business_month, branch_code, category_type, category_key, calc_version, COALESCE(department_id, -1)
HAVING COUNT(*) > 1;

-- ============================================================
-- 3) Reconciliation table sanity
-- ============================================================

SELECT
  'recon_total_rows' AS check_name,
  COUNT(*)::bigint AS value
FROM eos_pay_summary_reconciliation;

SELECT
  status,
  COUNT(*)::bigint AS rows_per_status
FROM eos_pay_summary_reconciliation
GROUP BY status
ORDER BY status;

-- Invalid branch code rows (should be none)
SELECT *
FROM eos_pay_summary_reconciliation
WHERE branch_code NOT IN ('EOSZ', 'EOSQ', 'EOSBLUM');

-- Tax-row protection (reconciliation)
SELECT *
FROM eos_pay_summary_reconciliation
WHERE (category_type = 'tax' AND (department_id IS NOT NULL OR category_key NOT IN ('ECOTAX_REMITTANCE', 'VAT_REMITTANCE')))
   OR (category_type <> 'tax' AND category_key IN ('ECOTAX_REMITTANCE', 'VAT_REMITTANCE'));

-- Variance consistency check
SELECT *
FROM eos_pay_summary_reconciliation
WHERE variance_abs <> ABS(variance);

-- ============================================================
-- 4) View-level checks (run after v_eos_pay_summary_* views are created)
-- ============================================================

-- Branch view rowcount + branch distribution
SELECT
  'branch_view_rows' AS check_name,
  COUNT(*)::bigint AS value
FROM v_eos_pay_summary_branch;

SELECT
  branch_code,
  COUNT(*)::bigint AS rows_per_branch
FROM v_eos_pay_summary_branch
GROUP BY branch_code
ORDER BY branch_code;

-- Tax-row rules in branch view (should be none)
SELECT *
FROM v_eos_pay_summary_branch
WHERE (category_type = 'tax' AND (department_id IS NOT NULL OR category_key NOT IN ('ECOTAX_REMITTANCE', 'VAT_REMITTANCE')))
   OR (category_type <> 'tax' AND category_key IN ('ECOTAX_REMITTANCE', 'VAT_REMITTANCE'));

-- Monthly view core totals sanity
SELECT
  branch_code,
  business_month,
  category_key,
  running_total,
  capital_total,
  grand_total,
  (running_total + capital_total) AS recomputed_grand_total,
  (grand_total - (running_total + capital_total)) AS grand_total_diff
FROM v_eos_pay_summary_monthly
WHERE grand_total <> (running_total + capital_total)
ORDER BY business_month, branch_code, category_key;

-- Monthly view display field sanity
SELECT *
FROM v_eos_pay_summary_monthly
WHERE category_display_name IS NULL OR TRIM(category_display_name) = '';

-- All-branches view branch split sanity (grand total)
SELECT
  business_month,
  category_key,
  all_branches_grand_total,
  (eosz_grand_total + eosq_grand_total + eosblum_grand_total) AS recomputed_all_branches_grand_total,
  (all_branches_grand_total - (eosz_grand_total + eosq_grand_total + eosblum_grand_total)) AS diff
FROM v_eos_summary_all_branches
WHERE all_branches_grand_total <> (eosz_grand_total + eosq_grand_total + eosblum_grand_total)
ORDER BY business_month, category_key;

-- ============================================================
-- 5) Coverage checks for non-department categories (build-now focus)
-- ============================================================

-- Ensure required build-now buckets exist in mapping table
SELECT required_key
FROM (
  VALUES
    ('ADMIN'),
    ('MHB'),
    ('MHB_CLINICS'),
    ('SELL_OTHER_MHB'),
    ('ECOTAX_REMITTANCE'),
    ('VAT_REMITTANCE')
) AS required(required_key)
LEFT JOIN eos_reporting_category_map m
  ON m.category_key = required.required_key
 AND m.is_active = TRUE
WHERE m.id IS NULL;

-- Placeholder check for unresolved fallback categories in branch view.
-- Convention here assumes unresolved rows may appear as regex-normalized category_key with no department_id.
-- Adjust this query once final fallback tagging strategy is locked.
SELECT
  branch_code,
  business_month,
  category_key,
  category_type,
  department_id,
  source_row_count
FROM v_eos_pay_summary_branch
WHERE category_type = 'reporting_bucket'
  AND department_id IS NULL
ORDER BY business_month DESC, branch_code, category_key;
