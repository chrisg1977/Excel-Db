-- eos_notification_queue_schema_v1.sql
-- PostgreSQL schema draft for EOS notification queue persistence.
--
-- Purpose:
--   Persist queued internal notification records produced by EOS discrepancy events.
--
-- Notes:
--   - This is queue persistence only. It does not implement delivery.
--   - Delivery channels can later include email, dashboard queue, internal inbox,
--     or another shared notification mechanism.
--   - Foreign keys are not enforced in this first draft to allow staged rollout.

BEGIN;

CREATE TABLE IF NOT EXISTS eos_notification_queue (
  id UUID PRIMARY KEY,
  source_event_id UUID NOT NULL,
  notification_type TEXT NOT NULL,
  primary_recipient_employee_id UUID NULL,
  fallback_recipient_employee_id UUID NULL,
  admin_summary_required BOOLEAN NOT NULL DEFAULT false,
  payload_json JSONB NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  scheduled_at TIMESTAMPTZ NULL,
  processed_at TIMESTAMPTZ NULL,
  error_note TEXT NULL,
  CONSTRAINT eos_notification_queue_notification_type_chk CHECK (
    notification_type IN (
      'discrepancy_alert',
      'manager_review_required',
      'admin_summary'
    )
  ),
  CONSTRAINT eos_notification_queue_status_chk CHECK (
    status IN (
      'queued',
      'pending',
      'sent',
      'failed',
      'cancelled'
    )
  )
);

CREATE INDEX IF NOT EXISTS ix_eos_notification_queue_source_event_id
  ON eos_notification_queue (source_event_id);

CREATE INDEX IF NOT EXISTS ix_eos_notification_queue_notification_type
  ON eos_notification_queue (notification_type);

CREATE INDEX IF NOT EXISTS ix_eos_notification_queue_primary_recipient_employee_id
  ON eos_notification_queue (primary_recipient_employee_id);

CREATE INDEX IF NOT EXISTS ix_eos_notification_queue_fallback_recipient_employee_id
  ON eos_notification_queue (fallback_recipient_employee_id);

CREATE INDEX IF NOT EXISTS ix_eos_notification_queue_status
  ON eos_notification_queue (status);

CREATE INDEX IF NOT EXISTS ix_eos_notification_queue_created_at
  ON eos_notification_queue (created_at);

COMMIT;
