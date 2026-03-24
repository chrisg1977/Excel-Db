-- EOS grouped dental production planning draft (v1)
-- Status:
--   Planning artifact only.
--   NOT final production SQL.
--   NOT wired into the frontend.
--
-- Live validation basis:
--   Updated using confirmed live Open Dental findings from the validation pack.
--
-- Important runtime note:
--   The live Open Dental database is MySQL 5.5.14.
--   This file keeps a staged / CTE-style layout for readability as a planning artifact.
--   Final implementation may need derived tables instead of CTEs because MySQL 5.5 does not support WITH.
--
-- Frontend expectation:
--   - One grouped row per patient visit / appointment occurrence within the selected clinic and report window.
--   - Treatments should be concatenated into a single display string.
--   - Provider should be displayed, concatenating full names if multiple providers exist in one grouped visit.
--   - Fee total should be summed for the grouped row.
--   - Excluded / carry-forward persistence is NOT part of this extraction SQL.
--
-- Confirmed live decisions applied here:
--   - clinic.ClinicNum is the canonical clinic identifier.
--   - clinic.Abbr is the business clinic code.
--   - Confirmed live clinic examples include MDCZ and MDCQ.
--   - appointment.AptDateTime is the report-window datetime source.
--   - procedurelog.ProcDate must NOT be used for intra-day EOS filtering.
--   - procedurelog.AptNum / appointment.AptNum is the grouped patient-visit key.
--   - First implementation is appointment-based only, so AptNum = 0 rows are excluded.
--   - Production source is procedurelog.ProcFee on completed rows only (ProcStatus = 2).
--   - Financial / non-treatment pseudo-procedure rows must be excluded with procedurecode.ProcCat <> 314.
--   - patient.PatNum is the patient number source.
--   - Provider display comes from procedurelog.ProvNum -> provider.ProvNum using full names.
--   - Treatment display comes from procedurecode.Descript.
--   - Effective clinic logic prefers appointment.ClinicNum when present/non-zero, otherwise falls back to procedurelog.ClinicNum.

-- ---------------------------------------------------------------------------
-- Stage 0: Parameters
-- ---------------------------------------------------------------------------
-- Replace these planning placeholders with real backend parameters later.

SET @clinic_code = 'MDCZ';
SET @clinic_num = 1; -- example confirmed live mapping: MDCZ = 1, MDCQ = 2
SET @department_code = 'MDCZ';
SET @report_start_at = 'YYYY-MM-DD HH:MM:SS';
SET @report_end_at = 'YYYY-MM-DD HH:MM:SS';

-- ---------------------------------------------------------------------------
-- Stage 1: Raw extraction with effective clinic and appointment datetime
-- ---------------------------------------------------------------------------
-- Confirmed live source areas:
--   - procedurelog
--   - appointment
--   - clinic
--   - patient
--   - provider
--   - procedurecode
--
-- Effective clinic rule:
--   Use appointment.ClinicNum when present and non-zero.
--   Otherwise fall back to procedurelog.ClinicNum.
--
-- Appointment rule:
--   This first implementation is appointment-based only.
--   Exclude procedurelog rows where AptNum = 0.
--
-- Production rule:
--   Keep completed rows only: ProcStatus = 2.
--   Sum ProcFee.
--   Exclude non-treatment financial pseudo-procedure rows where procedurecode.ProcCat = 314.

WITH raw_production AS (
  SELECT
    pl.ProcNum,
    pl.AptNum,
    pl.PatNum,
    pl.ProvNum,
    pl.CodeNum,
    pl.ProcStatus,
    pl.ProcFee,
    pl.ClinicNum AS procedurelog_clinic_num,
    appt.ClinicNum AS appointment_clinic_num,
    appt.AptDateTime AS appointment_datetime,

    CASE
      WHEN appt.ClinicNum IS NOT NULL AND appt.ClinicNum <> 0 THEN appt.ClinicNum
      ELSE pl.ClinicNum
    END AS effective_clinic_num,

    cln.Abbr AS clinic_code,
    @department_code AS department_code,

    -- Confirmed patient identity source.
    CAST(pat.PatNum AS CHAR) AS patient_number,
    pat.LName AS surname,
    pat.FName AS name,

    -- Confirmed provider source for grouped display.
    prv.FName AS provider_first_name,
    prv.LName AS provider_last_name,

    -- Confirmed treatment description source.
    pc.ProcCode,
    pc.Descript AS treatment_description,
    pc.ProcCat

  FROM procedurelog pl
  INNER JOIN appointment appt
    ON appt.AptNum = pl.AptNum
  LEFT JOIN patient pat
    ON pat.PatNum = pl.PatNum
  LEFT JOIN provider prv
    ON prv.ProvNum = pl.ProvNum
  LEFT JOIN procedurecode pc
    ON pc.CodeNum = pl.CodeNum
  LEFT JOIN clinic cln
    ON cln.ClinicNum = CASE
      WHEN appt.ClinicNum IS NOT NULL AND appt.ClinicNum <> 0 THEN appt.ClinicNum
      ELSE pl.ClinicNum
    END

  WHERE pl.AptNum <> 0
    AND pl.ProcStatus = 2
    AND appt.AptDateTime >= @report_start_at
    AND appt.AptDateTime <= @report_end_at
    AND CASE
      WHEN appt.ClinicNum IS NOT NULL AND appt.ClinicNum <> 0 THEN appt.ClinicNum
      ELSE pl.ClinicNum
    END = @clinic_num
    AND COALESCE(pc.ProcCat, -1) <> 314
),

-- ---------------------------------------------------------------------------
-- Stage 2: Grouped visit stage by AptNum
-- ---------------------------------------------------------------------------
-- Confirmed live grouping behavior:
--   - Use AptNum as the patient_visit_key for the first implementation.
--   - Live validation showed zero multi-patient collisions on appointment groups.
--   - Some grouped visits contain multiple providers, so provider display should concatenate names.

grouped_patient_visits AS (
  SELECT
    rp.effective_clinic_num,
    MAX(rp.clinic_code) AS clinic_code,
    MAX(rp.department_code) AS department_code,
    rp.AptNum AS patient_visit_key,
    MAX(rp.appointment_datetime) AS appointment_datetime,
    DATE_FORMAT(MAX(rp.appointment_datetime), '%H:%i') AS time,
    MAX(rp.patient_number) AS patient_number,
    MAX(rp.surname) AS surname,
    MAX(rp.name) AS name,

    GROUP_CONCAT(
      DISTINCT COALESCE(rp.treatment_description, rp.ProcCode, CONCAT('Code ', rp.CodeNum))
      ORDER BY COALESCE(rp.treatment_description, rp.ProcCode, CONCAT('Code ', rp.CodeNum))
      SEPARATOR ', '
    ) AS treatments,

    GROUP_CONCAT(
      DISTINCT TRIM(CONCAT(COALESCE(rp.provider_first_name, ''), ' ', COALESCE(rp.provider_last_name, '')))
      ORDER BY TRIM(CONCAT(COALESCE(rp.provider_first_name, ''), ' ', COALESCE(rp.provider_last_name, '')))
      SEPARATOR ' | '
    ) AS provider,

    ROUND(SUM(COALESCE(rp.ProcFee, 0)), 2) AS fee_total,
    COUNT(*) AS source_proc_count

  FROM raw_production rp
  GROUP BY
    rp.effective_clinic_num,
    rp.AptNum
),

-- ---------------------------------------------------------------------------
-- Stage 3: Final API-shaped select
-- ---------------------------------------------------------------------------
-- Intended output contract:
--   - time
--   - patient_number
--   - surname
--   - name
--   - treatments
--   - provider
--   - fee_total
--   - clinic_code
--   - department_code
--   - patient_visit_key
--   - source_proc_count
--   - appointment_datetime

final_api_shape AS (
  SELECT
    gpv.time,
    gpv.patient_number,
    gpv.surname,
    gpv.name,
    gpv.treatments,
    gpv.provider,
    gpv.fee_total,
    gpv.clinic_code,
    gpv.department_code,
    CAST(gpv.patient_visit_key AS CHAR) AS patient_visit_key,
    gpv.source_proc_count,
    gpv.appointment_datetime
  FROM grouped_patient_visits gpv
)

SELECT
  time,
  patient_number,
  surname,
  name,
  treatments,
  provider,
  fee_total,
  clinic_code,
  department_code,
  patient_visit_key,
  source_proc_count,
  appointment_datetime
FROM final_api_shape
ORDER BY
  appointment_datetime,
  patient_number;
