$ErrorActionPreference = 'Stop'
$creds = @{ email = 'drchrisgauci@gmail.com'; password = 'Crz6@6@6@!' } | ConvertTo-Json
$login = Invoke-RestMethod -Uri 'http://localhost:8055/auth/login' -Method POST -ContentType 'application/json' -Body $creds
$token = $login.data.access_token
Write-Output "Token obtained: $($token -ne $null)"
$paths = @('/extensions/admin-dashboard/ss-class-for','/admin-dashboard/ss-class-for','/admin-dashboard/extensions/ss-class-for','/ss-class-for','/extensions/ss-class-for','/admin/ss-class-for')
$body = @{ weekly_wage = 300; dob = '1990-06-15'; year = 2025 } | ConvertTo-Json
foreach($p in $paths){
  try{
    Write-Output "Trying $p"
    $resp = Invoke-RestMethod -Uri ("http://localhost:8055" + $p) -Method POST -Headers @{ Authorization = "Bearer $token" } -ContentType 'application/json' -Body $body -TimeoutSec 5
    Write-Output "Success at $p"
    $resp | ConvertTo-Json -Depth 5
    break
  } catch {
    Write-Output ('Failed ' + $p + ': ' + $_.Exception.Message)
  }
}
