# EOS Workbook Interpretation Correction (v1)

## Scope
This correction updates EOS workbook interpretation so `ENTRY` is treated as reference/master data, not transaction-line input.

## Corrected Sheet Classification

### A) Transaction-like Sources (candidate operational line inputs, not fully implemented yet)
- Monthly pay/expense-like sheets (e.g. `JANPAY` ... `DECPAY` across branches)
- Monthly fee/sell detail sheets (e.g. `JanFee`, `JanSell`, and branch equivalents)
- Any row-level sheets with explicit transaction semantics (date, shift, amount, receipt/channel)

### B) Reference/Master-data Sources
- `ENTRY` sheet:
  - department/subdepartment reference values
  - provider lists and display-name normalization candidates
  - third-party fallback references
  - payment-type reference section (starting around row 21)
  - VAT reference (service/product -> VAT rate)
  - receipt-issued value reference normalization logic
  - booking system reference list
- MDCZ/MDCQ dropdown/reference values for payment classification

### C) Reconciliation/Reporting Sources
- `PAY SUMMARY` sheet as aggregate/reconciliation probe
- branch/monthly summary sheets used for QA/reconciliation, not direct transaction loading

## Immediate Data-Model Implications

1. ENTRY reclassification
- `stg.eos*_entry` remains staged, but `source_family` is now `reference_entry`.
- Transaction loaders must not treat ENTRY rows as loadable operation lines.

2. Provider normalization model (future)
- Keep raw provider text for audit.
- Add normalized display naming and suffix handling (`Z`, `POD Z`, `PsychoT Z`, `Physio Z`).

3. Flexible service dimensions (future)
- Support selection/reporting by:
  - department/subdepartment
  - provider
  - provider + class
  - class only

4. Revenue-share and payout tracking (future)
- provider share
- clinic/user share
- provider paid flag/payment tracking
- client-income received tracking

5. Stripe classes/passes (future separate model)
- Keep separate from current transaction-line loader.

6. Apartments and bulk-pay model (future separate model)
- apartment-level selection + umbrella-level payments
- support agency/central bulk payments (e.g., central Qormi style)

7. Booking-system master model (future)
- per booking system master record with:
  - address
  - VAT number
  - multiple commission rates + descriptions
  - payment linkages (to/from)

## TO DO (Not Built Now)
- Build provider master + alias normalization from ENTRY.
- Build FLEX class dimension model (provider/class breakdown).
- Build Stripe pass/class pre-assignment model.
- Build apartments + bulk-pay capable model.
- Build booking-system commission master model.
- Build receipt-issued normalization policy (`pending`/`lost` -> `NO` until changed).
- Extract and formalize VAT-rate master from ENTRY reference area.

## Current Enforcement in SQL Chain
- `v_eos_stg_line_candidates_v1`: ENTRY rows marked `reference_entry` and non-load.
- `v_eos_stg_line_classification_v1`: `reference_entry` classified as `REFERENCE_ONLY`.
- Loaders remain strict and reject-first; they accept only `source_family='entry'`.

## Decision on eosz_entry staging
- Keep importing `stg.eosz_entry`.
- Role now: provenance-preserved reference/master-data staging for downstream master models,
  mapping, and audit; not operational transaction loading.
