This folder contains helper scripts used during development.

## Provider Feb-2026 dry-run test

Use this to test provider-production import with real DB credentials and mappings.

```bash
npm run build
npm run test:provider-feb26
```

Defaults target provider_id `2018001` (Ritienne) and period `2026-02`.

You can run manually with different args:

```bash
node dist/scripts/test-provider-feb26.js --provider-id 2018001 --year 2026 --month 2
```

Notes:
- Requires environment variables for MySQL + Postgres (`OD_MYSQL_*`, `DIRECTUS_PG_CONNECTION`).
- Requires `od_provider_map.od_prov_num` to be populated for the target provider.
