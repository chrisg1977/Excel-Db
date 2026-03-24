# EOS Period Summary Query Plan

## Goal

Document how the accounting-period dashboard summary metrics should be calculated
for one EOS accounting period.

## Planned Metrics

- total report snapshots in period
- total submitted reports
- total draft / saved-only reports
- total reports with `discrepancy_total <> 0`
- total discrepancy events created in period
- total manager reviews still pending
- total temporary closures pending review
- total abandoned shifts
- total superseded shifts

## Likely Source Tables

- `eos_accounting_period`
- `eos_report_header`
- `eos_report_summary`
- `eos_discrepancy_event`
- `eos_manager_review_outcome`
- `eos_shift_session`

## Calculation Notes

- report-snapshot metrics should be filtered by `eos_report_header.accounting_period_id`
- submitted vs draft / saved-only should come from `eos_report_header.status`
- report discrepancy counts should join `eos_report_summary` on `report_header_id`
- discrepancy-event counts should use `eos_discrepancy_event.created_at` resolved to the same period window
- manager reviews still pending should be derived from discrepancy-event status and latest review outcome state
- temporary closures pending review should come from `eos_shift_session.status`
- abandoned and superseded shift counts should come from `eos_shift_session.status`

## Notes

- append-only report snapshots mean counts are snapshot-based unless a future latest-only view is introduced
- period summary queries should stay read-only and optimized for dashboard retrieval, not operational write flows
