-- EOS Open Dental validation pack (v1)
-- Status:
--   Validation artifact only.
--   NOT final API SQL.
--   NOT frontend wiring.
--
-- Purpose:
--   Validate the uncertain Open Dental schema details before real EOS API implementation.
--
-- Usage notes:
--   - Start with the INFORMATION_SCHEMA queries in each section.
--   - Only run the follow-up candidate queries after confirming the relevant tables/columns exist.
--   - Common Open Dental table/column names are shown as candidates, not confirmed facts.
--   - VALIDATE AGAINST LIVE OPEN DENTAL SCHEMA before using any candidate query as implementation input.

SET @clinic_code = 'MDCZ';
SET @clinic_num = NULL;
SET @department_code = 'MDCZ';
SET @report_start_at = 'YYYY-MM-DD HH:MM:SS';
SET @report_end_at = 'YYYY-MM-DD HH:MM:SS';

-- ---------------------------------------------------------------------------
-- Section 1: Clinic mapping
-- Goal:
--   Identify the clinic table and validate clinic numbers plus any name/code fields.
-- ---------------------------------------------------------------------------

-- 1A. Discover clinic-related tables.
SELECT
  TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME LIKE '%clinic%'
ORDER BY TABLE_NAME;

-- 1B. Discover clinic-related columns.
SELECT
  TABLE_NAME,
  COLUMN_NAME,
  DATA_TYPE,
  COLUMN_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    TABLE_NAME LIKE '%clinic%'
    OR COLUMN_NAME LIKE '%clinic%'
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- 1C. Candidate follow-up query:
-- Run only if metadata confirms a `clinic` table and suitable display columns.
-- VALIDATE AGAINST LIVE OPEN DENTAL SCHEMA.
-- SELECT *
-- FROM clinic
-- ORDER BY ClinicNum
-- LIMIT 50;

-- ---------------------------------------------------------------------------
-- Section 2: Datetime source validation
-- Goal:
--   Inspect likely datetime fields for procedures and appointments.
--   Validate whether ProcDate is date-only.
--   Identify a possible appointment datetime source for true intra-day filtering.
-- ---------------------------------------------------------------------------

-- 2A. Discover date/time columns on likely procedure and appointment tables.
SELECT
  TABLE_NAME,
  COLUMN_NAME,
  DATA_TYPE,
  COLUMN_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    TABLE_NAME IN ('procedurelog', 'appointment')
    OR TABLE_NAME LIKE '%appoint%'
  )
  AND (
    COLUMN_NAME LIKE '%date%'
    OR COLUMN_NAME LIKE '%time%'
    OR COLUMN_NAME LIKE '%apt%'
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- 2B. Specifically inspect whether ProcDate is date-only or datetime-capable.
SELECT
  TABLE_NAME,
  COLUMN_NAME,
  DATA_TYPE,
  COLUMN_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'procedurelog'
  AND COLUMN_NAME = 'ProcDate';

-- 2C. Candidate follow-up queries:
-- Run only if metadata confirms the tables/columns below.
-- VALIDATE AGAINST LIVE OPEN DENTAL SCHEMA.
-- SELECT ProcNum, ProcDate
-- FROM procedurelog
-- ORDER BY ProcDate DESC
-- LIMIT 25;
--
-- SELECT *
-- FROM appointment
-- ORDER BY AptNum DESC
-- LIMIT 25;

-- ---------------------------------------------------------------------------
-- Section 3: Production definition validation
-- Goal:
--   Inspect `procedurelog` fields relevant to production.
--   Validate whether ProcStatus = 2 and ProcFee are appropriate candidates.
-- ---------------------------------------------------------------------------

-- 3A. Discover likely production-related fields on procedurelog.
SELECT
  TABLE_NAME,
  COLUMN_NAME,
  DATA_TYPE,
  COLUMN_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'procedurelog'
  AND (
    COLUMN_NAME LIKE 'Proc%'
    OR COLUMN_NAME IN ('ClinicNum', 'PatNum', 'ProvNum', 'CodeNum', 'AptNum')
  )
ORDER BY ORDINAL_POSITION;

-- 3B. Candidate follow-up query:
-- Run only if metadata confirms `procedurelog`, `ProcStatus`, and `ProcFee`.
-- VALIDATE AGAINST LIVE OPEN DENTAL SCHEMA.
-- SELECT
--   ProcStatus,
--   COUNT(*) AS row_count,
--   ROUND(SUM(COALESCE(ProcFee, 0)), 2) AS summed_proc_fee
-- FROM procedurelog
-- GROUP BY ProcStatus
-- ORDER BY ProcStatus;

-- ---------------------------------------------------------------------------
-- Section 4: Patient identity validation
-- Goal:
--   Confirm patient number source.
--   Compare PatNum, ChartNumber, and patient name fields.
-- ---------------------------------------------------------------------------

-- 4A. Discover likely patient identity columns.
SELECT
  TABLE_NAME,
  COLUMN_NAME,
  DATA_TYPE,
  COLUMN_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    TABLE_NAME IN ('patient', 'pat')
    OR TABLE_NAME LIKE '%patient%'
  )
  AND (
    COLUMN_NAME IN ('PatNum', 'ChartNumber', 'LName', 'FName', 'MiddleI', 'Preferred')
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- 4B. Candidate follow-up query:
-- Run only if metadata confirms a patient table and the identity columns below.
-- VALIDATE AGAINST LIVE OPEN DENTAL SCHEMA.
-- SELECT
--   PatNum,
--   ChartNumber,
--   LName,
--   FName
-- FROM patient
-- ORDER BY PatNum DESC
-- LIMIT 25;

-- ---------------------------------------------------------------------------
-- Section 5: Provider validation
-- Goal:
--   Inspect likely provider display fields.
--   Show how provider names are stored.
-- ---------------------------------------------------------------------------

-- 5A. Discover likely provider columns.
SELECT
  TABLE_NAME,
  COLUMN_NAME,
  DATA_TYPE,
  COLUMN_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'provider'
  AND (
    COLUMN_NAME IN ('ProvNum', 'Abbr', 'LName', 'FName', 'MI', 'Suffix')
    OR COLUMN_NAME LIKE '%name%'
  )
ORDER BY ORDINAL_POSITION;

-- 5B. Candidate follow-up query:
-- Run only if metadata confirms the provider table and display columns.
-- VALIDATE AGAINST LIVE OPEN DENTAL SCHEMA.
-- SELECT
--   ProvNum,
--   Abbr,
--   LName,
--   FName
-- FROM provider
-- ORDER BY ProvNum
-- LIMIT 25;

-- ---------------------------------------------------------------------------
-- Section 6: Treatment description validation
-- Goal:
--   Inspect code/description tables used for procedure display text.
-- ---------------------------------------------------------------------------

-- 6A. Discover likely procedure-code description columns.
SELECT
  TABLE_NAME,
  COLUMN_NAME,
  DATA_TYPE,
  COLUMN_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND (
    TABLE_NAME = 'procedurecode'
    OR TABLE_NAME LIKE '%procedurecode%'
    OR TABLE_NAME LIKE '%code%'
  )
  AND (
    COLUMN_NAME IN ('CodeNum', 'ProcCode', 'Descript', 'AbbrDesc')
    OR COLUMN_NAME LIKE '%descript%'
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- 6B. Candidate follow-up query:
-- Run only if metadata confirms a procedure code table with display fields.
-- VALIDATE AGAINST LIVE OPEN DENTAL SCHEMA.
-- SELECT
--   CodeNum,
--   ProcCode,
--   Descript
-- FROM procedurecode
-- ORDER BY CodeNum DESC
-- LIMIT 25;

-- ---------------------------------------------------------------------------
-- Section 7: Grouping-key validation
-- Goal:
--   Inspect links between procedures and appointments/visits.
--   Identify candidate fields for patient_visit_key.
-- ---------------------------------------------------------------------------

-- 7A. Discover likely linking fields on procedurelog and appointment tables.
SELECT
  TABLE_NAME,
  COLUMN_NAME,
  DATA_TYPE,
  COLUMN_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('procedurelog', 'appointment')
  AND (
    COLUMN_NAME IN ('ProcNum', 'PatNum', 'AptNum', 'ClinicNum', 'ProcDate')
    OR COLUMN_NAME LIKE '%visit%'
    OR COLUMN_NAME LIKE '%apt%'
    OR COLUMN_NAME LIKE '%date%'
    OR COLUMN_NAME LIKE '%time%'
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- 7B. Candidate follow-up query:
-- Run only if metadata confirms a usable appointment link such as `AptNum`.
-- VALIDATE AGAINST LIVE OPEN DENTAL SCHEMA.
-- SELECT
--   ProcNum,
--   PatNum,
--   AptNum,
--   ClinicNum,
--   ProcDate
-- FROM procedurelog
-- ORDER BY ProcNum DESC
-- LIMIT 25;
--
-- SELECT
--   AptNum,
--   PatNum,
--   ClinicNum,
--   AptDateTime
-- FROM appointment
-- ORDER BY AptNum DESC
-- LIMIT 25;

-- ---------------------------------------------------------------------------
-- Most critical validation note before API implementation
-- ---------------------------------------------------------------------------
-- The most critical area to validate is the true intra-day datetime source plus the
-- patient-visit grouping key strategy. Without a confirmed appointment/visit datetime
-- and reliable visit key, the backend cannot safely produce one grouped row per patient
-- visit for the EOS report window.
