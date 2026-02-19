param(
  [string]$BaseUrl = $(if ($env:DIRECTUS_BASE_URL) { $env:DIRECTUS_BASE_URL } else { "http://localhost:8055" }),
  [string]$Email = $(if ($env:DIRECTUS_EMAIL) { $env:DIRECTUS_EMAIL } else { "" }),
  [string]$Password = $(if ($env:DIRECTUS_PASSWORD) { $env:DIRECTUS_PASSWORD } else { "" }),
  [int]$Year = $(if ($env:RATE_CHECK_YEAR) { [int]$env:RATE_CHECK_YEAR } else { [DateTime]::UtcNow.Year })
)

$ErrorActionPreference = "Stop"

function Send-CheckAlert {
  param(
    [string]$Subject,
    [string]$Body
  )

  $smtpHost = $env:SMTP_HOST
  $to = $env:RATE_CHECK_ALERT_TO
  $from = $env:RATE_CHECK_ALERT_FROM

  if ([string]::IsNullOrWhiteSpace($smtpHost) -or [string]::IsNullOrWhiteSpace($to) -or [string]::IsNullOrWhiteSpace($from)) {
    Write-Warning "Alert not sent: missing SMTP_HOST / RATE_CHECK_ALERT_TO / RATE_CHECK_ALERT_FROM"
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
  throw "DIRECTUS_EMAIL and DIRECTUS_PASSWORD are required (or pass -Email and -Password)."
}

Write-Host "Logging in to $BaseUrl ..."
$loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json
$loginResponse = Invoke-RestMethod -Uri "$BaseUrl/auth/login" -Method POST -ContentType "application/json" -Body $loginBody
$token = $loginResponse.data.access_token

if ([string]::IsNullOrWhiteSpace($token)) {
  throw "Login succeeded but no access token returned."
}

$headers = @{ Authorization = "Bearer $token" }

$checks = @(
  @{ Name = "Tax"; Url = "$BaseUrl/tax/source-check/$Year" },
  @{ Name = "SocialSecurity"; Url = "$BaseUrl/ss/source-check/$Year" }
)

$results = @()
$hasFailure = $false

foreach ($check in $checks) {
  try {
    Write-Host "Checking $($check.Name) source..."
    $response = Invoke-RestMethod -Uri $check.Url -Method POST -Headers $headers -ContentType "application/json" -Body "{}" -TimeoutSec 30
    $rows = $response.data.rowsDetected
    $results += "[OK] $($check.Name): rowsDetected=$rows url=$($response.data.sourceUrl)"
  } catch {
    $hasFailure = $true
    $errText = $_.Exception.Message
    if ($_.ErrorDetails.Message) {
      $errText = "$errText | $($_.ErrorDetails.Message)"
    }
    $results += "[FAIL] $($check.Name): $errText"
  }
}

$report = @(
  "Rate Source Check",
  "Time (UTC): $([DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss'))",
  "Year: $Year",
  "",
  ($results -join "`n")
) -join "`n"

Write-Host ""
Write-Host $report

if ($hasFailure) {
  Send-CheckAlert -Subject "Rate Source Check Failed ($Year)" -Body $report
  exit 1
}

exit 0
