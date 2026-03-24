param(
  [switch]$SkipBuild,
  [switch]$SkipDeploy
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "[live-apply] Repo: $repoRoot"

$sqlFiles = @(
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

foreach ($file in $sqlFiles) {
  if (-not (Test-Path $file)) {
    throw "Missing SQL file: $file"
  }

  Write-Host "[live-apply] Applying $file"
  $sql = Get-Content -Raw $file
  $sql | docker exec -i pg_excel psql -U excel -d exceldb | Out-Host
}

if (-not $SkipBuild) {
  Write-Host "[live-apply] Building inventory UI"
  Push-Location "dashboard/inventory-ui"
  try {
    npm run build | Out-Host
  } finally {
    Pop-Location
  }
} else {
  Write-Host "[live-apply] Skipping UI build"
}

if (-not $SkipDeploy) {
  Write-Host "[live-apply] Deploying docker compose prod"
  docker compose -f docker-compose.prod.yml up -d --build | Out-Host
  docker compose -f docker-compose.prod.yml ps | Out-Host
} else {
  Write-Host "[live-apply] Skipping deploy"
}

Write-Host "[live-apply] Verifying critical DB contracts"

docker exec -i pg_excel psql -U excel -d exceldb -c "SELECT to_regclass('public.inv_transfer_header') AS inv_transfer_header, to_regclass('public.inv_location') AS inv_location, to_regclass('public.vw_inv_stock_position_by_department') AS vw_inv_stock_position_by_department, to_regclass('public.vw_inv_stock_position_by_location') AS vw_inv_stock_position_by_location, to_regclass('public.vw_inv_stock_position_expanded') AS vw_inv_stock_position_expanded;" | Out-Host

docker exec -i pg_excel psql -U excel -d exceldb -c "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='vw_inv_stock_position_by_department' ORDER BY ordinal_position;" | Out-Host

docker exec -i pg_excel psql -U excel -d exceldb -c "SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='inv_ledger' AND column_name IN ('location_id','source_location_id','target_location_id') ORDER BY column_name;" | Out-Host

docker exec -i pg_excel psql -U excel -d exceldb -c "SELECT COUNT(*) AS agg_diff FROM ( SELECT product_id, department_id, SUM(qty_delta) AS qty_sum, SUM(value_delta) AS val_sum FROM inv_ledger GROUP BY product_id, department_id EXCEPT SELECT product_id, department_id, on_hand_qty, stock_value FROM vw_inv_stock_position_by_department ) t;" | Out-Host

Write-Host "[live-apply] Complete"
