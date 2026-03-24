# EOS Inventory & Stocktake

This is the entry point for the EOS / MCodex inventory and stock-taking workstream (Shopify-style UI + EOS API + SQL objects) in the Excel-Db repo.

## 1. Scope

- Internal Shopify-like inventory UI (no public e-commerce).
- Features:
  - Products list with inventory summary and filters.
  - Product detail with per-location stock and recent movements.
  - Locations overview and location-scoped inventory view.
  - Stocktake sessions (create, count, review, finalize).
  - Inventory movements log (adjustments, transfers, stocktake variances).

## 2. Frontend (Shopify-style UI)

Main routes (served by the dashboard app):

- `/inventory/products`
- `/inventory/products/:productId`
- `/inventory/locations`
- `/inventory/locations/:locationId/stocktake`
- `/inventory/movements`

UX principles:

- Layout mimics Shopify Admin:
  - Left sidebar navigation.
  - Top search / filters bar.
  - Central content area with:
    - Metric cards row.
    - Sticky-header tables with bulk selection.
    - Status badges / chips (low stock, out of stock, to count, etc.).
- Read-only dashboards first, write operations behind feature flags / roles.

See also:

- `dashboard/README.md` - overall dashboard app notes.
- (Planned) frontend inventory notes in `dashboard/` or `dashboard/inventory-ui/README.md`.

## 3. EOS API - Inventory / Stocktake

All routes live under `/api/eos/...` in `server.ts`, following existing EOS conventions.[page:1]

Key endpoints (high-level):

- `GET /api/eos/inventory-products`
- `GET /api/eos/inventory-products/:id`
- `GET /api/eos/inventory-locations`
- `GET /api/eos/inventory-locations/:id/stock`
- `POST /api/eos/inventory-stocktake-sessions`
- `PATCH /api/eos/inventory-stocktake-sessions/:id`
- `POST /api/eos/inventory-stocktake-sessions/:id/lines`
- `POST /api/eos/inventory-stocktake-sessions/:id/finalize`
- `POST /api/eos/inventory-adjustments`
- `POST /api/eos/inventory-transfers`
- `GET /api/eos/inventory-movements`

Conventions:

- Error envelope (shared):

```json
{
  "code": "STRING_CODE",
  "message": "Human readable message",
  "details": {}
}
```

- Pagination envelope:

```json
{
  "data": [],
  "pagination": { "page": 1, "perPage": 25, "total": 0, "pages": 0 }
}
```

- Product identity/pricing is always sourced from canonical `eos_product_*` tables.

The full request/response shapes live in the inventory API contract (see below).

## 4. SQL / Views / Loaders

Naming is aligned with `EOS_NAMING_CONVENTION.md`.[page:1]

Canonical tables:

- `eos_inventory_locations`
- `eos_inventory_levels`
- `eos_inventory_movements`
- `eos_inventory_stocktake_sessions`
- `eos_inventory_stocktake_lines`

Read-optimised views:

- `v_eos_inventory_products_v1`
- `v_eos_inventory_product_detail_v1`
- `v_eos_inventory_locations_v1`
- `v_eos_inventory_location_stock_v1`
- `v_eos_inventory_movements_v1`

Staging / loaders:

- `eos_stg_to_inventory_levels_dry_run_v1.sql`
- `eos_stg_to_inventory_levels_insert_v1.sql`
- `eos_stg_to_inventory_movements_dry_run_v1.sql`
- `eos_stg_to_inventory_movements_insert_v1.sql`

Schema scripts (in `sql/`):

- `sql/eos_inventory_levels_schema_v1.sql`
- `sql/eos_inventory_movements_schema_v1.sql`
- `sql/eos_inventory_stocktake_sessions_schema_v1.sql`
- `sql/eos_inventory_stocktake_lines_schema_v1.sql`

Product truth (do not duplicate):

Always join from:

- `eos_product_master`
- `eos_product_identity`
- `eos_product_attributes_history`
- `eos_product_pricing_history`

Inventory tables carry foreign keys + inventory-specific fields only.

## 5. Alignment & Open Questions

Before/while implementing, use the contract-session checklist in
`EOS_NAMING_CONVENTION.md` (Sections 8-9) to align on:

- Pagination standard and limits.
- Search/filter key naming (`q`, `locationId`, `status`, `category`, `supplier`, etc.).
- Sort key whitelist + defaults per endpoint.
- Timezone strategy for dates (UTC storage, local display).
- Concurrency model for stock changes (optimistic locking, conflict handling).
- Stocktake locking rules (per `locationId` + `areaCode`).
- Error taxonomy (`STOCK_CONFLICT`, `SESSION_CLOSED`, `INSUFFICIENT_STOCK`, `INVALID_LOCATION`, `VALIDATION_ERROR`, ...).
- Idempotency strategy for adjustments, transfers, finalize.
- CSV export behaviour (sync vs async job for large sets).
- Audit requirements and movement reason-code master list.
- Reservation semantics (`quantity_reserved` write/release rules).
- Product identity precedence for lookups (barcode vs special identity vs distributor barcode).
- Initial rollout scope (read-only dashboards vs writes behind feature flags / roles).

## 6. Related docs in Excel-Db

Root:

- `EOS_NAMING_CONVENTION.md` - naming rules and inventory sections 8-9.
- `README.md` - repo-level context.
- `DEPLOYMENT_CHECKLIST.md` - deployment notes.

Dashboard:

- `dashboard/README.md`

SQL:

- `sql/*.md` - SQL-specific notes.

Importers:

- `importer/forms/README.md`
- `od-importer/README.md`
- `od-importer/scripts/README.md`

This file lives in the repo root as:

- `EOS_INVENTORY_STOCKTAKE_README.md`
