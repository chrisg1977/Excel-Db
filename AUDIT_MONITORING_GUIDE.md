# Audit Trail Monitoring & Compliance Guide

## Overview

The audit tables now capture all publish events for complete accountability and compliance. This guide provides SQL queries for:
- Real-time monitoring
- Compliance reporting
- Incident investigation
- Performance analysis

---

## Query Catalog

### 1. Recent Publish Activity (Last 24 Hours)

```sql
SELECT 
  id,
  batch_id,
  user_email,
  user_name,
  action_type,
  action_status,
  timestamp,
  year,
  total_records,
  processing_time_ms
FROM vw_tax_publish_audit
WHERE timestamp > NOW() - INTERVAL '24 hours'
ORDER BY timestamp DESC;
```

**Use When:** Checking recent activity, daily stand-ups

---

### 2. Failed Publishes (Validation Issues)

```sql
SELECT 
  id,
  batch_id,
  user_email,
  action_type,
  action_status,
  timestamp,
  year,
  total_records,
  validation_errors,
  notes
FROM vw_tax_publish_audit
WHERE action_status IN ('failed', 'validation_failed')
ORDER BY timestamp DESC;
```

**Use When:** Investigating data quality issues, root cause analysis

---

### 3. User Activity Report

```sql
SELECT 
  user_email,
  user_name,
  COUNT(*) as total_actions,
  COUNT(CASE WHEN action_status = 'success' THEN 1 END) as successful_publishes,
  COUNT(CASE WHEN action_status IN ('failed', 'validation_failed') THEN 1 END) as failed_attempts,
  COUNT(DISTINCT batch_id) as unique_batches,
  COUNT(DISTINCT year) as years_affected,
  MIN(timestamp) as first_action,
  MAX(timestamp) as last_action
FROM tax_publish_audit_log
WHERE timestamp > NOW() - INTERVAL '30 days'
GROUP BY user_email, user_name
ORDER BY total_actions DESC;
```

**Use When:** Audit trail analysis, access control review, compliance reporting

---

### 4. Validation Error Frequency

```sql
SELECT 
  action_status,
  COUNT(*) as frequency,
  ROUND(100.0 * COUNT(*) / 
    (SELECT COUNT(*) FROM tax_publish_audit_log WHERE timestamp > NOW() - INTERVAL '30 days'), 2) as percentage
FROM tax_publish_audit_log
WHERE timestamp > NOW() - INTERVAL '30 days'
GROUP BY action_status
ORDER BY frequency DESC;
```

**Use When:** Assessing data quality trends, identifying validation rule issues

---

### 5. Performance Metrics by Year

```sql
SELECT 
  year,
  action_type,
  COUNT(*) as attempts,
  COUNT(CASE WHEN action_status = 'success' THEN 1 END) as successful,
  ROUND(AVG(processing_time_ms)::numeric, 2) as avg_time_ms,
  MIN(processing_time_ms) as min_time_ms,
  MAX(processing_time_ms) as max_time_ms,
  ROUND(AVG(total_records)::numeric, 1) as avg_records
FROM tax_publish_audit_log
WHERE timestamp > NOW() - INTERVAL '90 days'
GROUP BY year, action_type
ORDER BY year DESC, action_type;
```

**Use When:** Performance tuning, capacity planning, SLA reporting

---

### 6. Audit Trail for Specific Batch

```sql
SELECT 
  id,
  action_type,
  action_status,
  user_email,
  user_name,
  timestamp,
  total_records,
  processing_time_ms,
  validation_errors,
  notes
FROM tax_publish_audit_log
WHERE batch_id = $1  -- Replace with actual batch ID
ORDER BY timestamp ASC;
```

**Use When:** Tracing specific batch lifecycle, debugging failed publishes

**Example:**
```sql
SELECT * FROM tax_publish_audit_log 
WHERE batch_id = 'de4b3e4c-90ab-1234-5678-cdef12340003'::uuid
ORDER BY timestamp ASC;
```

---

### 7. Data Coverage by Category

```sql
SELECT 
  year,
  'tax' as data_type,
  COUNT(DISTINCT batch_id) as published_batches,
  SUM(total_records) as total_records_published,
  COUNT(CASE WHEN action_status = 'success' THEN 1 END) as successful_publishes,
  COUNT(CASE WHEN action_status IN ('failed', 'validation_failed') THEN 1 END) as failed_attempts,
  MAX(timestamp) as last_published
FROM tax_publish_audit_log
WHERE action_status = 'success'
GROUP BY year
ORDER BY year DESC;
```

**Use When:** Coverage reports, data completeness checks

---

### 8. Validation Error Details (Last 30 Days)

```sql
SELECT 
  id,
  batch_id,
  user_email,
  timestamp,
  year,
  validation_errors,
  notes
FROM tax_publish_audit_log
WHERE action_status = 'validation_failed'
  AND timestamp > NOW() - INTERVAL '30 days'
ORDER BY timestamp DESC;
```

**Use When:** Data quality analysis, identifying systemic issues

---

### 9. Hourly Activity (Time Series)

```sql
SELECT 
  DATE_TRUNC('hour', timestamp) as hour,
  COUNT(*) as actions,
  COUNT(CASE WHEN action_status = 'success' THEN 1 END) as successes,
  COUNT(CASE WHEN action_status != 'success' THEN 1 END) as failures,
  ROUND(AVG(processing_time_ms)::numeric, 1) as avg_time_ms
FROM tax_publish_audit_log
WHERE timestamp > NOW() - INTERVAL '7 days'
GROUP BY DATE_TRUNC('hour', timestamp)
ORDER BY hour DESC;
```

**Use When:** Identifying patterns, peak hours, trend analysis

---

### 10. Compliance Audit Report

```sql
SELECT 
  user_email,
  user_name,
  action_type,
  COUNT(*) as count,
  COUNT(CASE WHEN action_status = 'success' THEN 1 END) as successful,
  COUNT(CASE WHEN action_status != 'success' THEN 1 END) as failed,
  MIN(timestamp) as first_action,
  MAX(timestamp) as latest_action,
  STRING_AGG(DISTINCT year::text, ', ' ORDER BY year::text) as years_affected
FROM tax_publish_audit_log
WHERE timestamp > NOW() - INTERVAL '90 days'
GROUP BY user_email, user_name, action_type
ORDER BY user_email, action_type;
```

**Use When:** Quarterly/annual compliance reviews, access control audits

---

## Monitoring Dashboards

### Key Metrics to Track

| Metric | Query | Alert Threshold |
|--------|-------|-----------------|
| **Failed Publishes** | Count where action_status = 'failed' | > 0 |
| **Validation Failures** | Count where action_type = 'validate' AND action_status = 'validation_failed' | > 2/day |
| **Processing Time** | AVG(processing_time_ms) | > 500ms |
| **User Activity** | COUNT distinct users | Unusual spikes |
| **Data Quality** | % successful publishes | < 95% |

---

## SQL Alerts (PostgreSQL)

### Alert 1: Multiple Failed Publishes in Last Hour

```sql
SELECT 
  COUNT(*) as failed_count,
  STRING_AGG(DISTINCT batch_id::text, ', ') as batch_ids,
  STRING_AGG(DISTINCT user_email, ', ') as users
FROM tax_publish_audit_log
WHERE action_status IN ('failed', 'validation_failed')
  AND timestamp > NOW() - INTERVAL '1 hour'
HAVING COUNT(*) > 2;
```

**Action:** Review failed batches, contact relevant users

---

### Alert 2: Long Processing Time

```sql
SELECT 
  id,
  batch_id,
  user_email,
  processing_time_ms,
  timestamp
FROM tax_publish_audit_log
WHERE processing_time_ms > 500
  AND timestamp > NOW() - INTERVAL '24 hours'
ORDER BY processing_time_ms DESC;
```

**Action:** Investigate performance degradation, check database load

---

### Alert 3: Unusual User Activity

```sql
SELECT 
  user_email,
  COUNT(*) as action_count,
  COUNT(DISTINCT batch_id) as batch_count,
  STRING_AGG(DISTINCT action_type, ', ') as action_types
FROM tax_publish_audit_log
WHERE timestamp > NOW() - INTERVAL '1 hour'
GROUP BY user_email
HAVING COUNT(*) > 10;  -- Adjust threshold as needed
```

**Action:** Security review, verify authorized activity

---

## Retention Policy

### Current Configuration
- **Retention**: Unlimited (permanent audit trail)
- **Archive**: Recommend archiving after 1 year to cold storage
- **Deletion**: Only with explicit approval by compliance officer

### Archive Strategy (Optional)

```sql
-- Archive 2024 data to separate table
CREATE TABLE tax_publish_audit_log_archive_2024 AS
SELECT * FROM tax_publish_audit_log
WHERE EXTRACT(YEAR FROM timestamp) = 2024;

-- Create index on archived data
CREATE INDEX idx_tax_audit_archive_2024_batch 
ON tax_publish_audit_log_archive_2024(batch_id);

-- Remove from active table
DELETE FROM tax_publish_audit_log
WHERE EXTRACT(YEAR FROM timestamp) = 2024;
```

---

## Compliance Certifications

### SOX (Sarbanes-Oxley) Compliance

✅ **Controls Achieved:**
- Change tracking (batch_id, batch updates)
- User accountability (user_id, user_email, user_name)
- Timestamp audit trail (timestamp, created_at)
- Segregation of duties (action_type logs all actions)
- Access controls logging (user_id for all changes)

**Query for SOX Report:**
```sql
SELECT 
  user_email,
  COUNT(*) as changes_made,
  MIN(timestamp) as period_start,
  MAX(timestamp) as period_end
FROM tax_publish_audit_log
WHERE timestamp BETWEEN '2026-01-01' AND '2026-03-31'
GROUP BY user_email;
```

---

### GDPR Compliance

✅ **Controls Achieved:**
- Purpose limitation (logs track publishing only)
- Data minimization (only essential fields logged)
- Retention (defined policy above)
- Right to erasure support (user_email indexed for quick lookup)

**User Data Request:**
```sql
-- Find all audit entries for a user
SELECT * FROM tax_publish_audit_log
WHERE user_email = 'user@example.com'
ORDER BY timestamp;

-- Anonymize user data
UPDATE tax_publish_audit_log
SET user_email = 'REDACTED',
    user_name = 'REDACTED'
WHERE user_email = 'user@example.com';
```

---

### Data Protection Impact Assessment

✅ **Risk Mitigations:**
1. **Confidentiality**: Audit table restricted to admins only
2. **Integrity**: Immutable log (no UPDATE operations)
3. **Availability**: Indexed for fast access
4. **Accountability**: User tracking on all changes
5. **Audit Trail**: Permanent record of all publish events

---

## Export & Reporting

### Export Audit Trail (CSV)

```bash
docker exec pg_excel psql -U excel -d exceldb \
  -c "COPY (SELECT * FROM vw_tax_publish_audit WHERE timestamp > NOW() - INTERVAL '30 days') TO STDOUT WITH CSV HEADER" \
  > audit_export_$(date +%Y%m%d).csv
```

### Generate JSON Report

```sql
SELECT 
  JSON_BUILD_OBJECT(
    'report_date', NOW(),
    'period', '30 days',
    'summary', JSON_BUILD_OBJECT(
      'total_publishes', COUNT(*),
      'successful', COUNT(CASE WHEN action_status = 'success' THEN 1 END),
      'failed', COUNT(CASE WHEN action_status != 'success' THEN 1 END)
    ),
    'by_user', JSON_OBJECT_AGG(user_email, COUNT(*))
  )
FROM tax_publish_audit_log
WHERE timestamp > NOW() - INTERVAL '30 days';
```

---

## Troubleshooting

### Issue: Audit logs not appearing

**Check:**
```sql
-- Verify table exists and has data
SELECT COUNT(*) FROM tax_publish_audit_log;

-- Check for recent entries
SELECT * FROM tax_publish_audit_log ORDER BY timestamp DESC LIMIT 5;

-- Verify indexes
SELECT schemaname, tablename, indexname FROM pg_indexes 
WHERE tablename = 'tax_publish_audit_log';
```

### Issue: Slow audit queries

**Optimize:**
```sql
-- Verify indexes are being used
EXPLAIN ANALYZE 
SELECT * FROM tax_publish_audit_log 
WHERE timestamp > NOW() - INTERVAL '30 days'
ORDER BY timestamp DESC;

-- Add missing indexes if needed
CREATE INDEX IF NOT EXISTS idx_tax_audit_status 
ON tax_publish_audit_log(action_status);
```

---

## Recommended Monitoring Frequency

| Check | Frequency | Responsibility |
|-------|-----------|-----------------|
| Daily activity | Daily | Operations |
| Failed publishes | Daily | Operations |
| Weekly summary | Weekly | Management |
| Compliance audit | Monthly | Compliance |
| Performance review | Quarterly | Engineering |
| Access audit | Quarterly | Security |

---

## Contact & Escalation

**For audit log issues:**
- Contact: Database team
- Severity: Based on frequency of publish failures
- Documentation: Link to this guide

**For compliance questions:**
- Contact: Compliance officer
- Response time: Within 24 hours
- Documentation: Use SQL queries above for evidence
