# EOS Naming Convention

This document captures the current backend naming conventions for EOS and product foundation work in this repository.

## 1) API Route Naming

- Base prefix for EOS APIs: `/api/eos/...`
- Service location: `od-importer/src/server.ts`
- Style:
  - Resource-oriented paths
  - Action suffixes only where needed (for lifecycle transitions)
  - Lowercase, hyphenated path segments

### Current EOS routes

- `GET /api/eos/production-visits`
- `POST /api/eos/discrepancy-events`
- `POST /api/eos/shift-sessions`
- `POST /api/eos/shift-sessions/:id/takeover`
- `POST /api/eos/shift-sessions/:id/abandon`
- `POST /api/eos/shift-sessions/:id/supersede`

### Related shared routes (same service)

- `GET /api/locations`
- `GET /api/departments`
- `GET /api/departments/:id/manager-resolution-preview`
- `GET /api/employees`
- `GET /api/leave/availability`

## 2) SQL Object Naming

### 2.1 Tables

- EOS domain table prefix: `eos_`
- Canonical product foundation tables:
  - `eos_product_master`
  - `eos_product_identity`
  - `eos_product_attributes_history`
  - `eos_product_pricing_history`

### 2.2 Views

- EOS view prefix: `v_eos_`
- Version suffix: `_v1`, `_v2`, etc.
- PRODUCTLIST views:
  - `v_eos_productlist_raw_v1`
  - `v_eos_productlist_candidates_v1`

### 2.3 Loaders / Pipelines

- Staging/loader prefix: `eos_stg_`
- Insert loader pattern: `eos_stg_to_<target>_insert_v1.sql`
- Dry-run loader pattern: `eos_stg_to_<target>_dry_run_v1.sql`
- PRODUCTLIST loaders:
  - `eos_stg_to_product_master_dry_run_v1.sql`
  - `eos_stg_to_product_master_insert_v1.sql`

### 2.4 Schema migrations

- Schema scripts use `_schema_v1.sql` suffix.
- Examples:
  - `eos_product_master_schema_v1.sql`
  - `eos_product_identity_schema_v1.sql`

## 3) Versioning Rules

- All non-trivial EOS SQL artifacts should be versioned with explicit suffixes.
- Never overwrite history by changing semantic behavior silently under same version name.
- Introduce a new version file when behavior/contract changes materially.

## 4) Data-flow Convention

- Preferred flow:
  1. raw view (`v_eos_*_raw_vN`)
  2. candidate/classification view (`v_eos_*_candidates_vN`)
  3. dry-run loader (`eos_stg_to_*_dry_run_vN`)
  4. strict insert loader (`eos_stg_to_*_insert_vN`)

## 5) Product Identity Convention

- Identity table: `eos_product_identity`
- Supported identity types currently include:
  - `barcode`
  - `special_identity`
  - `distributor_barcode`
- Keep one active primary identity per product where possible (`is_primary = true`, `effective_to IS NULL`).

## 6) Current Guardrails

- Reject-first validation before canonical insert.
- History-first modeling for attributes and pricing (effective date windows).
- Supplier remains raw label in attributes history until supplier canonical model is introduced.
- PAY/FEE/SELL baselines remain isolated from PRODUCTLIST product foundation path.

## 7) Change Control Note

For new EOS/product SQL work:

- follow existing prefix and version patterns,
- preserve idempotency where possible,
- avoid destructive changes to unrelated domains,
- document route/table/view naming changes in this file.

## 8) Inventory Naming (Approved Draft)

### 8.1 Canonical tables (`eos_`)

- `eos_inventory_locations`
  - Use only if inventory must not read location master directly.
- `eos_inventory_levels`
  - Current stock state per `product_id` + `location_id` (on hand, reserved, etc.).
- `eos_inventory_movements`
  - Immutable movement ledger for adjustments, transfers, and stocktake variances.
- `eos_inventory_stocktake_sessions`
  - Session header (location, area, user, status, timestamps).
- `eos_inventory_stocktake_lines`
  - Session line rows (expected, counted, variance).

### 8.2 Read-optimized views (`v_eos_*_v1`)

- `v_eos_inventory_products_v1`
  - Product-centric inventory list with aggregated inventory metrics.
- `v_eos_inventory_product_detail_v1`
  - Single-product detail model with per-location stock and recent movements.
- `v_eos_inventory_locations_v1`
  - Location KPIs (SKU count, low/out-of-stock counts, to-count count, last stocktake).
- `v_eos_inventory_location_stock_v1`
  - Location-scoped product rows (on hand, minimum, variance, status).
- `v_eos_inventory_movements_v1`
  - Movement log read model with product/location/user labels.

### 8.3 Staging and reject-first loaders (`eos_stg_to_*_v1`)

- `eos_stg_to_inventory_levels_dry_run_v1.sql`
- `eos_stg_to_inventory_levels_insert_v1.sql`
- `eos_stg_to_inventory_movements_dry_run_v1.sql`
- `eos_stg_to_inventory_movements_insert_v1.sql`

Additional staging tables should continue the `eos_stg_*` pattern where batch loads are required.

### 8.4 Schema scripts

- `eos_inventory_levels_schema_v1.sql`
- `eos_inventory_movements_schema_v1.sql`
- `eos_inventory_stocktake_sessions_schema_v1.sql`
- `eos_inventory_stocktake_lines_schema_v1.sql`

### 8.5 Query-sourcing rule

Product truth remains in canonical product tables only:

- `eos_product_master`
- `eos_product_identity`
- `eos_product_attributes_history`
- `eos_product_pricing_history`

Inventory endpoints should join product truth to `eos_inventory_*` and `v_eos_inventory_*_v1` models.
Do not duplicate product attributes/pricing truth in inventory state tables.

## 9) Inventory Contract Session Checklist (30 min)

- Pagination standard: `page/perPage` vs cursor; define global max page size.
- Search/filter key standardization: `q`, `locationId`, `status`, `category`, `supplier`.
- Sort policy: endpoint-level `sortBy` whitelists and defaults.
- Timezone policy: store UTC for `createdAt`, `startedAt`, `lastCountedAt`; UI converts for display.
- Concurrency on `eos_inventory_levels`:
  - choose optimistic lock strategy (`version` or `row_version`),
  - define `STOCK_CONFLICT` behavior.
- Stocktake locking:
  - enforce one open session per `locationId + areaCode` or not,
  - decide single-editor vs concurrent editor semantics.
- Error code taxonomy finalization:
  - `STOCK_CONFLICT`
  - `SESSION_CLOSED`
  - `INSUFFICIENT_STOCK`
  - `INVALID_LOCATION`
  - `VALIDATION_ERROR`
  - plus any additional inventory-specific codes.
- Idempotency requirement:
  - for adjustments,
  - transfers,
  - stocktake finalize.
- Performance guardrails:
  - max `perPage` for heavy endpoints,
  - query limits under peak clinic usage.
- CSV export policy:
  - synchronous for small sets,
  - async job/download for large sets.
- Audit requirements:
  - actor, before/after quantities, reason, reference, timestamps.
- Movement reason-code master:
  - source of truth,
  - localization,
  - validation strictness.
- Reservation semantics:
  - what sets `quantity_reserved`,
  - when it is released.
- Product identity precedence for lookups/scans:
  - `barcode` vs `special_identity` vs `distributor_barcode`.
- Initial rollout scope:
  - read-only first or mixed,
  - write operations behind feature flag/role controls.
