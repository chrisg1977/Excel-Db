param(
  [string]$HealthUrl = "http://127.0.0.1:4020/health",
  [int]$CheckIntervalSec = 30,
  [int]$FailThreshold = 3,
  [string]$AppName = "od-importer",
  [string]$RepoRoot = "C:\Users\User\Excel-Db",
  [string]$Pm2Cmd = "C:\Users\User\AppData\Roaming\npm\pm2.cmd",
  [string]$LogFile = "C:\Users\User\Excel-Db\od-importer\watchdog.log"
)

$ErrorActionPreference = 'Stop'

$mutexName = "Local\od-importer-watchdog"
$createdNew = $false
$mutex = New-Object System.Threading.Mutex($false, $mutexName, [ref]$createdNew)
if (-not $createdNew) {
  exit 0
}

function Write-Log {
  param([string]$Message)
  $line = "$(Get-Date -Format s) [watchdog] $Message"
  Add-Content -Path $LogFile -Value $line -Encoding Ascii
}

function Test-Health {
  param([string]$Url)
  try {
    $resp = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
    return ($resp.StatusCode -ge 200 -and $resp.StatusCode -lt 300)
  } catch {
    return $false
  }
}

function Ensure-App {
  if (-not (Test-Path $Pm2Cmd)) {
    Write-Log "pm2 not found at $Pm2Cmd"
    return
  }

  Push-Location $RepoRoot
  try {
    # Keep daemon and process list in sync.
    & $Pm2Cmd resurrect | Out-Null

    $statusOut = & $Pm2Cmd status $AppName 2>&1 | Out-String
    if ($statusOut -notmatch [regex]::Escape($AppName)) {
      Write-Log "App not found in PM2 list; starting ecosystem config"
      & $Pm2Cmd start "od-importer/ecosystem.config.cjs" | Out-Null
      & $Pm2Cmd save | Out-Null
      return
    }

    if ($statusOut -match "\bonline\b") {
      return
    }

    Write-Log "App found but not online; restarting $AppName"
    & $Pm2Cmd restart $AppName | Out-Null
    & $Pm2Cmd save | Out-Null
  } finally {
    Pop-Location
  }
}

Write-Log "watchdog started (url=$HealthUrl interval=${CheckIntervalSec}s threshold=$FailThreshold)"
$failCount = 0

while ($true) {
  $ok = Test-Health -Url $HealthUrl
  if ($ok) {
    if ($failCount -gt 0) {
      Write-Log "health recovered"
    }
    $failCount = 0
  } else {
    $failCount++
    Write-Log "health check failed ($failCount/$FailThreshold)"
    if ($failCount -ge $FailThreshold) {
      Write-Log "attempting auto-recovery"
      Ensure-App
      Start-Sleep -Seconds 8
      if (Test-Health -Url $HealthUrl) {
        Write-Log "auto-recovery succeeded"
        $failCount = 0
      } else {
        Write-Log "auto-recovery attempt did not restore health"
      }
    }
  }

  Start-Sleep -Seconds $CheckIntervalSec
}
