# OpenDental Import Service

This service imports clock events from OpenDental (MySQL) into Directus Postgres tables.

## What It Does

- Reads OpenDental `clockevent` rows for a date range
- Maps OpenDental `UserNum` to Directus employees via `od_user_map`
- Upserts rows into `timesheet_events` (idempotent by `source_clockevent_num`)
- Writes import stats to `import_log`

## Prerequisites

- OpenDental MySQL access
- Directus Postgres connection string
- Schema applied from `sql/od_timesheets_schema.sql`

## Setup

1. By default, the service loads env vars from `M:\.env` if it exists.
2. To override the path, set `OD_ENV_PATH` before starting the service.
3. Or copy `.env.example` to `.env` in this folder and run here.
2. Install dependencies.
3. Build and run.

## Commands

```bash
set OD_ENV_PATH=M:\.env
npm install
npm run build
npm run start
```

## API

`POST /api/od/timesheets/import`

Payload:

```json
{
  "date_from": "2026-02-01",
  "date_to": "2026-02-15",
  "employee_ids": [2018001, 2018002],
  "dry_run": false
}
```

Response:

```json
{
  "ok": true,
  "inserted": 274,
  "updated": 12,
  "skipped": 0,
  "missing_mappings": [],
  "total_events": 286
}
```
