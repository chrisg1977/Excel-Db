# Backup and Restore

## Create backup

From `c:\Excel-Db`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\backup.ps1 -IncludeProjectZip
```

This creates a timestamped folder in `.\backups\` containing:

- `exceldb.sql` (PostgreSQL dump from `pg_excel`)
- `docker-compose.yml`
- `sql\` (schema/init files)
- `project_snapshot.zip` (if `-IncludeProjectZip` is used)

## Restore database

1. Ensure Postgres container is running:

```powershell
docker compose up -d pg_excel
```

2. Restore from a dump file:

```powershell
Get-Content .\backups\<timestamp>\exceldb.sql | docker exec -i pg_excel psql -U excel -d exceldb
```

3. Restart Directus:

```powershell
docker restart directus_excel
```
