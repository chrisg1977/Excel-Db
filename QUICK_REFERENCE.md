# Quick Reference: Audit & Validation Operations

**Last Updated**: February 17, 2026

---

## Common Operations

### Check Recent Publish Activity
```sql
SELECT user_email, action_status, COUNT(*) 
FROM vw_tax_publish_audit
WHERE timestamp > NOW() - INTERVAL '24 hours'
GROUP BY user_email, action_status;
```

### Find Failed Publishes
```sql
SELECT batch_id, user_email, validation_errors, notes
FROM vw_tax_publish_audit 
WHERE action_status IN ('failed', 'validation_failed')
ORDER BY timestamp DESC LIMIT 10;
```

### Audit Specific Batch
```sql
SELECT * FROM vw_tax_publish_audit
WHERE batch_id = 'YOUR_BATCH_ID'
ORDER BY timestamp;
```

### User Activity Report
```sql
SELECT user_email, 
       COUNT(*) as actions,
       COUNT(CASE WHEN action_status = 'success' THEN 1 END) as successful,
       MAX(timestamp) as last_action
FROM vw_tax_publish_audit
GROUP BY user_email
ORDER BY actions DESC;
```

### Performance Stats
```sql
SELECT action_type,
       AVG(processing_time_ms) as avg_time,
       MAX(processing_time_ms) as max_time,
       COUNT(*) as count
FROM tax_publish_audit_log
WHERE timestamp > NOW() - INTERVAL '7 days'
GROUP BY action_type;
```

---

## Test Batch IDs

| Test Case | Batch ID | Status |
|-----------|----------|--------|
| Overlapping Bands | `de4b3e4c-1234-5678-90ab-cdef12340001` | INVALID |
| Missing Categories | `de4b3e4c-5678-90ab-1234-cdef12340002` | INVALID |
| Valid Complete | `de4b3e4c-90ab-1234-5678-cdef12340003` | VALID |

### Testing Overlapping Bands
```bash
curl -X POST http://localhost:8055/tax/publish/de4b3e4c-1234-5678-90ab-cdef12340001 \
  -H "Authorization: Bearer $TOKEN"
# Expected: 409 Conflict (overlapping_range error)
```

### Testing Valid Publish
```bash
curl -X POST http://localhost:8055/tax/publish/de4b3e4c-90ab-1234-5678-cdef12340003 \
  -H "Authorization: Bearer $TOKEN"
# Expected: 200 OK with published_by info
```

---

## Validation Error Types

| Error Type | Meaning | Solution |
|-----------|---------|----------|
| `overlapping_range` | Income bands cross in same category | Adjust band ranges |
| `duplicate_band` | Identical band ranges in category | Remove duplicate |
| `missing_category` | Required tax category not present | Add missing category |
| `year_mismatch` | Multiple years in same batch | Separate by year |
| `invalid_band_range` | Band_from/to invalid | Check numeric values |
| `missing_required_code` | Category code not mapped | Map category |

---

## Database Verification

### Check Audit Tables Exist
```bash
docker exec pg_excel psql -U excel -d exceldb \
  -c "SELECT tablename FROM pg_tables WHERE tablename LIKE '%audit%'"
```

### Check Indexes
```bash
docker exec pg_excel psql -U excel -d exceldb \
  -c "SELECT indexname FROM pg_indexes WHERE tablename = 'tax_publish_audit_log'"
```

### Check Audit Log Size
```bash
docker exec pg_excel psql -U excel -d exceldb \
  -c "SELECT pg_size_pretty(pg_total_relation_size('tax_publish_audit_log'))"
```

### Verify Views
```bash
docker exec pg_excel psql -U excel -d exceldb \
  -c "SELECT schemaname, viewname FROM pg_views WHERE viewname LIKE 'vw_%audit%'"
```

---

## Deployment Commands

### Apply SQL Migration
```bash
docker exec pg_excel psql -U excel -d exceldb -f /docker-entrypoint-initdb.d/audit_log_schema.sql
```

### Check Directus Status
```bash
curl -s http://localhost:8055/server/health | jq '.'
```

### Check Directus Version
```bash
curl -s http://localhost:8055/server/info | jq '.version'
```

### Restart Directus
```bash
docker-compose restart directus_excel
```

### View Directus Logs
```bash
docker logs -f directus_excel
```

---

## Troubleshooting

### No Audit Logs Being Created?
```sql
-- Check table exists and is populated
SELECT COUNT(*) FROM tax_publish_audit_log;

-- Check recent entries
SELECT * FROM tax_publish_audit_log ORDER BY timestamp DESC LIMIT 5;

-- Check indexes
SELECT * FROM pg_indexes WHERE tablename = 'tax_publish_audit_log';
```

### Validation Rejecting Valid Data?
```sql
-- Check sample records
SELECT * FROM tax_rates_import WHERE batch_id = $1 LIMIT 5;

-- Verify year consistency
SELECT DISTINCT year FROM tax_rates_import WHERE batch_id = $1;

-- Check for overlaps
SELECT category_code, band_from, band_to 
FROM tax_rates_import 
WHERE batch_id = $1
ORDER BY category_code, band_from;
```

### Slow Publishing?
```sql
-- Check performance
SELECT 
  MAX(processing_time_ms) as max_time,
  AVG(processing_time_ms) as avg_time
FROM tax_publish_audit_log
WHERE timestamp > NOW() - INTERVAL '1 hour';

-- Look for slowest publishes
SELECT * FROM tax_publish_audit_log
ORDER BY processing_time_ms DESC LIMIT 5;
```

---

## Connection Strings

### PostgreSQL
```
Host: localhost
Port: 55432
User: excel
Password: excelpass
Database: exceldb
```

### Docker Command
```bash
docker exec pg_excel psql -U excel -d exceldb
```

### SQL in Docker
```bash
docker exec pg_excel psql -U excel -d exceldb -c "SELECT COUNT(*) FROM tax_publish_audit_log"
```

---

## Monitoring Commands

### Weekly Status Check
```bash
# Recent activity
docker exec pg_excel psql -U excel -d exceldb -c \
  "SELECT COUNT(*) as total, 
          COUNT(CASE WHEN action_status='success' THEN 1 END) as successful,
          COUNT(CASE WHEN action_status!='success' THEN 1 END) as failed
   FROM tax_publish_audit_log WHERE timestamp > NOW() - INTERVAL '7 days'"

# By user
docker exec pg_excel psql -U excel -d exceldb -c \
  "SELECT user_email, COUNT(*) FROM tax_publish_audit_log 
   WHERE timestamp > NOW() - INTERVAL '7 days' GROUP BY user_email ORDER BY count DESC"
```

### Daily Health Check
```bash
# Failed publishes
docker exec pg_excel psql -U excel -d exceldb -c \
  "SELECT COUNT(*) as failed FROM tax_publish_audit_log 
   WHERE action_status IN ('failed', 'validation_failed') 
   AND timestamp > NOW() - INTERVAL '24 hours'"

# If result > 0, investigate with: 
# SELECT * FROM vw_tax_publish_audit WHERE action_status != 'success'
```

---

## Export Data

### Export to CSV
```bash
docker exec pg_excel psql -U excel -d exceldb \
  -c "COPY (SELECT * FROM vw_tax_publish_audit LIMIT 1000) TO STDOUT WITH CSV HEADER" \
  > audit_export.csv
```

### Export to JSON
```bash
docker exec pg_excel psql -U excel -d exceldb \
  -c "SELECT json_agg(t) FROM (SELECT * FROM vw_tax_publish_audit LIMIT 1000) t" \
  > audit_export.json
```

---

## Rollback if Needed

### Quick Rollback (Endpoints Only)
```bash
git checkout HEAD~1 -- src/endpoints/publish.ts
git checkout HEAD~1 -- src/endpoints/social-security-publish.ts
docker-compose restart directus_excel
```

### Full Rollback (Database + Code)
```bash
# Drop audit tables
docker exec pg_excel psql -U excel -d exceldb -c \
  "DROP TABLE IF EXISTS tax_publish_audit_log, ss_publish_audit_log CASCADE;"

# Restore code
git checkout HEAD~1 -- src/endpoints/
docker-compose restart directus_excel
```

---

## Documentation Links

- **Implementation Details**: See AUDIT_VALIDATION_IMPLEMENTATION.md
- **Test Results**: See VALIDATION_TEST_RESULTS.md
- **Monitoring Guide**: See AUDIT_MONITORING_GUIDE.md
- **Deployment Plan**: See DEPLOYMENT_CHECKLIST.md
- **Complete Summary**: See IMPLEMENTATION_COMPLETE.md

---

## Emergency Contacts

**Issues During Business Hours**:
- Tech: Contact Dev Team
- Database: Contact DBA Team
- Urgent: Escalate to CTO

**After Hours**:
- On-call: Check call rotation
- Emergency: Contact CTO directly

---

**Last Verified**: February 17, 2026  
**Status**: ✅ All systems operational
