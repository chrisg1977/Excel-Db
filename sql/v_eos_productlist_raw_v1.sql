-- EOS PRODUCTLIST raw normalization view (v1)
-- Purpose:
--   Provenance-first raw extraction for PRODUCTLIST sheets across branches.
--   Preserve A:O source values as text without silent coercion.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/v_eos_productlist_raw_v1.sql

DROP VIEW IF EXISTS v_eos_productlist_raw_v1;

CREATE VIEW v_eos_productlist_raw_v1 AS
WITH source_union AS (
  SELECT
    'EOSZ'::text AS branch_code,
    'stg.eosz_productlist'::text AS source_table_name,
    t._source_file,
    t._source_sheet,
    t._row_num,
    to_jsonb(t) AS row_json,
    t.col_1::text AS raw_a_date_text,
    t.barcode::text AS raw_b_barcode_text,
    t.product_name::text AS raw_c_product_name_text,
    t.size::text AS raw_d_size_text,
    t.type::text AS raw_e_type_text,
    t.expires::text AS raw_f_expires_text,
    t.supplier::text AS raw_g_supplier_text,
    t.cost_price_excl_vat::text AS raw_h_cost_ex_vat_text,
    t.retail_vat_pct::text AS raw_i_cost_vat_rate_text,
    t.cost_price::text AS raw_j_cost_inc_vat_text,
    t.retail_excl_vat::text AS raw_k_retail_ex_vat_text,
    t.vat_pct::text AS raw_l_retail_vat_pct_text,
    t.vat::text AS raw_m_vat_amount_text,
    t.each_selling::text AS raw_n_unit_selling_text,
    t.destination::text AS raw_o_destination_text
  FROM stg.eosz_productlist t

  UNION ALL

  SELECT
    'EOSQ'::text,
    'stg.eosq_productlist'::text,
    t._source_file,
    t._source_sheet,
    t._row_num,
    to_jsonb(t),
    t.col_1::text,
    t.barcode::text,
    t.product_name::text,
    t.size::text,
    t.type::text,
    t.expires::text,
    t.supplier::text,
    t.cost_price_excl_vat::text,
    t.retail_vat_pct::text,
    t.cost_price::text,
    t.retail_excl_vat::text,
    t.vat_pct::text,
    t.vat::text,
    t.each_selling::text,
    t.destination::text
  FROM stg.eosq_productlist t

  UNION ALL

  SELECT
    'EOSBLUM'::text,
    'stg.eosblum_productlist'::text,
    t._source_file,
    t._source_sheet,
    t._row_num,
    to_jsonb(t),
    t.col_1::text,
    t.barcode::text,
    t.product_name::text,
    t.size::text,
    t.type::text,
    t.expires::text,
    t.supplier::text,
    t.cost_price_excl_vat::text,
    t.retail_vat_pct::text,
    t.cost_price::text,
    t.retail_excl_vat::text,
    t.vat_pct::text,
    t.vat::text,
    t.each_selling::text,
    t.destination::text
  FROM stg.eosblum_productlist t
), filtered AS (
  SELECT
    s.*,
    md5(
      coalesce(s._source_file, '') || '|' ||
      coalesce(s._source_sheet, '') || '|' ||
      coalesce(s._row_num::text, '') || '|' ||
      coalesce(s.source_table_name, '')
    ) AS raw_line_id
  FROM source_union s
  WHERE
    -- Exclude deterministic all-blank rows only.
    NOT (
      nullif(btrim(coalesce(s.raw_a_date_text, '')), '') IS NULL
      AND nullif(btrim(coalesce(s.raw_b_barcode_text, '')), '') IS NULL
      AND nullif(btrim(coalesce(s.raw_c_product_name_text, '')), '') IS NULL
      AND nullif(btrim(coalesce(s.raw_d_size_text, '')), '') IS NULL
      AND nullif(btrim(coalesce(s.raw_e_type_text, '')), '') IS NULL
      AND nullif(btrim(coalesce(s.raw_f_expires_text, '')), '') IS NULL
      AND nullif(btrim(coalesce(s.raw_g_supplier_text, '')), '') IS NULL
      AND nullif(btrim(coalesce(s.raw_h_cost_ex_vat_text, '')), '') IS NULL
      AND nullif(btrim(coalesce(s.raw_i_cost_vat_rate_text, '')), '') IS NULL
      AND nullif(btrim(coalesce(s.raw_j_cost_inc_vat_text, '')), '') IS NULL
      AND nullif(btrim(coalesce(s.raw_k_retail_ex_vat_text, '')), '') IS NULL
      AND nullif(btrim(coalesce(s.raw_l_retail_vat_pct_text, '')), '') IS NULL
      AND nullif(btrim(coalesce(s.raw_m_vat_amount_text, '')), '') IS NULL
      AND nullif(btrim(coalesce(s.raw_n_unit_selling_text, '')), '') IS NULL
      AND nullif(btrim(coalesce(s.raw_o_destination_text, '')), '') IS NULL
    )
    -- Exclude deterministic header row.
    AND NOT (
      upper(nullif(btrim(coalesce(s.raw_b_barcode_text, '')), '')) = 'BARCODE'
      AND upper(nullif(btrim(coalesce(s.raw_c_product_name_text, '')), '')) = 'PRODUCT NAME'
    )
    -- Exclude deterministic scanner prompt row.
    AND NOT (
      coalesce(lower(s.raw_c_product_name_text), '') LIKE '%scan barcode%'
      AND coalesce(s.raw_b_barcode_text, '') IN ('0', '')
    )
    -- Exclude explicit ECOTAX control row from PRODUCTLIST pipeline.
    AND NOT (
      s._row_num = 3
      AND upper(coalesce(s.raw_c_product_name_text, '')) = 'ECOTAX'
    )
    -- Exclude deprecated product row from PRODUCTLIST pipeline.
    AND NOT (
      s._row_num = 152
      AND upper(coalesce(s.raw_c_product_name_text, '')) = 'FONTANA STILL WATER'
    )
)
SELECT
  branch_code,
  source_table_name,
  _source_file,
  _source_sheet,
  _row_num,
  raw_line_id,

  raw_a_date_text,
  raw_b_barcode_text,
  raw_c_product_name_text,
  raw_d_size_text,
  raw_e_type_text,
  raw_f_expires_text,
  raw_g_supplier_text,
  raw_h_cost_ex_vat_text,
  raw_i_cost_vat_rate_text,
  raw_j_cost_inc_vat_text,
  raw_k_retail_ex_vat_text,
  raw_l_retail_vat_pct_text,
  raw_m_vat_amount_text,
  raw_n_unit_selling_text,
  raw_o_destination_text,
  row_json AS raw_payload_json
FROM filtered;
