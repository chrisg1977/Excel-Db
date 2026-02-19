$ErrorActionPreference = 'Stop'
$creds = @{ email = 'drchrisgauci@gmail.com'; password = 'Crz6@6@6@!' } | ConvertTo-Json
$login = Invoke-RestMethod -Uri 'http://localhost:8055/auth/login' -Method POST -ContentType 'application/json' -Body $creds
$token = $login.data.access_token
Write-Output "Obtained token: $($token -ne $null)"
$body = @{ weekly_wage = 300; dob = '1990-06-15'; year = 2025 } | ConvertTo-Json
$response = Invoke-RestMethod -Uri 'http://localhost:8055/extensions/admin-dashboard/ss-class-for' -Method POST -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body
$response | ConvertTo-Json -Depth 5
