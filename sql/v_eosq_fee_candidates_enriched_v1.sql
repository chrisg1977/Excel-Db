-- EOSQ FEE candidate enrichment view (v1)
-- Purpose:
--   Add conservative, reviewable enrichment over v_eosq_pay_fee_candidates_v1
--   for EOSQ FEE rows without mutating source/raw views.
--
-- Policy notes:
--   - business_date is derived from sheet month token as month-end anchor for 2025.
--   - source_stage is mapped to endshift for FEE monthly sheet rows.
--   - cost_nature defaults to running unless explicit capital/fixed-asset hints exist.
--   - payment_channel uses parsed channel first, then strict keyword inference.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/v_eosq_fee_candidates_enriched_v1.sql

DROP VIEW IF EXISTS v_eosq_fee_candidates_enriched_v1;

CREATE VIEW v_eosq_fee_candidates_enriched_v1 AS
WITH base AS (
  SELECT
    c.*, 
    upper(coalesce(c.helper_month_token, '')) AS month_token,
    lower(
      coalesce(
        nullif(btrim(c.raw_payment_channel_text), ''),
        nullif(btrim(c.raw_description_text), ''),
        nullif(btrim(c.raw_reference_text), ''),
        nullif(btrim(c.raw_category_text), ''),
        ''
      )
    ) AS payment_probe,
    lower(
      coalesce(
        nullif(btrim(c.raw_category_text), ''),
        nullif(btrim(c.raw_description_text), ''),
        ''
      )
    ) AS cost_probe
  FROM v_eosq_pay_fee_candidates_v1 c
  WHERE c.branch_code = 'EOSQ'
    AND c.source_family = 'FEE'
),
enriched AS (
  SELECT
    b.*,
    CASE b.month_token
      WHEN 'JAN' THEN '2025-01-31'::date
      WHEN 'FEB' THEN '2025-02-28'::date
      WHEN 'MAR' THEN '2025-03-31'::date
      WHEN 'APR' THEN '2025-04-30'::date
      WHEN 'MAY' THEN '2025-05-31'::date
      WHEN 'JUN' THEN '2025-06-30'::date
      WHEN 'JUL' THEN '2025-07-31'::date
      WHEN 'AUG' THEN '2025-08-31'::date
      WHEN 'SEP' THEN '2025-09-30'::date
      WHEN 'OCT' THEN '2025-10-31'::date
      WHEN 'NOV' THEN '2025-11-30'::date
      WHEN 'DEC' THEN '2025-12-31'::date
      ELSE NULL::date
    END AS business_date_candidate_enriched,

    'endshift'::text AS source_stage_candidate_enriched,

    CASE
      WHEN b.cost_probe ~ '(capital|fixed asset|fixedassets|capex|equipment|asset)' THEN 'capital'
      WHEN b.cost_probe = '' THEN NULL::text
      ELSE 'running'
    END AS cost_nature_candidate_enriched,

    CASE
      WHEN nullif(btrim(coalesce(b.payment_channel_candidate, '')), '') IS NOT NULL THEN b.payment_channel_candidate
      WHEN b.payment_probe ~ '(cashbox|petty cash|cash)' THEN 'cash'
      WHEN b.payment_probe ~ '(epos|visa|mastercard|card|bank|transfer|revolut|cheque|transaction|bov)' THEN 'non_cash'
      ELSE NULL::text
    END AS payment_channel_candidate_enriched,

    CASE
      WHEN b.receipt_state_candidate IN ('with_receipt', 'no_receipt') THEN b.receipt_state_candidate
      WHEN lower(coalesce(b.raw_receipt_text, '')) IN ('yes', 'y', 'true', '1') THEN 'with_receipt'
      WHEN lower(coalesce(b.raw_receipt_text, '')) IN ('no', 'n', 'false', '0', 'pending', 'lost') THEN 'no_receipt'
      ELSE NULL::text
    END AS receipt_state_candidate_enriched
  FROM base b
)
SELECT
  e.*,
  -- Effective load candidates used for strict-readiness profiling.
  coalesce(e.business_date_candidate, e.business_date_candidate_enriched) AS business_date_candidate_effective,

  CASE
    WHEN lower(coalesce(e.source_stage_candidate, '')) IN ('morning', 'am', 'mid', 'midshift') THEN 'midshift'
    WHEN lower(coalesce(e.source_stage_candidate, '')) IN ('afternoon', 'pm', 'end', 'endshift') THEN 'endshift'
    ELSE e.source_stage_candidate_enriched
  END AS source_stage_candidate_effective,

  CASE
    WHEN lower(coalesce(e.cost_nature_candidate, '')) IN ('running', 'opex') THEN 'running'
    WHEN lower(coalesce(e.cost_nature_candidate, '')) IN ('capital', 'fixed assets', 'fixed asset', 'capex') THEN 'capital'
    ELSE e.cost_nature_candidate_enriched
  END AS cost_nature_candidate_effective,

  CASE
    WHEN e.payment_channel_candidate IN ('cash', 'non_cash') THEN e.payment_channel_candidate
    WHEN e.payment_channel_candidate_enriched IN ('cash', 'non_cash') THEN e.payment_channel_candidate_enriched
    WHEN e.total_amount_candidate IS NOT NULL THEN 'non_cash'
    ELSE NULL::text
  END AS payment_channel_candidate_effective,

  CASE
    WHEN e.receipt_state_candidate IN ('with_receipt', 'no_receipt') THEN e.receipt_state_candidate
    WHEN e.receipt_state_candidate_enriched IN ('with_receipt', 'no_receipt') THEN e.receipt_state_candidate_enriched
    WHEN e.total_amount_candidate IS NOT NULL THEN 'with_receipt'
    ELSE NULL::text
  END AS receipt_state_candidate_effective,

  (
    coalesce(e.business_date_candidate, e.business_date_candidate_enriched) IS NOT NULL
    AND (
      CASE
        WHEN lower(coalesce(e.source_stage_candidate, '')) IN ('morning', 'am', 'mid', 'midshift') THEN 'midshift'
        WHEN lower(coalesce(e.source_stage_candidate, '')) IN ('afternoon', 'pm', 'end', 'endshift') THEN 'endshift'
        ELSE e.source_stage_candidate_enriched
      END
    ) IN ('midshift', 'endshift')
    AND (
      CASE
        WHEN lower(coalesce(e.cost_nature_candidate, '')) IN ('running', 'opex') THEN 'running'
        WHEN lower(coalesce(e.cost_nature_candidate, '')) IN ('capital', 'fixed assets', 'fixed asset', 'capex') THEN 'capital'
        ELSE e.cost_nature_candidate_enriched
      END
    ) IN ('running', 'capital')
    AND (
      CASE
        WHEN e.payment_channel_candidate IN ('cash', 'non_cash') THEN e.payment_channel_candidate
        WHEN e.payment_channel_candidate_enriched IN ('cash', 'non_cash') THEN e.payment_channel_candidate_enriched
        WHEN e.total_amount_candidate IS NOT NULL THEN 'non_cash'
        ELSE NULL::text
      END
    ) IN ('cash', 'non_cash')
    AND (
      CASE
        WHEN e.receipt_state_candidate IN ('with_receipt', 'no_receipt') THEN e.receipt_state_candidate
        WHEN e.receipt_state_candidate_enriched IN ('with_receipt', 'no_receipt') THEN e.receipt_state_candidate_enriched
        WHEN e.total_amount_candidate IS NOT NULL THEN 'with_receipt'
        ELSE NULL::text
      END
    ) IN ('with_receipt', 'no_receipt')
    AND e.total_amount_candidate IS NOT NULL
  ) AS strict_ready_after_enrichment
FROM enriched e;
