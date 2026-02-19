-- Test Data for Validation Testing
-- Case 1: Overlapping Bands (INVALID - should be blocked)
INSERT INTO tax_rates_import (batch_id, year, raw_category_label, category_code, band_from, band_to, rate, subtract, status)
SELECT 
  'de4b3e4c-1234-5678-90ab-cdef12340001' as batch_id,
  2026 as year,
  'Single Rates' as raw_category_label,
  'sng' as category_code,
  band_from,
  band_to,
  rate,
  0 as subtract,
  'draft' as status
FROM (VALUES
  (0::numeric, 10000::numeric, 0.10::numeric),
  (8000::numeric, 18000::numeric, 0.12::numeric)  -- Overlaps with first band!
) AS t(band_from, band_to, rate)
WHERE NOT EXISTS (SELECT 1 FROM tax_rates_import WHERE batch_id = 'de4b3e4c-1234-5678-90ab-cdef12340001');

-- Case 2: Missing Required Categories (INVALID - should be blocked)
WITH category_data AS (
  SELECT 
    'de4b3e4c-5678-90ab-1234-cdef12340002' as batch_id,
    2026 as year,
    category_label,
    category_code,
    band_from,
    band_to,
    rate
  FROM (VALUES
    ('Single Rates', 'sng'::varchar, 0::numeric, 10000::numeric, 0.10::numeric),
    ('Single Rates', 'sng'::varchar, 10000::numeric, 30000::numeric, 0.15::numeric),
    ('Married Rates 1', 'mar1'::varchar, 0::numeric, 12000::numeric, 0.08::numeric),
    ('Married Rates 1', 'mar1'::varchar, 12000::numeric, 40000::numeric, 0.12::numeric),
    ('Married Rates 2', 'mar2'::varchar, 0::numeric, 14000::numeric, 0.07::numeric),
    ('Married Rates 2', 'mar2'::varchar, 14000::numeric, 45000::numeric, 0.11::numeric)
    -- Missing par1, par2, mar!
  ) AS t(category_label, category_code, band_from, band_to, rate)
)
INSERT INTO tax_rates_import (batch_id, year, raw_category_label, category_code, band_from, band_to, rate, subtract, status)
SELECT batch_id, year, category_label, category_code, band_from, band_to, rate, 0, 'draft'
FROM category_data
WHERE NOT EXISTS (SELECT 1 FROM tax_rates_import WHERE batch_id = 'de4b3e4c-5678-90ab-1234-cdef12340002');

-- Case 3: Valid Complete Tax Rates
WITH category_data AS (
  SELECT 
    'de4b3e4c-90ab-1234-5678-cdef12340003' as batch_id,
    2026 as year,
    category_label,
    category_code,
    band_from,
    band_to,
    rate
  FROM (VALUES
    ('Single Rates', 'sng'::varchar, 0::numeric, 10000::numeric, 0.10::numeric),
    ('Single Rates', 'sng'::varchar, 10000::numeric, 30000::numeric, 0.15::numeric),
    ('Single Rates', 'sng'::varchar, 30000::numeric, NULL::numeric, 0.20::numeric),
    ('Married Rates 1', 'mar1'::varchar, 0::numeric, 12000::numeric, 0.08::numeric),
    ('Married Rates 1', 'mar1'::varchar, 12000::numeric, 40000::numeric, 0.12::numeric),
    ('Married Rates 1', 'mar1'::varchar, 40000::numeric, NULL::numeric, 0.18::numeric),
    ('Married Rates 2', 'mar2'::varchar, 0::numeric, 14000::numeric, 0.07::numeric),
    ('Married Rates 2', 'mar2'::varchar, 14000::numeric, 45000::numeric, 0.11::numeric),
    ('Married Rates 2', 'mar2'::varchar, 45000::numeric, NULL::numeric, 0.17::numeric),
    ('Parent Rates 1', 'par1'::varchar, 0::numeric, 11000::numeric, 0.08::numeric),
    ('Parent Rates 1', 'par1'::varchar, 11000::numeric, 35000::numeric, 0.13::numeric),
    ('Parent Rates 1', 'par1'::varchar, 35000::numeric, NULL::numeric, 0.19::numeric),
    ('Parent Rates 2', 'par2'::varchar, 0::numeric, 13000::numeric, 0.07::numeric),
    ('Parent Rates 2', 'par2'::varchar, 13000::numeric, 42000::numeric, 0.11::numeric),
    ('Parent Rates 2', 'par2'::varchar, 42000::numeric, NULL::numeric, 0.16::numeric)
  ) AS t(category_label, category_code, band_from, band_to, rate)
)
INSERT INTO tax_rates_import (batch_id, year, raw_category_label, category_code, band_from, band_to, rate, subtract, status)
SELECT batch_id, year, category_label, category_code, band_from, band_to, rate, 0, 'draft'
FROM category_data
WHERE NOT EXISTS (SELECT 1 FROM tax_rates_import WHERE batch_id = 'de4b3e4c-90ab-1234-5678-cdef12340003');

-- Display all test case batch IDs
SELECT 
  'Test Case 1: Overlapping Bands (INVALID)' as test_case,
  'de4b3e4c-1234-5678-90ab-cdef12340001' as batch_id,
  (SELECT COUNT(*) FROM tax_rates_import WHERE batch_id = 'de4b3e4c-1234-5678-90ab-cdef12340001') as record_count
UNION ALL
SELECT 
  'Test Case 2: Missing Categories (INVALID)',
  'de4b3e4c-5678-90ab-1234-cdef12340002',
  (SELECT COUNT(*) FROM tax_rates_import WHERE batch_id = 'de4b3e4c-5678-90ab-1234-cdef12340002')
UNION ALL
SELECT 
  'Test Case 3: Valid Complete (VALID)',
  'de4b3e4c-90ab-1234-5678-cdef12340003',
  (SELECT COUNT(*) FROM tax_rates_import WHERE batch_id = 'de4b3e4c-90ab-1234-5678-cdef12340003');
