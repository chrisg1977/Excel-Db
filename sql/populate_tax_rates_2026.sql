-- Populate tax_rates_live with 2026 Malta income tax brackets
-- Malta uses a progressive tax system with multiple brackets

BEGIN;

INSERT INTO tax_rates_live (year, raw_category_label, category_code, band_from, band_to, rate, subtract, source_url)
VALUES
-- Residents (standard rates)
(2026, 'Single/Unmarried', 'single', 0.00, 9100.00, 0.00, 0.00, 'Malta Tax Authority 2026'),
(2026, 'Single/Unmarried', 'single', 9100.01, 14500.00, 15.00, 1365.00, 'Malta Tax Authority 2026'),
(2026, 'Single/Unmarried', 'single', 14500.01, 19500.00, 26.00, 3485.00, 'Malta Tax Authority 2026'),
(2026, 'Single/Unmarried', 'single', 19500.01, 60000.00, 31.00, 4570.00, 'Malta Tax Authority 2026'),
(2026, 'Single/Unmarried', 'single', 60000.01, NULL, 35.00, 7570.00, 'Malta Tax Authority 2026'),

-- Married (increased allowances)
(2026, 'Married', 'married', 0.00, 11200.00, 0.00, 0.00, 'Malta Tax Authority 2026'),
(2026, 'Married', 'married', 11200.01, 16600.00, 15.00, 1680.00, 'Malta Tax Authority 2026'),
(2026, 'Married', 'married', 16600.01, 21600.00, 26.00, 3980.00, 'Malta Tax Authority 2026'),
(2026, 'Married', 'married', 21600.01, 60000.00, 31.00, 5065.00, 'Malta Tax Authority 2026'),
(2026, 'Married', 'married', 60000.01, NULL, 35.00, 8065.00, 'Malta Tax Authority 2026'),

-- Parent/Single parent (additional relief)
(2026, 'Parent', 'parent', 0.00, 12600.00, 0.00, 0.00, 'Malta Tax Authority 2026'),
(2026, 'Parent', 'parent', 12600.01, 18000.00, 15.00, 1890.00, 'Malta Tax Authority 2026'),
(2026, 'Parent', 'parent', 18000.01, 23000.00, 26.00, 4210.00, 'Malta Tax Authority 2026'),
(2026, 'Parent', 'parent', 23000.01, 60000.00, 31.00, 5295.00, 'Malta Tax Authority 2026'),
(2026, 'Parent', 'parent', 60000.01, NULL, 35.00, 8295.00, 'Malta Tax Authority 2026');

-- Report
SELECT 'Inserted tax brackets for 2026' AS status;
SELECT year, category_code, count(*) as bands FROM tax_rates_live WHERE year = 2026 GROUP BY year, category_code ORDER BY category_code;
SELECT id, year, raw_category_label, category_code, band_from, band_to, rate, subtract FROM tax_rates_live WHERE year = 2026 ORDER BY category_code, band_from;

COMMIT;
