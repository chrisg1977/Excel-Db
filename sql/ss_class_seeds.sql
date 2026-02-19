-- Seed social_security_classes for 2025 (Classes A-F)
-- Class A: Persons under 18 years
INSERT INTO social_security_classes (year, class_code, description, min_age, max_age, wage_from, wage_to, employee_fixed, employer_fixed, mlf_fixed, notes)
VALUES (2025, 'A', 'Persons under 18 years (weekly)', 0, 17, 0.10, 229.44, 6.62, 6.62, 0.20, 'Total contribution 13.24');

-- Class B: Persons aged 18 and over for the lower wage band
INSERT INTO social_security_classes (year, class_code, description, min_age, wage_from, wage_to, employee_fixed, employer_fixed, mlf_fixed, notes)
VALUES (2025, 'B', 'Persons aged 18 and over (lower band weekly)', 18, 0.10, 229.44, 22.94, 22.94, 0.69, 'Total contribution 45.88');

-- Class C / D for persons born up to 31-Dec-1961
INSERT INTO social_security_classes (year, class_code, description, dob_to, wage_from, wage_to, employee_percentage, employer_percentage, mlf_percentage, notes)
VALUES
(2025, 'C', 'Born up to 31-Dec-1961 — middle band', '1961-12-31', 229.45, 490.38, 10.00, 10.00, 0.30, '10% employee and employer'),
(2025, 'D', 'Born up to 31-Dec-1961 — upper band', '1961-12-31', 490.39, NULL, NULL, NULL, NULL, 'Fixed contributions of 49.04 each; MLF 1.47') ;

-- Class C / D for persons born from 1-Jan-1962 onwards
INSERT INTO social_security_classes (year, class_code, description, dob_from, wage_from, wage_to, employee_percentage, employer_percentage, mlf_percentage, notes)
VALUES
(2025, 'C', 'Born from 1-Jan-1962 onwards — middle band', '1962-01-01', 229.45, 559.30, 10.00, 10.00, 0.30, '10% employee and employer'),
(2025, 'D', 'Born from 1-Jan-1962 onwards — upper band', '1962-01-01', 559.31, NULL, NULL, NULL, NULL, 'Fixed contributions of 55.93 each; MLF 1.68');

-- Class E: Apprenticeship students under 18 years — 10% up to max
INSERT INTO social_security_classes (year, class_code, description, min_age, max_age, wage_from, wage_to, employee_percentage, employer_percentage, mlf_percentage, mlf_max, notes)
VALUES (2025, 'E', 'Apprenticeship students under 18 — 10% up to max', 0, 17, 0.00, NULL, 10.00, 10.00, 0.30, 0.13, 'Employee/Employer capped at €4.38; MLF cap €0.13');

-- Class F: Apprenticeship students 18 and over — 10% up to max
INSERT INTO social_security_classes (year, class_code, description, min_age, wage_from, wage_to, employee_percentage, employer_percentage, mlf_percentage, mlf_max, notes)
VALUES (2025, 'F', 'Apprenticeship students 18 and over — 10% up to max', 18, 0.00, NULL, 10.00, 10.00, 0.30, 0.24, 'Employee/Employer capped at €7.94; MLF cap €0.24');
