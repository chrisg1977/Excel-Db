-- Seed common leave types and a sample department
INSERT INTO leave_types (code, display_name, default_hours, notes)
VALUES
  ('annual_vacation', 'Annual Vacation Leave', 224, '28 days for a 40-hour work week (pro-rated) - 2025 guidance'),
  ('urgent_family', 'Urgent Family Leave', 32, '32 hours per year (from April 4, 2025) - taken from existing leave entitlement'),
  ('sick_leave', 'Sick Leave', 80, 'Typical paid sick leave hours; may vary by WRO'),
  ('maternity_leave', 'Maternity Leave', NULL, '18 weeks total (126 days). First 14 weeks paid by employer; remaining 4 weeks social security)'),
  ('paternity_leave', 'Paternity/Birth Leave', 80, '10 working days fully paid'),
  ('marriage_leave', 'Marriage Leave', 16, '2 working days'),
  ('bereavement_leave', 'Bereavement Leave', 8, '1 working day'),
  ('parental_leave', 'Parental Leave (unpaid)', NULL, '4 months unpaid leave; limited paid component via sickness benefit'),
  ('ivf_leave', 'IVF Leave', 100, 'Up to 100 hours paid leave for IVF procedures');

-- Sample department row for general policies (replace or extend as needed)
INSERT INTO departments (abbreviation, name) VALUES ('GEN', 'General / Default') ON CONFLICT (abbreviation) DO NOTHING;
