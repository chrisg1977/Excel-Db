-- Update social_security_classes to set fixed contributions for Class D rows
UPDATE social_security_classes
SET employee_fixed = 49.04, employer_fixed = 49.04, mlf_fixed = 1.47
WHERE year = 2025 AND class_code = 'D' AND dob_to = '1961-12-31';

UPDATE social_security_classes
SET employee_fixed = 55.93, employer_fixed = 55.93, mlf_fixed = 1.68
WHERE year = 2025 AND class_code = 'D' AND dob_from = '1962-01-01';
