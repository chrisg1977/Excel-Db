# OpenDental Provider Fees Import — Groundwork Audit

## Scope clarified
- **provider** = dentist / dental surgeon / hygienist (OpenDental clinician identity).
- **provider payroll** = payroll stream/process for those providers.

This note captures what is already present in this repository so we can avoid duplicate pathways/fields before implementing monthly provider-fee imports.

## Groundwork already present (reuse)

### 1) OpenDental ↔ internal identity mapping exists
- `od_provider_map` stores provider-side identity coming from OpenDental/user mapping, including `od_prov_num` and `od_user_num`.
- `od_provider_link` links OpenDental provider identity to internal employee (optional) and records whether the person is `PROVIDER`, `EMPLOYEE`, or `BOTH`.
- `od_payroll_employee_map` + `od_employee_link` already cover main employee payroll mappings.

Relevant files:
- `sql/od_payroll_mapping_schema.sql`
- `sql/od_payroll_mapping_seed.sql`
- `sql/od_payroll_linking.sql`

### 2) Provider payment storage already exists (separate from main payroll)
- `provider_payments` table exists and is explicitly documented as separate from main payroll.
- It currently stores payment-level data (`provider_id`, `payment_date`, `hours`, `amount`, method/status), but **not** raw OpenDental production rows.

Relevant file:
- `sql/provider_payments_schema.sql`

### 3) Payroll subscription model already supports provider payroll stream
- `payroll_subscriptions` supports `MAIN`, `PROVIDER`, `THIRDPARTY` payroll types.
- Includes OpenDental sync metadata (`od_provider_num`, `od_employee_num`, sync status fields).

Relevant file:
- `sql/payroll_subscriptions_schema.sql`

### 4) Existing OpenDental import pattern already established
- Build-order document and importer components already define the pattern:
  - query OpenDental MySQL,
  - map to internal identities,
  - upsert into internal tables with idempotency,
  - log imports.
- Existing implemented importer path currently targets **timesheets/clockevent**, not provider production.

Relevant files:
- `OPEN_DENTAL_IMPORT_BUILD_ORDER.md`
- `od-importer/src/importer.ts`
- `sql/od_timesheets_schema.sql`

## Gaps specifically for provider-fee earnings import

1. There is no dedicated table yet for **raw monthly provider production/fees** from `procedurelog` (e.g., `ProcFee`, `ProcDate`, `ProvNum`, optional clinic breakdown).
2. Existing provider payment table is a settlement/output table, not a raw-import ledger.
3. Existing SQL linking script currently relies on first/last name joins for mapping in places, which is fragile for long-term maintenance.

## Non-duplicating implementation path

1. **Keep existing mapping tables** (`od_provider_map`, `od_provider_link`) as the identity bridge.
2. **Add one raw import table** for provider production (source-of-truth import ledger), keyed by source identifiers and import period.
3. **Default import mode**: full month + one provider + all clinics.
4. **Optional mode**: date range + clinic split/grouping.
5. **Compute dues/commissions downstream** from raw imported production (do not overwrite raw source rows).

## Minimum data model for new raw import ledger
- `import_batch_id`
- `period_start`, `period_end`
- `od_prov_num` (OpenDental provider key)
- `provider_id` (internal mapped key from `od_provider_map.provider_id`)
- `proc_date`
- `clinic_num` (nullable for all-clinic rollups)
- `proc_fee_gross`
- `source_system` (`OpenDental`)
- `source_row_hash` or natural key for idempotency
- `imported_at`

## Query semantics to preserve from legacy workbook behavior
- Filter completed procedures only (`ProcStatus = 2`).
- Filter by provider identity (prefer `ProvNum` / `od_prov_num`, not names).
- Filter by period (default whole month).
- Sum `ProcFee` by required granularity (monthly total and optionally by clinic/date).

## Implementation order (concise)
1. Add SQL migration for raw provider-fee import table + indexes/uniqueness.
2. Add importer module in `od-importer` for `procedurelog` production import.
3. Reuse existing import logging/idempotent upsert pattern.
4. Add service endpoint/trigger for month/provider/(optional clinic split).
5. Add dues calculation layer consuming imported raw rows.
