-- EOS SELL monthly raw-source normalization view (v1)
-- Purpose:
--   Read-only, provenance-first normalization over EOSZ/EOSQ monthly *SELL sheets.
--   Keeps raw source values visible and adds only safe helper parsing.
--
-- Scope:
--   Includes stg.eosz_*sell and stg.eosq_*sell.
--   Excludes PAY/FEE/ENTRY/PAY SUMMARY families.
--   Uses operational left-side SELL data contract only (A..R equivalent fields).
--   Delivery/logistics section (S..AQ) and right-side summaries/visuals are ignored.
--
-- Notes:
--   - Current staging shows EOSQ SELL rows populated and EOSZ SELL mostly empty.
--   - This view does not invent missing values; unresolved fields remain NULL.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/v_eos_sell_lines_raw_v1.sql

DROP VIEW IF EXISTS v_eos_sell_lines_raw_v1 CASCADE;

CREATE VIEW v_eos_sell_lines_raw_v1 AS
WITH source_union AS (
  SELECT 'EOSZ'::text AS branch_code, 'stg.eosz_jansell'::text AS source_table_name, _source_file, _source_sheet, _row_num, to_jsonb(t) AS row_json FROM stg.eosz_jansell t
  UNION ALL SELECT 'EOSZ','stg.eosz_febsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosz_febsell t
  UNION ALL SELECT 'EOSZ','stg.eosz_marsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosz_marsell t
  UNION ALL SELECT 'EOSZ','stg.eosz_aprsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosz_aprsell t
  UNION ALL SELECT 'EOSZ','stg.eosz_maysell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosz_maysell t
  UNION ALL SELECT 'EOSZ','stg.eosz_junsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosz_junsell t
  UNION ALL SELECT 'EOSZ','stg.eosz_julsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosz_julsell t
  UNION ALL SELECT 'EOSZ','stg.eosz_augsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosz_augsell t
  UNION ALL SELECT 'EOSZ','stg.eosz_sepsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosz_sepsell t
  UNION ALL SELECT 'EOSZ','stg.eosz_octsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosz_octsell t
  UNION ALL SELECT 'EOSZ','stg.eosz_novsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosz_novsell t
  UNION ALL SELECT 'EOSZ','stg.eosz_decsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosz_decsell t

  UNION ALL SELECT 'EOSQ','stg.eosq_jansell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosq_jansell t
  UNION ALL SELECT 'EOSQ','stg.eosq_febsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosq_febsell t
  UNION ALL SELECT 'EOSQ','stg.eosq_marsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosq_marsell t
  UNION ALL SELECT 'EOSQ','stg.eosq_aprsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosq_aprsell t
  UNION ALL SELECT 'EOSQ','stg.eosq_maysell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosq_maysell t
  UNION ALL SELECT 'EOSQ','stg.eosq_junsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosq_junsell t
  UNION ALL SELECT 'EOSQ','stg.eosq_julsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosq_julsell t
  UNION ALL SELECT 'EOSQ','stg.eosq_augsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosq_augsell t
  UNION ALL SELECT 'EOSQ','stg.eosq_sepsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosq_sepsell t
  UNION ALL SELECT 'EOSQ','stg.eosq_octsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosq_octsell t
  UNION ALL SELECT 'EOSQ','stg.eosq_novsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosq_novsell t
  UNION ALL SELECT 'EOSQ','stg.eosq_decsell',_source_file,_source_sheet,_row_num,to_jsonb(t) FROM stg.eosq_decsell t
), normalized AS (
  SELECT
    s.branch_code,
    s.source_table_name,
    s._source_file,
    s._source_sheet,
    s._row_num,
    md5(coalesce(s._source_file, '') || '|' || coalesce(s._source_sheet, '') || '|' || coalesce(s._row_num::text, '') || '|' || coalesce(s.source_table_name, '')) AS raw_line_id,

    -- Raw SELL fields (A..R contract with drift-safe key fallbacks)
    coalesce(
      (
        SELECT e.value
        FROM jsonb_each_text(s.row_json) e
        WHERE e.key ~ '^col_20[0-9]{2}_[0-9]{2}_[0-9]{2}_00_00_00$'
        LIMIT 1
      ),
      CASE
        WHEN coalesce(s.row_json ->> 'if_c20_0_index_stock_match_c21_productlist_code_0_match_d_2_pro', '') ~ '^\d{4}-\d{2}-\d{2}(\s+\d{2}:\d{2}:\d{2})?$'
          THEN s.row_json ->> 'if_c20_0_index_stock_match_c21_productlist_code_0_match_d_2_pro'
        ELSE NULL::text
      END
    ) AS raw_business_date_text,
    coalesce(
      nullif(s.row_json ->> 'if_c21_0_index_stock_match_c21_productlist_code_0_match_e_2_pro', ''),
      s.row_json ->> 'afternoon',
      CASE
        WHEN lower(coalesce(s.row_json ->> 'if_c20_0_index_stock_match_c21_productlist_code_0_match_d_2_pro', '')) IN ('morning', 'afternoon')
          THEN s.row_json ->> 'if_c20_0_index_stock_match_c21_productlist_code_0_match_d_2_pro'
        WHEN coalesce(s.row_json ->> 'if_c20_0_index_stock_match_c21_productlist_code_0_match_d_2_pro', '') ~ '^[0-2]?[0-9]:[0-5][0-9](:[0-5][0-9])?$'
          THEN s.row_json ->> 'if_c20_0_index_stock_match_c21_productlist_code_0_match_d_2_pro'
        ELSE NULL::text
      END,
      s.row_json ->> 'morning'
    ) AS raw_shift_text,
    coalesce(
      CASE
        WHEN coalesce(s.row_json ->> 'if_c21_0_index_stock_match_c21_productlist_code_0_match_f_2_pro', '') ~ '^[0-9]{6,}$'
          THEN s.row_json ->> 'if_c21_0_index_stock_match_c21_productlist_code_0_match_f_2_pro'
        ELSE NULL::text
      END,
      (
        SELECT e.value
        FROM jsonb_each_text(s.row_json) e
        WHERE e.key ~ '^col_[0-9]{8,}$'
          AND e.value ~ '^[0-9]{6,}$'
        LIMIT 1
      ),
      CASE
        WHEN coalesce(s.row_json ->> 'if_c21_0_index_stock_match_c21_productlist_code_0_match_e_2_pro', '') ~ '^[0-9]{6,}$'
          THEN s.row_json ->> 'if_c21_0_index_stock_match_c21_productlist_code_0_match_e_2_pro'
        ELSE NULL::text
      END
    ) AS raw_barcode_text,
    coalesce(
      nullif(s.row_json ->> 'if_c21_0_index_stock_match_c21_productlist_code_0_match_i_2_pro', ''),
      CASE
        WHEN coalesce(s.row_json ->> 'if_c20_0_index_stock_match_c21_productlist_code_0_match_d_2_pro', '') ~ '^\d{4}-\d{2}-\d{2}(\s+\d{2}:\d{2}:\d{2})?$'
          THEN NULL::text
        WHEN lower(coalesce(s.row_json ->> 'if_c20_0_index_stock_match_c21_productlist_code_0_match_d_2_pro', '')) IN ('morning', 'afternoon')
          THEN NULL::text
        WHEN coalesce(s.row_json ->> 'if_c20_0_index_stock_match_c21_productlist_code_0_match_d_2_pro', '') ~ '^[0-2]?[0-9]:[0-5][0-9](:[0-5][0-9])?$'
          THEN NULL::text
        ELSE s.row_json ->> 'if_c20_0_index_stock_match_c21_productlist_code_0_match_d_2_pro'
      END,
      nullif(s.row_json ->> 'if_c21_0_index_stock_match_c21_productlist_code_0_match_f_2_pro', '')
    ) AS raw_product_text,
    coalesce(
      CASE
        WHEN coalesce(s.row_json ->> 'if_c21_0_index_stock_match_c21_productlist_code_0_match_e_2_pro', '') ~ '^[0-9]{6,}$'
          THEN NULL::text
        ELSE nullif(s.row_json ->> 'if_c21_0_index_stock_match_c21_productlist_code_0_match_e_2_pro', '')
      END,
      nullif(s.row_json ->> 'col_7', '')
    ) AS raw_size_text,
    coalesce(
      nullif(s.row_json ->> 'if_g21_10_10_g21', ''),
      nullif(s.row_json ->> 'if_c21_0_index_stock_match_c21_productlist_code_0_match_f_2_pro', '')
    ) AS raw_product_type_text,

    -- G/H are primarily used for ecotax nights logic.
    s.row_json ->> 'if_c21_0_index_stock_match_c21_productlist_code_0_match_i_2_pro' AS raw_g_total_nights_text,
    s.row_json ->> 'if_c21_0_index_stock_match_c21_productlist_code_0_match_j_2_pro' AS raw_h_billable_nights_text,

    coalesce(
      s.row_json ->> 'if_c21_0_0_if_c21_ecobar_0_i21_m21',
      s.row_json ->> 'if_g21_10_10_g21'
    ) AS raw_ex_vat_amount_text,
    coalesce(
      s.row_json ->> 'if_k21_0_0_k21_m21',
      s.row_json ->> 'if_c21_0_l21_m21'
    ) AS raw_vat_amount_text,
    coalesce(
      s.row_json ->> 'if_c21_0_if_c21_0_if_d21_ecotax_i21_h21_index_stock_match_c21_p',
      s.row_json ->> 'if_c21_0_0_if_c21_ecobar_0_i21_m21'
    ) AS raw_total_amount_text,
    coalesce(
      s.row_json ->> 'if_c21_0_index_stock_match_c21_productlist_code_0_match_j_2_pro',
      s.row_json ->> 'vat'
    ) AS raw_vat_percent_text,

    coalesce(
      s.row_json ->> 'if_c21_0_0_if_c21_ecobar_0_i21_m21',
      s.row_json ->> 'col_1'
    ) AS raw_qty_text,

    coalesce(
      s.row_json ->> 'if_v21_0_index_stock_match_v21_productlist_code_0_match_aa_2_pr',
      s.row_json ->> 'cashbox',
      s.row_json ->> 'if_v21_0_index_stock_match_v21_productlist_code_0_match_y_2_pro',
      s.row_json ->> 'sumifs_aj_aj_an_an_no_ak_ak_data_b_10_ao_ao_cc_19',
      s.row_json ->> 'paid_by'
    ) AS raw_payment_channel_text,
    coalesce(
      s.row_json ->> 'if_v21_0_index_stock_match_v21_productlist_code_0_match_ab_2_pr',
      s.row_json ->> 'anitta',
      s.row_json ->> 'if_v21_0_index_stock_match_v21_productlist_code_0_match_ac_2_pr',
      s.row_json ->> 'assistant'
    ) AS raw_signer_text,

    coalesce(
      s.row_json ->> 'if_v21_0_index_stock_match_v21_productlist_code_0_match_ab_2_pr',
      s.row_json ->> 'if_c21_0_0_if_c21_ecobar_0_i21_m21'
    ) AS raw_total_ex_vat_text,

    -- Keep row JSON for diagnostics / future mapping
    s.row_json AS raw_payload_json
  FROM source_union s
), sell_filtered AS (
  SELECT *
  FROM normalized
  WHERE
    nullif(btrim(coalesce(raw_business_date_text, '')), '') IS NOT NULL
    AND
    nullif(btrim(coalesce(raw_product_text, '')), '') IS NOT NULL
    AND lower(btrim(raw_product_text)) NOT IN (
      'product name',
      'table: jansell10',
      'table: jan sell10',
      'table: julsell2',
      'size',
      'type',
      'income',
      'shift',
      'date',
      'tax',
      'vat',
      'xread'
    )
    AND raw_product_text !~ '^[+-]?[0-9]+(\.[0-9]+)?$'
    AND lower(raw_product_text) NOT LIKE '%scan barcode%'
    AND lower(coalesce(raw_payment_channel_text, '')) NOT IN ('pay_type', 'total')
    AND (
      nullif(btrim(coalesce(raw_total_amount_text, '')), '') IS NOT NULL
      OR nullif(btrim(coalesce(raw_ex_vat_amount_text, '')), '') IS NOT NULL
      OR nullif(btrim(coalesce(raw_vat_amount_text, '')), '') IS NOT NULL
    )
)
SELECT
  branch_code,
  source_table_name,
  _source_file,
  _source_sheet,
  _row_num,
  raw_line_id,

  raw_business_date_text,
  raw_shift_text,
  raw_barcode_text,
  raw_product_text,
  raw_size_text,
  raw_product_type_text,
  raw_g_total_nights_text,
  raw_h_billable_nights_text,
  raw_ex_vat_amount_text,
  raw_vat_amount_text,
  raw_total_amount_text,
  raw_qty_text,
  raw_vat_percent_text,
  raw_payment_channel_text,
  raw_signer_text,
  raw_total_ex_vat_text,
  raw_payload_json,

  CASE
    WHEN nullif(btrim(raw_business_date_text), '') IS NULL THEN NULL::date
    WHEN raw_business_date_text ~ '^\d{4}-\d{2}-\d{2}$' THEN raw_business_date_text::date
    WHEN raw_business_date_text ~ '^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$' THEN left(raw_business_date_text, 10)::date
    WHEN raw_business_date_text ~ '^\d{4}-\d{2}-\d{2}T.*$' THEN left(raw_business_date_text, 10)::date
    ELSE NULL::date
  END AS parsed_business_date,

  CASE
    WHEN nullif(btrim(raw_ex_vat_amount_text), '') IS NULL THEN NULL::numeric(14,2)
    WHEN btrim(raw_ex_vat_amount_text) ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN btrim(raw_ex_vat_amount_text)::numeric(14,2)
    ELSE NULL::numeric(14,2)
  END AS parsed_ex_vat_amount,

  CASE
    WHEN nullif(btrim(raw_vat_amount_text), '') IS NULL THEN NULL::numeric(14,2)
    WHEN btrim(raw_vat_amount_text) ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN btrim(raw_vat_amount_text)::numeric(14,2)
    ELSE NULL::numeric(14,2)
  END AS parsed_vat_amount,

  CASE
    WHEN nullif(btrim(raw_total_amount_text), '') IS NULL THEN NULL::numeric(14,2)
    WHEN btrim(raw_total_amount_text) ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN btrim(raw_total_amount_text)::numeric(14,2)
    ELSE NULL::numeric(14,2)
  END AS parsed_total_amount,

  CASE
    WHEN nullif(btrim(raw_qty_text), '') IS NULL THEN NULL::numeric(14,2)
    WHEN btrim(raw_qty_text) ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN btrim(raw_qty_text)::numeric(14,2)
    ELSE NULL::numeric(14,2)
  END AS parsed_qty,

  CASE
    WHEN nullif(btrim(raw_payment_channel_text), '') IS NULL THEN NULL::text
    WHEN lower(raw_payment_channel_text) ~ '(cash)' THEN 'cash'
    WHEN lower(raw_payment_channel_text) ~ '(epos|revolut|bov|bank|transfer|cheque|card|online|transaction)' THEN 'non_cash'
    ELSE NULL::text
  END AS parsed_payment_channel,

  NULL::text AS parsed_receipt_state,

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
    WHEN nullif(btrim(raw_business_date_text), '') IS NULL THEN 'blank_or_missing'
    WHEN raw_business_date_text ~ '^\d{4}-\d{2}-\d{2}$' THEN 'parsed_date'
    WHEN raw_business_date_text ~ '^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$' THEN 'parsed_date'
    WHEN raw_business_date_text ~ '^\d{4}-\d{2}-\d{2}T.*$' THEN 'parsed_date'
    ELSE 'non_date_or_ambiguous'
  END AS business_date_parse_status,

  CASE
    WHEN nullif(btrim(raw_ex_vat_amount_text), '') IS NULL THEN 'blank_or_missing'
    WHEN btrim(raw_ex_vat_amount_text) ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN 'parsed_numeric'
    ELSE 'non_numeric_or_ambiguous'
  END AS ex_vat_parse_status,

  CASE
    WHEN nullif(btrim(raw_vat_amount_text), '') IS NULL THEN 'blank_or_missing'
    WHEN btrim(raw_vat_amount_text) ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN 'parsed_numeric'
    ELSE 'non_numeric_or_ambiguous'
  END AS vat_parse_status,

  CASE
    WHEN nullif(btrim(raw_total_amount_text), '') IS NULL THEN 'blank_or_missing'
    WHEN btrim(raw_total_amount_text) ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN 'parsed_numeric'
    ELSE 'non_numeric_or_ambiguous'
  END AS total_amount_parse_status,

  CASE
    WHEN nullif(btrim(raw_payment_channel_text), '') IS NULL THEN 'blank_or_missing'
    WHEN lower(raw_payment_channel_text) ~ '(cash|epos|revolut|bov|bank|transfer|cheque|card|online|transaction)' THEN 'parsed_rule_based'
    ELSE 'unresolved_value'
  END AS payment_channel_parse_status,

  'not_available_in_sell_raw_v1'::text AS receipt_parse_status,

  (
    nullif(btrim(raw_product_text), '') IS NOT NULL
    AND nullif(btrim(raw_total_amount_text), '') IS NOT NULL
    AND btrim(raw_total_amount_text) ~ '^[+-]?[0-9]+(\.[0-9]+)?$'
  ) AS candidate_for_shift_sell_line,

  (
    nullif(btrim(raw_business_date_text), '') IS NOT NULL
    AND (
      raw_business_date_text ~ '^\d{4}-\d{2}-\d{2}$'
      OR raw_business_date_text ~ '^\d{4}-\d{2}-\d{2}T.*$'
    )
  ) AS candidate_for_shift_header
FROM sell_filtered;
