-- EOSZ PAY monthly raw-source normalization view (v1)
-- Purpose:
--   Read-only, provenance-first normalization over EOSZ monthly *PAY sheets.
--   This view intentionally keeps raw fields visible and adds safe helper parsing.
--
-- Scope:
--   Includes stg.eosq_janpay .. stg.eosq_decpay.
--   Excludes ENTRY, SELL, and PAY SUMMARY families.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/v_eosq_pay_lines_raw_v1.sql

CREATE OR REPLACE VIEW v_eosq_pay_lines_raw_v1 AS
WITH pay_union AS (
  -- Mixed layout for EOSQ: Jan is richer, Feb-Dec are lean.
  SELECT
    'stg.eosq_janpay'::text AS source_table_name,
    _source_file,
    _source_sheet,
    _row_num,
    department_mdcz_mdcq_mhb_blu_m_q_blu_m_v_mplus::text AS raw_department_text,
    col_2::text AS raw_business_date_text,
    morning::text AS raw_shift_text,
    merchant_name_in_full::text AS raw_merchant_text,
    description::text AS raw_description_text,
    running::text AS raw_running_capital_text,
    type::text AS raw_type_text,
    invoice_number_s::text AS raw_invoice_text,
    NULL::text AS raw_reference_text,
    paid_by::text AS raw_paid_by_text,
    receipt_in_file::text AS raw_receipt_text,
    exc_vat::text AS raw_ex_vat_text,
    NULL::text AS raw_vat_text,
    tot::text AS raw_total_text,
    assistant::text AS raw_assistant_text,
    morning_2::text AS raw_shift_text_2,
    description_2::text AS raw_description_text_2
  FROM stg.eosq_janpay

  UNION ALL

  -- EOSQ FEB already follows the lean layout.
  SELECT
    'stg.eosq_febpay'::text,
    _source_file,
    _source_sheet,
    _row_num,
    morning::text,
    merchant_name_in_full::text,
    description::text,
    running::text,
    exc_vat::text,
    tot::text,
    morning_2::text,
    description_2::text,
    col_25::text,
    tot_2::text,
    col_30::text,
    new_loan_drawdowns::text,
    col_32::text,
    fixed_assets_via_loan::text,
    col_34::text,
    fixed_assets_own_sources::text,
    col_36::text
  FROM stg.eosq_febpay

  UNION ALL

  -- Lean layout (Mar-Dec)
  SELECT
    'stg.eosq_marpay'::text,
    _source_file,
    _source_sheet,
    _row_num,
    morning::text,
    merchant_name_in_full::text,
    description::text,
    running::text,
    exc_vat::text,
    tot::text,
    morning_2::text,
    description_2::text,
    col_25::text,
    tot_2::text,
    col_30::text,
    new_loan_drawdowns::text,
    col_32::text,
    fixed_assets_via_loan::text,
    col_34::text,
    fixed_assets_own_sources::text,
    col_36::text
  FROM stg.eosq_marpay

  UNION ALL
  SELECT 'stg.eosq_aprpay', _source_file, _source_sheet, _row_num, morning::text, merchant_name_in_full::text, description::text, running::text, exc_vat::text, tot::text, morning_2::text, description_2::text, col_25::text, tot_2::text, col_30::text, new_loan_drawdowns::text, col_32::text, fixed_assets_via_loan::text, col_34::text, fixed_assets_own_sources::text, col_36::text FROM stg.eosq_aprpay
  UNION ALL
  SELECT 'stg.eosq_maypay', _source_file, _source_sheet, _row_num, morning::text, merchant_name_in_full::text, description::text, running::text, exc_vat::text, tot::text, morning_2::text, description_2::text, col_25::text, tot_2::text, col_30::text, new_loan_drawdowns::text, col_32::text, fixed_assets_via_loan::text, col_34::text, fixed_assets_own_sources::text, col_36::text FROM stg.eosq_maypay
  UNION ALL
  SELECT 'stg.eosq_junpay', _source_file, _source_sheet, _row_num, morning::text, merchant_name_in_full::text, description::text, running::text, exc_vat::text, tot::text, morning_2::text, description_2::text, col_25::text, tot_2::text, col_30::text, new_loan_drawdowns::text, col_32::text, fixed_assets_via_loan::text, col_34::text, fixed_assets_own_sources::text, col_36::text FROM stg.eosq_junpay
  UNION ALL
  SELECT 'stg.eosq_julpay', _source_file, _source_sheet, _row_num, morning::text, merchant_name_in_full::text, description::text, running::text, exc_vat::text, tot::text, morning_2::text, description_2::text, col_25::text, tot_2::text, col_30::text, new_loan_drawdowns::text, col_32::text, fixed_assets_via_loan::text, col_34::text, fixed_assets_own_sources::text, col_36::text FROM stg.eosq_julpay
  UNION ALL
  SELECT 'stg.eosq_augpay', _source_file, _source_sheet, _row_num, morning::text, merchant_name_in_full::text, description::text, running::text, exc_vat::text, tot::text, morning_2::text, description_2::text, col_25::text, tot_2::text, col_30::text, new_loan_drawdowns::text, col_32::text, fixed_assets_via_loan::text, col_34::text, fixed_assets_own_sources::text, col_36::text FROM stg.eosq_augpay
  UNION ALL
  SELECT 'stg.eosq_seppay', _source_file, _source_sheet, _row_num, morning::text, merchant_name_in_full::text, description::text, running::text, exc_vat::text, tot::text, morning_2::text, description_2::text, col_25::text, tot_2::text, col_30::text, new_loan_drawdowns::text, col_32::text, fixed_assets_via_loan::text, col_34::text, fixed_assets_own_sources::text, col_36::text FROM stg.eosq_seppay
  UNION ALL
  SELECT 'stg.eosq_octpay', _source_file, _source_sheet, _row_num, morning::text, merchant_name_in_full::text, description::text, running::text, exc_vat::text, tot::text, morning_2::text, description_2::text, col_25::text, tot_2::text, col_30::text, new_loan_drawdowns::text, col_32::text, fixed_assets_via_loan::text, col_34::text, fixed_assets_own_sources::text, col_36::text FROM stg.eosq_octpay
  UNION ALL
  SELECT 'stg.eosq_novpay', _source_file, _source_sheet, _row_num, morning::text, merchant_name_in_full::text, description::text, running::text, exc_vat::text, tot::text, morning_2::text, description_2::text, col_25::text, tot_2::text, col_30::text, new_loan_drawdowns::text, col_32::text, fixed_assets_via_loan::text, col_34::text, fixed_assets_own_sources::text, col_36::text FROM stg.eosq_novpay
  UNION ALL
  SELECT 'stg.eosq_decpay', _source_file, _source_sheet, _row_num, morning::text, merchant_name_in_full::text, description::text, running::text, exc_vat::text, tot::text, morning_2::text, description_2::text, col_25::text, tot_2::text, col_30::text, new_loan_drawdowns::text, col_32::text, fixed_assets_via_loan::text, col_34::text, fixed_assets_own_sources::text, col_36::text FROM stg.eosq_decpay
),
pay_filtered AS (
  SELECT *
  FROM pay_union
  WHERE
    -- Keep rows with transactional signal.
    (
      nullif(btrim(raw_business_date_text), '') IS NOT NULL
      OR nullif(btrim(raw_ex_vat_text), '') IS NOT NULL
      OR nullif(btrim(raw_total_text), '') IS NOT NULL
      OR nullif(btrim(raw_merchant_text), '') IS NOT NULL
    )
    -- Exclude obvious non-transaction headers/summary prompts.
    AND lower(coalesce(btrim(raw_department_text), '')) NOT IN ('department', 'dept')
    AND lower(coalesce(btrim(raw_business_date_text), '')) NOT IN ('date', 'paid date')
    AND lower(coalesce(btrim(raw_running_capital_text), '')) NOT IN ('paid to')
    AND lower(coalesce(btrim(raw_description_text), '')) NOT IN ('what did you pay for')
    -- Require at least one business descriptor to avoid blank "0" carry rows.
    AND (
      nullif(btrim(raw_department_text), '') IS NOT NULL
      OR nullif(btrim(raw_merchant_text), '') IS NOT NULL
      OR nullif(btrim(raw_description_text), '') IS NOT NULL
      OR nullif(btrim(raw_invoice_text), '') IS NOT NULL
    )
)
SELECT
  -- Provenance / identity
  'EOSQ'::text AS branch_code,
  source_table_name,
  _source_file,
  _source_sheet,
  _row_num,
  md5(coalesce(_source_file, '') || '|' || coalesce(_source_sheet, '') || '|' || coalesce(_row_num::text, '') || '|' || coalesce(source_table_name, '')) AS raw_line_id,

  -- Raw fields (as staged)
  raw_department_text,
  raw_business_date_text,
  raw_shift_text,
  raw_merchant_text,
  raw_description_text,
  raw_running_capital_text,
  raw_type_text,
  raw_invoice_text,
  raw_reference_text,
  raw_paid_by_text,
  raw_receipt_text,
  raw_ex_vat_text,
  raw_vat_text,
  raw_total_text,
  raw_assistant_text,
  raw_shift_text_2,
  raw_description_text_2,

  -- Parsed fields (strict parse, no ambiguous coercion)
  CASE
    WHEN nullif(btrim(raw_business_date_text), '') IS NULL THEN NULL::date
    WHEN raw_business_date_text ~ '^\d{4}-\d{2}-\d{2}$' THEN raw_business_date_text::date
    WHEN raw_business_date_text ~ '^\d{4}-\d{2}-\d{2}T.*$' THEN left(raw_business_date_text, 10)::date
    ELSE NULL::date
  END AS parsed_business_date,

  CASE
    WHEN nullif(btrim(raw_ex_vat_text), '') IS NULL THEN NULL::numeric(14,2)
    WHEN btrim(raw_ex_vat_text) ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN btrim(raw_ex_vat_text)::numeric(14,2)
    ELSE NULL::numeric(14,2)
  END AS parsed_ex_vat_amount,

  CASE
    WHEN nullif(btrim(raw_vat_text), '') IS NULL THEN NULL::numeric(14,2)
    WHEN btrim(raw_vat_text) ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN btrim(raw_vat_text)::numeric(14,2)
    ELSE NULL::numeric(14,2)
  END AS parsed_vat_amount,

  CASE
    WHEN nullif(btrim(raw_total_text), '') IS NULL THEN NULL::numeric(14,2)
    WHEN btrim(raw_total_text) ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN btrim(raw_total_text)::numeric(14,2)
    ELSE NULL::numeric(14,2)
  END AS parsed_total_amount,

  CASE
    WHEN nullif(btrim(raw_receipt_text), '') IS NULL THEN NULL::text
    WHEN lower(btrim(raw_receipt_text)) IN ('yes', 'y', 'true', '1', 'issued', 'with receipt') THEN 'with_receipt'
    WHEN lower(btrim(raw_receipt_text)) IN ('no', 'n', 'false', '0', 'pending', 'lost', 'without receipt') THEN 'no_receipt'
    ELSE NULL::text
  END AS parsed_receipt_state,

  CASE
    WHEN nullif(btrim(raw_paid_by_text), '') IS NULL THEN NULL::text
    WHEN lower(raw_paid_by_text) ~ '(cash)' THEN 'cash'
    WHEN lower(raw_paid_by_text) ~ '(revolut|bov|bank|transfer|cheque|card|online|transaction)' THEN 'non_cash'
    ELSE NULL::text
  END AS parsed_payment_channel,

  -- Derived/helper fields (non-authoritative)
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
    WHEN raw_business_date_text ~ '^\d{4}-\d{2}-\d{2}T.*$' THEN 'parsed_date'
    ELSE 'non_date_or_ambiguous'
  END AS business_date_parse_status,

  CASE
    WHEN nullif(btrim(raw_ex_vat_text), '') IS NULL THEN 'blank_or_missing'
    WHEN btrim(raw_ex_vat_text) ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN 'parsed_numeric'
    ELSE 'non_numeric_or_ambiguous'
  END AS ex_vat_parse_status,

  CASE
    WHEN nullif(btrim(raw_vat_text), '') IS NULL THEN 'blank_or_missing'
    WHEN btrim(raw_vat_text) ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN 'parsed_numeric'
    ELSE 'non_numeric_or_ambiguous'
  END AS vat_parse_status,

  CASE
    WHEN nullif(btrim(raw_total_text), '') IS NULL THEN 'blank_or_missing'
    WHEN btrim(raw_total_text) ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN 'parsed_numeric'
    ELSE 'non_numeric_or_ambiguous'
  END AS total_amount_parse_status,

  CASE
    WHEN nullif(btrim(raw_receipt_text), '') IS NULL THEN 'blank_or_missing'
    WHEN lower(btrim(raw_receipt_text)) IN ('yes', 'y', 'true', '1', 'issued', 'with receipt', 'no', 'n', 'false', '0', 'pending', 'lost', 'without receipt') THEN 'parsed_rule_based'
    ELSE 'unresolved_value'
  END AS receipt_parse_status,

  CASE
    WHEN nullif(btrim(raw_paid_by_text), '') IS NULL THEN 'blank_or_missing'
    WHEN lower(raw_paid_by_text) ~ '(cash|revolut|bov|bank|transfer|cheque|card|online|transaction)' THEN 'parsed_rule_based'
    ELSE 'unresolved_value'
  END AS payment_channel_parse_status,

  -- Future suitability hints (not load decisions)
  -- Suitable later for eos_shift_header when business_date_parse_status='parsed_date'.
  (
    nullif(btrim(raw_business_date_text), '') IS NOT NULL
    AND (
      raw_business_date_text ~ '^\d{4}-\d{2}-\d{2}$'
      OR raw_business_date_text ~ '^\d{4}-\d{2}-\d{2}T.*$'
    )
  ) AS candidate_for_shift_header,

  -- Suitable later for eos_shift_payment_lines when total amount is safely parsed.
  (nullif(btrim(raw_total_text), '') IS NOT NULL AND btrim(raw_total_text) ~ '^[+-]?[0-9]+(\.[0-9]+)?$') AS candidate_for_shift_payment_line
FROM pay_filtered;

