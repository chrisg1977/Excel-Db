BEGIN;

-- Re-insert amended cohort-structured rows for 2025 (wage_from is NOT NULL)
INSERT INTO social_security_classes (year, class_code, dob_from, dob_to, min_age, max_age, wage_from, wage_to, employee_fixed, employee_percentage, employer_fixed, employer_percentage, mlf_fixed, mlf_percentage, mlf_max, notes)
VALUES
(2025, 'A', NULL, NULL, 0, 17, 0.00, 221.78, 6.62, NULL, 6.62, NULL, 0.20, NULL, NULL, 'Class A: under 18, wage <= 221.78'),
(2025, 'B', NULL, NULL, 18, NULL, 0.00, 221.78, 22.94, NULL, 22.94, NULL, 0.69, NULL, NULL, 'Class B: 18+, wage <= 221.78'),
(2025, 'C', NULL, '1961-12-31', NULL, NULL, 221.79, 490.38, NULL, 10.00, NULL, 10.00, NULL, NULL, 0.30, 'Class C (born on or before 31-12-1961) 10% emp/empr, MLF 0.30%'),
(2025, 'C', '1962-01-01', NULL, NULL, NULL, 221.79, 559.30, NULL, 10.00, NULL, 10.00, NULL, NULL, 0.30, 'Class C (born on or after 01-01-1962) 10% emp/empr, MLF 0.30%'),
(2025, 'D', NULL, '1961-12-31', NULL, NULL, 490.39, NULL, 49.04, NULL, 49.04, NULL, 1.47, NULL, NULL, 'Class D fixed contributions (born on or before 31-12-1961)'),
(2025, 'D', '1962-01-01', NULL, NULL, NULL, 559.31, NULL, 55.93, NULL, 55.93, NULL, 1.68, NULL, NULL, 'Class D fixed contributions (born on or after 01-01-1962)'),
(2025, 'E', NULL, NULL, 0, 17, 0.00, NULL, NULL, 10.00, NULL, 10.00, NULL, NULL, 0.13, 'Class E: students under 18, 10% capped at €4.38; MLF cap €0.13'),
(2025, 'F', NULL, NULL, 18, NULL, 0.00, NULL, NULL, 10.00, NULL, 10.00, NULL, NULL, 0.24, 'Class F: students 18+, 10% capped at €7.94; MLF cap €0.24');

-- Verify
SELECT id, year, class_code, dob_from, dob_to, min_age, max_age, wage_from, wage_to, employee_fixed, employee_percentage, employer_fixed, employer_percentage, mlf_fixed, mlf_percentage, mlf_max, notes FROM social_security_classes WHERE year = 2025 ORDER BY class_code, dob_from NULLS FIRST, wage_from;

COMMIT;
