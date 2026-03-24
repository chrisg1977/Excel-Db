-- EOS PRODUCTLIST candidate view (v1)
-- Purpose:
--   Map PRODUCTLIST A:O into canonical product foundation candidates with
--   strict parse statuses and unresolved reasons.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/v_eos_productlist_candidates_v1.sql

DROP VIEW IF EXISTS v_eos_productlist_candidates_v1;

CREATE VIEW v_eos_productlist_candidates_v1 AS
WITH base AS (
  SELECT
    r.branch_code,
    r.source_table_name,
    r._source_file,
    r._source_sheet,
    r._row_num,
    r.raw_line_id,

    r.raw_a_date_text,
    r.raw_b_barcode_text,
    r.raw_c_product_name_text,
    r.raw_d_size_text,
    r.raw_e_type_text,
    r.raw_f_expires_text,
    r.raw_g_supplier_text,
    r.raw_h_cost_ex_vat_text,
    r.raw_i_cost_vat_rate_text,
    r.raw_j_cost_inc_vat_text,
    r.raw_k_retail_ex_vat_text,
    r.raw_l_retail_vat_pct_text,
    r.raw_m_vat_amount_text,
    r.raw_n_unit_selling_text,
    r.raw_o_destination_text,
    coalesce(
      nullif(btrim(r.raw_payload_json ->> 'distributor_barcode'), ''),
      nullif(btrim(r.raw_payload_json ->> 'secondary_barcode'), ''),
      nullif(btrim(r.raw_payload_json ->> 'barcode_2'), '')
    ) AS raw_secondary_barcode_text,
    r.raw_payload_json
  FROM v_eos_productlist_raw_v1 r
), parsed AS (
  SELECT
    b.*,

    CASE
      WHEN nullif(btrim(coalesce(b.raw_a_date_text, '')), '') IS NULL THEN NULL::date
      WHEN btrim(b.raw_a_date_text) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN btrim(b.raw_a_date_text)::date
      WHEN btrim(b.raw_a_date_text) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T].*$' THEN left(btrim(b.raw_a_date_text), 10)::date
      ELSE NULL::date
    END AS effective_date_candidate,

    CASE
      WHEN nullif(btrim(coalesce(b.raw_b_barcode_text, '')), '') IS NULL THEN NULL::text
      WHEN btrim(b.raw_b_barcode_text) ~ '^[0-9]+$' THEN btrim(b.raw_b_barcode_text)
      ELSE NULL::text
    END AS barcode_candidate,

    CASE
      WHEN nullif(btrim(coalesce(b.raw_b_barcode_text, '')), '') IS NULL THEN NULL::text
      ELSE lower(regexp_replace(btrim(b.raw_b_barcode_text), '[[:space:]]+', '', 'g'))
    END AS barcode_identity_norm_candidate,

    CASE
      WHEN nullif(btrim(coalesce(b.raw_b_barcode_text, '')), '') IS NULL THEN NULL::text
      WHEN btrim(b.raw_b_barcode_text) ~ '^[0-9]+$' THEN 'barcode'
      ELSE 'special_identity'
    END AS barcode_identity_type_candidate,

    CASE
      WHEN nullif(btrim(coalesce(b.raw_secondary_barcode_text, '')), '') IS NULL THEN NULL::text
      ELSE btrim(b.raw_secondary_barcode_text)
    END AS secondary_barcode_candidate,

    CASE
      WHEN nullif(btrim(coalesce(b.raw_secondary_barcode_text, '')), '') IS NULL THEN NULL::text
      ELSE lower(regexp_replace(btrim(b.raw_secondary_barcode_text), '[[:space:]]+', '', 'g'))
    END AS secondary_barcode_norm_candidate,

    CASE
      WHEN nullif(btrim(coalesce(b.raw_f_expires_text, '')), '') IS NULL THEN NULL::boolean
      WHEN lower(btrim(b.raw_f_expires_text)) IN ('y', 'yes', 'true', '1') THEN TRUE
      WHEN lower(btrim(b.raw_f_expires_text)) IN ('n', 'no', 'false', '0') THEN FALSE
      ELSE NULL::boolean
    END AS expires_flag_candidate,

    CASE
      WHEN nullif(btrim(coalesce(b.raw_o_destination_text, '')), '') IS NULL THEN NULL::text
      WHEN lower(btrim(b.raw_o_destination_text)) = 'sale' THEN 'sale'
      WHEN lower(btrim(b.raw_o_destination_text)) = 'service' THEN 'service'
      ELSE NULL::text
    END AS destination_mode_candidate,

    CASE
      WHEN nullif(btrim(coalesce(b.raw_h_cost_ex_vat_text, '')), '') IS NULL
        AND b._row_num <> 152 THEN 0::numeric(14,4)
      WHEN nullif(btrim(coalesce(b.raw_h_cost_ex_vat_text, '')), '') IS NULL THEN NULL::numeric(14,4)
      WHEN btrim(b.raw_h_cost_ex_vat_text) ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN btrim(b.raw_h_cost_ex_vat_text)::numeric(14,4)
      ELSE NULL::numeric(14,4)
    END AS cost_ex_vat_candidate,

    CASE
      WHEN nullif(btrim(coalesce(b.raw_i_cost_vat_rate_text, '')), '') IS NULL THEN NULL::numeric(7,4)
      WHEN replace(btrim(b.raw_i_cost_vat_rate_text), '%', '') ~ '^[+-]?[0-9]+([.][0-9]+)?$'
        THEN replace(btrim(b.raw_i_cost_vat_rate_text), '%', '')::numeric(7,4)
      ELSE NULL::numeric(7,4)
    END AS cost_vat_rate_pct_candidate,

    CASE
      WHEN nullif(btrim(coalesce(b.raw_j_cost_inc_vat_text, '')), '') IS NULL THEN NULL::numeric(14,4)
      WHEN btrim(b.raw_j_cost_inc_vat_text) ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN btrim(b.raw_j_cost_inc_vat_text)::numeric(14,4)
      ELSE NULL::numeric(14,4)
    END AS cost_inc_vat_candidate,

    CASE
      WHEN nullif(btrim(coalesce(b.raw_k_retail_ex_vat_text, '')), '') IS NULL THEN NULL::numeric(14,4)
      WHEN btrim(b.raw_k_retail_ex_vat_text) ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN btrim(b.raw_k_retail_ex_vat_text)::numeric(14,4)
      ELSE NULL::numeric(14,4)
    END AS retail_ex_vat_candidate,

    CASE
      WHEN nullif(btrim(coalesce(b.raw_l_retail_vat_pct_text, '')), '') IS NULL THEN NULL::numeric(7,4)
      WHEN replace(btrim(b.raw_l_retail_vat_pct_text), '%', '') ~ '^[+-]?[0-9]+([.][0-9]+)?$'
        THEN replace(btrim(b.raw_l_retail_vat_pct_text), '%', '')::numeric(7,4)
      ELSE NULL::numeric(7,4)
    END AS retail_vat_rate_pct_candidate,

    CASE
      WHEN nullif(btrim(coalesce(b.raw_m_vat_amount_text, '')), '') IS NULL THEN NULL::numeric(14,4)
      WHEN btrim(b.raw_m_vat_amount_text) ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN btrim(b.raw_m_vat_amount_text)::numeric(14,4)
      ELSE NULL::numeric(14,4)
    END AS retail_vat_amount_candidate,

    CASE
      WHEN nullif(btrim(coalesce(b.raw_n_unit_selling_text, '')), '') IS NULL THEN NULL::numeric(14,4)
      WHEN btrim(b.raw_n_unit_selling_text) ~ '^[+-]?[0-9]+([.][0-9]+)?$' THEN btrim(b.raw_n_unit_selling_text)::numeric(14,4)
      ELSE NULL::numeric(14,4)
    END AS unit_selling_price_candidate
  FROM base b
), matched AS (
  SELECT
    p.*,
    m.active_match_count,
    m.product_ids
  FROM parsed p
  LEFT JOIN LATERAL (
    SELECT
      count(DISTINCT i.product_id)::int AS active_match_count,
      array_agg(DISTINCT i.product_id) AS product_ids
    FROM eos_product_identity i
    WHERE i.identity_type IN ('barcode', 'legacy_barcode', 'eco_code', 'distributor_barcode', 'special_identity')
      AND i.effective_to IS NULL
      AND i.identity_value_norm = coalesce(p.barcode_identity_norm_candidate, '')
  ) m ON TRUE
)
SELECT
  m.branch_code,
  'PRODUCTLIST'::text AS source_family,
  m.source_table_name,
  m._source_file,
  m._source_sheet,
  m._row_num,
  m.raw_line_id AS candidate_id,

  -- Raw A:O payload preservation.
  m.raw_a_date_text,
  m.raw_b_barcode_text,
  m.raw_c_product_name_text,
  m.raw_d_size_text,
  m.raw_e_type_text,
  m.raw_f_expires_text,
  m.raw_g_supplier_text,
  m.raw_h_cost_ex_vat_text,
  m.raw_i_cost_vat_rate_text,
  m.raw_j_cost_inc_vat_text,
  m.raw_k_retail_ex_vat_text,
  m.raw_l_retail_vat_pct_text,
  m.raw_m_vat_amount_text,
  m.raw_n_unit_selling_text,
  m.raw_o_destination_text,
  m.raw_secondary_barcode_text,

  -- Canonical mapping candidates.
  m.effective_date_candidate,
  nullif(btrim(m.raw_c_product_name_text), '') AS product_name_candidate,
  nullif(btrim(m.raw_d_size_text), '') AS size_label_candidate,
  nullif(btrim(m.raw_e_type_text), '') AS product_type_candidate,
  m.expires_flag_candidate,
  nullif(btrim(m.raw_g_supplier_text), '') AS supplier_label_raw_candidate,
  m.destination_mode_candidate,

  m.barcode_candidate,
  m.barcode_identity_type_candidate,
  m.secondary_barcode_candidate,
  CASE
    WHEN m.barcode_identity_norm_candidate IS NULL THEN NULL::text
    ELSE m.barcode_identity_norm_candidate
  END AS barcode_norm_candidate,
  m.secondary_barcode_norm_candidate,

  m.cost_ex_vat_candidate,
  m.cost_vat_rate_pct_candidate,
  m.cost_inc_vat_candidate,
  m.retail_ex_vat_candidate,
  m.retail_vat_rate_pct_candidate,
  m.retail_vat_amount_candidate,
  m.unit_selling_price_candidate,

  -- Parse statuses.
  CASE
    WHEN nullif(btrim(coalesce(m.raw_a_date_text, '')), '') IS NULL THEN 'blank_or_missing'
    WHEN m.effective_date_candidate IS NOT NULL THEN 'parsed_date'
    ELSE 'invalid_date'
  END AS effective_date_parse_status,

  CASE
    WHEN nullif(btrim(coalesce(m.raw_b_barcode_text, '')), '') IS NULL THEN 'blank_or_missing'
    WHEN m.barcode_candidate IS NOT NULL THEN 'parsed_digits'
    WHEN m.barcode_identity_norm_candidate IS NOT NULL THEN 'parsed_special_identity'
    ELSE 'invalid_non_digit'
  END AS barcode_parse_status,

  CASE
    WHEN nullif(btrim(coalesce(m.raw_secondary_barcode_text, '')), '') IS NULL THEN 'blank_or_missing'
    WHEN m.secondary_barcode_norm_candidate IS NOT NULL THEN 'parsed_secondary_identity'
    ELSE 'invalid_secondary_barcode'
  END AS secondary_barcode_parse_status,

  CASE
    WHEN nullif(btrim(coalesce(m.raw_f_expires_text, '')), '') IS NULL THEN 'blank_or_missing'
    WHEN m.expires_flag_candidate IS NOT NULL THEN 'parsed_yes_no'
    ELSE 'unresolved_value'
  END AS expires_parse_status,

  CASE
    WHEN nullif(btrim(coalesce(m.raw_o_destination_text, '')), '') IS NULL THEN 'blank_or_missing'
    WHEN m.destination_mode_candidate IS NOT NULL THEN 'parsed_strict'
    ELSE 'invalid_destination'
  END AS destination_parse_status,

  CASE
    WHEN nullif(btrim(coalesce(m.raw_h_cost_ex_vat_text, '')), '') IS NULL AND m._row_num <> 152 THEN 'imputed_free_of_charge_zero'
    WHEN nullif(btrim(coalesce(m.raw_h_cost_ex_vat_text, '')), '') IS NULL THEN 'blank_or_missing'
    WHEN m.cost_ex_vat_candidate IS NOT NULL THEN 'parsed_numeric'
    ELSE 'invalid_numeric'
  END AS cost_ex_vat_parse_status,

  CASE
    WHEN nullif(btrim(coalesce(m.raw_i_cost_vat_rate_text, '')), '') IS NULL THEN 'blank_or_missing'
    WHEN m.cost_vat_rate_pct_candidate IS NOT NULL THEN 'parsed_numeric'
    ELSE 'invalid_numeric'
  END AS cost_vat_rate_parse_status,

  CASE
    WHEN nullif(btrim(coalesce(m.raw_j_cost_inc_vat_text, '')), '') IS NULL THEN 'blank_or_missing'
    WHEN m.cost_inc_vat_candidate IS NOT NULL THEN 'parsed_numeric'
    ELSE 'invalid_numeric'
  END AS cost_inc_vat_parse_status,

  CASE
    WHEN nullif(btrim(coalesce(m.raw_k_retail_ex_vat_text, '')), '') IS NULL THEN 'blank_or_missing'
    WHEN m.retail_ex_vat_candidate IS NOT NULL THEN 'parsed_numeric'
    ELSE 'invalid_numeric'
  END AS retail_ex_vat_parse_status,

  CASE
    WHEN nullif(btrim(coalesce(m.raw_l_retail_vat_pct_text, '')), '') IS NULL THEN 'blank_or_missing'
    WHEN m.retail_vat_rate_pct_candidate IS NOT NULL THEN 'parsed_numeric'
    ELSE 'invalid_numeric'
  END AS retail_vat_rate_parse_status,

  CASE
    WHEN nullif(btrim(coalesce(m.raw_m_vat_amount_text, '')), '') IS NULL THEN 'blank_or_missing'
    WHEN m.retail_vat_amount_candidate IS NOT NULL THEN 'parsed_numeric'
    ELSE 'invalid_numeric'
  END AS retail_vat_amount_parse_status,

  CASE
    WHEN nullif(btrim(coalesce(m.raw_n_unit_selling_text, '')), '') IS NULL THEN 'blank_or_missing'
    WHEN m.unit_selling_price_candidate IS NOT NULL THEN 'parsed_numeric'
    ELSE 'invalid_numeric'
  END AS unit_selling_parse_status,

  -- Match preclassification (no auto-merge).
  CASE
    WHEN m.barcode_identity_norm_candidate IS NULL THEN 'invalid_barcode'
    WHEN coalesce(m.active_match_count, 0) = 0 THEN 'new_product_root_candidate'
    WHEN m.active_match_count = 1 THEN 'existing_identity_match'
    ELSE 'ambiguous_identity'
  END AS match_preclassification,
  coalesce(m.active_match_count, 0) AS active_identity_match_count,
  m.product_ids AS matched_product_ids,

  (
    m.cost_ex_vat_candidate IS NOT NULL
    AND m.cost_vat_rate_pct_candidate IS NOT NULL
    AND m.cost_inc_vat_candidate IS NOT NULL
    AND m.retail_ex_vat_candidate IS NOT NULL
    AND m.retail_vat_rate_pct_candidate IS NOT NULL
    AND m.retail_vat_amount_candidate IS NOT NULL
    AND m.unit_selling_price_candidate IS NOT NULL
    AND m.cost_ex_vat_candidate >= 0
    AND m.cost_inc_vat_candidate >= 0
    AND m.retail_ex_vat_candidate >= 0
    AND m.retail_vat_amount_candidate >= 0
    AND m.unit_selling_price_candidate >= 0
    AND m.cost_vat_rate_pct_candidate BETWEEN 0 AND 100
    AND m.retail_vat_rate_pct_candidate BETWEEN 0 AND 100
    AND m.cost_inc_vat_candidate >= m.cost_ex_vat_candidate
    AND m.unit_selling_price_candidate >= m.retail_ex_vat_candidate
    AND m.retail_vat_amount_candidate <= m.unit_selling_price_candidate
  ) AS pricing_valid,

  array_remove(ARRAY[
    CASE WHEN m.effective_date_candidate IS NULL THEN 'invalid_date' END,
    CASE WHEN m.barcode_identity_norm_candidate IS NULL THEN 'invalid_barcode' END,
    CASE WHEN m.destination_mode_candidate IS NULL THEN 'invalid_destination' END,
    CASE
      WHEN (
        m.cost_ex_vat_candidate IS NULL
        OR m.cost_vat_rate_pct_candidate IS NULL
        OR m.cost_inc_vat_candidate IS NULL
        OR m.retail_ex_vat_candidate IS NULL
        OR m.retail_vat_rate_pct_candidate IS NULL
        OR m.retail_vat_amount_candidate IS NULL
        OR m.unit_selling_price_candidate IS NULL
        OR m.cost_ex_vat_candidate < 0
        OR m.cost_inc_vat_candidate < 0
        OR m.retail_ex_vat_candidate < 0
        OR m.retail_vat_amount_candidate < 0
        OR m.unit_selling_price_candidate < 0
        OR m.cost_vat_rate_pct_candidate NOT BETWEEN 0 AND 100
        OR m.retail_vat_rate_pct_candidate NOT BETWEEN 0 AND 100
        OR m.cost_inc_vat_candidate < m.cost_ex_vat_candidate
        OR m.unit_selling_price_candidate < m.retail_ex_vat_candidate
        OR m.retail_vat_amount_candidate > m.unit_selling_price_candidate
      )
      THEN 'invalid_pricing'
    END,
    CASE
      WHEN (
        nullif(btrim(coalesce(m.raw_a_date_text, '')), '') IS NULL
        OR nullif(btrim(coalesce(m.raw_b_barcode_text, '')), '') IS NULL
        OR nullif(btrim(coalesce(m.raw_c_product_name_text, '')), '') IS NULL
        OR nullif(btrim(coalesce(m.raw_f_expires_text, '')), '') IS NULL
        OR nullif(btrim(coalesce(m.raw_o_destination_text, '')), '') IS NULL
        OR (nullif(btrim(coalesce(m.raw_h_cost_ex_vat_text, '')), '') IS NULL AND m._row_num = 152)
        OR nullif(btrim(coalesce(m.raw_i_cost_vat_rate_text, '')), '') IS NULL
        OR nullif(btrim(coalesce(m.raw_j_cost_inc_vat_text, '')), '') IS NULL
        OR nullif(btrim(coalesce(m.raw_k_retail_ex_vat_text, '')), '') IS NULL
        OR nullif(btrim(coalesce(m.raw_l_retail_vat_pct_text, '')), '') IS NULL
        OR nullif(btrim(coalesce(m.raw_m_vat_amount_text, '')), '') IS NULL
        OR nullif(btrim(coalesce(m.raw_n_unit_selling_text, '')), '') IS NULL
      )
      THEN 'missing_required_fields'
    END,
    CASE WHEN coalesce(m.active_match_count, 0) > 1 THEN 'ambiguous_identity' END
  ], NULL::text) AS reject_reasons,

  (
    m.effective_date_candidate IS NOT NULL
    AND m.barcode_identity_norm_candidate IS NOT NULL
    AND nullif(btrim(coalesce(m.raw_c_product_name_text, '')), '') IS NOT NULL
    AND m.expires_flag_candidate IS NOT NULL
    AND m.destination_mode_candidate IS NOT NULL
    AND (
      m.cost_ex_vat_candidate IS NOT NULL
      AND m.cost_vat_rate_pct_candidate IS NOT NULL
      AND m.cost_inc_vat_candidate IS NOT NULL
      AND m.retail_ex_vat_candidate IS NOT NULL
      AND m.retail_vat_rate_pct_candidate IS NOT NULL
      AND m.retail_vat_amount_candidate IS NOT NULL
      AND m.unit_selling_price_candidate IS NOT NULL
      AND m.cost_ex_vat_candidate >= 0
      AND m.cost_inc_vat_candidate >= 0
      AND m.retail_ex_vat_candidate >= 0
      AND m.retail_vat_amount_candidate >= 0
      AND m.unit_selling_price_candidate >= 0
      AND m.cost_vat_rate_pct_candidate BETWEEN 0 AND 100
      AND m.retail_vat_rate_pct_candidate BETWEEN 0 AND 100
      AND m.cost_inc_vat_candidate >= m.cost_ex_vat_candidate
      AND m.unit_selling_price_candidate >= m.retail_ex_vat_candidate
      AND m.retail_vat_amount_candidate <= m.unit_selling_price_candidate
    )
    AND coalesce(m.active_match_count, 0) <= 1
  ) AS deterministic_ready,

  m.raw_payload_json
FROM matched m;
