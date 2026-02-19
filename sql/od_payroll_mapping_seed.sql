-- Main Payroll Employee Mappings
-- From OpenDental employee JOIN userod
-- NOTE: Duplicates commented out for now; will be resolved after manual review

INSERT INTO od_payroll_employee_map (payroll_id, od_employee_num, od_user_num, first_name, last_name)
VALUES
  ('2025001', 33, 22, 'Cristina', 'Acero'),
  ('2021009', 31, 34, 'Raisa', 'Attard'),
  ('2026003', 25, 48, 'Katrina', 'Bonavia'),      -- primary (keeping this one)
  -- ('2026003', 25, 27, 'Katrina', 'Bonavia'),    -- DUPLICATE: different UserNum
  ('2018004', 14, 10, 'Luana', 'Bonnici'),
  ('2020005', 17, 15, 'Michaela', 'Camilleri'),
  ('2025006', 40, 19, 'Emma', 'Curmi'),
  ('2024002', 48, 26, 'Maria', 'Ellul'),
  ('2025007', 19, 47, 'Andae', 'Falzon'),
  ('2025002', 35, 30, 'Ahmad', 'Faraz'),
  ('2024005', 49, 39, 'Andreya', 'Gauci'),        -- primary (keeping this one)
  -- ('2024005', 49, 49, 'Andreya', 'Gauci'),      -- DUPLICATE: different UserNum
  -- ('2024005', 49, 18, 'Mariah', 'HYG'),         -- DUPLICATE: different names!
  ('2023007', 34, 38, 'Aisha', 'Haneena'),        -- primary (keeping this one)
  -- ('2023007', 34, 50, 'Aishathul', 'Haneena'), -- DUPLICATE: different names!
  ('2023008', 42, 32, 'Elda', 'Lama'),
  ('2023006', 10, 17, 'Rebecca', 'Mallan'),
  ('2025011', 32, 6, 'Zaira', 'Mifsud'),
  ('2026002', 46, 43, 'Danila', 'Nixon'),
  ('2026004', 41, 42, 'Natasha', 'Scerri Esposito'),
  ('2025005', 26, 35, 'Anitta', 'Simon'),
  ('2023005', 39, 31, 'Rethu', 'Sreejith');

-- Provider Payroll Mappings
-- From OpenDental provider JOIN userod

INSERT INTO od_provider_map (provider_id, od_prov_num, od_user_num, abbreviation, first_name, last_name)
VALUES
  ('2024001', NULL, 44, 'NA', 'Natasha', 'Azzopardi'),
  ('2016001', NULL, 14, 'RODAZZ', 'Roderick', 'Azzopardi'),
  ('2021004', NULL, 23, 'EB', 'Eisle', 'Baroni'),
  ('2025008', NULL, 52, 'RC', 'Ryan', 'Camilleri'),          -- primary (keeping this one)
  ('2018002', NULL, 7, 'LC', 'Lucia', 'Carini'),
  ('2018001', NULL, 13, 'RG', 'Ritienne', 'Galdes'),
  ('2001001', NULL, 2, 'CG', 'Christian', 'Gauci'),
  ('2023009', NULL, 18, 'MG', 'Mariah', 'Grixti'),
  ('2025009', NULL, 9, 'Debb', 'Deborah', 'Mifsud_Ceci'),
  ('2024006', NULL, 25, 'KM', 'Katia', 'Mizzi'),
  ('2024009', NULL, 46, 'RAP', 'Rucsandra-Ana', 'Petre'),
  ('2013001', NULL, 8, 'JS', 'Jackie', 'Schembri'),
  ('2025012', NULL, 53, 'LS', 'Luke', 'Sciberras');
