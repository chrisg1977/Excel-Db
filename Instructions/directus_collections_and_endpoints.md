Summary of changes (Tax / Social Security / Leave)

Schema (sql/schema.sql)
- social_security_brackets: weekly wage bands (band_from, band_to) with employee/employer rates.
- social_security_classes: Class A–F (yeared), supports DOB cohorts, age bounds, weekly wage ranges, fixed or percentage contributions and MLF fields.
- departments: dept_id, abbreviation, name.
- leave_types: code, display_name, default_hours.
- leave_policies: per-year per-department entitlements, carry-forward percent, effective_from/to.
- fiscal_settings: active fiscal year flags.

Seeds
- sql/leave_seeds.sql: common leave types + `GEN` department.
- sql/leave_policy_seeds.sql: 2025 `GEN` leave_policies (entitlement_hours=0 used for unpaid/variable types).
- sql/ss_class_seeds.sql: social security Classes A–F for 2025.
- sql/ss_class_updates.sql: set fixed Class D contributions for DOB cohorts.

Endpoints (src/endpoints/admin-dashboard.ts)
- GET /extensions/admin-dashboard/tax-rates-live?year=YYYY  → returns rows from `tax_rates_live`.
- GET /extensions/admin-dashboard/ss-brackets?year=YYYY   → returns `social_security_brackets` rows.
- GET /extensions/admin-dashboard/ss-classes?year=YYYY    → returns `social_security_classes` rows.
- GET /extensions/admin-dashboard/leave-policies?year=YYYY→ returns joined `leave_policies` (dept + leave_type).
- POST /extensions/admin-dashboard/ss-class-for  (body: { weekly_wage, dob, year? })
  - Authenticated endpoint that matches a class for the given weekly wage and DOB and returns computed employee, employer and employer-MLF contributions.
  - Includes `warnings` array when class definitions overlap or have invalid ranges.

Admin panel
- `src/panels/tax-admin.vue` updated with an "Admin Dashboard" section showing tax brackets, SS brackets, SS classes, leave policies and a small interactive "Social Security Calculator" (inputs: weekly wage, DOB) that calls `/ss-class-for`.

How to apply changes (if you need to re-run locally)
1. Apply schema & seeds (run inside Postgres container or with psql against the DB):

```powershell
# start DB if not running
docker compose up -d pg_excel
# run schema (inside container path is /docker-entrypoint-initdb.d/schema.sql)
docker compose exec -T pg_excel psql -U excel -d exceldb -f /docker-entrypoint-initdb.d/schema.sql
# run seeds
docker compose exec -T pg_excel psql -U excel -d exceldb -f /docker-entrypoint-initdb.d/leave_seeds.sql
docker compose exec -T pg_excel psql -U excel -d exceldb -f /docker-entrypoint-initdb.d/leave_policy_seeds.sql
docker compose exec -T pg_excel psql -U excel -d exceldb -f /docker-entrypoint-initdb.d/ss_class_seeds.sql
docker compose exec -T pg_excel psql -U excel -d exceldb -f /docker-entrypoint-initdb.d/ss_class_updates.sql
```

2. Restart Directus to load updated extensions/UI:

```powershell
Set-Location 'C:\directus-excel'
docker compose restart directus
```

3. Admin UI: open http://localhost:8055 → navigate to the Tax Admin panel (Extensions) → use the Dashboard and Social Security Calculator.

How to test the compute endpoint with an API token
1. Login to Directus to get a token:

```bash
curl -sS -X POST http://localhost:8055/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"YOUR_ADMIN_EMAIL","password":"YOUR_PASSWORD"}'
```

2. Use the returned `access_token` as Bearer and POST to ss-class-for:

```bash
curl -sS -X POST http://localhost:8055/extensions/admin-dashboard/ss-class-for \
  -H "Authorization: Bearer <ACCESS_TOKEN>" \
  -H 'Content-Type: application/json' \
  -d '{"weekly_wage":300,"dob":"1990-06-15","year":2025}'
```

Notes and recommendations
- The `ss-class-for` route requires Directus authentication (admin/API token). If you see 404 for `/extensions/admin-dashboard/*`, restart Directus and check logs (`docker compose logs directus`).
- I added server-side checks that warn about overlapping wage/cohort ranges; please review `social_security_classes` rows in Directus and adjust ranges to avoid overlaps.
- Some leave types used `entitlement_hours = 0` for unpaid/variable leaves to satisfy the DB constraint — consider allowing NULL in the future to model unpaid items explicitly.
- If you want me to create Directus collection definitions (JSON) to auto-create fields/relations and user-friendly labels, I can generate them next.

Files changed (high level)
- sql/schema.sql
- sql/leave_seeds.sql
- sql/leave_policy_seeds.sql
- sql/ss_class_seeds.sql
- sql/ss_class_updates.sql
- src/endpoints/admin-dashboard.ts
- src/panels/tax-admin.vue
- src/index.ts

If you'd like, I can now: (a) generate Directus collection JSON to auto-create collections and relations, (b) produce a short README update under the project root, or (c) run a live sample POST now that you provided credentials. Which would you like next?