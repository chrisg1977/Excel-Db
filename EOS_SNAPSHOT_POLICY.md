# EOS Snapshot Policy

## Purpose
Define the current and planned persistence policy for saved EOS report snapshots.

## Current Behavior
- `POST /api/eos/reports` creates a new saved snapshot each time it is called.
- The current implementation does not update an existing saved report in place.

## Benefits
- Preserves auditability of what was saved at a given point in time.
- Maintains a historical trace of report-generation activity.

## Risks
- Can produce draft/submission records that look duplicated to users.
- Can create user confusion if the UI does not clearly label saved states and timestamps.
- Management retrieval screens must be careful not to present repeated drafts as if they were separate business outcomes.

## Future Options
- Keep the current append-only snapshot model.
- Add explicit draft versioning on top of append-only snapshots.
- Allow update-in-place only while a report remains in `draft` status.

### Recommended Later Header Fields

To make append-only browsing easier later, consider adding on `eos_report_header`:
- `snapshot_kind` such as `draft`, `submitted`, `locked`
- `snapshot_version`
- `is_latest_for_shift`

## Recommendation
- Keep the append-only snapshot model for now unless a strong operational reason arises to support draft updates in place.
