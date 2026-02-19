BEGIN;

-- Create directus schema table if missing
CREATE TABLE IF NOT EXISTS directus.social_security_category_map (
  id SERIAL PRIMARY KEY,
  raw_category_label TEXT NOT NULL,
  category_code VARCHAR(16) NOT NULL,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_directus_social_security_category_map_raw_label
  ON directus.social_security_category_map (raw_category_label);

-- Insert canonical mappings (common variants) mapping raw labels to classes A-F
INSERT INTO directus.social_security_category_map (raw_category_label, category_code, enabled)
VALUES
  ('Class A', 'A', true),
  ('Class A Youth', 'A', true),
  ('Class A Under 18', 'A', true),
  ('Class B', 'B', true),
  ('Class C', 'C', true),
  ('Class D', 'D', true),
  ('Class E', 'E', true),
  ('Class F', 'F', true),
  ('Class A (Under 18)', 'A', true),
  ('Class B (18+)', 'B', true),
  ('Class C (middle band)', 'C', true),
  ('Class D (upper band)', 'D', true),
  ('Apprentice Under 18', 'E', true),
  ('Apprentice 18+', 'F', true)
ON CONFLICT (raw_category_label) DO UPDATE
  SET category_code = EXCLUDED.category_code,
      enabled = EXCLUDED.enabled;

-- Insert 2026 social security class definitions (A-F)
-- Class A
INSERT INTO social_security_classes (year, class_code, description, min_age, max_age, wage_from, wage_to, employee_fixed, employer_fixed, mlf_fixed, notes)
VALUES (2026, 'A', 'Persons under 18 years', 0, 17, 0.10, 229.44, 6.62, 6.62, 0.20, 'Total 13.24')
ON CONFLICT DO NOTHING;

-- Class B
INSERT INTO social_security_classes (year, class_code, description, min_age, wage_from, wage_to, employee_fixed, employer_fixed, mlf_fixed, notes)
VALUES (2026, 'B', 'Persons aged 18 and over (lower band)', 18, 0.10, 229.44, 22.94, 22.94, 0.69, 'Total 45.88')
ON CONFLICT DO NOTHING;

-- Class C/D for persons born up to 31-Dec-1961
INSERT INTO social_security_classes (year, class_code, description, dob_to, wage_from, wage_to, employee_percentage, employer_percentage, mlf_percentage, notes)
VALUES
  (2026, 'C', 'Born up to 31-Dec-1961 — middle band', '1961-12-31', 229.45, 490.38, 10.00, 10.00, 0.30, '10% employee and employer'),
  (2026, 'D', 'Born up to 31-Dec-1961 — upper band', '1961-12-31', 490.39, NULL, 49.04, 49.04, 1.47, 'Fixed contributions')
ON CONFLICT DO NOTHING;

-- Class C/D for persons born from 1-Jan-1962 onwards
INSERT INTO social_security_classes (year, class_code, description, dob_from, wage_from, wage_to, employee_percentage, employer_percentage, mlf_percentage, notes)
VALUES
  (2026, 'C', 'Born from 1-Jan-1962 onwards — middle band', '1962-01-01', 229.45, 559.30, 10.00, 10.00, 0.30, '10% employee and employer'),
  (2026, 'D', 'Born from 1-Jan-1962 onwards — upper band', '1962-01-01', 559.31, NULL, 55.93, 55.93, 1.68, 'Fixed contributions')
ON CONFLICT DO NOTHING;

-- Class E: Apprenticeship students under 18
INSERT INTO social_security_classes (year, class_code, description, min_age, max_age, wage_from, wage_to, employee_percentage, employer_percentage, mlf_percentage, mlf_max, notes)
VALUES (2026, 'E', 'Apprenticeship students under 18 — 10% up to max', 0, 17, 0.00, NULL, 10.00, 10.00, 0.30, 0.13, 'Employee/Employer capped at €4.38; MLF cap €0.13')
ON CONFLICT DO NOTHING;

-- Class F: Apprenticeship students 18 and over
INSERT INTO social_security_classes (year, class_code, description, min_age, wage_from, wage_to, employee_percentage, employer_percentage, mlf_percentage, mlf_max, notes)
VALUES (2026, 'F', 'Apprenticeship students 18 and over — 10% up to max', 18, 0.00, NULL, 10.00, 10.00, 0.30, 0.24, 'Employee/Employer capped at €7.94; MLF cap €0.24')
ON CONFLICT DO NOTHING;

COMMIT;
