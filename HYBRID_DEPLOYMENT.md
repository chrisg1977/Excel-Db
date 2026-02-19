# Hybrid Deployment (Chosen)

This project now uses a hybrid model:

- Development: bind-mounted extensions (fast iteration)
- Production: custom Directus image with extension baked in (stable releases)

## Development Mode

Current runtime is already bind-mounted:

- `C:\Excel-Db\directus-extensions -> /directus/extensions`
- `C:\Excel-Db\directus-uploads -> /directus/uploads`

Use this flow for daily work:

1. `npm run build`
2. Copy updated `dist/` to `directus-extensions/directus-extension-tax-sync/dist/`
3. Restart `directus_excel`

## Production Mode

Production artifacts:

- Dockerfile: `docker/directus/Dockerfile.prod`
- Compose file: `docker-compose.prod.yml`

### Release Steps

1. Build extension bundle:
   - `npm run build`
2. Ensure baked extension source is current:
   - `directus-extensions/directus-extension-tax-sync/package.json`
   - `directus-extensions/directus-extension-tax-sync/dist/*`
3. Build and run production stack:
   - `docker compose -f docker-compose.prod.yml build`
   - `docker compose -f docker-compose.prod.yml up -d`

### Important Notes

- `docker-compose.prod.yml` currently includes plaintext secrets for convenience.
- Before real production use, move secrets to environment variables or a secrets manager.
- Keep image tags/versioning per release (for rollback and auditability).

