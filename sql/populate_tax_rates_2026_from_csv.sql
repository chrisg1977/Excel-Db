-- Delete existing 2026 tax rates
DELETE FROM tax_rates_live WHERE year = 2026;

-- Insert 2026 tax rates from CSV (7 categories × 4 brackets = 28 rows)
INSERT INTO tax_rates_live (year, raw_category_label, category_code, band_from, band_to, rate, subtract) VALUES
-- Single Rates
(2026, 'Single', 'Single', 0, 12000, 0.00, 0.00),
(2026, 'Single', 'Single', 12001, 16000, 15.00, 1800.00),
(2026, 'Single', 'Single', 16001, 60000, 25.00, 3400.00),
(2026, 'Single', 'Single', 60001, 999999999, 35.00, 9400.00),

-- Married Rates
(2026, 'Married', 'Married', 0, 15000, 0.00, 0.00),
(2026, 'Married', 'Married', 15001, 23000, 15.00, 2250.00),
(2026, 'Married', 'Married', 23001, 60000, 25.00, 4550.00),
(2026, 'Married', 'Married', 60001, 999999999, 35.00, 10550.00),

-- Married Rates with 1 child (Married 1)
(2026, 'Married 1', 'Married1', 0, 17500, 0.00, 0.00),
(2026, 'Married 1', 'Married1', 17501, 26500, 15.00, 2625.00),
(2026, 'Married 1', 'Married1', 26501, 60000, 25.00, 5275.00),
(2026, 'Married 1', 'Married1', 60001, 999999999, 35.00, 11275.00),

-- Married Rates with 2 children or more (Married 2)
(2026, 'Married 2', 'Married2', 0, 22500, 0.00, 0.00),
(2026, 'Married 2', 'Married2', 22501, 32000, 15.00, 3375.00),
(2026, 'Married 2', 'Married2', 32001, 60000, 25.00, 6575.00),
(2026, 'Married 2', 'Married2', 60001, 999999999, 35.00, 12575.00),

-- Parent Rates
(2026, 'Parent', 'Parent', 0, 13000, 0.00, 0.00),
(2026, 'Parent', 'Parent', 13001, 17500, 15.00, 1950.00),
(2026, 'Parent', 'Parent', 17501, 60000, 25.00, 3700.00),
(2026, 'Parent', 'Parent', 60001, 999999999, 35.00, 9700.00),

-- Parent Rates with 1 child (Parent 1)
(2026, 'Parent 1', 'Parent1', 0, 14500, 0.00, 0.00),
(2026, 'Parent 1', 'Parent1', 14501, 21000, 15.00, 2175.00),
(2026, 'Parent 1', 'Parent1', 21001, 60000, 25.00, 4275.00),
(2026, 'Parent 1', 'Parent1', 60001, 999999999, 35.00, 10275.00),

-- Parent Rates with 2 children or more (Parent 2)
(2026, 'Parent 2', 'Parent2', 0, 18500, 0.00, 0.00),
(2026, 'Parent 2', 'Parent2', 18501, 25500, 15.00, 2775.00),
(2026, 'Parent 2', 'Parent2', 25501, 60000, 25.00, 5325.00),
(2026, 'Parent 2', 'Parent2', 60001, 999999999, 35.00, 11325.00);

-- Verify insertion
SELECT category_code, COUNT(*) as bracket_count, 
       MIN(band_from) as min_band, MAX(band_to) as max_band
FROM tax_rates_live 
WHERE year = 2026
GROUP BY category_code
ORDER BY category_code;
