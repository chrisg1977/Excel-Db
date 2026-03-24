-- EOS PRODUCTLIST staged -> canonical product loader (v1)
-- Purpose:
--   Promote deterministic PRODUCTLIST candidates into canonical product tables.
--   Adds distributor/secondary barcodes as identity_type='distributor_barcode'.
--
-- Run order:
--   1) sql/eos_product_master_schema_v1.sql
--   2) sql/eos_product_identity_schema_v1.sql
--   3) sql/eos_product_attributes_history_schema_v1.sql
--   4) sql/eos_product_pricing_history_schema_v1.sql
--   5) sql/v_eos_productlist_raw_v1.sql
--   6) sql/v_eos_productlist_candidates_v1.sql
--   7) sql/eos_stg_to_product_master_insert_v1.sql

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.v_eos_productlist_candidates_v1') IS NULL THEN
    RAISE EXCEPTION 'Missing required view: v_eos_productlist_candidates_v1';
  END IF;

  IF to_regclass('public.eos_product_master') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_product_master';
  END IF;

  IF to_regclass('public.eos_product_identity') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_product_identity';
  END IF;

  IF to_regclass('public.eos_product_attributes_history') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_product_attributes_history';
  END IF;

  IF to_regclass('public.eos_product_pricing_history') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_product_pricing_history';
  END IF;
END$$;

WITH candidates AS (
  SELECT
    c.candidate_id,
    c.branch_code,
    c.source_table_name,
    c._source_file,
    c._source_sheet,
    c._row_num,
    c.effective_date_candidate,
    c.product_name_candidate,
    c.size_label_candidate,
    c.product_type_candidate,
    c.expires_flag_candidate,
    c.supplier_label_raw_candidate,
    c.destination_mode_candidate,
    c.barcode_identity_type_candidate,
    c.barcode_norm_candidate,
    c.barcode_candidate,
    c.raw_b_barcode_text,
    c.secondary_barcode_candidate,
    c.secondary_barcode_norm_candidate,
    c.cost_ex_vat_candidate,
    c.cost_vat_rate_pct_candidate,
    c.cost_inc_vat_candidate,
    c.retail_ex_vat_candidate,
    c.retail_vat_rate_pct_candidate,
    c.retail_vat_amount_candidate,
    c.unit_selling_price_candidate,
    c.match_preclassification,
    c.matched_product_ids
  FROM v_eos_productlist_candidates_v1 c
  WHERE c.deterministic_ready = TRUE
), existing_resolved AS (
  SELECT
    c.*,
    CASE
      WHEN c.match_preclassification = 'existing_identity_match'
        AND coalesce(array_length(c.matched_product_ids, 1), 0) = 1
      THEN c.matched_product_ids[1]
      ELSE NULL::bigint
    END AS resolved_existing_product_id
  FROM candidates c
), new_root_keys AS (
  SELECT DISTINCT
    e.barcode_norm_candidate,
    e.barcode_identity_type_candidate,
    upper('PL_' || regexp_replace(e.barcode_norm_candidate, '[^A-Za-z0-9]+', '_', 'g')) AS generated_product_key,
    CASE
      WHEN e.barcode_candidate IS NOT NULL THEN e.barcode_candidate
      ELSE btrim(coalesce(e.raw_b_barcode_text, ''))
    END AS barcode_identity_value
  FROM existing_resolved e
  WHERE e.match_preclassification = 'new_product_root_candidate'
    AND e.barcode_norm_candidate IS NOT NULL
), inserted_roots AS (
  INSERT INTO eos_product_master (
    product_key,
    lifecycle_status,
    is_active,
    source_system,
    source_reference,
    notes
  )
  SELECT
    k.generated_product_key,
    'ACTIVE'::text,
    TRUE,
    'productlist',
    'productlist:auto_root:' || k.barcode_norm_candidate,
    'Auto-created from PRODUCTLIST deterministic candidate'
  FROM new_root_keys k
  WHERE NOT EXISTS (
    SELECT 1
    FROM eos_product_identity i
    WHERE i.effective_to IS NULL
      AND i.identity_type = k.barcode_identity_type_candidate
      AND i.identity_value_norm = k.barcode_norm_candidate
  )
  RETURNING id, product_key
), inserted_root_with_key AS (
  SELECT
    r.id AS product_id,
    r.product_key
  FROM inserted_roots r
), resolved AS (
  SELECT
    e.*,
    coalesce(
      e.resolved_existing_product_id,
      i_active.product_id,
      i_new.product_id
    ) AS resolved_product_id
  FROM existing_resolved e
  LEFT JOIN LATERAL (
    SELECT i.product_id
    FROM eos_product_identity i
    WHERE i.effective_to IS NULL
      AND i.identity_type = e.barcode_identity_type_candidate
      AND i.identity_value_norm = e.barcode_norm_candidate
    LIMIT 1
  ) i_active ON TRUE
  LEFT JOIN new_root_keys nk
    ON nk.barcode_norm_candidate = e.barcode_norm_candidate
   AND nk.barcode_identity_type_candidate = e.barcode_identity_type_candidate
  LEFT JOIN inserted_root_with_key i_new
    ON i_new.product_key = nk.generated_product_key
), ready AS (
  SELECT *
  FROM resolved
  WHERE resolved_product_id IS NOT NULL
), close_active_attributes AS (
  UPDATE eos_product_attributes_history ah
  SET effective_to = (r.effective_date_candidate - INTERVAL '1 day')::date,
      updated_at = now()
  FROM ready r
  WHERE ah.product_id = r.resolved_product_id
    AND ah.effective_to IS NULL
    AND ah.effective_from <> r.effective_date_candidate
  RETURNING ah.product_id
), close_active_pricing AS (
  UPDATE eos_product_pricing_history ph
  SET effective_to = (r.effective_date_candidate - INTERVAL '1 day')::date,
      updated_at = now()
  FROM ready r
  WHERE ph.product_id = r.resolved_product_id
    AND ph.effective_to IS NULL
    AND ph.effective_from <> r.effective_date_candidate
  RETURNING ph.product_id
), insert_primary_identity_new_roots AS (
  INSERT INTO eos_product_identity (
    product_id,
    identity_type,
    identity_value,
    identity_value_norm,
    effective_from,
    effective_to,
    is_primary,
    source_system,
    source_reference,
    notes
  )
  SELECT
    r.resolved_product_id,
    r.barcode_identity_type_candidate,
    CASE
      WHEN r.barcode_candidate IS NOT NULL THEN r.barcode_candidate
      ELSE btrim(coalesce(r.raw_b_barcode_text, ''))
    END AS identity_value,
    r.barcode_norm_candidate,
    r.effective_date_candidate,
    NULL::date,
    TRUE,
    'productlist',
    r.source_table_name || ':' || r._row_num,
    'Primary identity from PRODUCTLIST'
  FROM ready r
  WHERE r.match_preclassification = 'new_product_root_candidate'
    AND r.barcode_norm_candidate IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM eos_product_identity i
      WHERE i.product_id = r.resolved_product_id
        AND i.effective_to IS NULL
        AND i.is_primary = TRUE
    )
  RETURNING id
), insert_secondary_distributor_identity AS (
  INSERT INTO eos_product_identity (
    product_id,
    identity_type,
    identity_value,
    identity_value_norm,
    effective_from,
    effective_to,
    is_primary,
    source_system,
    source_reference,
    notes
  )
  SELECT
    r.resolved_product_id,
    'distributor_barcode'::text,
    r.secondary_barcode_candidate,
    r.secondary_barcode_norm_candidate,
    r.effective_date_candidate,
    NULL::date,
    FALSE,
    'productlist',
    r.source_table_name || ':' || r._row_num,
    'Secondary distributor barcode from PRODUCTLIST'
  FROM ready r
  WHERE r.secondary_barcode_norm_candidate IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM eos_product_identity i
      WHERE i.effective_to IS NULL
        AND i.identity_type = 'distributor_barcode'
        AND i.identity_value_norm = r.secondary_barcode_norm_candidate
    )
  RETURNING id
), upsert_attributes AS (
  INSERT INTO eos_product_attributes_history (
    product_id,
    effective_from,
    effective_to,
    product_name,
    size_label,
    product_type,
    expires_flag,
    destination_mode,
    supplier_label_raw,
    source_system,
    source_reference,
    notes
  )
  SELECT
    r.resolved_product_id,
    r.effective_date_candidate,
    NULL::date,
    r.product_name_candidate,
    r.size_label_candidate,
    r.product_type_candidate,
    r.expires_flag_candidate,
    coalesce(r.destination_mode_candidate, 'unknown'),
    r.supplier_label_raw_candidate,
    'productlist',
    r.source_table_name || ':' || r._row_num,
    NULL::text
  FROM ready r
  ON CONFLICT (product_id, effective_from) DO UPDATE
  SET
    product_name = EXCLUDED.product_name,
    size_label = EXCLUDED.size_label,
    product_type = EXCLUDED.product_type,
    expires_flag = EXCLUDED.expires_flag,
    destination_mode = EXCLUDED.destination_mode,
    supplier_label_raw = EXCLUDED.supplier_label_raw,
    source_reference = EXCLUDED.source_reference,
    updated_at = now()
  RETURNING product_id
), upsert_pricing AS (
  INSERT INTO eos_product_pricing_history (
    product_id,
    effective_from,
    effective_to,
    cost_ex_vat,
    cost_vat_rate_pct,
    cost_inc_vat,
    retail_ex_vat,
    retail_vat_rate_pct,
    retail_vat_amount,
    unit_selling_price,
    currency_code,
    source_system,
    source_reference,
    notes
  )
  SELECT
    r.resolved_product_id,
    r.effective_date_candidate,
    NULL::date,
    r.cost_ex_vat_candidate,
    r.cost_vat_rate_pct_candidate,
    r.cost_inc_vat_candidate,
    r.retail_ex_vat_candidate,
    r.retail_vat_rate_pct_candidate,
    r.retail_vat_amount_candidate,
    r.unit_selling_price_candidate,
    'EUR',
    'productlist',
    r.source_table_name || ':' || r._row_num,
    NULL::text
  FROM ready r
  ON CONFLICT (product_id, effective_from) DO UPDATE
  SET
    cost_ex_vat = EXCLUDED.cost_ex_vat,
    cost_vat_rate_pct = EXCLUDED.cost_vat_rate_pct,
    cost_inc_vat = EXCLUDED.cost_inc_vat,
    retail_ex_vat = EXCLUDED.retail_ex_vat,
    retail_vat_rate_pct = EXCLUDED.retail_vat_rate_pct,
    retail_vat_amount = EXCLUDED.retail_vat_amount,
    unit_selling_price = EXCLUDED.unit_selling_price,
    source_reference = EXCLUDED.source_reference,
    updated_at = now()
  RETURNING product_id
)
SELECT
  (SELECT count(*) FROM candidates) AS deterministic_candidates,
  (SELECT count(*) FROM ready) AS candidates_with_resolved_product,
  (SELECT count(*) FROM inserted_roots) AS inserted_product_roots,
  (SELECT count(*) FROM insert_primary_identity_new_roots) AS inserted_primary_identities,
  (SELECT count(*) FROM insert_secondary_distributor_identity) AS inserted_distributor_identities,
  (SELECT count(*) FROM close_active_attributes) AS closed_prior_active_attributes,
  (SELECT count(*) FROM close_active_pricing) AS closed_prior_active_pricing,
  (SELECT count(*) FROM upsert_attributes) AS upserted_attributes_rows,
  (SELECT count(*) FROM upsert_pricing) AS upserted_pricing_rows;

COMMIT;
