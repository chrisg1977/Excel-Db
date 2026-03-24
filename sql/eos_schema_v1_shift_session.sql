-- EOS shift session schema migration (v1)
-- Purpose:
--   Persist the EOS opening form and the first manager ownership/resolution fields
--   needed by the shift-session endpoints.
--
-- Notes:
--   - PostgreSQL target.
--   - UUID values are expected to be supplied by the application/service layer.

BEGIN;

CREATE TABLE IF NOT EXISTS eos_shift_session (
  id UUID PRIMARY KEY,
  location_code TEXT NOT NULL,
  department_code TEXT NOT NULL,
  clinic_code TEXT NOT NULL,
  shift_date DATE NOT NULL,
  shift_start_time TIME NOT NULL,
  opening_cash NUMERIC(12,2) NOT NULL,
  opening_cash_matches BOOLEAN NOT NULL,
  previous_cashbox_end NUMERIC(12,2) NULL,
  corrected_opening_cash NUMERIC(12,2) NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT NOT NULL,
  current_owner TEXT NOT NULL,
  taken_over_from_user TEXT NULL,
  taken_over_at TIMESTAMPTZ NULL,
  takeover_reason TEXT NULL,
  closed_at TIMESTAMPTZ NULL,
  closed_by TEXT NULL,
  abandoned_at TIMESTAMPTZ NULL,
  abandoned_by TEXT NULL,
  abandon_reason TEXT NULL,
  supersedes_shift_session_id UUID NULL REFERENCES eos_shift_session(id) ON DELETE SET NULL,
  superseded_by_shift_session_id UUID NULL REFERENCES eos_shift_session(id) ON DELETE SET NULL,

  CONSTRAINT eos_shift_session_opening_cash_nonnegative_chk
    CHECK (opening_cash >= 0),

  CONSTRAINT eos_shift_session_previous_cashbox_end_nonnegative_chk
    CHECK (
      previous_cashbox_end IS NULL
      OR previous_cashbox_end >= 0
    ),

  CONSTRAINT eos_shift_session_corrected_opening_cash_nonnegative_chk
    CHECK (
      corrected_opening_cash IS NULL
      OR corrected_opening_cash >= 0
    ),

  CONSTRAINT eos_shift_session_corrected_opening_cash_required_chk
    CHECK (
      opening_cash_matches = TRUE
      OR corrected_opening_cash IS NOT NULL
    ),

  CONSTRAINT eos_shift_session_status_chk
    CHECK (
      status IN (
        'open',
        'report_in_progress',
        'submitted',
        'locked',
        'abandoned',
        'superseded'
      )
    )
);

CREATE INDEX IF NOT EXISTS ix_eos_shift_session_location_code
  ON eos_shift_session (location_code);

CREATE INDEX IF NOT EXISTS ix_eos_shift_session_shift_date
  ON eos_shift_session (shift_date);

CREATE INDEX IF NOT EXISTS ix_eos_shift_session_clinic_code
  ON eos_shift_session (clinic_code);

CREATE INDEX IF NOT EXISTS ix_eos_shift_session_department_code
  ON eos_shift_session (department_code);

CREATE INDEX IF NOT EXISTS ix_eos_shift_session_status
  ON eos_shift_session (status);

CREATE INDEX IF NOT EXISTS ix_eos_shift_session_current_owner
  ON eos_shift_session (current_owner);

COMMIT;
