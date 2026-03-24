# Developer Backlog

This is the canonical developer backlog for the repo. It tracks pending architecture decisions, developer tasks, and structural features across the codebase. It is developer-only and must not be exposed in the UI.

Future project-specific backlog notes should gradually be consolidated into this file.

## EOS Data Pipeline (Active)

- Active baselines (not frozen):
  - PAY baseline active on `EOSZ - 2025.xlsx` with clean canonical load.
  - FEE baseline active on `EOSQ - 2025.xlsx` with 4 strict rejects under targeted remediation.
  - Shared header model (`eos_shift_header`) is reusable and stable.
- Immediate execution order:
  - Investigate and resolve remaining EOSQ FEE rejects (strict rules preserved).
  - Continue SELL pilot development (profile -> parser -> candidates -> readiness -> canonical proposal).
  - Keep provider/commission model deferred pending external business rules.

## Deferred Until EOS Go-Live

- YOUR INFO self-service page request is intentionally on hold until EOS is fully up and running in production.
- Hold scope includes:
  - employee self-edit profile page (name/address/contact)
  - role-based edit restrictions and HR-only overrides
  - leave/communication pending visibility in page
  - full change audit + HR handover notifications
  - payroll bank-change confirmation gating
- Unblock condition:
  - EOS pipeline and operational flow are live, validated, and signed off as stable for go-forward work.

## EOS FEE Reject Remediation (Current Priority)

- Scope:
  - Investigate the 4 EOSQ FEE rejects with reasons `gross_amount_negative` and `vat_greater_than_gross`.
  - Classify each as data error, refund/reversal, sign inversion, adjustment, or import artifact.
- Constraints:
  - No rule relaxation across the baseline.
  - No amount fabrication or silent defaults.
  - Preserve reject-first and auditability.
  - Limit any change to targeted reprocessing or controlled future-load logic.
- Execution continuation tasks:
  - Keep the 4 EOSQ FEE negative-gross rows rejected in v1 canonical loading (no global acceptance change).
  - Persist remediation evidence and row-level classification from `EOSQ_FEE_REJECT_INVESTIGATION_20260312.md` as the current decision record.
  - Define a separate, controlled refund/adjustment lane design (subtype-gated, audited, immutable source linkage) without touching PAY/FEE accepted baseline logic.
  - Re-run strict EOSQ FEE load verification after any targeted parser/metadata fixes to confirm reject count remains expected and explainable.

## EOS SELL Pilot (Next Active Stream)

- Profile EOSZ/EOSQ SELL sheet structures and separate transaction rows from summaries.
- Build provenance-first SELL raw parser and candidate view.
- Run strict readiness metrics and recommend canonical SELL model.
- Keep PAY/FEE baselines unchanged while SELL work proceeds.

## EOS Product / Supplier / Stock Foundation (New Active Stream)

- Design PRODUCTLIST-backed central product master with historical attributes and strict auditability.
- Design supplier master plus supplier invoice receipt and payable tracking ledgers.
- Design stock movement ledger with explicit from/to location and sender/receiver accountability.
- Design inventory-by-location projection model (no silent quantity adjustments).
- Design inter-location transfer ledger and transfer lifecycle states.
- Add strict staged SELL-to-product matching layer:
  - no silent product matching
  - unresolved matches must remain reviewable/rejectable
  - preserve raw SELL and PRODUCTLIST source fields
- Keep commission model deferred and untouched.
- Keep PAY/FEE accepted baselines untouched.

### Build-Now Focus

- Product master v1 schema and staged PRODUCTLIST parser.
- Product match candidate/review tables for SELL.
- Supplier master v1 schema.
- Supplier invoice receipt ledger v1 schema.
- Stock movement ledger v1 schema.

### Defer-Later Focus

- Full costing engine (weighted-average/FIFO) and accounting postings.
- Automated supplier payment allocation/reconciliation workflows.
- Advanced inventory reservation/forecasting/reorder automation.
- Commission-linked inventory profitability logic.

## Provider / Commission Model (Deferred Only)

- Status: temporarily blocked pending external business inputs.
- Blocked implementation areas:
  - provider share calculations
  - commission split logic
  - doctor payouts
  - apartment revenue sharing
  - platform-deduction commission effects
  - net-of-commission accounting
- Allowed while deferred:
  - continue loading gross income
  - preserve raw commission-related source fields
  - keep `commission_amount` as `NULL`
  - preserve schema flexibility for later controlled rollout
- Required external inputs:
  - 2025 commission calculation spreadsheets
  - reconciliation files
  - apartment income distribution rules
  - platform fee handling rules
  - 2026 commission rule updates
  - edge-case definitions (refunds/cancellations/split providers)

## EOS

- Canonical pending database-improvement list is maintained in `EOS_DEVELOPMENT_DATABASE_TODO.md` (developer/repo only, not UI To Do records).

- Management-or-higher access to retrieve previously generated EOS reports, with persisted report storage and audit-oriented access control.
  - reports must be saved, not UI-only
  - retrieval must be restricted to management or higher
  - retrieval should be separate from the operational EOS screen
  - reports may later include walkout exception labels such as "NO WALK OUT PRINTED"
- Walkout exception reporting for EOS grouped visits.
  - existing grouped visit rows with no printed walkout should be marked "NO WALK OUT PRINTED"
  - walkout/securitylog data may enrich existing EOS grouped visit rows only and must never create new rows
  - decide later whether saved walkout exception reports belong in a dedicated EOS management report area or the Handover / To Do flow

## Open Dental Importer

- No backlog items recorded yet.

## Frontend

- No backlog items recorded yet.

## Backend / API

- No backlog items recorded yet.

## Security / Access Control

- No backlog items recorded yet.

## Reporting / Audit

- No backlog items recorded yet.

## Data Model / Schema

- No backlog items recorded yet.

## Infrastructure / Deployment

- No backlog items recorded yet.

## Integrations

- No backlog items recorded yet.

## Technical Debt / Refactors

- No backlog items recorded yet.
