-- EOS PRODUCTLIST staged -> product master dry-run loader (v1)
-- Purpose:
--   Reject-first dry-run validation for PRODUCTLIST candidates.
--   No canonical inserts are performed in this phase.
--
-- Run order:
--   1) sql/eos_stg_rejects_schema_v1.sql
--   2) sql/v_eos_productlist_raw_v1.sql
--   3) sql/v_eos_productlist_candidates_v1.sql
--   4) sql/eos_stg_to_product_master_dry_run_v1.sql

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.eos_stg_rejects') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_stg_rejects (run sql/eos_stg_rejects_schema_v1.sql first)';
  END IF;

  IF to_regclass('public.v_eos_productlist_candidates_v1') IS NULL THEN
    RAISE EXCEPTION 'Missing required view: v_eos_productlist_candidates_v1';
  END IF;
END$$;

WITH base AS (
  SELECT
    c.candidate_id,
    c.branch_code,
    c.source_family,
    c.source_table_name,
    c._source_file,
    c._source_sheet,
    c._row_num,
    c.match_preclassification,
    c.active_identity_match_count,
    c.matched_product_ids,
    c.deterministic_ready,
    c.reject_reasons,

    c.effective_date_candidate,
    c.barcode_candidate,
    c.product_name_candidate,
    c.size_label_candidate,
    c.product_type_candidate,
    c.expires_flag_candidate,
    c.supplier_label_raw_candidate,
    c.destination_mode_candidate,

    c.cost_ex_vat_candidate,
    c.cost_vat_rate_pct_candidate,
    c.cost_inc_vat_candidate,
    c.retail_ex_vat_candidate,
    c.retail_vat_rate_pct_candidate,
    c.retail_vat_amount_candidate,
    c.unit_selling_price_candidate,

    c.effective_date_parse_status,
    c.barcode_parse_status,
    c.expires_parse_status,
    c.destination_parse_status,
    c.cost_ex_vat_parse_status,
    c.cost_vat_rate_parse_status,
    c.cost_inc_vat_parse_status,
    c.retail_ex_vat_parse_status,
    c.retail_vat_rate_parse_status,
    c.retail_vat_amount_parse_status,
    c.unit_selling_parse_status,

    c.raw_a_date_text,
    c.raw_b_barcode_text,
    c.raw_c_product_name_text,
    c.raw_d_size_text,
    c.raw_e_type_text,
    c.raw_f_expires_text,
    c.raw_g_supplier_text,
    c.raw_h_cost_ex_vat_text,
    c.raw_i_cost_vat_rate_text,
    c.raw_j_cost_inc_vat_text,
    c.raw_k_retail_ex_vat_text,
    c.raw_l_retail_vat_pct_text,
    c.raw_m_vat_amount_text,
    c.raw_n_unit_selling_text,
    c.raw_o_destination_text,
    c.raw_payload_json
  FROM v_eos_productlist_candidates_v1 c
), rejected AS (
  INSERT INTO eos_stg_rejects (
    loader_name,
    candidate_id,
    branch_code,
    source_table_name,
    source_family,
    source_file,
    source_sheet,
    source_row_num,
    classification_status,
    unresolved_reason,
    reject_reasons,
    reject_context,
    updated_at
  )
  SELECT
    'eos_stg_to_product_master_dry_run_v1' AS loader_name,
    b.candidate_id,
    b.branch_code,
    b.source_table_name,
    b.source_family,
    b._source_file,
    b._source_sheet,
    b._row_num,
    'STRICT_PRODUCTLIST_DRY_RUN' AS classification_status,
    CASE WHEN cardinality(b.reject_reasons) > 0 THEN b.reject_reasons[1] ELSE NULL END AS unresolved_reason,
    b.reject_reasons,
    jsonb_build_object(
      'match_preclassification', b.match_preclassification,
      'active_identity_match_count', b.active_identity_match_count,
      'matched_product_ids', b.matched_product_ids,
      'deterministic_ready', b.deterministic_ready,
      'effective_date_candidate', b.effective_date_candidate,
      'barcode_candidate', b.barcode_candidate,
      'product_name_candidate', b.product_name_candidate,
      'size_label_candidate', b.size_label_candidate,
      'product_type_candidate', b.product_type_candidate,
      'expires_flag_candidate', b.expires_flag_candidate,
      'supplier_label_raw_candidate', b.supplier_label_raw_candidate,
      'destination_mode_candidate', b.destination_mode_candidate,
      'cost_ex_vat_candidate', b.cost_ex_vat_candidate,
      'cost_vat_rate_pct_candidate', b.cost_vat_rate_pct_candidate,
      'cost_inc_vat_candidate', b.cost_inc_vat_candidate,
      'retail_ex_vat_candidate', b.retail_ex_vat_candidate,
      'retail_vat_rate_pct_candidate', b.retail_vat_rate_pct_candidate,
      'retail_vat_amount_candidate', b.retail_vat_amount_candidate,
      'unit_selling_price_candidate', b.unit_selling_price_candidate,
      'effective_date_parse_status', b.effective_date_parse_status,
      'barcode_parse_status', b.barcode_parse_status,
      'expires_parse_status', b.expires_parse_status,
      'destination_parse_status', b.destination_parse_status,
      'cost_ex_vat_parse_status', b.cost_ex_vat_parse_status,
      'cost_vat_rate_parse_status', b.cost_vat_rate_parse_status,
      'cost_inc_vat_parse_status', b.cost_inc_vat_parse_status,
      'retail_ex_vat_parse_status', b.retail_ex_vat_parse_status,
      'retail_vat_rate_parse_status', b.retail_vat_rate_parse_status,
      'retail_vat_amount_parse_status', b.retail_vat_amount_parse_status,
      'unit_selling_parse_status', b.unit_selling_parse_status,
      'raw_a_date_text', b.raw_a_date_text,
      'raw_b_barcode_text', b.raw_b_barcode_text,
      'raw_c_product_name_text', b.raw_c_product_name_text,
      'raw_d_size_text', b.raw_d_size_text,
      'raw_e_type_text', b.raw_e_type_text,
      'raw_f_expires_text', b.raw_f_expires_text,
      'raw_g_supplier_text', b.raw_g_supplier_text,
      'raw_h_cost_ex_vat_text', b.raw_h_cost_ex_vat_text,
      'raw_i_cost_vat_rate_text', b.raw_i_cost_vat_rate_text,
      'raw_j_cost_inc_vat_text', b.raw_j_cost_inc_vat_text,
      'raw_k_retail_ex_vat_text', b.raw_k_retail_ex_vat_text,
      'raw_l_retail_vat_pct_text', b.raw_l_retail_vat_pct_text,
      'raw_m_vat_amount_text', b.raw_m_vat_amount_text,
      'raw_n_unit_selling_text', b.raw_n_unit_selling_text,
      'raw_o_destination_text', b.raw_o_destination_text,
      'rule', 'strict_productlist_dry_run_v1'
    ) AS reject_context,
    now()
  FROM base b
  WHERE cardinality(b.reject_reasons) > 0
  ON CONFLICT (loader_name, candidate_id) DO UPDATE
  SET
    branch_code = EXCLUDED.branch_code,
    source_table_name = EXCLUDED.source_table_name,
    source_family = EXCLUDED.source_family,
    source_file = EXCLUDED.source_file,
    source_sheet = EXCLUDED.source_sheet,
    source_row_num = EXCLUDED.source_row_num,
    classification_status = EXCLUDED.classification_status,
    unresolved_reason = EXCLUDED.unresolved_reason,
    reject_reasons = EXCLUDED.reject_reasons,
    reject_context = EXCLUDED.reject_context,
    updated_at = now()
  RETURNING 1
), cleared_rejects AS (
  DELETE FROM eos_stg_rejects r
  USING base b
  WHERE r.loader_name = 'eos_stg_to_product_master_dry_run_v1'
    AND r.candidate_id = b.candidate_id
    AND cardinality(b.reject_reasons) = 0
  RETURNING 1
), stale_rejects_pruned_not_in_candidates AS (
  DELETE FROM eos_stg_rejects r
  WHERE r.loader_name = 'eos_stg_to_product_master_dry_run_v1'
    AND NOT EXISTS (
      SELECT 1
      FROM base b
      WHERE b.candidate_id = r.candidate_id
    )
  RETURNING 1
)
SELECT
  (SELECT count(*) FROM base) AS total_candidates,
  (SELECT count(*) FROM base WHERE deterministic_ready) AS deterministic_ready_rows,
  (SELECT count(*) FROM base WHERE NOT deterministic_ready) AS unresolved_rows,
  (SELECT count(*) FROM rejected) AS rejected_upserted,
  (SELECT count(*) FROM cleared_rejects) AS stale_rejects_cleared,
  (SELECT count(*) FROM stale_rejects_pruned_not_in_candidates) AS stale_rejects_pruned_not_in_candidates;

COMMIT;
