-- Enable HR Dashboard Views in Directus
-- This script registers the views as visible collections in Directus
-- Note: Directus may use SQLite, not PostgreSQL for metadata

-- If Directus is using the same PostgreSQL database, you would register views here:
-- INSERT INTO directus_collections (collection, meta) VALUES 
-- ('vw_hr_employee_dashboard', '{"hidden": false, "note": "HR Employee Payroll Dashboard with color coding"}')
-- ON CONFLICT DO NOTHING;

-- Alternative: Direct approach - modify Directus via CLI
-- This is handled via npx directus collections create command

-- For now, the views are created in PostgreSQL:
-- - vw_hr_employee_dashboard
-- - vw_dashboard_filter_options  
-- - print_audit_log (table)

-- To verify they exist and work:
SELECT 
  'View' as type,
  viewname as name,
  'vw_hr_employee_dashboard' as description
FROM pg_views 
WHERE viewname='vw_hr_employee_dashboard' AND schemaname='public'

UNION ALL

SELECT 
  'View',
  viewname,
  'Filter options for dashboard dropdowns'
FROM pg_views 
WHERE viewname='vw_dashboard_filter_options' AND schemaname='public'

UNION ALL

SELECT 
  'Table',
  tablename,
  'Print audit log for compliance tracking'
FROM pg_tables 
WHERE tablename='print_audit_log' AND schemaname='public';
