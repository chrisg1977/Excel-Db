param(
  [string]$BaseUrl = $(if ($env:DIRECTUS_BASE_URL) { $env:DIRECTUS_BASE_URL } else { "http://localhost:8055" }),
  [string]$Email = $(if ($env:DIRECTUS_EMAIL) { $env:DIRECTUS_EMAIL } else { "" }),
  [string]$Password = $(if ($env:DIRECTUS_PASSWORD) { $env:DIRECTUS_PASSWORD } else { "" })
)

$ErrorActionPreference = "Stop"

function Send-EmailAccountAlert {
  param(
    [string]$Subject,
    [string]$Body
  )

  $smtpHost = $env:SMTP_HOST
  $to = $env:EMAIL_ACCOUNTS_ALERT_TO
  $from = $env:EMAIL_ACCOUNTS_ALERT_FROM

  if ([string]::IsNullOrWhiteSpace($smtpHost) -or [string]::IsNullOrWhiteSpace($to) -or [string]::IsNullOrWhiteSpace($from)) {
    Write-Warning "Alert not sent: missing SMTP_HOST / EMAIL_ACCOUNTS_ALERT_TO / EMAIL_ACCOUNTS_ALERT_FROM"
    return
  }

  $smtpPort = if ($env:SMTP_PORT) { [int]$env:SMTP_PORT } else { 587 }
  $smtpSsl = if ($env:SMTP_SSL) { [System.Convert]::ToBoolean($env:SMTP_SSL) } else { $true }
  $smtpUser = $env:SMTP_USER
  $smtpPass = $env:SMTP_PASS

  $message = New-Object System.Net.Mail.MailMessage($from, $to, $Subject, $Body)
  $client = New-Object System.Net.Mail.SmtpClient($smtpHost, $smtpPort)
  $client.EnableSsl = $smtpSsl

  if (-not [string]::IsNullOrWhiteSpace($smtpUser) -and -not [string]::IsNullOrWhiteSpace($smtpPass)) {
    $client.Credentials = New-Object System.Net.NetworkCredential($smtpUser, $smtpPass)
  }

  $client.Send($message)
  Write-Host "Alert sent to $to"
}

if ([string]::IsNullOrWhiteSpace($Email) -or [string]::IsNullOrWhiteSpace($Password)) {
  throw "DIRECTUS_EMAIL and DIRECTUS_PASSWORD are required (or pass -Email and -Password). Use an admin account: the health-check endpoint requires admin access."
}

Write-Host "Logging in to $BaseUrl ..."
$loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json
$loginResponse = Invoke-RestMethod -Uri "$BaseUrl/auth/login" -Method POST -ContentType "application/json" -Body $loginBody
$token = $loginResponse.data.access_token

if ([string]::IsNullOrWhiteSpace($token)) {
  throw "Login succeeded but no access token returned."
}

$headers = @{ Authorization = "Bearer $token" }

Write-Host "Running email account health checks..."
$response = Invoke-RestMethod -Uri "$BaseUrl/email-accounts/health-check" -Method POST -Headers $headers -ContentType "application/json" -Body "{}" -TimeoutSec 60

$checked = $response.data.checked
$healthy = $response.data.healthy
$alerts = $response.data.alerts

$reportLines = @(
  "Email Account Health Check",
  "Time (UTC): $([DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss'))",
  "Checked: $checked   Healthy: $healthy   Needs attention: $($alerts.Count)",
  ""
)

foreach ($alert in $alerts) {
  $reportLines += "[ATTENTION] $($alert.email): $($alert.message)"
}

$report = $reportLines -join "`n"
Write-Host ""
Write-Host $report

if ($alerts.Count -gt 0) {
  Send-EmailAccountAlert -Subject "Email account(s) need attention ($($alerts.Count))" -Body $report
  exit 1
}

exit 0
