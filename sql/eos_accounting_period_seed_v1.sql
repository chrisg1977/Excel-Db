-- EOS accounting period seed (v1)
-- PostgreSQL
-- Notes:
--   - Uses half-open month boundaries: [start_at, end_at).
--   - Seeds a rolling window around the current Malta month.
--   - Current month is open; past months are closed; future months are open.
--   - Uses deterministic RFC4122-style UUIDs derived from period_code.

BEGIN;

WITH month_seed AS (
  SELECT
    month_start::date AS month_start_date,
    (month_start + INTERVAL '1 month')::date AS next_month_start_date,
    date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Malta')::date AS current_month_start_date,
    md5('eos_accounting_period:' || to_char(month_start::date, 'YYYY-MM')) AS period_hash
  FROM generate_series(
    date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Malta')::date - INTERVAL '3 months',
    date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Malta')::date + INTERVAL '3 months',
    INTERVAL '1 month'
  ) AS seeded_month(month_start)
)
INSERT INTO eos_accounting_period (
  id,
  year,
  month,
  period_code,
  period_name,
  start_at,
  end_at,
  start_date,
  end_date,
  status,
  is_closed,
  closed_at,
  closed_by
)
SELECT
  (
    substr(period_hash, 1, 8) || '-' ||
    substr(period_hash, 9, 4) || '-' ||
    '4' || substr(period_hash, 14, 3) || '-' ||
    substr('89ab', (get_byte(decode(substr(period_hash, 17, 2), 'hex'), 0) % 4) + 1, 1) ||
    substr(period_hash, 18, 3) || '-' ||
    substr(period_hash, 21, 12)
  )::uuid AS id,
  EXTRACT(YEAR FROM month_start_date)::int AS year,
  EXTRACT(MONTH FROM month_start_date)::int AS month,
  to_char(month_start_date, 'YYYY-MM') AS period_code,
  upper(to_char(month_start_date, 'MON YYYY')) AS period_name,
  (month_start_date::timestamp AT TIME ZONE 'Europe/Malta') AS start_at,
  (next_month_start_date::timestamp AT TIME ZONE 'Europe/Malta') AS end_at,
  month_start_date AS start_date,
  (next_month_start_date - INTERVAL '1 day')::date AS end_date,
  CASE
    WHEN month_start_date < current_month_start_date THEN 'closed'
    ELSE 'open'
  END AS status,
  CASE
    WHEN month_start_date < current_month_start_date THEN TRUE
    ELSE FALSE
  END AS is_closed,
  CASE
    WHEN month_start_date < current_month_start_date THEN (next_month_start_date::timestamp AT TIME ZONE 'Europe/Malta')
    ELSE NULL
  END AS closed_at,
  CASE
    WHEN month_start_date < current_month_start_date THEN 'seed'
    ELSE NULL
  END AS closed_by
FROM month_seed
ON CONFLICT (period_code) DO UPDATE
SET
  year = EXCLUDED.year,
  month = EXCLUDED.month,
  period_name = EXCLUDED.period_name,
  start_at = EXCLUDED.start_at,
  end_at = EXCLUDED.end_at,
  start_date = EXCLUDED.start_date,
  end_date = EXCLUDED.end_date,
  status = EXCLUDED.status,
  is_closed = EXCLUDED.is_closed,
  closed_at = EXCLUDED.closed_at,
  closed_by = EXCLUDED.closed_by,
  updated_at = NOW();

COMMIT;
