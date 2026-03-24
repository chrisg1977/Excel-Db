-- eos_manager_review_outcome_schema_v1.sql
-- PostgreSQL schema draft for EOS manager review outcome persistence.
--
-- Purpose:
--   Persist manager review outcomes for EOS discrepancy events.
--
-- Notes:
--   - This is schema only. No delivery or admin-summary runtime logic is implemented here.
--   - Foreign keys are not enforced in this first draft to allow staged rollout.

BEGIN;

CREATE TABLE IF NOT EXISTS eos_manager_review_outcome (
  review_id UUID PRIMARY KEY,
  source_event_id UUID NOT NULL,
  reviewed_by TEXT NOT NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decision TEXT NOT NULL,
  decision_note TEXT NULL,
  action_type TEXT NOT NULL,
  final_outcome_status TEXT NOT NULL,
  admin_summary_generated BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT eos_manager_review_outcome_decision_chk CHECK (
    decision IN (
      'acknowledged',
      'accepted',
      'corrected',
      'escalated',
      'rejected'
    )
  ),
  CONSTRAINT eos_manager_review_outcome_action_type_chk CHECK (
    action_type IN (
      'no_change',
      'manager_note_only',
      'cash_adjustment_reviewed',
      'handover_reviewed',
      'follow_up_required'
    )
  ),
  CONSTRAINT eos_manager_review_outcome_final_outcome_status_chk CHECK (
    final_outcome_status IN (
      'closed',
      'pending_follow_up',
      'escalated'
    )
  ),
  CONSTRAINT eos_manager_review_outcome_reviewed_by_nonblank_chk CHECK (btrim(reviewed_by) <> '')
);

CREATE INDEX IF NOT EXISTS ix_eos_manager_review_outcome_source_event_id
  ON eos_manager_review_outcome (source_event_id);

CREATE INDEX IF NOT EXISTS ix_eos_manager_review_outcome_reviewed_by
  ON eos_manager_review_outcome (reviewed_by);

CREATE INDEX IF NOT EXISTS ix_eos_manager_review_outcome_reviewed_at
  ON eos_manager_review_outcome (reviewed_at);

CREATE INDEX IF NOT EXISTS ix_eos_manager_review_outcome_final_outcome_status
  ON eos_manager_review_outcome (final_outcome_status);

COMMIT;
