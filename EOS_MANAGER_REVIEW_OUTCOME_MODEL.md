# EOS Manager Review Outcome Model

## Purpose

This note defines how a manager reviews and resolves an EOS discrepancy.

This model is separate from the original discrepancy event.

It feeds the admin outcome summary and may later connect to EOS report audit/history.

## Suggested Review Outcome Shape

```ts
type EosManagerReviewOutcome = {
  review_id: string;
  source_event_id: string;
  reviewed_by: string;
  reviewed_at: string;
  decision: 'acknowledged' | 'accepted' | 'corrected' | 'escalated' | 'rejected';
  decision_note: string | null;
  action_type: 'no_change' | 'manager_note_only' | 'cash_adjustment_reviewed' | 'handover_reviewed' | 'follow_up_required';
  final_outcome_status: 'closed' | 'pending_follow_up' | 'escalated';
  admin_summary_generated: boolean;
};
```

## Field Notes

- `review_id`
  - unique manager review identifier
- `source_event_id`
  - points to the discrepancy event being reviewed
- `reviewed_by`
  - manager or reviewer identity
- `reviewed_at`
  - review timestamp
- `decision`
  - high-level review decision
- `decision_note`
  - optional reviewer note
- `action_type`
  - operational action classification
- `final_outcome_status`
  - final state after review
- `admin_summary_generated`
  - whether the admin outcome summary has already been produced

## Suggested Decision Values

- `acknowledged`
- `accepted`
- `corrected`
- `escalated`
- `rejected`

## Suggested Action Type Values

- `no_change`
- `manager_note_only`
- `cash_adjustment_reviewed`
- `handover_reviewed`
- `follow_up_required`

## Suggested Final Outcome Status Values

- `closed`
- `pending_follow_up`
- `escalated`
