# EOS Notification Queue Model

## Purpose

This note defines how EOS discrepancy events can be queued for delivery and review without implementing actual delivery yet.

Discrepancy events should produce queue entries.

Queue entries are separate from the EOS UI and should be handled by shared backend/service logic.

Future delivery can use email, a dashboard queue, an internal inbox, or another delivery channel.

## Suggested Queue Item Shape

```ts
type EosNotificationQueueItem = {
  queue_id: string;
  source_event_id: string;
  notification_type: 'discrepancy_alert' | 'manager_review_required' | 'admin_summary';
  primary_recipient_employee_id: string | null;
  fallback_recipient_employee_id: string | null;
  admin_summary_required: boolean;
  payload_json: unknown;
  status: 'queued' | 'pending' | 'sent' | 'failed' | 'cancelled';
  created_at: string;
  scheduled_at: string | null;
  processed_at: string | null;
  error_note: string | null;
};
```

## Field Notes

- `queue_id`
  - unique queue item identifier
- `source_event_id`
  - points back to the discrepancy event that produced the queue item
- `notification_type`
  - type of queued notification or summary action
- `primary_recipient_employee_id`
  - first direct recipient if one exists
- `fallback_recipient_employee_id`
  - secondary recipient if fallback routing applies
- `admin_summary_required`
  - whether admin summary flow must be included
- `payload_json`
  - queued message payload or delivery context
- `status`
  - queue lifecycle state
- `created_at`
  - queue creation timestamp
- `scheduled_at`
  - nullable scheduled delivery/review time
- `processed_at`
  - nullable processing completion time
- `error_note`
  - nullable processing/delivery failure note

## Suggested Notification Types

- `discrepancy_alert`
- `manager_review_required`
- `admin_summary`

## Suggested Status Values

- `queued`
- `pending`
- `sent`
- `failed`
- `cancelled`
