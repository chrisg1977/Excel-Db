-- EOS SELL candidate bridge view (v1)
-- Purpose:
--   Read-only candidate projection for SELL rows from v_eos_sell_lines_raw_v1.
--   Keeps unresolved values as NULL and emits explicit unresolved notes.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/v_eos_sell_candidates_v1.sql

DROP VIEW IF EXISTS v_eos_sell_candidates_v1;

CREATE VIEW v_eos_sell_candidates_v1 AS
SELECT
  r.branch_code,
  'SELL'::text AS source_family,
  r.source_table_name,
  r.raw_line_id,
  r._source_file,
  r._source_sheet,
  r._row_num,

  -- Raw source values
  r.raw_business_date_text,
  r.raw_shift_text,
  'MHB'::text AS raw_department_text,
  r.raw_barcode_text,
  r.raw_product_text AS raw_description_text,
  r.raw_product_type_text AS raw_category_text,
  coalesce(nullif(btrim(r.raw_size_text), ''), nullif(btrim(r.raw_barcode_text), '')) AS raw_reference_text,
  r.raw_g_total_nights_text,
  r.raw_h_billable_nights_text,
  r.raw_qty_text,
  r.raw_payment_channel_text,
  r.raw_ex_vat_amount_text AS raw_ex_vat_text,
  r.raw_vat_amount_text AS raw_vat_text,
  r.raw_total_amount_text AS raw_total_text,
  r.raw_signer_text AS raw_receipt_text,

  -- Parsed helper values
  r.parsed_business_date,
  r.parsed_ex_vat_amount,
  r.parsed_vat_amount,
  r.parsed_total_amount,
  r.parsed_receipt_state,
  r.parsed_payment_channel,
  r.helper_month_token,
  r.business_date_parse_status,
  r.ex_vat_parse_status,
  r.vat_parse_status,
  r.total_amount_parse_status,
  CASE
    WHEN nullif(btrim(r.raw_qty_text), '') IS NULL THEN 'blank_or_missing'
    WHEN btrim(r.raw_qty_text) ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN 'parsed_numeric'
    ELSE 'non_numeric_or_ambiguous'
  END AS qty_parse_status,
  r.receipt_parse_status,
  r.payment_channel_parse_status,

  -- Candidate values (strict, no fabrication)
  r.parsed_business_date AS business_date_candidate,
  'MHB'::text AS department_label_raw,
  coalesce(nullif(btrim(r.raw_product_type_text), ''), nullif(btrim(r.raw_product_text), '')) AS category_label_raw,
  CASE
    WHEN lower(nullif(btrim(r.raw_shift_text), '')) IN ('morning', 'am', 'mid', 'midshift') THEN 'midshift'
    WHEN lower(nullif(btrim(r.raw_shift_text), '')) IN ('afternoon', 'pm', 'end', 'endshift') THEN 'endshift'
    WHEN nullif(btrim(r.raw_shift_text), '') ~ '^[0-2]?[0-9]:[0-5][0-9](:[0-5][0-9])?$' THEN
      CASE
        WHEN split_part(nullif(btrim(r.raw_shift_text), ''), ':', 1)::int < 13 THEN 'midshift'
        ELSE 'endshift'
      END
    ELSE NULL::text
  END AS source_stage_candidate,
  NULL::text AS cost_nature_candidate,
  r.parsed_payment_channel AS payment_channel_candidate,
  r.parsed_receipt_state AS receipt_state_candidate,
  r.parsed_total_amount AS total_amount_candidate,
  r.parsed_ex_vat_amount AS ex_vat_amount_candidate,
  r.parsed_vat_amount AS vat_amount_candidate,
  NULL::text AS tax_code_candidate,

  -- Unresolved signals
  (r.parsed_business_date IS NULL) AS business_date_unresolved,
  (r.parsed_total_amount IS NULL AND r.parsed_ex_vat_amount IS NULL AND r.parsed_vat_amount IS NULL) AS amount_unresolved,
  (coalesce(nullif(btrim(r.raw_product_type_text), ''), nullif(btrim(r.raw_product_text), '')) IS NULL) AS label_unresolved,
  (nullif(btrim(r.raw_shift_text), '') IS NULL) AS shift_stage_unresolved,
  TRUE AS cost_nature_unresolved,
  (r.parsed_payment_channel IS NULL) AS payment_channel_unresolved,

  CASE
    WHEN r.parsed_total_amount IS NOT NULL AND r.parsed_business_date IS NOT NULL AND r.parsed_payment_channel IS NOT NULL THEN 0.75::numeric(4,2)
    WHEN r.parsed_total_amount IS NOT NULL THEN 0.55::numeric(4,2)
    WHEN r.parsed_ex_vat_amount IS NOT NULL OR r.parsed_vat_amount IS NOT NULL THEN 0.40::numeric(4,2)
    ELSE 0.20::numeric(4,2)
  END AS candidate_confidence_score,

  CASE
    WHEN r.parsed_total_amount IS NOT NULL AND r.parsed_business_date IS NOT NULL AND r.parsed_payment_channel IS NOT NULL THEN 'MEDIUM'
    WHEN r.parsed_total_amount IS NOT NULL THEN 'LOW'
    WHEN r.parsed_ex_vat_amount IS NOT NULL OR r.parsed_vat_amount IS NOT NULL THEN 'LOW'
    ELSE 'LOW'
  END AS candidate_confidence_level,

  trim(both ';' from concat_ws('; ',
    CASE WHEN r.parsed_business_date IS NULL THEN 'business_date unresolved from SELL row' END,
    CASE WHEN r.parsed_total_amount IS NULL THEN 'total_amount not safely parsed from SELL total column' END,
    CASE WHEN nullif(btrim(r.raw_shift_text), '') IS NULL THEN 'shift/time missing from SELL row (column B)' END,
    CASE WHEN coalesce(nullif(btrim(r.raw_product_type_text), ''), nullif(btrim(r.raw_product_text), '')) IS NULL THEN 'product/category missing' END,
    CASE WHEN r.parsed_payment_channel IS NULL THEN 'payment channel unresolved in SELL row' END,
    CASE WHEN r.parsed_receipt_state IS NULL THEN 'receipt state not available in SELL raw contract (back-burner)' END
  )) AS unresolved_notes,

  CASE
    WHEN r.parsed_total_amount IS NOT NULL AND r.parsed_business_date IS NOT NULL AND r.parsed_payment_channel IS NOT NULL AND r.parsed_receipt_state IS NOT NULL THEN 'READY_FOR_ENRICHMENT'
    WHEN r.parsed_total_amount IS NOT NULL THEN 'PARTIAL'
    ELSE 'UNRESOLVED'
  END AS candidate_load_status,

  CASE WHEN r.branch_code = 'EOSZ' THEN 1 ELSE 2 END AS source_priority_rank,
  (r.branch_code = 'EOSZ') AS is_primary_source_for_eosz,

  -- Keep payload for future refinement/debugging
  r.raw_payload_json
FROM v_eos_sell_lines_raw_v1 r;
