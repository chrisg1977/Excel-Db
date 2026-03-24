# EOS Period Close Readiness

## Goal

Define the checks that should run before an EOS accounting period is marked ready
to close.

## Hard Blockers

- unresolved manager reviews still open
- temporary closures pending review
- unresolved emergency handovers
- critical discrepancies still open
- missing required reports for active reception locations
- any close-blocking workflow status still unresolved

## Warnings

- high discrepancy count in the period
- repeated draft / saved-only snapshots without clear final submission
- abandoned or superseded shifts present in the period
- pending queue items not yet reviewed by management/admin

## Informational Items

- total report snapshots created in the period
- total submitted reports
- total discrepancies detected
- total manager reviews completed
- total temporary closures and emergency handovers resolved

## Future Override Path

- management / admin override may later allow a period to be forced ready or forced closed
- any override must require a reason
- any override must be audited with actor, timestamp, prior state, new state, and note
