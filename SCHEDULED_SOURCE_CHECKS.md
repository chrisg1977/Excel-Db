# Scheduled Tax + Social Security Source Checks

This repo includes a monitor script at `scripts/check-rate-sources.ps1`.

Purpose:
- Monthly live-source check for tax and social security URLs
- Alert when fetch/parse fails (so admin can use manual HTML fallback import)
- No writes to import/live tables (health-check only)

## Endpoints Used

- `POST /tax/source-check/:year`
- `POST /ss/source-check/:year`

These endpoints:
- require Directus authentication
- fetch live URL
- parse rows
- return counts/categories
- do not insert/update data

## Run Manually

```powershell
$env:DIRECTUS_BASE_URL = "http://localhost:8055"
$env:DIRECTUS_EMAIL = "admin@example.com"
$env:DIRECTUS_PASSWORD = "your-password"
.\scripts\check-rate-sources.ps1 -Year 2026
```

## Optional Email Alerts

Set these env vars before running:

- `SMTP_HOST`
- `SMTP_PORT` (default `587`)
- `SMTP_SSL` (default `true`)
- `SMTP_USER`
- `SMTP_PASS`
- `RATE_CHECK_ALERT_FROM`
- `RATE_CHECK_ALERT_TO`

If SMTP vars are missing, failures are still printed and the script exits non-zero, but no email is sent.

## Windows Task Scheduler (Monthly)

1. Create a task that runs monthly (for example on day 1).
2. Action:

```powershell
powershell.exe -ExecutionPolicy Bypass -File C:\Excel-Db\scripts\check-rate-sources.ps1 -Year 2026
```

3. Configure required environment variables for the task account (or wrap in a launcher `.ps1` that sets them first).
4. Confirm task history is enabled and alerts arrive on failure.

## Expected Operational Flow

1. Scheduled check passes: no action required.
2. Scheduled check fails: admin receives alert.
3. Admin runs `sync-preview` with pasted `source_html` fallback.
4. Admin reviews unknown categories, then publishes approved batch.
