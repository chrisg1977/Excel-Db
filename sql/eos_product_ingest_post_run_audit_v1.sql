-- EOS PRODUCTLIST post-run audit snapshot (v1)
-- Purpose:
--   Write one run-audit row after PRODUCTLIST loader execution.
--   Captures candidate stats, per-table counts, deltas, fingerprints,
--   and run-level inserted/updated/skipped estimates.
--
-- Run:
--   psql -h <host> -p <port> -U <user> -d <db> -f sql/eos_product_ingest_post_run_audit_v1.sql
--
-- Optional caller context (recommended before executing this file):
--   SELECT set_config('eos.run_started_at', now()::text, false);
--   SELECT set_config('eos.run_finished_at', now()::text, false);
--   SELECT set_config('eos.source_reference', 'productlist:manual_run', false);
--   SELECT set_config('eos.audit_notes', 'strict_insert_v1 post-run audit', false);

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.eos_product_ingest_run_audit') IS NULL THEN
    RAISE EXCEPTION 'Missing required table: eos_product_ingest_run_audit (run sql/eos_product_ingest_run_audit_schema_v1.sql first)';
  END IF;

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

WITH params AS (
  SELECT
    coalesce(
      nullif(current_setting('eos.run_started_at', true), '')::timestamptz,
      now()
    ) AS run_started_at,
    coalesce(
      nullif(current_setting('eos.run_finished_at', true), '')::timestamptz,
      now()
    ) AS run_finished_at,
    nullif(current_setting('eos.source_reference', true), '')::text AS source_reference,
    nullif(current_setting('eos.audit_notes', true), '')::text AS notes
), candidate_stats AS (
  SELECT
    string_agg(DISTINCT coalesce(c._source_file, '(unknown)'), ', ' ORDER BY coalesce(c._source_file, '(unknown)')) AS source_file,
    string_agg(DISTINCT coalesce(c._source_sheet, '(unknown)'), ', ' ORDER BY coalesce(c._source_sheet, '(unknown)')) AS source_sheet,
    count(*)::int AS candidate_row_count,
    count(*) FILTER (WHERE c.deterministic_ready)::int AS deterministic_ready_count,
    count(*) FILTER (WHERE NOT c.deterministic_ready)::int AS unresolved_count
  FROM v_eos_productlist_candidates_v1 c
), table_counts AS (
  SELECT
    (SELECT count(*)::bigint FROM eos_product_master) AS master_row_count,
    (SELECT count(*)::bigint FROM eos_product_identity) AS identity_row_count,
    (SELECT count(*)::bigint FROM eos_product_attributes_history) AS attributes_row_count,
    (SELECT count(*)::bigint FROM eos_product_pricing_history) AS pricing_row_count
), fingerprints AS (
  SELECT
    md5(coalesce((
      SELECT string_agg(
        md5(concat_ws('|',
          m.id::text,
          coalesce(m.product_key, ''),
          coalesce(m.lifecycle_status, ''),
          m.is_active::text,
          coalesce(m.source_system, ''),
          coalesce(m.source_reference, ''),
          coalesce(m.notes, '')
        )),
        '|' ORDER BY m.id
      )
      FROM eos_product_master m
    ), '')) AS master_fingerprint,
    md5(coalesce((
      SELECT string_agg(
        md5(concat_ws('|',
          i.id::text,
          i.product_id::text,
          coalesce(i.identity_type, ''),
          coalesce(i.identity_value, ''),
          coalesce(i.identity_value_norm, ''),
          i.effective_from::text,
          coalesce(i.effective_to::text, ''),
          i.is_primary::text,
          coalesce(i.source_system, ''),
          coalesce(i.source_reference, ''),
          coalesce(i.notes, '')
        )),
        '|' ORDER BY i.id
      )
      FROM eos_product_identity i
    ), '')) AS identity_fingerprint,
    md5(coalesce((
      SELECT string_agg(
        md5(concat_ws('|',
          a.id::text,
          a.product_id::text,
          a.effective_from::text,
          coalesce(a.effective_to::text, ''),
          coalesce(a.product_name, ''),
          coalesce(a.size_label, ''),
          coalesce(a.product_type, ''),
          coalesce(a.expires_flag::text, ''),
          coalesce(a.destination_mode, ''),
          coalesce(a.supplier_label_raw, ''),
          coalesce(a.source_system, ''),
          coalesce(a.source_reference, ''),
          coalesce(a.notes, '')
        )),
        '|' ORDER BY a.id
      )
      FROM eos_product_attributes_history a
    ), '')) AS attributes_fingerprint,
    md5(coalesce((
      SELECT string_agg(
        md5(concat_ws('|',
          p.id::text,
          p.product_id::text,
          p.effective_from::text,
          coalesce(p.effective_to::text, ''),
          coalesce(p.cost_ex_vat::text, ''),
          coalesce(p.cost_vat_rate_pct::text, ''),
          coalesce(p.cost_inc_vat::text, ''),
          coalesce(p.retail_ex_vat::text, ''),
          coalesce(p.retail_vat_rate_pct::text, ''),
          coalesce(p.retail_vat_amount::text, ''),
          coalesce(p.unit_selling_price::text, ''),
          coalesce(p.currency_code, ''),
          coalesce(p.source_system, ''),
          coalesce(p.source_reference, ''),
          coalesce(p.notes, '')
        )),
        '|' ORDER BY p.id
      )
      FROM eos_product_pricing_history p
    ), '')) AS pricing_fingerprint
), previous_run AS (
  SELECT
    r.run_id,
    r.master_row_count,
    r.identity_row_count,
    r.attributes_row_count,
    r.pricing_row_count,
    r.master_fingerprint,
    r.identity_fingerprint,
    r.attributes_fingerprint,
    r.pricing_fingerprint
  FROM eos_product_ingest_run_audit r
  ORDER BY r.run_id DESC
  LIMIT 1
), run_deltas AS (
  SELECT
    c.master_row_count,
    c.identity_row_count,
    c.attributes_row_count,
    c.pricing_row_count,
    CASE WHEN p.run_id IS NULL THEN NULL::bigint ELSE c.master_row_count - p.master_row_count END AS master_row_delta,
    CASE WHEN p.run_id IS NULL THEN NULL::bigint ELSE c.identity_row_count - p.identity_row_count END AS identity_row_delta,
    CASE WHEN p.run_id IS NULL THEN NULL::bigint ELSE c.attributes_row_count - p.attributes_row_count END AS attributes_row_delta,
    CASE WHEN p.run_id IS NULL THEN NULL::bigint ELSE c.pricing_row_count - p.pricing_row_count END AS pricing_row_delta,
    f.master_fingerprint,
    f.identity_fingerprint,
    f.attributes_fingerprint,
    f.pricing_fingerprint,
    p.run_id AS previous_run_id,
    p.master_fingerprint AS previous_master_fingerprint,
    p.identity_fingerprint AS previous_identity_fingerprint,
    p.attributes_fingerprint AS previous_attributes_fingerprint,
    p.pricing_fingerprint AS previous_pricing_fingerprint
  FROM table_counts c
  CROSS JOIN fingerprints f
  LEFT JOIN previous_run p ON TRUE
), activity_counts AS (
  SELECT
    count(*) FILTER (
      WHERE m.created_at >= p.run_started_at
        AND m.created_at <= p.run_finished_at
        AND m.source_system = 'productlist'
    )::int AS inserted_root_count,

    count(*) FILTER (
      WHERE i.created_at >= p.run_started_at
        AND i.created_at <= p.run_finished_at
        AND i.source_system = 'productlist'
    )::int AS inserted_identity_count,

    count(*) FILTER (
      WHERE a.created_at >= p.run_started_at
        AND a.created_at <= p.run_finished_at
        AND a.source_system = 'productlist'
    )::int AS inserted_attributes_count,

    count(*) FILTER (
      WHERE ph.created_at >= p.run_started_at
        AND ph.created_at <= p.run_finished_at
        AND ph.source_system = 'productlist'
    )::int AS inserted_pricing_count,

    count(*) FILTER (
      WHERE a.updated_at >= p.run_started_at
        AND a.updated_at <= p.run_finished_at
        AND a.created_at < p.run_started_at
        AND a.source_system = 'productlist'
    )::int AS updated_attributes_count,

    count(*) FILTER (
      WHERE ph.updated_at >= p.run_started_at
        AND ph.updated_at <= p.run_finished_at
        AND ph.created_at < p.run_started_at
        AND ph.source_system = 'productlist'
    )::int AS updated_pricing_count
  FROM params p
  LEFT JOIN eos_product_master m ON TRUE
  LEFT JOIN eos_product_identity i ON TRUE
  LEFT JOIN eos_product_attributes_history a ON TRUE
  LEFT JOIN eos_product_pricing_history ph ON TRUE
)
INSERT INTO eos_product_ingest_run_audit (
  run_started_at,
  run_finished_at,
  source_file,
  source_sheet,
  candidate_row_count,
  deterministic_ready_count,
  unresolved_count,
  inserted_root_count,
  inserted_identity_count,
  inserted_attributes_count,
  inserted_pricing_count,
  skipped_root_count,
  skipped_identity_count,
  skipped_attributes_count,
  skipped_pricing_count,
  updated_attributes_count,
  updated_pricing_count,
  master_row_count,
  identity_row_count,
  attributes_row_count,
  pricing_row_count,
  master_row_delta,
  identity_row_delta,
  attributes_row_delta,
  pricing_row_delta,
  master_fingerprint,
  identity_fingerprint,
  attributes_fingerprint,
  pricing_fingerprint,
  idempotency_held,
  notes,
  source_reference
)
SELECT
  p.run_started_at,
  p.run_finished_at,
  coalesce(cs.source_file, '(none)'),
  coalesce(cs.source_sheet, '(none)'),
  cs.candidate_row_count,
  cs.deterministic_ready_count,
  cs.unresolved_count,
  ac.inserted_root_count,
  ac.inserted_identity_count,
  ac.inserted_attributes_count,
  ac.inserted_pricing_count,
  greatest(cs.deterministic_ready_count - ac.inserted_root_count, 0),
  greatest(cs.deterministic_ready_count - ac.inserted_identity_count, 0),
  greatest(cs.deterministic_ready_count - ac.inserted_attributes_count - ac.updated_attributes_count, 0),
  greatest(cs.deterministic_ready_count - ac.inserted_pricing_count - ac.updated_pricing_count, 0),
  ac.updated_attributes_count,
  ac.updated_pricing_count,
  rd.master_row_count,
  rd.identity_row_count,
  rd.attributes_row_count,
  rd.pricing_row_count,
  rd.master_row_delta,
  rd.identity_row_delta,
  rd.attributes_row_delta,
  rd.pricing_row_delta,
  rd.master_fingerprint,
  rd.identity_fingerprint,
  rd.attributes_fingerprint,
  rd.pricing_fingerprint,
  CASE
    WHEN rd.previous_run_id IS NULL THEN TRUE
    ELSE (
      coalesce(rd.master_row_delta, 0) = 0
      AND coalesce(rd.identity_row_delta, 0) = 0
      AND coalesce(rd.attributes_row_delta, 0) = 0
      AND coalesce(rd.pricing_row_delta, 0) = 0
      AND rd.master_fingerprint = rd.previous_master_fingerprint
      AND rd.identity_fingerprint = rd.previous_identity_fingerprint
      AND rd.attributes_fingerprint = rd.previous_attributes_fingerprint
      AND rd.pricing_fingerprint = rd.previous_pricing_fingerprint
    )
  END AS idempotency_held,
  coalesce(p.notes, 'productlist post-run audit snapshot'),
  coalesce(p.source_reference, 'productlist:post_run_audit_v1')
FROM params p
CROSS JOIN candidate_stats cs
CROSS JOIN run_deltas rd
CROSS JOIN activity_counts ac;

-- Return the inserted audit row for immediate visibility.
SELECT *
FROM eos_product_ingest_run_audit
ORDER BY run_id DESC
LIMIT 1;

COMMIT;
