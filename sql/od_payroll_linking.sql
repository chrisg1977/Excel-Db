-- Link employees to payroll streams
-- An employee can be in MAIN payroll, PROVIDER payroll, or both

-- Link Directus employee_id to main payroll (PayrollID)
INSERT INTO od_employee_link (directus_employee_id, od_payroll_id)
SELECT 
    ec.emp_id,
    opm.payroll_id
FROM vw_employee_current ec
JOIN od_payroll_employee_map opm 
    ON ec.surname = opm.last_name 
    AND ec.first_name = opm.first_name
WHERE ec.terminated_on IS NULL
ON CONFLICT (directus_employee_id, od_payroll_id) DO NOTHING;

-- Link Directus employee_id to provider payroll (CustomID)
-- Employees who are also providers
INSERT INTO od_provider_link (directus_employee_id, od_provider_id, payroll_type, payment_method)
SELECT 
    ec.emp_id,
    opr.provider_id,
    'BOTH',  -- they are both employee AND provider
    'BANK_TRANSFER'  -- default; adjust per your payment method
FROM vw_employee_current ec
JOIN od_provider_map opr 
    ON ec.surname = opr.last_name 
    AND ec.first_name = opr.first_name
WHERE ec.terminated_on IS NULL
AND EXISTS (
    SELECT 1 FROM od_employee_link oel 
    WHERE oel.directus_employee_id = ec.emp_id
)
ON CONFLICT (od_provider_id, directus_employee_id) DO NOTHING;

-- Link external providers (not Directus employees)
INSERT INTO od_provider_link (directus_employee_id, od_provider_id, payroll_type, payment_method)
SELECT 
    NULL,  -- no directus employee
    opr.provider_id,
    'PROVIDER',
    'CASH'  -- default for external providers
FROM od_provider_map opr
WHERE NOT EXISTS (
    SELECT 1 FROM od_provider_link opl
    WHERE opl.od_provider_id = opr.provider_id
)
ON CONFLICT DO NOTHING;
