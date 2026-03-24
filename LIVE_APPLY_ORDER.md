# Live Apply Order (EOS Inventory)

This is the canonical order to apply EOS inventory migrations safely in live/prod while preserving current view contracts and idempotent behavior.

## 1) Apply SQL in order

Run from repo root (`C:\Users\User\Excel-Db`):

```powershell
$files = @(
  'sql/eos_project_decision_log_schema_v1.sql',
  'sql/eos_inventory_posting_rules_v1.sql',
  'sql/eos_inventory_roles_and_scope_seed_v1.sql',
  'sql/eos_sell_inventory_integration_v1.sql',
  'sql/eos_transfer_workflow_v1.sql',
  'sql/eos_employee_permission_wiring_v1.sql',
  'sql/eos_inventory_reporting_views_v1.sql',
  'sql/eos_centralized_location_model_v1.sql',
  'sql/eos_location_lifecycle_hardening_v1.sql',
  'sql/eos_location_backcompat_guards_v1.sql'
)

foreach ($f in $files) {
  if (Test-Path $f) {
    Write-Host "Applying $f"
    Get-Content -Raw $f | docker exec -i pg_excel psql -U excel -d exceldb
  } else {
    Write-Host "Missing $f"
  }
}
```

## 2) Build UI

```powershell
cd dashboard/inventory-ui
npm run build
cd ../..
```

## 3) Deploy live

```powershell
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
```

## 4) Post-apply verification

### 4.1 Core object checks
```powershell
docker exec -i pg_excel psql -U excel -d exceldb -c "SELECT to_regclass('public.inv_transfer_header') AS inv_transfer_header, to_regclass('public.inv_location') AS inv_location, to_regclass('public.inv_stock_balance_location') AS inv_stock_balance_location, to_regclass('public.vw_inv_stock_position_by_department') AS vw_inv_stock_position_by_department, to_regclass('public.vw_inv_stock_position_by_location') AS vw_inv_stock_position_by_location, to_regclass('public.vw_inv_stock_position_expanded') AS vw_inv_stock_position_expanded;"
```

### 4.2 Department stock view contract (must stay unchanged)
Expected columns:
- `product_id`
- `department_id`
- `on_hand_qty`
- `stock_value`

```powershell
docker exec -i pg_excel psql -U excel -d exceldb -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='vw_inv_stock_position_by_department' ORDER BY ordinal_position;"
```

### 4.3 Location stock view contract
Expected columns:
- `product_id`
- `department_id`
- `location_id`
- `on_hand_qty`
- `stock_value`

```powershell
docker exec -i pg_excel psql -U excel -d exceldb -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='vw_inv_stock_position_by_location' ORDER BY ordinal_position;"
```

### 4.4 Transfer location columns
```powershell
docker exec -i pg_excel psql -U excel -d exceldb -c "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='inv_transfer_header' AND column_name IN ('source_location_id','target_location_id') ORDER BY column_name;"
```

### 4.5 Location-aware function compile checks
```powershell
docker exec -i pg_excel psql -U excel -d exceldb -c "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND proname IN ('fn_inv_transfer_create_v2','fn_inv_transfer_dispatch_v2','fn_inv_transfer_receive_v2','fn_inv_location_validate_transfer_v1') ORDER BY proname;"
```

### 4.6 Backward compatibility checks (nullable location columns)
```powershell
docker exec -i pg_excel psql -U excel -d exceldb -c "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='inv_ledger' AND column_name IN ('location_id','source_location_id','target_location_id') ORDER BY column_name;"
```

### 4.7 Aggregate parity check (department view vs ledger)
```powershell
docker exec -i pg_excel psql -U excel -d exceldb -c "SELECT COUNT(*) AS agg_diff FROM ( SELECT product_id, department_id, SUM(qty_delta) AS qty_sum, SUM(value_delta) AS val_sum FROM inv_ledger GROUP BY product_id, department_id EXCEPT SELECT product_id, department_id, on_hand_qty, stock_value FROM vw_inv_stock_position_by_department ) t;"
```

Expected: `agg_diff = 0`.

## 5) Known migration constraints

- `vw_inv_stock_position_by_department` must keep its 4-column contract to avoid breaking existing API/UI consumers.
- If additional detail is needed, add new views (`vw_inv_stock_position_by_location`, `vw_inv_stock_position_expanded`) instead of changing the department view shape.
- `inv_ledger.location_id` remains nullable for backward compatibility unless/until a full backfill strategy is completed.

## 6) Quick one-shot run (optional)

```powershell
cd c:/Users/User/Excel-Db
$files = @('sql/eos_project_decision_log_schema_v1.sql','sql/eos_inventory_posting_rules_v1.sql','sql/eos_inventory_roles_and_scope_seed_v1.sql','sql/eos_sell_inventory_integration_v1.sql','sql/eos_transfer_workflow_v1.sql','sql/eos_employee_permission_wiring_v1.sql','sql/eos_inventory_reporting_views_v1.sql','sql/eos_centralized_location_model_v1.sql','sql/eos_location_lifecycle_hardening_v1.sql','sql/eos_location_backcompat_guards_v1.sql'); foreach ($f in $files) { if (Test-Path $f) { Write-Host "Applying $f"; Get-Content -Raw $f | docker exec -i pg_excel psql -U excel -d exceldb | Out-Host } else { Write-Host "Missing $f" } }; cd dashboard/inventory-ui; npm run build; cd ../..; docker compose -f docker-compose.prod.yml up -d --build; docker compose -f docker-compose.prod.yml ps
```
