OpenDental → Directus Import: Build Order Checklist

Goal

Implement an on-demand import that reads OpenDental `clockevent` rows and upserts them into Directus `timesheet_events`, mapped via `od_user_map`.

Outcome

HR clicks import → service reads MySQL `clockevent` → matches `UserNum` to Directus `employee_id` via `od_user_map` → upserts `timesheet_events` → returns summary.

Prerequisites

- Directus admin token (server-to-server) available
- Network access from import host to OpenDental MySQL
- Access to Directus instance for collection creation
- Max date-range policy decided (recommended: 60 days)

Top-level Steps (ordered)

1. Create Directus collections (schema/fields)
   - `od_user_map`
     - `id` (auto)
     - `employee_id` (relation -> `employees`)
     - `od_user_num` (integer, unique)
     - `notes` (text)
   - `timesheet_events`
     - `id` (auto)
     - `employee_id` (relation -> `employees`)
     - `event_datetime` (timestamp)
     - `status` (string enum: IN, OUT)
     - `note` (text)
     - `clinic_num` (integer)
     - `source_system` (string, default "OpenDental")
     - `source_clockevent_num` (integer)
     - `created_by_import` (boolean)
     - unique constraint: (`source_system`, `source_clockevent_num`)
   - `import_log`
     - `id`, `imported_by`, `date_from`, `date_to`, `employee_ids`, `inserted`, `updated`, `skipped`, `errors` (json)

2. Seed `od_user_map` (initial manual mapping)

3. Implement Import Service (recommended folder: `/importer/opendental_import`)
   - Language: Node.js (TypeScript) or Python (fast to iterate)
   - Packages: mysql2 (or mysql), node-fetch/axios, directus-sdk or axios
   - Config: MySQL connection, Directus base URL, admin token, import limits

4. Implement Import Logic (detailed)
   - Endpoint (internal): `POST /import/opendental` (or CLI command)
   - Payload: `{ date_from, date_to, employee_od_user_nums?: [int], employee_ids?: [int], max_range_days?: int }`
   - Steps:
     1. Validate dates (range <= configured max)
     2. Query `od_user_map` to map requested employees (support both `employee_ids` or `od_user_nums`)
     3. Query OpenDental MySQL:
        ```sql
        SELECT ClockEventNum, UserNum, ClockDateTime, ClockStatus, Note, ClinicNum
        FROM clockevent
        WHERE ClockDateTime >= ? AND ClockDateTime < ?
        AND UserNum IN ( ... )
        ORDER BY ClockDateTime
        ```
     4. For each row:
        - Find `employee_id` from `od_user_map` by `UserNum`.
        - Build upsert payload to Directus `timesheet_events`.
        - Upsert rule: if (`source_system`, `source_clockevent_num`) exists → update fields; else insert new.
     5. Batch upserts (e.g., 100 rows per request) to Directus to reduce API calls.
     6. Collect counters: inserted, updated, skipped, errors.
     7. Insert a summary row in `import_log`.

5. Idempotency & Safety
   - Use `source_clockevent_num` + `source_system` unique index to avoid duplicates.
   - Support re-import: service should update changed `Note`/`status` and not duplicate.
   - Use transactions where possible for multi-step DB updates in MySQL side logic.

6. Edge Cases & Rules
   - Skip events whose `UserNum` is unmapped — report in `errors` with list.
   - Time zone handling: ensure `ClockDateTime` is interpreted in correct TZ (store UTC in Directus where possible).
   - Partial day ranges: be explicit about inclusive/exclusive boundaries.

7. Logging & Observability
   - Log summary (inserted/updated/skipped/errors) to `import_log` collection.
   - Log per-row errors (max 100) with sample rows saved to S3/attachments or `errors` JSON.

8. Tests
   - Unit tests for mapping logic, date validation, SQL query generation.
   - Integration test: run against a dev copy of OpenDental DB with a small date range and verify Directus records.

9. Directus UI
   - Option A (recommended UX): small Directus extension or interface button
     - Allow multi-select employees → open modal for date range → call import endpoint (server-side URL)
     - Show progress and final summary
   - Option B: Admin-only page with employee lookup and date pickers

10. Deployment
   - Containerize service (Dockerfile) and deploy onto same network as Directus & OpenDental DB (or host with network access)
   - Environment variables: MYSQL_HOST, MYSQL_USER, MYSQL_PASS, DIRECTUS_URL, DIRECTUS_ADMIN_TOKEN, MAX_DAYS

11. Security
   - Store Directus admin token in secrets manager or environment variables (never commit)
   - Use service account with limited Directus scopes when possible (create a Directus role with collection create/update rights only for `timesheet_events`/`import_log`)

12. Rollback & Cleanup
   - `import_log` links to inserted ids; add an admin operation to delete import batch if needed.
   - Keep import batches immutable to enable audit.

13. Follow-ups (after MVP)
   - Add retry/backoff for API failures
   - Add incremental sync (last N days) scheduled job
   - Auto-merge IN/OUT pairs into shifts and auto-calc hours

Quick Implementation Checklist (action items)

- [ ] Create Directus collections (`od_user_map`, `timesheet_events`, `import_log`)
- [ ] Seed `od_user_map` with initial mappings
- [ ] Scaffold import service repository and CI
- [ ] Implement MySQL read + Directus upsert logic
- [ ] Implement batching & error handling
- [ ] Build Directus UI trigger (extension)
- [ ] Run integration test and validate results
- [ ] Add documentation and runbook

Commands to run locally (Node example)

```bash
cd importer/opendental_import
npm install
# dev run
MYSQL_HOST=yourhost MYSQL_USER=user MYSQL_PASS=pass DIRECTUS_URL=http://localhost:8055 DIRECTUS_TOKEN=token node dist/index.js --from=2026-02-01 --to=2026-02-15
```

Files to add in repo

- `importer/opendental_import/README.md` (run instructions)
- `importer/opendental_import/src/index.ts` (main)
- `importer/opendental_import/src/opendental.ts` (mysql client)
- `importer/opendental_import/src/directus.ts` (directus-client wrapper)
- `importer/opendental_import/src/upsert.ts` (upsert logic & batching)
- `importer/opendental_import/Dockerfile`

Where I'll start now

1) Create the Directus collection definitions (DDL/JSON ready) and the service scaffold.
2) Implement upsert logic with batching.

