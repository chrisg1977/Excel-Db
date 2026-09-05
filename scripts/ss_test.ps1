param(
  [string]$BaseUrl = $(if ($env:DIRECTUS_BASE_URL) { $env:DIRECTUS_BASE_URL } else { "http://localhost:8055" }),
  [string]$Email = $(if ($env:DIRECTUS_EMAIL) { $env:DIRECTUS_EMAIL } else { "" }),
  [string]$Password = $(if ($env:DIRECTUS_PASSWORD) { $env:DIRECTUS_PASSWORD } else { "" })
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Email) -or [string]::IsNullOrWhiteSpace($Password)) {
  throw "DIRECTUS_EMAIL and DIRECTUS_PASSWORD are required (or pass -Email and -Password)."
}

$creds = @{ email = $Email; password = $Password } | ConvertTo-Json
$login = Invoke-RestMethod -Uri "$BaseUrl/auth/login" -Method POST -ContentType 'application/json' -Body $creds
$token = $login.data.access_token
Write-Output "Obtained token: $($token -ne $null)"
$body = @{ weekly_wage = 300; dob = '1990-06-15'; year = 2025 } | ConvertTo-Json
$response = Invoke-RestMethod -Uri "$BaseUrl/extensions/admin-dashboard/ss-class-for" -Method POST -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body
$response | ConvertTo-Json -Depth 5
