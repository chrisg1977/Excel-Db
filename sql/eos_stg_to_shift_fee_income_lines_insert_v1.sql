-- EOSQ strict staged -> fee/income canonical loader (v1)
-- Purpose:
--   Insert only safe EOSQ FEE transaction rows into eos_shift_fee_income_lines
--   with explicit reject-first behavior and raw source preservation.
--
-- Scope:
--   - EOSQ only
--   - source_family = 'FEE' only
--   - Uses v_eosq_fee_candidates_enriched_v1 as canonical staged source
--
-- Policy:
--   - fee_subtype_raw comes from column G mapping (category_label_raw)
--   - gross_amount comes from H (total_amount_candidate)
--   - vat_amount comes from J (vat_amount_candidate)
--   - ex_vat_amount derived conservatively only when safe
--   - commission_amount stays NULL in v1
--   - reject rows with 'Missing' literals in raw transaction fields
--
-- Run order:
--   1) sql/eos_stg_rejects_schema_v1.sql
--   2) sql/eos_shift_fee_income_lines_schema_v1.sql
--   3) sql/eos_shift_fee_income_source_details_schema_v1.sql
--   4) sql/eos_stg_to_shift_fee_income_lines_insert_v1.sql

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.eos_stg_rejects') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_stg_rejects (run sql/eos_stg_rejects_schema_v1.sql first)';
  END IF;

  IF to_regclass('public.eos_shift_header') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_shift_header';
  END IF;

  IF to_regclass('public.eos_shift_fee_income_lines') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_shift_fee_income_lines (run sql/eos_shift_fee_income_lines_schema_v1.sql first)';
  END IF;

  IF to_regclass('public.eos_shift_fee_income_source_details') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_shift_fee_income_source_details (run sql/eos_shift_fee_income_source_details_schema_v1.sql first)';
  END IF;

  IF to_regclass('public.v_eosq_fee_candidates_enriched_v1') IS NULL THEN
    RAISE EXCEPTION 'Missing required view: v_eosq_fee_candidates_enriched_v1';
  END IF;
END$$;

WITH base AS (
  SELECT
    c.raw_line_id AS candidate_id,
    c.branch_code,
    c.source_family,
    c.source_table_name,
    c._source_file,
    c._source_sheet,
    c._row_num,

    c.business_date_candidate_effective AS business_date_for_loading,
    c.source_stage_candidate_effective AS source_stage_for_loading,
    c.payment_channel_candidate_effective AS payment_channel_for_loading,
    c.receipt_state_candidate_effective AS receipt_state_for_loading,

    c.department_label_raw,
    c.raw_description_text AS description_raw,
    c.category_label_raw AS fee_subtype_raw,
    c.raw_reference_text AS detail_raw,
    c.raw_invoice_text AS booking_platform_raw,

    c.total_amount_candidate AS gross_amount_candidate,
    c.vat_amount_candidate,
    c.ex_vat_amount_candidate,
    c.tax_code_candidate,

    c.raw_business_date_text,
    c.raw_shift_text,
    c.raw_department_text,
    c.raw_description_text,
    c.raw_reference_text,
    c.raw_invoice_text,
    c.raw_type_text,
    c.raw_total_text,
    c.raw_vat_text,
    c.raw_receipt_text,
    c.raw_payment_channel_text,
    c.raw_assistant_text
  FROM v_eosq_fee_candidates_enriched_v1 c
),
prepared AS (
  SELECT
    b.*,
    CASE
      WHEN b.ex_vat_amount_candidate IS NOT NULL
        AND b.gross_amount_candidate IS NOT NULL
        AND b.ex_vat_amount_candidate >= 0
        AND b.ex_vat_amount_candidate <= b.gross_amount_candidate
        THEN b.ex_vat_amount_candidate::numeric(14,2)
      WHEN b.ex_vat_amount_candidate IS NULL
        AND b.gross_amount_candidate IS NOT NULL
        AND b.vat_amount_candidate IS NOT NULL
        AND b.gross_amount_candidate >= b.vat_amount_candidate
        THEN (b.gross_amount_candidate - b.vat_amount_candidate)::numeric(14,2)
      ELSE NULL::numeric(14,2)
    END AS ex_vat_amount_for_loading,

    (
      lower(coalesce(b.raw_business_date_text, '')) = 'missing'
      OR lower(coalesce(b.raw_shift_text, '')) = 'missing'
      OR lower(coalesce(b.raw_department_text, '')) = 'missing'
      OR lower(coalesce(b.raw_description_text, '')) = 'missing'
      OR lower(coalesce(b.raw_reference_text, '')) = 'missing'
      OR lower(coalesce(b.raw_invoice_text, '')) = 'missing'
      OR lower(coalesce(b.raw_type_text, '')) = 'missing'
      OR lower(coalesce(b.raw_total_text, '')) = 'missing'
      OR lower(coalesce(b.raw_vat_text, '')) = 'missing'
      OR lower(coalesce(b.raw_receipt_text, '')) = 'missing'
      OR lower(coalesce(b.raw_payment_channel_text, '')) = 'missing'
      OR lower(coalesce(b.raw_assistant_text, '')) = 'missing'
    ) AS has_missing_literal
  FROM base b
),
linked AS (
  SELECT
    p.*,
    h.id AS shift_header_id
  FROM prepared p
  LEFT JOIN eos_shift_header h
    ON h.branch_code = p.branch_code
   AND h.business_date = p.business_date_for_loading
),
classified AS (
  SELECT
    l.*,
    array_remove(ARRAY[
      CASE WHEN l.source_family <> 'FEE' THEN 'source_family_not_fee' END,
      CASE WHEN l.branch_code <> 'EOSQ' THEN 'branch_not_eosq' END,
      CASE WHEN l.business_date_for_loading IS NULL THEN 'business_date_unresolved' END,
      CASE WHEN l.shift_header_id IS NULL THEN 'shift_header_missing' END,

      CASE WHEN l.source_stage_for_loading IS NULL THEN 'source_stage_unresolved' END,
      CASE WHEN l.source_stage_for_loading IS NOT NULL AND l.source_stage_for_loading NOT IN ('midshift', 'endshift') THEN 'source_stage_out_of_domain' END,

      CASE WHEN l.payment_channel_for_loading IS NULL THEN 'payment_channel_unresolved' END,
      CASE WHEN l.payment_channel_for_loading IS NOT NULL AND l.payment_channel_for_loading NOT IN ('cash', 'non_cash') THEN 'payment_channel_out_of_domain' END,

      CASE WHEN l.receipt_state_for_loading IS NULL THEN 'receipt_state_unresolved' END,
      CASE WHEN l.receipt_state_for_loading IS NOT NULL AND l.receipt_state_for_loading NOT IN ('with_receipt', 'no_receipt') THEN 'receipt_state_out_of_domain' END,

      CASE WHEN nullif(btrim(coalesce(l.department_label_raw, '')), '') IS NULL THEN 'department_unresolved' END,
      CASE WHEN nullif(btrim(coalesce(l.description_raw, '')), '') IS NULL THEN 'description_unresolved' END,
      CASE WHEN nullif(btrim(coalesce(l.fee_subtype_raw, '')), '') IS NULL THEN 'fee_subtype_unresolved' END,

      CASE WHEN l.gross_amount_candidate IS NULL THEN 'gross_amount_unresolved' END,
      CASE WHEN l.gross_amount_candidate IS NOT NULL AND l.gross_amount_candidate < 0 THEN 'gross_amount_negative' END,
      CASE WHEN l.vat_amount_candidate IS NOT NULL AND l.gross_amount_candidate IS NOT NULL AND l.vat_amount_candidate > l.gross_amount_candidate THEN 'vat_greater_than_gross' END,

      CASE WHEN l.has_missing_literal THEN 'raw_missing_literal' END
    ], NULL::text) AS reject_reasons
  FROM linked l
),
rejected AS (
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
    'eos_stg_to_shift_fee_income_lines_insert_v1' AS loader_name,
    c.candidate_id,
    c.branch_code,
    c.source_table_name,
    c.source_family,
    c._source_file,
    c._source_sheet,
    c._row_num,
    'STRICT_FEE_CANONICAL' AS classification_status,
    CASE WHEN cardinality(c.reject_reasons) > 0 THEN c.reject_reasons[1] ELSE NULL END AS unresolved_reason,
    c.reject_reasons,
    jsonb_build_object(
      'business_date_for_loading', c.business_date_for_loading,
      'source_stage_for_loading', c.source_stage_for_loading,
      'payment_channel_for_loading', c.payment_channel_for_loading,
      'receipt_state_for_loading', c.receipt_state_for_loading,
      'department_label_raw', c.department_label_raw,
      'description_raw', c.description_raw,
      'fee_subtype_raw', c.fee_subtype_raw,
      'detail_raw', c.detail_raw,
      'booking_platform_raw', c.booking_platform_raw,
      'gross_amount_candidate', c.gross_amount_candidate,
      'vat_amount_candidate', c.vat_amount_candidate,
      'ex_vat_amount_candidate', c.ex_vat_amount_candidate,
      'ex_vat_amount_for_loading', c.ex_vat_amount_for_loading,
      'has_missing_literal', c.has_missing_literal,
      'rule', 'strict_eosq_fee_income_acceptance_v1'
    ) AS reject_context,
    now()
  FROM classified c
  WHERE cardinality(c.reject_reasons) > 0
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
),
cleared_rejects AS (
  DELETE FROM eos_stg_rejects r
  USING classified c
  WHERE r.loader_name = 'eos_stg_to_shift_fee_income_lines_insert_v1'
    AND r.candidate_id = c.candidate_id
    AND cardinality(c.reject_reasons) = 0
  RETURNING 1
),
accepted AS (
  SELECT
    c.candidate_id AS source_candidate_id,
    c.shift_header_id,
    c.department_label_raw,
    c.description_raw,
    c.fee_subtype_raw,
    c.detail_raw,
    c.booking_platform_raw,
    c.source_stage_for_loading AS source_stage,
    c.payment_channel_for_loading AS payment_channel,
    c.receipt_state_for_loading AS receipt_state,
    c.gross_amount_candidate::numeric(14,2) AS gross_amount,
    c.vat_amount_candidate::numeric(14,2) AS vat_amount,
    c.ex_vat_amount_for_loading::numeric(14,2) AS ex_vat_amount,
    NULL::numeric(14,2) AS commission_amount,
    c.tax_code_candidate AS tax_code,

    c.source_table_name,
    c.source_family,
    c._source_file,
    c._source_sheet,
    c._row_num,
    c.raw_business_date_text,
    c.raw_shift_text,
    c.raw_department_text,
    c.raw_description_text,
    c.raw_reference_text,
    c.raw_invoice_text,
    c.raw_type_text,
    c.raw_total_text,
    c.raw_vat_text,
    c.raw_receipt_text,
    c.raw_payment_channel_text,
    c.raw_assistant_text
  FROM classified c
  WHERE cardinality(c.reject_reasons) = 0
),
inserted_lines AS (
  INSERT INTO eos_shift_fee_income_lines (
    source_candidate_id,
    shift_header_id,
    department_label_raw,
    description_raw,
    fee_subtype_raw,
    detail_raw,
    booking_platform_raw,
    source_stage,
    payment_channel,
    receipt_state,
    gross_amount,
    vat_amount,
    ex_vat_amount,
    commission_amount,
    tax_code
  )
  SELECT
    a.source_candidate_id,
    a.shift_header_id,
    a.department_label_raw,
    a.description_raw,
    a.fee_subtype_raw,
    a.detail_raw,
    a.booking_platform_raw,
    a.source_stage,
    a.payment_channel,
    a.receipt_state,
    a.gross_amount,
    a.vat_amount,
    a.ex_vat_amount,
    a.commission_amount,
    a.tax_code
  FROM accepted a
  WHERE NOT EXISTS (
    SELECT 1
    FROM eos_shift_fee_income_lines l
    WHERE l.source_candidate_id = a.source_candidate_id
  )
  RETURNING id, source_candidate_id
)
INSERT INTO eos_shift_fee_income_source_details (
  shift_fee_income_line_id,
  source_candidate_id,
  source_table_name,
  source_family,
  source_file,
  source_sheet,
  source_row_num,
  raw_a_transaction_date_text,
  raw_b_shift_text,
  raw_c_department_text,
  raw_d_description_text,
  raw_e_detail_text,
  raw_f_booking_platform_text,
  raw_g_fee_subtype_text,
  raw_h_gross_amount_text,
  raw_i_vat_percentage_text,
  raw_j_vat_amount_text,
  raw_k_receipt_issued_text,
  raw_l_payment_method_text,
  raw_n_user_signing_text,
  updated_at
)
SELECT
  i.id,
  a.source_candidate_id,
  a.source_table_name,
  a.source_family,
  a._source_file,
  a._source_sheet,
  a._row_num,
  a.raw_business_date_text,
  a.raw_shift_text,
  a.raw_department_text,
  a.raw_description_text,
  a.raw_reference_text,
  a.raw_invoice_text,
  a.raw_type_text,
  a.raw_total_text,
  NULL::text,
  a.raw_vat_text,
  a.raw_receipt_text,
  a.raw_payment_channel_text,
  a.raw_assistant_text,
  now()
FROM inserted_lines i
JOIN accepted a
  ON a.source_candidate_id = i.source_candidate_id
ON CONFLICT (source_candidate_id) DO UPDATE
SET
  shift_fee_income_line_id = EXCLUDED.shift_fee_income_line_id,
  source_table_name = EXCLUDED.source_table_name,
  source_family = EXCLUDED.source_family,
  source_file = EXCLUDED.source_file,
  source_sheet = EXCLUDED.source_sheet,
  source_row_num = EXCLUDED.source_row_num,
  raw_a_transaction_date_text = EXCLUDED.raw_a_transaction_date_text,
  raw_b_shift_text = EXCLUDED.raw_b_shift_text,
  raw_c_department_text = EXCLUDED.raw_c_department_text,
  raw_d_description_text = EXCLUDED.raw_d_description_text,
  raw_e_detail_text = EXCLUDED.raw_e_detail_text,
  raw_f_booking_platform_text = EXCLUDED.raw_f_booking_platform_text,
  raw_g_fee_subtype_text = EXCLUDED.raw_g_fee_subtype_text,
  raw_h_gross_amount_text = EXCLUDED.raw_h_gross_amount_text,
  raw_i_vat_percentage_text = EXCLUDED.raw_i_vat_percentage_text,
  raw_j_vat_amount_text = EXCLUDED.raw_j_vat_amount_text,
  raw_k_receipt_issued_text = EXCLUDED.raw_k_receipt_issued_text,
  raw_l_payment_method_text = EXCLUDED.raw_l_payment_method_text,
  raw_n_user_signing_text = EXCLUDED.raw_n_user_signing_text,
  updated_at = now();

COMMIT;
