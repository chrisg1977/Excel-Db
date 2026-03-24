# EOSQ 2025 FEE Pilot Readiness (Strict Reject-First)

Date: 2026-03-12
Repository: `chrisg1977/Excel-Db`
Branch: `copilot/create-hr-dashboard-interface`

## What Was Executed
- Imported EOSQ workbook live into staging using:
  - `importer/import_eos_workbook.py --workbook "C:\Users\User\Desktop\CURRENT BACKUP\EOSQ - 2025.xlsx" --branch eosq --truncate-matched --map-by-position`
- Applied EOSQ pilot views:
  - `sql/v_eosq_pay_lines_raw_v1.sql`
  - `sql/v_eosq_fee_lines_raw_v1.sql`
  - `sql/v_eosq_pay_fee_candidates_v1.sql`
- Added conservative parse improvements for EOSQ FEE:
  - amount fallback parse from `raw_col_22`/`raw_col_23`
  - payment-channel parse from `raw_col_6`

## Import Evidence
- Matched and imported all monthly EOSQ sheets (`JAN..DEC`, `*PAY`, `*FEE`, `*SELL`) plus `ENTRY`, `PAY SUMMARY`, `DATA`, `PRODUCTLIST`.
- FEE table rows imported by month:
  - Jan 347, Feb 347, Mar 347, Apr 347, May 348, Jun 347, Jul 347, Aug 347, Sep 347, Oct 347, Nov 341, Dec 344

## EOSQ Bridge Counts
- `v_eosq_pay_fee_candidates_v1`:
  - `FEE = 4156`
  - `PAY = 30`

## FEE Strict-Readiness Snapshot
- Candidate load status (`source_family='FEE'`):
  - `READY_FOR_ENRICHMENT = 211`
  - `PARTIAL = 25`
  - `UNRESOLVED = 3920`
- FEE rows with `total_amount_candidate IS NOT NULL`: `211`
- Of those, rows with `payment_channel_candidate IS NOT NULL`: `10`

## Hard Blockers Under Strict Loader Rules
For all EOSQ FEE candidates, these critical dimensions remain unresolved in current source/model:
- `business_date_unresolved = true`
- `shift_stage_unresolved = true`
- `cost_nature_unresolved = true`
- `payment_channel_unresolved = true` for the vast majority

Observed unresolved profile counts:
- `business_date=true, shift_stage=true, cost_nature=true, payment_channel=true, label=true, amount=true => 2711`
- `business_date=true, shift_stage=true, cost_nature=true, payment_channel=true, label=false, amount=true => 1209`
- `business_date=true, shift_stage=true, cost_nature=true, payment_channel=true, label=false, amount=false => 236`

## Conclusion
- EOSQ FEE is **not load-ready** for canonical strict loaders yet.
- Running strict loaders now would produce near-total rejects for EOSQ FEE due to unresolved required operational fields.

## Enrichment Pack (Applied)
Implemented and applied:
- `sql/v_eosq_fee_candidates_enriched_v1.sql`

This view adds an explicit EOSQ FEE enrichment layer over `v_eosq_pay_fee_candidates_v1` with:
- month-token to month-end business-date anchoring for 2025 (`JAN..DEC`)
- source-stage normalization to loader-domain values (`midshift/endshift`), with FEE fallback to `endshift`
- conservative cost-nature normalization with `capital` keyword detection and `running` default for non-blank non-capital probes
- payment-channel fallback inference and strict-domain normalization
- receipt-state strict-domain normalization plus fallback for rows with concrete totals

## Post-Enrichment Strict-Readiness Impact
Measured live after applying `v_eosq_fee_candidates_enriched_v1`:

- Baseline (`v_eosq_pay_fee_candidates_v1`):
  - `FEE rows = 4156`
  - `FEE strict-ready = 0`

- Enriched (`v_eosq_fee_candidates_enriched_v1`):
  - `FEE rows = 4156`
  - `FEE strict-ready = 211`

Net strict-ready uplift:
- `0 -> 211` (`+211` rows)

## Remaining Blockers After Enrichment
Across all EOSQ FEE rows (`4156`):
- `missing_business_date = 0`
- `missing_source_stage = 0`
- `missing_cost_nature = 2711`
- `missing_payment_channel = 3850`
- `missing_receipt_state = 3938`
- `missing_total = 3945`

Interpretation:
- The enrichment layer successfully unlocks all rows that already had usable monetary totals.
- The dominant remaining blocker is source sparsity for non-amount rows, not parser or domain mismatches.

## Next Best Remediation (Single Step)
Implement a reviewed EOSQ FEE enrichment mapping pack before loader wiring:
- deterministic business-date mapping by month/sheet
- source-stage and cost-nature mapping policy for FEE
- payment-channel inference overrides where raw method labels are reliable

Status of this remediation:
- Business-date mapping by month/sheet: completed in `v_eosq_fee_candidates_enriched_v1`
- Source-stage policy for FEE: completed in `v_eosq_fee_candidates_enriched_v1`
- Cost-nature policy for FEE: partially completed (rows with non-blank probes)
- Payment-channel inference overrides: partially completed (still sparse where source is blank)
