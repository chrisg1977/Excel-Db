-- 2026 statutory bonus and weekly allowance baseline values
-- Amounts based on the existing payroll schema comments and workbook-aligned figures.
-- Payment windows:
-- - March weekly allowance accrues from 1 Oct of previous year to 31 Mar
-- - June statutory bonus accrues from 1 Jan to 30 Jun
-- - September weekly allowance accrues from 1 Apr to 30 Sep
-- - December statutory bonus accrues from 1 Jul to 31 Dec

DELETE FROM statutory_bonuses
WHERE bonus_year = 2026;

INSERT INTO statutory_bonuses (
  bonus_year,
  bonus_type,
  payment_month,
  full_amount,
  daily_rate,
  weekly_rate,
  accrual_period_from,
  accrual_period_to,
  payment_cutoff_date,
  minimum_hours_worked
) VALUES
  (2026, 'WEEKLY_ALLOWANCE', 'MARCH',     121.16, NULL, 4.6600, DATE '2025-10-01', DATE '2026-03-31', DATE '2026-03-31', NULL),
  (2026, 'STATUTORY_BONUS', 'JUNE',       135.10, 0.7400, NULL, DATE '2026-01-01', DATE '2026-06-30', DATE '2026-06-30', NULL),
  (2026, 'WEEKLY_ALLOWANCE', 'SEPTEMBER', 121.16, NULL, 4.6600, DATE '2026-04-01', DATE '2026-09-30', DATE '2026-09-30', NULL),
  (2026, 'STATUTORY_BONUS', 'DECEMBER',   135.10, 0.7400, NULL, DATE '2026-07-01', DATE '2026-12-31', DATE '2026-12-23', NULL);
