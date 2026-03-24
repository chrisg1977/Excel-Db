-- EOS accounting period schema (v1)
-- PostgreSQL
-- Notes:
--   - `start_at` / `end_at` are the canonical half-open period boundaries.
--   - `start_date` / `end_date` and `is_closed` remain for current backend compatibility.

BEGIN;

CREATE TABLE IF NOT EXISTS eos_accounting_period (
  id UUID PRIMARY KEY,
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  period_code TEXT NOT NULL UNIQUE,
  period_name TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  is_closed BOOLEAN NOT NULL DEFAULT FALSE,
  closed_at TIMESTAMPTZ NULL,
  closed_by TEXT NULL,
  reopened_at TIMESTAMPTZ NULL,
  reopened_by TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT eos_accounting_period_year_month_uq
    UNIQUE (year, month),

  CONSTRAINT eos_accounting_period_bounds_chk
    CHECK (end_at > start_at),

  CONSTRAINT eos_accounting_period_date_bounds_chk
    CHECK (end_date >= start_date),

  CONSTRAINT eos_accounting_period_status_chk
    CHECK (status IN ('open', 'closing_review', 'closed', 'reopened')),

  CONSTRAINT eos_accounting_period_closed_alignment_chk
    CHECK (
      (status = 'closed' AND is_closed = TRUE)
      OR (status <> 'closed' AND is_closed = FALSE)
    ),

  CONSTRAINT eos_accounting_period_closed_fields_chk
    CHECK (
      is_closed = FALSE
      OR closed_at IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS ix_eos_accounting_period_status_start_at
  ON eos_accounting_period (status, start_at DESC);

CREATE INDEX IF NOT EXISTS ix_eos_accounting_period_start_at
  ON eos_accounting_period (start_at DESC);

CREATE INDEX IF NOT EXISTS ix_eos_accounting_period_end_at
  ON eos_accounting_period (end_at DESC);

COMMIT;
