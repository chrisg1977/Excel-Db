param(
  [string]$BackupRoot = "backups",
  [switch]$IncludeProjectZip
)

$ErrorActionPreference = "Stop"

$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = Join-Path $BackupRoot $timestamp
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

$container = "pg_excel"
$dumpFile = Join-Path $backupDir "exceldb.sql"

Write-Host "Creating PostgreSQL dump from container '$container'..."
docker exec $container pg_dump -U excel -d exceldb --no-owner --no-privileges > $dumpFile

if (-not (Test-Path $dumpFile) -or (Get-Item $dumpFile).Length -eq 0) {
  throw "Database dump failed or produced an empty file: $dumpFile"
}

Copy-Item -Path "docker-compose.yml" -Destination (Join-Path $backupDir "docker-compose.yml")
if (Test-Path "sql") {
  Copy-Item -Path "sql" -Destination (Join-Path $backupDir "sql") -Recurse
}

if ($IncludeProjectZip) {
  $zipPath = Join-Path $backupDir "project_snapshot.zip"
  Write-Host "Creating project snapshot zip..."
  Compress-Archive -Path `
    "docker-compose.yml", `
    "package.json", `
    "tsconfig.json", `
    "src", `
    "sql", `
    "Instructions" `
    -DestinationPath $zipPath -Force
}

$latestFile = Join-Path $BackupRoot "LATEST.txt"
$backupDir | Set-Content -Path $latestFile -Encoding UTF8

Write-Host ""
Write-Host "Backup complete:"
Write-Host "  $backupDir"
Write-Host "  DB dump: $dumpFile"
