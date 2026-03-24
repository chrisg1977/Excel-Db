# Inventory Invariant Verification - 2026-03-16

Scope: pre-feature verification for inventory/location/transfer behaviors.

## Summary

- Invariant 1: `PASS (code-path)` / `NOT EXERCISED (live data currently has no null-location rows)`
- Invariant 2: `PASS`
- Invariant 3: `PASS`
- Invariant 4: `PASS`
- Invariant 5: `PASS`

## 1) Historical rows with null `location_id` still work everywhere

Status: `PASS (code-path)`

Evidence:
- Department stock endpoint aggregates from `inv_ledger` without requiring `location_id`; this inherently includes legacy/null-location rows.
  - `dashboard/server.js:1036`
- Product stock endpoint uses `LEFT JOIN inv_location` and allows `l.location_id IS NULL` in inactive-location filtering branch.
  - `dashboard/server.js:1308`
  - `dashboard/server.js:1340`
- Scope guard allows null location rows via `OR ${locationExpr} IS NULL`.
  - `dashboard/server.js:233`

Live data note:
- Current DB has no null-location ledger rows to empirically exercise this path today.
- Query result: `null_location_ledger_rows = 0`

## 2) Department totals aggregate correctly with location-specific rows present

Status: `PASS`

Evidence:
- Department total view is derived directly from ledger by `(product_id, department_id)`.
  - `sql/eos_location_backcompat_guards_v1.sql:12`
- Live reconciliation check against `vw_inv_stock_position_by_department` is exact both directions.
  - Query: ledger aggregate EXCEPT view => `agg_diff = 0`
  - Query: view EXCEPT ledger aggregate => `reverse_agg_diff = 0`

## 3) Transfer print output null-location fallback text

Required fallback: `Department-level / Unspecified location`

Status: `PASS`

Evidence:
- Print formatter explicitly returns fallback when both code/name are empty.
  - `dashboard/server.js:3574`
- UI helper uses the same fallback text.
  - `dashboard/inventory-ui/src/lib/inventoryApi.ts:281`

## 4) Scope enforcement consistency

Status: `PASS`

### by-department stock endpoint
- Endpoint includes location-scope clause for non-admin users.
  - `dashboard/server.js:986`
  - `dashboard/server.js:1051`

### by-location stock endpoint
- Endpoint includes location-scope clause for non-admin users.
  - `dashboard/server.js:1106`
  - `dashboard/server.js:1170`

### transfer list
- Transfer list applies source and target location scope clauses for non-admin users.
  - `dashboard/server.js:1755`
  - `dashboard/server.js:1849`

### transfer create
- Enforces department permission and source/target location scope checks.
  - `dashboard/server.js:3264`
  - `dashboard/server.js:3302`

### transfer dispatch
- Enforces source department permission and source location scope check.
  - `dashboard/server.js:3335`
  - `dashboard/server.js:3359`

### transfer receive
- Enforces receiver department permission and receiver location scope check.
  - `dashboard/server.js:3381`
  - `dashboard/server.js:3421`

## 5) No operational screen shows inactive locations by default

Status: `PASS`

Backend evidence:
- Transfer form options API returns only active/available locations.
  - `dashboard/server.js:2952`
  - `dashboard/server.js:2953`
- Stock-by-location endpoint defaults `include_inactive=false`.
  - `dashboard/server.js:1111`
- Product stock breakdown endpoint defaults `include_inactive=false`.
  - `dashboard/server.js:1253`

Frontend evidence:
- Transfer location filtering helper excludes inactive/unavailable locations.
  - `dashboard/inventory-ui/src/lib/transferApi.ts:155`
- Operational transfer screens source location options from transfer-form-options + helper filtering.
  - `dashboard/inventory-ui/src/pages/TransferDispatchPage.tsx:87`
  - `dashboard/inventory-ui/src/pages/TransferReceivePage.tsx:99`
  - `dashboard/inventory-ui/src/pages/TransferListPage.tsx:48`
  - `dashboard/inventory-ui/src/pages/TransferPendingPage.tsx:30`

Note:
- `Location Master` can intentionally toggle active filter and is considered an administrative maintenance screen, not an operational transaction screen.
  - `dashboard/server.js:1988`
  - `dashboard/inventory-ui/src/lib/locationApi.ts:114`
