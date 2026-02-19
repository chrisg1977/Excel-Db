# Extension Source of Truth

## Active Runtime Path

The production Directus extension is `directus-extension-tax-sync` and its active source is:

- `src/endpoints/*`
- `src/panels/*`
- `src/index.ts`
- `package.json` (`directus:extension` manifest)

All runtime edits must be made in the paths above.

## Non-Runtime Scaffold (Do Not Use for Production)

These paths are scaffold/reference only and are **not** the active runtime extension:

- `extensions/bundles/tax-sync/endpoint/src/index.ts`
- `extensions/bundles/tax-sync/panel/src/index.ts`

Do not implement production changes there unless we explicitly migrate the build/deploy pipeline.

## Deployment Mode

We use a hybrid deployment model:

- Dev: bind-mounted extensions for rapid iteration
- Prod: baked custom image for stable/versioned releases

See `HYBRID_DEPLOYMENT.md`.

## Scheduled Source Monitoring

Monthly tax/social-security live source checks and alerting are documented in `SCHEDULED_SOURCE_CHECKS.md`.
