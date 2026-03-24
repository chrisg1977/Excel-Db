# EOS Latest Snapshot View Plan

## Purpose
Document a future management-facing "latest snapshot only" view for EOS saved reports.

## Why This May Be Needed
- Append-only EOS snapshots can create repeated-looking rows when drafts and later saves exist for the same shift.
- Management may want a simplified latest-only view for browsing, while still preserving the full historical snapshot trail underneath.

## Suggested Future `eos_report_header` Fields
- `snapshot_kind`
- `snapshot_version`
- `is_latest_for_shift`

## Possible Implementation Approaches
- Persisted flag:
  - store and maintain `is_latest_for_shift` on `eos_report_header`
- SQL window-function view:
  - derive the latest row per shift/session with `ROW_NUMBER()` or similar
- Materialized latest-report view:
  - precompute latest report rows for faster management browsing if volume grows
