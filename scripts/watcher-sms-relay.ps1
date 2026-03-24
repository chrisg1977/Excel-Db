#Requires -Version 5
<#
.SYNOPSIS
    Relay OTP SMS request files from the Docker-accessible local queue
    into M:\SMSConfirm\reminder_requests where the watcher picks them up.

.DESCRIPTION
    Docker cannot write directly to M: (network drive), so Directus writes
    *.req.json files to C:\watcher-sms-queue.  This script polls that
    folder every 5 seconds and moves any new files to the watcher queue.

    Run once as a scheduled task (SYSTEM account, At Startup, no window):
        schtasks /Create /TN "WatcherSmsRelay" /TR "pwsh -NonInteractive -File C:\Users\User\Excel-Db\scripts\watcher-sms-relay.ps1" /SC ONSTART /RU SYSTEM /F

    Or start manually in a background window:
        Start-Process pwsh -ArgumentList "-NonInteractive -WindowStyle Hidden -File C:\Users\User\Excel-Db\scripts\watcher-sms-relay.ps1" -WindowStyle Hidden
#>

$src = "C:\watcher-sms-queue"
$dst = "M:\SMSConfirm\reminder_requests"

# Ensure source directory exists (created at startup if missing)
if (-not (Test-Path $src)) { New-Item -ItemType Directory -Path $src -Force | Out-Null }

Write-Host "[watcher-sms-relay] Started. $src -> $dst  (poll every 5s)"

while ($true) {
    if (Test-Path $dst) {
        $files = Get-ChildItem -Path $src -Filter "*.req.json" -File -ErrorAction SilentlyContinue
        foreach ($f in $files) {
            $target = Join-Path $dst $f.Name
            try {
                Move-Item -Path $f.FullName -Destination $target -Force -ErrorAction Stop
                Write-Host "[watcher-sms-relay] Relayed: $($f.Name)"
            } catch {
                Write-Warning "[watcher-sms-relay] Failed to relay $($f.Name): $_"
            }
        }
    } else {
        Write-Warning "[watcher-sms-relay] Destination not accessible: $dst"
    }
    Start-Sleep -Seconds 5
}
