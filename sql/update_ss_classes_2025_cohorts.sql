BEGIN;

-- Delete existing 2025 class rows (we backed them up already)
DELETE FROM social_security_classes WHERE year = 2025;

-- Insert amended cohort-structured rows for 2025
-- Class A: single entry, under 18, wage_to 221.78, fixed amounts from seed
INSERT INTO social_security_classes (year, class_code, dob_from, dob_to, min_age, max_age, wage_from, wage_to, employee_fixed, employer_fixed, mlf_fixed, notes)
VALUES
(2025, 'A', NULL, NULL, 0, 17, 0, 221.78, 6.62, 6.62, 0.20, 'Class A: under 18, wage <= 221.78'),

-- Class B: single entry, 18+, wage_to 221.78
(2025, 'B', NULL, NULL, 18, NULL, 0, 221.78, 22.94, 22.94, 0.69, 'Class B: 18+, wage <= 221.78'),

-- Class C: two cohort rows split by DOB 31-12-1961
(2025, 'C', NULL, '1961-12-31', NULL, NULL, 221.79, 490.38, NULL, NULL, NULL, 'Class C (born on or before 31-12-1961) 10% emp/empr, MLF 0.30%'),
(2025, 'C', '1962-01-01', NULL, NULL, NULL, 221.79, 559.30, NULL, NULL, NULL, 'Class C (born on or after 01-01-1962) 10% emp/empr, MLF 0.30%'),

-- Class D: two cohort rows split by DOB 31-12-1961 (fixed contributions)
(2025, 'D', NULL, '1961-12-31', NULL, NULL, 490.39, NULL, 49.04, 49.04, 1.47, 'Class D fixed contributions (born on or before 31-12-1961)'),
(2025, 'D', '1962-01-01', NULL, NULL, NULL, 559.31, NULL, 55.93, 55.93, 1.68, 'Class D fixed contributions (born on or after 01-01-1962)'),

-- Class E: students under 18 (percentage, capped)
(2025, 'E', NULL, NULL, 0, 17, NULL, NULL, NULL, NULL, 0.13, 'Class E: students under 18, 10% capped at €4.38; MLF cap €0.13'),

-- Class F: students 18+ (percentage, capped)
(2025, 'F', NULL, NULL, 18, NULL, NULL, NULL, NULL, NULL, 0.24, 'Class F: students 18+, 10% capped at €7.94; MLF cap €0.24');

-- Verify
SELECT id, year, class_code, dob_from, dob_to, min_age, max_age, wage_from, wage_to, employee_fixed, employee_percentage, employer_fixed, employer_percentage, mlf_fixed, mlf_percentage, mlf_max, notes FROM social_security_classes WHERE year = 2025 ORDER BY class_code, dob_from NULLS FIRST, wage_from;

COMMIT;
