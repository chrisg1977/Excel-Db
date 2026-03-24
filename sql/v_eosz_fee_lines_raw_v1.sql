-- EOSZ FEE monthly raw-source normalization view (v1)
-- Purpose:
--   Read-only, provenance-first normalization over EOSZ monthly *FEE sheets.
--   This view keeps raw staged fields visible and adds only safe parsing helpers.
--
-- Scope:
--   Includes stg.eosz_janfee .. stg.eosz_decfee.
--   Excludes ENTRY, SELL, and PAY SUMMARY families.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/v_eosz_fee_lines_raw_v1.sql

CREATE OR REPLACE VIEW v_eosz_fee_lines_raw_v1 AS
WITH fee_union AS (
  SELECT
    'stg.eosz_janfee'::text AS source_table_name,
    _source_file,
    _source_sheet,
    _row_num,
    if_h23_0_0_index_vatentry_match_janfee_g23_ratesentry_0_2 AS raw_col_4,
    if_k23_no_0_if_i23_0_0_h23_100pct_i23_i23 AS raw_col_5,
    h23_j23 AS raw_col_6,
    col_16 AS raw_col_7,
    exc_vat AS raw_col_8,
    vat AS raw_col_9,
    exc_vat_2 AS raw_col_10,
    vat_2 AS raw_col_11,
    exc_vat_3 AS raw_col_12,
    vat_3 AS raw_col_13,
    exc_vat_4 AS raw_col_14,
    vat_4 AS raw_col_15,
    exc_vat_5 AS raw_col_16,
    vat_5 AS raw_col_17,
    exc_vat_6 AS raw_col_18,
    vat_6 AS raw_col_19,
    exc_vat_7 AS raw_col_20,
    vat_7 AS raw_col_21,
    no_receipt AS raw_col_22,
    col_32 AS raw_col_23
  FROM stg.eosz_janfee

  UNION ALL

  SELECT
    'stg.eosz_febfee'::text,
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
  FROM stg.eosz_febfee

  UNION ALL

  SELECT
    'stg.eosz_marfee'::text,
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
  FROM stg.eosz_marfee

  UNION ALL

  SELECT
    'stg.eosz_aprfee'::text,
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
  FROM stg.eosz_aprfee

  UNION ALL

  SELECT
    'stg.eosz_mayfee'::text,
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
  FROM stg.eosz_mayfee

  UNION ALL

  SELECT
    'stg.eosz_junfee'::text,
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
  FROM stg.eosz_junfee

  UNION ALL

  SELECT
    'stg.eosz_julfee'::text,
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
  FROM stg.eosz_julfee

  UNION ALL

  SELECT
    'stg.eosz_augfee'::text,
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
  FROM stg.eosz_augfee

  UNION ALL

  SELECT
    'stg.eosz_sepfee'::text,
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
  FROM stg.eosz_sepfee

  UNION ALL

  SELECT
    'stg.eosz_octfee'::text,
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
  FROM stg.eosz_octfee

  UNION ALL

  SELECT
    'stg.eosz_novfee'::text,
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
  FROM stg.eosz_novfee

  UNION ALL

  SELECT
    'stg.eosz_decfee'::text,
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
  FROM stg.eosz_decfee
)
SELECT
  -- Provenance / identity
  'EOSZ'::text AS branch_code,
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
  NULL::date AS parsed_business_date,

  CASE
    WHEN nullif(btrim(raw_col_8), '') IS NULL THEN NULL::numeric(14,2)
    WHEN btrim(raw_col_8) ~ '^[+-]?[0-9]+(\\.[0-9]+)?$' THEN btrim(raw_col_8)::numeric(14,2)
    ELSE NULL::numeric(14,2)
  END AS parsed_ex_vat_amount_primary,

  CASE
    WHEN nullif(btrim(raw_col_9), '') IS NULL THEN NULL::numeric(14,2)
    WHEN btrim(raw_col_9) ~ '^[+-]?[0-9]+(\\.[0-9]+)?$' THEN btrim(raw_col_9)::numeric(14,2)
    ELSE NULL::numeric(14,2)
  END AS parsed_vat_amount_primary,

  CASE
    WHEN nullif(btrim(raw_col_8), '') IS NULL THEN NULL::numeric(14,2)
    WHEN btrim(raw_col_8) !~ '^[+-]?[0-9]+(\\.[0-9]+)?$' THEN NULL::numeric(14,2)
    WHEN nullif(btrim(raw_col_9), '') IS NULL THEN NULL::numeric(14,2)
    WHEN btrim(raw_col_9) !~ '^[+-]?[0-9]+(\\.[0-9]+)?$' THEN NULL::numeric(14,2)
    ELSE (btrim(raw_col_8)::numeric(14,2) + btrim(raw_col_9)::numeric(14,2))::numeric(14,2)
  END AS helper_total_amount_primary,

  CASE
    WHEN nullif(btrim(raw_col_22), '') IS NULL THEN NULL::text
    WHEN lower(btrim(raw_col_22)) IN ('yes', 'y', 'true', '1', 'issued', 'with receipt') THEN 'with_receipt'
    WHEN lower(btrim(raw_col_22)) IN ('no', 'n', 'false', '0', 'pending', 'lost', 'without receipt') THEN 'no_receipt'
    ELSE NULL::text
  END AS parsed_receipt_state,

  NULL::text AS parsed_payment_channel,

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
    WHEN NULL::date IS NULL THEN 'unresolved_no_explicit_date_field'
    ELSE 'parsed_date'
  END AS business_date_parse_status,

  CASE
    WHEN nullif(btrim(raw_col_8), '') IS NULL THEN 'blank_or_missing'
    WHEN btrim(raw_col_8) ~ '^[+-]?[0-9]+(\\.[0-9]+)?$' THEN 'parsed_numeric'
    ELSE 'non_numeric_or_ambiguous'
  END AS ex_vat_parse_status,

  CASE
    WHEN nullif(btrim(raw_col_9), '') IS NULL THEN 'blank_or_missing'
    WHEN btrim(raw_col_9) ~ '^[+-]?[0-9]+(\\.[0-9]+)?$' THEN 'parsed_numeric'
    ELSE 'non_numeric_or_ambiguous'
  END AS vat_parse_status,

  CASE
    WHEN nullif(btrim(raw_col_22), '') IS NULL THEN 'blank_or_missing'
    WHEN lower(btrim(raw_col_22)) IN ('yes', 'y', 'true', '1', 'issued', 'with receipt', 'no', 'n', 'false', '0', 'pending', 'lost', 'without receipt') THEN 'parsed_rule_based'
    ELSE 'unresolved_value'
  END AS receipt_parse_status,

  'unresolved_no_explicit_channel_field'::text AS payment_channel_parse_status,

  -- Future suitability hints (not load decisions)
  -- Header suitability remains false until a trusted date source is joined in.
  FALSE AS candidate_for_shift_header,

  -- Line suitability is tentative and amount-driven only (date still unresolved here).
  (
    nullif(btrim(raw_col_8), '') IS NOT NULL
    AND btrim(raw_col_8) ~ '^[+-]?[0-9]+(\\.[0-9]+)?$'
  ) AS candidate_for_shift_payment_line
FROM fee_union;
