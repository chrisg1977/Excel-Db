-- Archive Schema for Backup Tables
-- Run this AFTER testing is complete to clean up the Data Model
-- This preserves backup data in a separate schema

-- Create archive schema
CREATE SCHEMA IF NOT EXISTS archive;

-- Move backup tables to archive schema
-- These tables are one-time snapshots from 20260216 migration

-- 1. Tax category map backup
ALTER TABLE IF EXISTS tax_category_map_backup SET SCHEMA archive;

-- 2. Social security classes backups
ALTER TABLE IF EXISTS social_security_classes_backup_20260216 SET SCHEMA archive;
ALTER TABLE IF EXISTS social_security_classes_2026_backup_20260216 SET SCHEMA archive;

-- 3. Social security rates backups
ALTER TABLE IF EXISTS social_security_rates_import_backup_20260216 SET SCHEMA archive;
ALTER TABLE IF EXISTS social_security_rates_live_backup_20260216 SET SCHEMA archive;

-- Create archive information table for reference
CREATE TABLE IF NOT EXISTS archive.archive_metadata (
  id SERIAL PRIMARY KEY,
  table_name VARCHAR(255) NOT NULL,
  original_schema VARCHAR(50) DEFAULT 'public',
  archived_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  description TEXT,
  data_snapshot_date DATE,
  UNIQUE(table_name)
);

-- Log what was archived
INSERT INTO archive.archive_metadata (table_name, archived_date, description, data_snapshot_date) VALUES
  ('tax_category_map_backup', CURRENT_TIMESTAMP, 'Tax category mapping backup from 2026-02-16 migration', '2026-02-16'),
  ('social_security_classes_backup_20260216', CURRENT_TIMESTAMP, 'Social security classes backup from 2026-02-16 migration', '2026-02-16'),
  ('social_security_classes_2026_backup_20260216', CURRENT_TIMESTAMP, 'Social security classes 2026 backup from 2026-02-16 migration', '2026-02-16'),
  ('social_security_rates_import_backup_20260216', CURRENT_TIMESTAMP, 'Social security rates import backup from 2026-02-16 migration', '2026-02-16'),
  ('social_security_rates_live_backup_20260216', CURRENT_TIMESTAMP, 'Social security rates live backup from 2026-02-16 migration', '2026-02-16')
ON CONFLICT (table_name) DO NOTHING;

-- Create view to access archived data if needed
CREATE OR REPLACE VIEW public.vw_archived_tables AS
SELECT 
  table_name,
  original_schema,
  archived_date,
  description,
  data_snapshot_date,
  'SELECT COUNT(*) FROM archive.' || table_name || ';' AS query_example
FROM archive.archive_metadata
ORDER BY archived_date DESC;

-- Grant appropriate permissions
-- (Adjust roles as needed for your setup)
GRANT USAGE ON SCHEMA archive TO excel;
GRANT SELECT ON ALL TABLES IN SCHEMA archive TO excel;

-- Summary comment
COMMENT ON SCHEMA archive IS 'Archive schema for backup tables and historical data snapshots. Moved from public schema to reduce clutter in main data model.';
