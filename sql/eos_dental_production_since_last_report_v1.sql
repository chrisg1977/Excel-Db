-- EOS dental production gather draft (v1)
-- Purpose:
--   Pull dental clinic production from the previous report cutoff until the current gather time.
--
-- Status:
--   Draft only. The earlier SQL mentioned in discussion was not found in this repo or local git history,
--   so this file recreates the intended shape and adds clinic selection explicitly.
--
-- Assumptions to validate against the live OpenDental source:
--   - Source DB is OpenDental MySQL.
--   - Production source table is procedurelog.
--   - Completed procedures use ProcStatus = 2.
--   - Gross production amount is represented by procedurelog.ProcFee.
--   - Clinic filtering should be done by ClinicNum.
--
-- Known limitation:
--   - ProcDate is date-granular. If the live report must cut off intra-day, replace ProcDate-based filtering
--     with the correct datetime column from the production source.
--
-- How to use:
--   1) Set @clinic_code for the business-facing clinic label (for your output only).
--   2) Set @clinic_num to the real OpenDental ClinicNum for that clinic.
--   3) Set @previous_report_at to the prior report cutoff timestamp.
--   4) Leave @gather_until_at as NOW() or replace it with a fixed timestamp.

SET @clinic_code = 'MDCZ';
SET @clinic_num = NULL; -- required: replace with actual OpenDental ClinicNum, e.g. 1 or 2
SET @previous_report_at = 'YYYY-MM-DD HH:MM:SS';
SET @gather_until_at = NOW();

-- Summary by production date
SELECT
  @clinic_code AS clinic_code,
  pl.ClinicNum AS clinic_num,
  DATE(pl.ProcDate) AS production_date,
  COUNT(*) AS completed_procedure_count,
  ROUND(SUM(COALESCE(pl.ProcFee, 0)), 2) AS gross_production_amount
FROM procedurelog pl
WHERE pl.ClinicNum = @clinic_num
  AND pl.ProcStatus = 2
  AND pl.ProcDate >= DATE(@previous_report_at)
  AND pl.ProcDate <= DATE(@gather_until_at)
GROUP BY
  pl.ClinicNum,
  DATE(pl.ProcDate)
ORDER BY
  production_date;

-- Detail extract for audit / paste-back into the EOS gather page
SELECT
  @clinic_code AS clinic_code,
  pl.ProcNum,
  pl.PatNum,
  pl.ProvNum,
  pl.CodeNum,
  pl.ProcDate,
  pl.ProcFee,
  pl.ClinicNum
FROM procedurelog pl
WHERE pl.ClinicNum = @clinic_num
  AND pl.ProcStatus = 2
  AND pl.ProcDate >= DATE(@previous_report_at)
  AND pl.ProcDate <= DATE(@gather_until_at)
ORDER BY
  pl.ProcDate,
  pl.ProcNum;
