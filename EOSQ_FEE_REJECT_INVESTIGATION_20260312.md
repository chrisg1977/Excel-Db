# EOSQ 2025 FEE Reject Investigation - 2026-03-12

Scope:
- Loader: `eos_stg_to_shift_fee_income_lines_insert_v1`
- Remaining rejects: 4
- Baseline constraints preserved: strict reject-first, no fabricated values, no PAY baseline changes

## Summary

Observed reject reasons:
- `{gross_amount_negative,vat_greater_than_gross}`: 3 rows
- `{gross_amount_negative}`: 1 row

High-confidence root cause:
- All 4 rows have negative gross amounts.
- Current SELL/FEE-safe parsing and strict loader rules treat negative gross as unresolved/invalid for v1 income canonical acceptance.
- One refund row also carries negative VAT/EX VAT text that is currently not accepted into parsed VAT/EX VAT candidates in this path.

## Row-Level Forensics

### 1) Candidate `659b0edbd8add7d3777c576263b267f1`
- Source: `EOSQ - 2025.xlsx`, `AugFee`, row `24`
- Raw A..N highlights:
  - A date: `2025-08-06 00:00:00`
  - B shift: `MORNING`
  - C dept: `MDCQ`
  - D description: `Matteo Dosi`
  - E detail: `DENTAL`
  - G subtype: `All Fee`
  - H gross: `-10`
  - J VAT amount: `0`
  - K receipt: `Yes`
  - L payment: `CASHBOX`
  - N signer: `CHARMAINE`
- Parsed/candidate:
  - `total_amount_candidate = -10.00`
  - `vat_amount_candidate = 0.00`
- Reject reasons: `{gross_amount_negative,vat_greater_than_gross}`
- Classification: refund/adjustment or sign inversion marker inside All Fee stream (not standard positive sale)
- Recommended handling now: keep rejected under current strict income rules.

### 2) Candidate `266996f7e1db3623e7dec96cd6379d2d`
- Source: `EOSQ - 2025.xlsx`, `AugFee`, row `69`
- Raw A..N highlights:
  - A date: `2025-08-12 00:00:00`
  - B shift: `AFTERNOON`
  - C dept: `MDCQ`
  - D description: `Bilal Bayrak`
  - E detail: `DENTAL`
  - G subtype: `All Fee`
  - H gross: `-50`
  - J VAT amount: `0`
  - K receipt: `yes`
  - L payment: `Revolut_77826685`
  - N signer: `Cristina`
- Parsed/candidate:
  - `total_amount_candidate = -50.00`
  - `vat_amount_candidate = 0.00`
- Reject reasons: `{gross_amount_negative,vat_greater_than_gross}`
- Classification: likely reversal/adjustment entered in All Fee subtype, not labeled as refund
- Recommended handling now: keep rejected under current strict income rules.

### 3) Candidate `975a9cb6b27557e97c6cf2f030fbf6d3`
- Source: `EOSQ - 2025.xlsx`, `AugFee`, row `104`
- Raw A..N highlights:
  - A date: `2025-08-22 00:00:00`
  - B shift: `AFTERNOON`
  - C dept: `APARTMENTS`
  - D description: `Matteo Roger`
  - E detail: `BLU-M CENTRAL QORMI  APT 5 / 10`
  - G subtype: `Refunds`
  - H gross: `-1500`
  - J VAT amount text: `-98.13084112149532`
  - K receipt: `Yes`
  - L payment: `BaNK TRANSFER`
  - N signer: `Miceyla`
- Parsed/candidate:
  - `total_amount_candidate = -1500.00`
  - `vat_amount_candidate = NULL` (negative VAT text present but not accepted in current candidate path)
- Reject reasons: `{gross_amount_negative}`
- Classification: true refund/reversal scenario (explicit subtype = `Refunds`) with negative amount signs
- Recommended handling now: keep rejected until explicit controlled refund model is approved.

### 4) Candidate `fddddd1c9732ebcb94c635e0168cb5ef`
- Source: `EOSQ - 2025.xlsx`, `DecFee`, row `58`
- Raw A..N highlights:
  - A date: `2025-12-18 00:00:00`
  - B shift: `MORNING`
  - C dept: `MDCQ`
  - D description: `Kim Sese`
  - E detail: `DENTAL`
  - G subtype: `All Fee`
  - H gross: `-50`
  - J VAT amount: `0`
  - K receipt: `Yes`
  - L payment: `Revolut_77826685`
  - N signer: `Cristina`
- Parsed/candidate:
  - `total_amount_candidate = -50.00`
  - `vat_amount_candidate = 0.00`
- Reject reasons: `{gross_amount_negative,vat_greater_than_gross}`
- Classification: likely reversal/adjustment in All Fee stream
- Recommended handling now: keep rejected under current strict income rules.

## Classification Outcome (All 4)

- True data error: 0 definitive
- Refund/reversal requiring explicit model support: 1 definitive (`Refunds` subtype), 3 probable adjustments/reversals
- Sign inversion issue: possible in 3 `All Fee` negatives
- Import/parsing artifact: partial on refund VAT parsing path for negative VAT candidate derivation
- Duplicate/reversal pair: no exact same-person+detail positive counterpart found in current candidate set

## Safest Corrective Strategy

Recommended immediate policy:
- Keep all 4 rows rejected in current v1 strict income loader.
- Do not relax global `gross_amount >= 0` acceptance rule.
- Add explicit future controlled lane for signed adjustments/refunds (separate from standard income lines) once business rules are approved.

Controlled acceptance option (future, gated):
- Introduce dedicated adjustment/refund canonical path/table (or explicit subtype gate) that allows signed amounts only for approved subtypes (for example `Refunds`) and requires additional controls:
  - mandatory subtype whitelist
  - mandatory operator/signer fields
  - immutable source linkage and reason code
  - separate reporting bucket from positive gross income

## Financial Integrity Impact

If kept rejected now:
- Financial integrity risk: low
- Reporting completeness risk: minor (4 rows remain out-of-band)
- Baseline trust: preserved

If globally allowing negative gross now:
- Financial integrity risk: high (could admit accidental sign errors as valid income lines)
- Recommendation: do not do this.

If adding controlled refund/adjustment lane later:
- Financial integrity risk: moderate-to-low if subtype-gated and audited
- Benefit: complete accounting coverage for legitimate reversals without weakening baseline acceptance rules.
