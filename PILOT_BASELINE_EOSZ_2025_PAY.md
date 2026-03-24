# EOSZ 2025 PAY Pilot Baseline (Accepted)

Date: 2026-03-12
Repository: `chrisg1977/Excel-Db`
Branch: `copilot/create-hr-dashboard-interface`

## Scope
- Branch/workbook source: `C:\Users\User\Desktop\CURRENT BACKUP\EOSZ - 2025.xlsx`
- Pipeline mode: PAY-only (`source_family='PAY'`)
- Staging import mode: `--truncate-matched --map-by-position --pay-ao-only`
- Excluded from first canonical pilot: FEE, SELL, ENTRY, PAY SUMMARY

## Baseline KPIs
- `eos_shift_header`: 157
- `eos_shift_payment_lines`: 327
- `eos_shift_payment_line_source_details`: 327
- `eos_stg_rejects`: 23
- `bad_vat_defaults`: 0

## Integrity/Honesty Assertions
- No invented/default VAT rows remain (`bad_vat_defaults = 0`).
- Unresolved VAT rows are reject-first, not coerced (`vat_unresolved`/`ex_vat_unresolved` in rejects).
- Source preservation sidecar is 1:1 with canonical payment lines.

## Evidence Artifacts
- Full reject detail extract (23 rows): `scripts/eosz_pay_rejects_23_detailed_pipe.txt`

## Reject Remediation Pass (2026-03-12)
- Deterministic amount completion added where mathematically derivable:
	- `vat = total - ex_vat`
	- `ex_vat = total - vat`
	- `total = ex_vat + vat`
- Non-financial PAY noise rows filtered out when zero/blank amount signal indicates no transactional value.
- Receipt-state normalization aligned to loader domain (`with_receipt` / `no_receipt`) with conservative blank `CASHBOX` fallback.

### Post-Remediation KPIs
- `eos_shift_header`: 157
- `eos_shift_payment_lines`: 336
- `eos_shift_payment_line_source_details`: 336
- `eos_stg_rejects`: 0

### Delta vs Initial Baseline
- Accepted payment lines: `327 -> 336` (`+9`)
- Total rejects: `23 -> 0` (`-23`)
