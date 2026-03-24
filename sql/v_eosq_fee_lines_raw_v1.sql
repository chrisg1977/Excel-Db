-- EOSZ FEE monthly raw-source normalization view (v1)
-- Purpose:
--   Read-only, provenance-first normalization over EOSZ monthly *FEE sheets.
--   This view keeps raw staged fields visible and adds only safe parsing helpers.
--
-- Scope:
--   Includes stg.eosq_janfee .. stg.eosq_decfee.
--   Excludes ENTRY, SELL, and PAY SUMMARY families.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/v_eosq_fee_lines_raw_v1.sql

CREATE OR REPLACE VIEW v_eosq_fee_lines_raw_v1 AS
WITH fee_union AS (
  SELECT
    'stg.eosq_janfee'::text AS source_table_name,
    _source_file,
    _source_sheet,
    _row_num,
    if_h24_0_0_index_vatentry_match_janfee_g24_ratesentry_0_2 AS raw_col_4,
    if_k24_no_0_if_i24_0_0_h24_100pct_i24_i24 AS raw_col_5,
    h24_j24 AS raw_col_6,
    mdcz AS raw_col_7,
    sumifs_m_m_c_c_p24_l_l_q_22 AS raw_col_8,
    sumifs_j_j_c_c_p24_l_l_q_22 AS raw_col_9,
    sumifs_m_m_c_c_p24_l_l_s_22 AS raw_col_10,
    sumifs_j_j_c_c_p24_l_l_s_22 AS raw_col_11,
    sumifs_m_m_c_c_p24_l_l_u_22 AS raw_col_12,
    sumifs_j_j_c_c_p24_l_l_u_22 AS raw_col_13,
    sumifs_m_m_c_c_p24_l_l_w_22 AS raw_col_14,
    sumifs_j_j_c_c_p24_l_l_w_22 AS raw_col_15,
    sumifs_m_m_c_c_p24_l_l_y_22 AS raw_col_16,
    sumifs_j_j_c_c_p24_l_l_y_22 AS raw_col_17,
    sumifs_m_m_c_c_p24_l_l_aa_22 AS raw_col_18,
    sumifs_j_j_c_c_p24_l_l_aa_22 AS raw_col_19,
    sumifs_m_m_c_c_p24_l_l_ac_22_k_k_yes AS raw_col_20,
    sumifs_j_j_c_c_p24_l_l_ac_22_k_k_yes AS raw_col_21,
    sumifs_h_h_c_c_p24_l_l_ae_22_k_k_yes AS raw_col_22,
    sumifs_h_h_c_c_p24_l_l_af_22 AS raw_col_23
  FROM stg.eosq_janfee

  UNION ALL

  SELECT
    'stg.eosq_febfee'::text,
    _source_file,
    _source_sheet,
    _row_num,
    if_h24_0_0_index_vatentry_match_febfee_g24_ratesentry_0_2,
    if_k24_no_0_if_i24_0_0_h24_100pct_i24_i24,
    h24_j24,
    mdcz,
    sumifs_m_m_c_c_p24_l_l_q_22,
    sumifs_j_j_c_c_p24_l_l_q_22,
    sumifs_m_m_c_c_p24_l_l_s_22,
    sumifs_j_j_c_c_p24_l_l_s_22,
    sumifs_m_m_c_c_p24_l_l_u_22,
    sumifs_j_j_c_c_p24_l_l_u_22,
    sumifs_m_m_c_c_p24_l_l_w_22,
    sumifs_j_j_c_c_p24_l_l_w_22,
    sumifs_m_m_c_c_p24_l_l_y_22,
    sumifs_j_j_c_c_p24_l_l_y_22,
    sumifs_m_m_c_c_p24_l_l_aa_22,
    sumifs_j_j_c_c_p24_l_l_aa_22,
    sumifs_m_m_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_j_j_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_ae_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_af_22
  FROM stg.eosq_febfee

  UNION ALL

  SELECT
    'stg.eosq_marfee'::text,
    _source_file,
    _source_sheet,
    _row_num,
    if_h24_0_0_index_vatentry_match_marfee_g24_ratesentry_0_2,
    if_k24_no_0_if_i24_0_0_h24_100pct_i24_i24,
    h24_j24,
    mdcz,
    sumifs_m_m_c_c_p24_l_l_q_22,
    sumifs_j_j_c_c_p24_l_l_q_22,
    sumifs_m_m_c_c_p24_l_l_s_22,
    sumifs_j_j_c_c_p24_l_l_s_22,
    sumifs_m_m_c_c_p24_l_l_u_22,
    sumifs_j_j_c_c_p24_l_l_u_22,
    sumifs_m_m_c_c_p24_l_l_w_22,
    sumifs_j_j_c_c_p24_l_l_w_22,
    sumifs_m_m_c_c_p24_l_l_y_22,
    sumifs_j_j_c_c_p24_l_l_y_22,
    sumifs_m_m_c_c_p24_l_l_aa_22,
    sumifs_j_j_c_c_p24_l_l_aa_22,
    sumifs_m_m_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_j_j_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_ae_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_af_22
  FROM stg.eosq_marfee

  UNION ALL

  SELECT
    'stg.eosq_aprfee'::text,
    _source_file,
    _source_sheet,
    _row_num,
    if_h24_0_0_index_vatentry_match_aprfee_g24_ratesentry_0_2,
    if_k24_no_0_if_i24_0_0_h24_100pct_i24_i24,
    h24_j24,
    mdcz,
    sumifs_m_m_c_c_p24_l_l_q_22,
    sumifs_j_j_c_c_p24_l_l_q_22,
    sumifs_m_m_c_c_p24_l_l_s_22,
    sumifs_j_j_c_c_p24_l_l_s_22,
    sumifs_m_m_c_c_p24_l_l_u_22,
    sumifs_j_j_c_c_p24_l_l_u_22,
    sumifs_m_m_c_c_p24_l_l_w_22,
    sumifs_j_j_c_c_p24_l_l_w_22,
    sumifs_m_m_c_c_p24_l_l_y_22,
    sumifs_j_j_c_c_p24_l_l_y_22,
    sumifs_m_m_c_c_p24_l_l_aa_22,
    sumifs_j_j_c_c_p24_l_l_aa_22,
    sumifs_m_m_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_j_j_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_ae_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_af_22
  FROM stg.eosq_aprfee

  UNION ALL

  SELECT
    'stg.eosq_mayfee'::text,
    _source_file,
    _source_sheet,
    _row_num,
    if_h24_0_0_index_vatentry_match_mayfee_g24_ratesentry_0_2,
    if_k24_no_0_if_i24_0_0_h24_100pct_i24_i24,
    h24_j24,
    mdcz,
    sumifs_m_m_c_c_p24_l_l_q_22,
    sumifs_j_j_c_c_p24_l_l_q_22,
    sumifs_m_m_c_c_p24_l_l_s_22,
    sumifs_j_j_c_c_p24_l_l_s_22,
    sumifs_m_m_c_c_p24_l_l_u_22,
    sumifs_j_j_c_c_p24_l_l_u_22,
    sumifs_m_m_c_c_p24_l_l_w_22,
    sumifs_j_j_c_c_p24_l_l_w_22,
    sumifs_m_m_c_c_p24_l_l_y_22,
    sumifs_j_j_c_c_p24_l_l_y_22,
    sumifs_m_m_c_c_p24_l_l_aa_22,
    sumifs_j_j_c_c_p24_l_l_aa_22,
    sumifs_m_m_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_j_j_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_ae_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_af_22
  FROM stg.eosq_mayfee

  UNION ALL

  SELECT
    'stg.eosq_junfee'::text,
    _source_file,
    _source_sheet,
    _row_num,
    if_h24_0_0_index_vatentry_match_junfee_g24_ratesentry_0_2,
    if_k24_no_0_if_i24_0_0_h24_100pct_i24_i24,
    h24_j24,
    mdcz,
    sumifs_m_m_c_c_p24_l_l_q_22,
    sumifs_j_j_c_c_p24_l_l_q_22,
    sumifs_m_m_c_c_p24_l_l_s_22,
    sumifs_j_j_c_c_p24_l_l_s_22,
    sumifs_m_m_c_c_p24_l_l_u_22,
    sumifs_j_j_c_c_p24_l_l_u_22,
    sumifs_m_m_c_c_p24_l_l_w_22,
    sumifs_j_j_c_c_p24_l_l_w_22,
    sumifs_m_m_c_c_p24_l_l_y_22,
    sumifs_j_j_c_c_p24_l_l_y_22,
    sumifs_m_m_c_c_p24_l_l_aa_22,
    sumifs_j_j_c_c_p24_l_l_aa_22,
    sumifs_m_m_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_j_j_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_ae_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_af_22
  FROM stg.eosq_junfee

  UNION ALL

  SELECT
    'stg.eosq_julfee'::text,
    _source_file,
    _source_sheet,
    _row_num,
    if_h24_0_0_index_vatentry_match_julfee_g24_ratesentry_0_2,
    if_k24_no_0_if_i24_0_0_h24_100pct_i24_i24,
    h24_j24,
    mdcz,
    sumifs_m_m_c_c_p24_l_l_q_22,
    sumifs_j_j_c_c_p24_l_l_q_22,
    sumifs_m_m_c_c_p24_l_l_s_22,
    sumifs_j_j_c_c_p24_l_l_s_22,
    sumifs_m_m_c_c_p24_l_l_u_22,
    sumifs_j_j_c_c_p24_l_l_u_22,
    sumifs_m_m_c_c_p24_l_l_w_22,
    sumifs_j_j_c_c_p24_l_l_w_22,
    sumifs_m_m_c_c_p24_l_l_y_22,
    sumifs_j_j_c_c_p24_l_l_y_22,
    sumifs_m_m_c_c_p24_l_l_aa_22,
    sumifs_j_j_c_c_p24_l_l_aa_22,
    sumifs_m_m_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_j_j_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_ae_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_af_22
  FROM stg.eosq_julfee

  UNION ALL

  SELECT
    'stg.eosq_augfee'::text,
    _source_file,
    _source_sheet,
    _row_num,
    if_h24_0_0_index_vatentry_match_augfee_g24_ratesentry_0_2,
    if_k24_no_0_if_i24_0_0_h24_100pct_i24_i24,
    h24_j24,
    mdcz,
    sumifs_m_m_c_c_p24_l_l_q_22,
    sumifs_j_j_c_c_p24_l_l_q_22,
    sumifs_m_m_c_c_p24_l_l_s_22,
    sumifs_j_j_c_c_p24_l_l_s_22,
    sumifs_m_m_c_c_p24_l_l_u_22,
    sumifs_j_j_c_c_p24_l_l_u_22,
    sumifs_m_m_c_c_p24_l_l_w_22,
    sumifs_j_j_c_c_p24_l_l_w_22,
    sumifs_m_m_c_c_p24_l_l_y_22,
    sumifs_j_j_c_c_p24_l_l_y_22,
    sumifs_m_m_c_c_p24_l_l_aa_22,
    sumifs_j_j_c_c_p24_l_l_aa_22,
    sumifs_m_m_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_j_j_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_ae_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_af_22
  FROM stg.eosq_augfee

  UNION ALL

  SELECT
    'stg.eosq_sepfee'::text,
    _source_file,
    _source_sheet,
    _row_num,
    if_h24_0_0_index_vatentry_match_sepfee_g24_ratesentry_0_2,
    if_k24_no_0_if_i24_0_0_h24_100pct_i24_i24,
    h24_j24,
    mdcz,
    sumifs_m_m_c_c_p24_l_l_q_22,
    sumifs_j_j_c_c_p24_l_l_q_22,
    sumifs_m_m_c_c_p24_l_l_s_22,
    sumifs_j_j_c_c_p24_l_l_s_22,
    sumifs_m_m_c_c_p24_l_l_u_22,
    sumifs_j_j_c_c_p24_l_l_u_22,
    sumifs_m_m_c_c_p24_l_l_w_22,
    sumifs_j_j_c_c_p24_l_l_w_22,
    sumifs_m_m_c_c_p24_l_l_y_22,
    sumifs_j_j_c_c_p24_l_l_y_22,
    sumifs_m_m_c_c_p24_l_l_aa_22,
    sumifs_j_j_c_c_p24_l_l_aa_22,
    sumifs_m_m_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_j_j_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_ae_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_af_22
  FROM stg.eosq_sepfee

  UNION ALL

  SELECT
    'stg.eosq_octfee'::text,
    _source_file,
    _source_sheet,
    _row_num,
    if_h24_0_0_index_vatentry_match_octfee_g24_ratesentry_0_2,
    if_k24_no_0_if_i24_0_0_h24_100pct_i24_i24,
    h24_j24,
    mdcz,
    sumifs_m_m_c_c_p24_l_l_q_22,
    sumifs_j_j_c_c_p24_l_l_q_22,
    sumifs_m_m_c_c_p24_l_l_s_22,
    sumifs_j_j_c_c_p24_l_l_s_22,
    sumifs_m_m_c_c_p24_l_l_u_22,
    sumifs_j_j_c_c_p24_l_l_u_22,
    sumifs_m_m_c_c_p24_l_l_w_22,
    sumifs_j_j_c_c_p24_l_l_w_22,
    sumifs_m_m_c_c_p24_l_l_y_22,
    sumifs_j_j_c_c_p24_l_l_y_22,
    sumifs_m_m_c_c_p24_l_l_aa_22,
    sumifs_j_j_c_c_p24_l_l_aa_22,
    sumifs_m_m_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_j_j_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_ae_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_af_22
  FROM stg.eosq_octfee

  UNION ALL

  SELECT
    'stg.eosq_novfee'::text,
    _source_file,
    _source_sheet,
    _row_num,
    if_h24_0_0_index_vatentry_match_novfee_g24_ratesentry_0_2,
    if_k24_no_0_if_i24_0_0_h24_100pct_i24_i24,
    h24_j24,
    mdcz,
    sumifs_m_m_c_c_p24_l_l_q_22,
    sumifs_j_j_c_c_p24_l_l_q_22,
    sumifs_m_m_c_c_p24_l_l_s_22,
    sumifs_j_j_c_c_p24_l_l_s_22,
    sumifs_m_m_c_c_p24_l_l_u_22,
    sumifs_j_j_c_c_p24_l_l_u_22,
    sumifs_m_m_c_c_p24_l_l_w_22,
    sumifs_j_j_c_c_p24_l_l_w_22,
    sumifs_m_m_c_c_p24_l_l_y_22,
    sumifs_j_j_c_c_p24_l_l_y_22,
    sumifs_m_m_c_c_p24_l_l_aa_22,
    sumifs_j_j_c_c_p24_l_l_aa_22,
    sumifs_m_m_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_j_j_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_ae_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_af_22
  FROM stg.eosq_novfee

  UNION ALL

  SELECT
    'stg.eosq_decfee'::text,
    _source_file,
    _source_sheet,
    _row_num,
    if_h24_0_0_index_vatentry_match_decfee_g24_ratesentry_0_2,
    if_k24_no_0_if_i24_0_0_h24_100pct_i24_i24,
    h24_j24,
    mdcz,
    sumifs_m_m_c_c_p24_l_l_q_22,
    sumifs_j_j_c_c_p24_l_l_q_22,
    sumifs_m_m_c_c_p24_l_l_s_22,
    sumifs_j_j_c_c_p24_l_l_s_22,
    sumifs_m_m_c_c_p24_l_l_u_22,
    sumifs_j_j_c_c_p24_l_l_u_22,
    sumifs_m_m_c_c_p24_l_l_w_22,
    sumifs_j_j_c_c_p24_l_l_w_22,
    sumifs_m_m_c_c_p24_l_l_y_22,
    sumifs_j_j_c_c_p24_l_l_y_22,
    sumifs_m_m_c_c_p24_l_l_aa_22,
    sumifs_j_j_c_c_p24_l_l_aa_22,
    sumifs_m_m_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_j_j_c_c_p24_l_l_ac_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_ae_22_k_k_yes,
    sumifs_h_h_c_c_p24_l_l_af_22
  FROM stg.eosq_decfee
),
fee_filtered AS (
  SELECT fu.*
  FROM fee_union fu
  CROSS JOIN LATERAL (
    SELECT
      CASE
        WHEN nullif(btrim(fu.raw_col_4), '') IS NULL THEN NULL::date
        WHEN btrim(fu.raw_col_4) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN btrim(fu.raw_col_4)::date
        WHEN btrim(fu.raw_col_4) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*$' THEN left(btrim(fu.raw_col_4), 10)::date
        WHEN btrim(fu.raw_col_4) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} .*$' THEN left(btrim(fu.raw_col_4), 10)::date
        ELSE NULL::date
      END AS tx_date,
      CASE
        WHEN nullif(btrim(fu.raw_col_11), '') IS NOT NULL
          AND btrim(fu.raw_col_11) ~ '^[+-]?[0-9]+(\\.[0-9]+)?$' THEN btrim(fu.raw_col_11)::numeric(14,2)
        ELSE NULL::numeric(14,2)
      END AS total_probe
  ) p
  WHERE
    -- Contract: row 1 is header; row 2 onward can contain transactions.
    fu._row_num >= 2

    -- A = transaction date (must parse).
    AND p.tx_date IS NOT NULL

    -- B/C/D are required transaction anchors (shift/department/description).
    AND nullif(btrim(fu.raw_col_5), '') IS NOT NULL
    AND nullif(btrim(fu.raw_col_6), '') IS NOT NULL
    AND nullif(btrim(fu.raw_col_7), '') IS NOT NULL
    AND nullif(btrim(fu.raw_col_10), '') IS NOT NULL
    AND lower(coalesce(fu.raw_col_6, '')) NOT IN ('dept', 'department')
    AND lower(coalesce(fu.raw_col_10, '')) NOT IN ('type')
    AND lower(coalesce(fu.raw_col_7, '')) NOT LIKE '%client name%'
    AND lower(coalesce(fu.raw_col_7, '')) NOT LIKE '%accomodation booking ref%'

    -- H = fee including VAT and commissions (must be numeric).
    AND p.total_probe IS NOT NULL

    -- "Missing" is invalid; keep it out of candidate generation path.
    AND NOT (
      lower(coalesce(fu.raw_col_4, '')) = 'missing'
      OR lower(coalesce(fu.raw_col_5, '')) = 'missing'
      OR lower(coalesce(fu.raw_col_6, '')) = 'missing'
      OR lower(coalesce(fu.raw_col_7, '')) = 'missing'
      OR lower(coalesce(fu.raw_col_8, '')) = 'missing'
      OR lower(coalesce(fu.raw_col_9, '')) = 'missing'
      OR lower(coalesce(fu.raw_col_10, '')) = 'missing'
      OR lower(coalesce(fu.raw_col_11, '')) = 'missing'
      OR lower(coalesce(fu.raw_col_12, '')) = 'missing'
      OR lower(coalesce(fu.raw_col_13, '')) = 'missing'
      OR lower(coalesce(fu.raw_col_14, '')) = 'missing'
      OR lower(coalesce(fu.raw_col_15, '')) = 'missing'
      OR lower(coalesce(fu.raw_col_16, '')) = 'missing'
      OR lower(coalesce(fu.raw_col_17, '')) = 'missing'
    )
)
SELECT
  -- Provenance / identity
  'EOSQ'::text AS branch_code,
  source_table_name,
  _source_file,
  _source_sheet,
  _row_num,
  md5(
    coalesce(_source_file, '') || '|' ||
    coalesce(_source_sheet, '') || '|' ||
    coalesce(_row_num::text, '') || '|' ||
    coalesce(source_table_name, '')
  ) AS raw_line_id,

  -- Raw fields (generic positional aliases to avoid accidental semantic coercion)
  raw_col_4,
  raw_col_5,
  raw_col_6,
  raw_col_7,
  raw_col_8,
  raw_col_9,
  raw_col_10,
  raw_col_11,
  raw_col_12,
  raw_col_13,
  raw_col_14,
  raw_col_15,
  raw_col_16,
  raw_col_17,
  raw_col_18,
  raw_col_19,
  raw_col_20,
  raw_col_21,
  raw_col_22,
  raw_col_23,

  -- Parsed fields (strict and minimal)
  CASE
    WHEN nullif(btrim(raw_col_4), '') IS NULL THEN NULL::date
    WHEN btrim(raw_col_4) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN btrim(raw_col_4)::date
    WHEN btrim(raw_col_4) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*$' THEN left(btrim(raw_col_4), 10)::date
    WHEN btrim(raw_col_4) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} .*$' THEN left(btrim(raw_col_4), 10)::date
    ELSE NULL::date
  END AS parsed_business_date,

  CASE
    WHEN nullif(btrim(raw_col_11), '') IS NOT NULL
      AND btrim(raw_col_11) ~ '^[+-]?[0-9]+(\\.[0-9]+)?$'
      AND nullif(btrim(raw_col_13), '') IS NOT NULL
      AND btrim(raw_col_13) ~ '^[+-]?[0-9]+(\\.[0-9]+)?$'
      AND btrim(raw_col_11)::numeric(14,2) >= btrim(raw_col_13)::numeric(14,2)
      THEN (btrim(raw_col_11)::numeric(14,2) - btrim(raw_col_13)::numeric(14,2))::numeric(14,2)
    ELSE NULL::numeric(14,2)
  END AS parsed_ex_vat_amount_primary,

  CASE
    WHEN nullif(btrim(raw_col_13), '') IS NOT NULL
      AND btrim(raw_col_13) ~ '^[+-]?[0-9]+(\\.[0-9]+)?$' THEN btrim(raw_col_13)::numeric(14,2)
    ELSE NULL::numeric(14,2)
  END AS parsed_vat_amount_primary,

  CASE
    WHEN nullif(btrim(raw_col_11), '') IS NOT NULL
      AND btrim(raw_col_11) ~ '^[+-]?[0-9]+(\\.[0-9]+)?$' THEN btrim(raw_col_11)::numeric(14,2)
    ELSE NULL::numeric(14,2)
  END AS helper_total_amount_primary,

  CASE
    WHEN nullif(btrim(raw_col_14), '') IS NULL THEN NULL::text
    WHEN lower(btrim(raw_col_14)) IN ('yes', 'y', 'true', '1', 'issued', 'with receipt') THEN 'with_receipt'
    WHEN lower(btrim(raw_col_14)) IN ('no', 'n', 'false', '0', 'pending', 'lost', 'without receipt') THEN 'no_receipt'
    ELSE NULL::text
  END AS parsed_receipt_state,

  CASE
    WHEN nullif(btrim(raw_col_15), '') IS NULL THEN NULL::text
    WHEN lower(raw_col_15) ~ '(cashbox|petty cash|cash)' THEN 'cash'
    WHEN lower(raw_col_15) ~ '(epos|revolut|bov|bank|transfer|cheque|card|online|transaction|visa|mastercard)' THEN 'non_cash'
    ELSE NULL::text
  END AS parsed_payment_channel,

  -- Derived/helper fields
  CASE
    WHEN upper(_source_sheet) LIKE 'JAN%' THEN 'JAN'
    WHEN upper(_source_sheet) LIKE 'FEB%' THEN 'FEB'
    WHEN upper(_source_sheet) LIKE 'MAR%' THEN 'MAR'
    WHEN upper(_source_sheet) LIKE 'APR%' THEN 'APR'
    WHEN upper(_source_sheet) LIKE 'MAY%' THEN 'MAY'
    WHEN upper(_source_sheet) LIKE 'JUN%' THEN 'JUN'
    WHEN upper(_source_sheet) LIKE 'JUL%' THEN 'JUL'
    WHEN upper(_source_sheet) LIKE 'AUG%' THEN 'AUG'
    WHEN upper(_source_sheet) LIKE 'SEP%' THEN 'SEP'
    WHEN upper(_source_sheet) LIKE 'OCT%' THEN 'OCT'
    WHEN upper(_source_sheet) LIKE 'NOV%' THEN 'NOV'
    WHEN upper(_source_sheet) LIKE 'DEC%' THEN 'DEC'
    ELSE NULL::text
  END AS helper_month_token,

  CASE
    WHEN nullif(btrim(raw_col_4), '') IS NULL THEN 'blank_or_missing'
    WHEN btrim(raw_col_4) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN 'parsed_date'
    WHEN btrim(raw_col_4) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*$' THEN 'parsed_date'
    WHEN btrim(raw_col_4) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} .*$' THEN 'parsed_date'
    ELSE 'non_date_or_ambiguous'
  END AS business_date_parse_status,

  CASE
    WHEN nullif(btrim(raw_col_11), '') IS NULL OR nullif(btrim(raw_col_13), '') IS NULL THEN 'blank_or_missing'
    WHEN btrim(raw_col_11) ~ '^[+-]?[0-9]+(\\.[0-9]+)?$'
      AND btrim(raw_col_13) ~ '^[+-]?[0-9]+(\\.[0-9]+)?$'
      AND btrim(raw_col_11)::numeric(14,2) >= btrim(raw_col_13)::numeric(14,2) THEN 'parsed_derived_from_h_minus_j'
    ELSE 'non_numeric_or_ambiguous'
  END AS ex_vat_parse_status,

  CASE
    WHEN nullif(btrim(raw_col_13), '') IS NULL THEN 'blank_or_missing'
    WHEN btrim(raw_col_13) ~ '^[+-]?[0-9]+(\\.[0-9]+)?$' THEN 'parsed_numeric'
    ELSE 'non_numeric_or_ambiguous'
  END AS vat_parse_status,

  CASE
    WHEN nullif(btrim(raw_col_14), '') IS NULL THEN 'blank_or_missing'
    WHEN lower(btrim(raw_col_14)) IN ('yes', 'y', 'true', '1', 'issued', 'with receipt', 'no', 'n', 'false', '0', 'pending', 'lost', 'without receipt') THEN 'parsed_rule_based'
    ELSE 'unresolved_value'
  END AS receipt_parse_status,

  CASE
    WHEN nullif(btrim(raw_col_15), '') IS NULL THEN 'blank_or_missing'
    WHEN lower(raw_col_15) ~ '(cashbox|petty cash|cash|epos|revolut|bov|bank|transfer|cheque|card|online|transaction|visa|mastercard)' THEN 'parsed_rule_based'
    ELSE 'unresolved_value'
  END AS payment_channel_parse_status,

  -- Future suitability hints (not load decisions)
  -- Header suitability remains false until a trusted date source is joined in.
  (
    nullif(btrim(raw_col_4), '') IS NOT NULL
    AND (
      btrim(raw_col_4) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      OR btrim(raw_col_4) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T.*$'
      OR btrim(raw_col_4) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} .*$'
    )
  ) AS candidate_for_shift_header,

  -- Line suitability is tentative and amount-driven only (date still unresolved here).
  (
    nullif(btrim(raw_col_11), '') IS NOT NULL
    AND btrim(raw_col_11) ~ '^[+-]?[0-9]+(\\.[0-9]+)?$'
  ) AS candidate_for_shift_payment_line
FROM fee_filtered;

