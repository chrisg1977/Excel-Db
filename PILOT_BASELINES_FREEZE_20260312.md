# Pilot Baselines Freeze - 2026-03-12

Scope frozen:
- EOSZ 2025 PAY baseline
- EOSQ 2025 FEE baseline

Data source:
- Live Postgres container `pg_excel` (`exceldb`)
- Snapshot taken after EOSQ header dependency fix and strict FEE rerun

## A. Combined baseline summary

### EOSZ 2025 PAY baseline
- Source workbook: `EOSZ - 2025.xlsx`
- Header count (branch EOSZ): `157`
- Canonical line count (`eos_shift_payment_lines`): `336`
- Source detail count (`eos_shift_payment_line_source_details`): `336`
- Reject count (`eos_stg_rejects`, loader `eos_stg_to_shift_payment_lines_insert_v1`): `0`
- Top reject reasons: none recorded (no rows present for PAY loader)

### EOSQ 2025 FEE baseline
- Source workbook: `EOSQ - 2025.xlsx`
- Header count (branch EOSQ): `197`
- Canonical line count (`eos_shift_fee_income_lines`): `1292`
- Source detail count (`eos_shift_fee_income_source_details`): `1292`
- Reject count (`eos_stg_rejects`, loader `eos_stg_to_shift_fee_income_lines_insert_v1`): `4`
- Top reject reasons:
  - `{gross_amount_negative,vat_greater_than_gross}`: `3`
  - `{gross_amount_negative}`: `1`

## B. Shared header summary

- Headers by branch:
  - `EOSZ`: `157`
  - `EOSQ`: `197`
  - Total headers: `354`
- Headers reused by PAY and FEE (same `shift_header_id` referenced by both canonical tables): `0`
- Duplicate-risk observations:
  - Duplicate header key rows (`branch_code`, `business_date`) currently: `0`
  - Current separation by branch means no PAY/FEE cross-branch header collisions in this pilot freeze.

## C. Model summary

- PAY canonical tables used:
  - `eos_shift_payment_lines`
- FEE canonical tables used:
  - `eos_shift_fee_income_lines`
- Source detail tables used:
  - PAY: `eos_shift_payment_line_source_details`
  - FEE: `eos_shift_fee_income_source_details`
- Why PAY and FEE are separated:
  - PAY is expense-shaped and depends on fields like `cost_nature`.
  - FEE is income-shaped and depends on subtype/detail semantics (not PAY cost-nature semantics).
  - Separation avoids forced/default mappings that would weaken strict reject-first behavior.

## D. Known deferred items

- Commission split
- Provider share logic
- Apartments bulk-pay logic
- Booking-system master
- SELL pilot
- Richer normalization of merchant/provider/platform

## E. Single best next implementation step after freeze

- Recommendation: improve remaining FEE rejects.
- Reason: only 4 strict rejects remain, all explicit amount-consistency failures, making this the highest-impact low-risk step to complete the accepted FEE baseline quality.
