const DATETIME_WITH_OPTIONAL_SECONDS = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?$/;
const getSingleQueryValue = (value, key) => {
    if (value === undefined || value === null || value === '')
        return undefined;
    if (Array.isArray(value)) {
        throw new Error(`Query parameter ${key} must be provided once`);
    }
    if (typeof value !== 'string') {
        throw new Error(`Query parameter ${key} must be a string`);
    }
    return value.trim();
};
const normalizeRequiredText = (value, key) => {
    if (!value)
        throw new Error(`${key} is required`);
    return value;
};
const normalizeDepartmentCode = (value) => {
    return normalizeRequiredText(value, 'department_code').toUpperCase();
};
const normalizeClinicCode = (value) => {
    if (!value)
        return undefined;
    return value.toUpperCase();
};
const normalizeClinicNum = (value) => {
    if (!value)
        return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error('clinic_num must be a positive integer');
    }
    return parsed;
};
const normalizeMysqlDateTime = (value, key) => {
    const trimmed = normalizeRequiredText(value, key);
    const match = DATETIME_WITH_OPTIONAL_SECONDS.exec(trimmed);
    if (!match) {
        throw new Error(`${key} must be in YYYY-MM-DD HH:MM or YYYY-MM-DD HH:MM:SS format`);
    }
    const [, datePart, timePart, secondsPart] = match;
    return `${datePart} ${timePart}:${secondsPart ?? '00'}`;
};
const parseRequest = (req) => {
    const clinicCode = normalizeClinicCode(getSingleQueryValue(req.query.clinic_code, 'clinic_code'));
    const clinicNum = normalizeClinicNum(getSingleQueryValue(req.query.clinic_num, 'clinic_num'));
    if (!clinicCode && !clinicNum) {
        throw new Error('clinic_code or clinic_num is required');
    }
    const reportStartAt = normalizeMysqlDateTime(getSingleQueryValue(req.query.report_start_at, 'report_start_at'), 'report_start_at');
    const reportEndAt = normalizeMysqlDateTime(getSingleQueryValue(req.query.report_end_at, 'report_end_at'), 'report_end_at');
    if (reportStartAt > reportEndAt) {
        throw new Error('report_end_at must be on or after report_start_at');
    }
    return {
        clinic_code: clinicCode,
        clinic_num: clinicNum,
        report_start_at: reportStartAt,
        report_end_at: reportEndAt,
        department_code: normalizeDepartmentCode(getSingleQueryValue(req.query.department_code, 'department_code'))
    };
};
const resolveClinic = async (mysql, filters) => {
    if (filters.clinic_num && filters.clinic_code) {
        const [rows] = await mysql.query(`SELECT ClinicNum, Abbr
       FROM clinic
       WHERE ClinicNum = ? AND Abbr = ?
       LIMIT 1`, [filters.clinic_num, filters.clinic_code]);
        const matches = rows;
        if (!matches.length) {
            throw new Error('clinic_code and clinic_num do not match a live clinic record');
        }
        return {
            clinic_num: Number(matches[0].ClinicNum),
            clinic_code: String(matches[0].Abbr)
        };
    }
    if (filters.clinic_num) {
        const [rows] = await mysql.query(`SELECT ClinicNum, Abbr
       FROM clinic
       WHERE ClinicNum = ?
       LIMIT 1`, [filters.clinic_num]);
        const matches = rows;
        if (!matches.length) {
            throw new Error(`Unknown clinic_num: ${filters.clinic_num}`);
        }
        return {
            clinic_num: Number(matches[0].ClinicNum),
            clinic_code: String(matches[0].Abbr)
        };
    }
    const [rows] = await mysql.query(`SELECT ClinicNum, Abbr
     FROM clinic
     WHERE Abbr = ?
     LIMIT 1`, [filters.clinic_code]);
    const matches = rows;
    if (!matches.length) {
        throw new Error(`Unknown clinic_code: ${filters.clinic_code}`);
    }
    return {
        clinic_num: Number(matches[0].ClinicNum),
        clinic_code: String(matches[0].Abbr)
    };
};
const loadProductionVisits = async (mysql, filters, clinic) => {
    // TODO: If this endpoint moves behind a shared backend layer, replace direct OpenDental SQL
    // wiring with the final service/repository abstraction instead of calling the MySQL pool here.
    //
    // Effective clinic logic:
    // Prefer appointment.ClinicNum when it is present and non-zero. Otherwise fall back to
    // procedurelog.ClinicNum. The filter below applies against that effective clinic value because
    // live validation showed procedurelog.ClinicNum can be zero or disagree with the appointment row.
    //
    // Carry-forward persistence is intentionally outside this endpoint. The frontend include/exclude
    // state will need its own storage flow later.
    //
    // TODO: Future walkout/securitylog enrichment must only annotate these grouped visit rows.
    // It must never create new EOS rows from unmatched walkout events.
    // TODO: If no walkout print exists for a grouped visit, future report surfaces should show
    // "NO WALK OUT PRINTED" and save that exception for management-or-higher retrieval.
    const [rows] = await mysql.query(`SELECT
       DATE_FORMAT(grouped.appointment_datetime, '%H:%i') AS time,
       grouped.patient_number AS patient_number,
       grouped.surname AS surname,
       grouped.name AS name,
       grouped.treatments AS treatments,
       grouped.provider AS provider,
       grouped.fee_total AS fee_total,
       grouped.clinic_code AS clinic_code,
       ? AS department_code,
       CAST(grouped.patient_visit_key AS CHAR) AS patient_visit_key,
       grouped.source_proc_count AS source_proc_count,
       DATE_FORMAT(grouped.appointment_datetime, '%Y-%m-%d %H:%i:%s') AS appointment_datetime
     FROM (
       SELECT
         raw.AptNum AS patient_visit_key,
         MAX(raw.appointment_datetime) AS appointment_datetime,
         CAST(MAX(raw.patient_number_num) AS CHAR) AS patient_number,
         MAX(raw.surname) AS surname,
         MAX(raw.name) AS name,
         GROUP_CONCAT(
           DISTINCT COALESCE(raw.treatment_description, raw.proc_code, CONCAT('Code ', raw.code_num))
           ORDER BY COALESCE(raw.treatment_description, raw.proc_code, CONCAT('Code ', raw.code_num))
           SEPARATOR ', '
         ) AS treatments,
         GROUP_CONCAT(
           DISTINCT raw.provider_full_name
           ORDER BY raw.provider_full_name
           SEPARATOR ' | '
         ) AS provider,
         ROUND(SUM(COALESCE(raw.proc_fee, 0)), 2) AS fee_total,
         MAX(raw.clinic_code) AS clinic_code,
         COUNT(*) AS source_proc_count
       FROM (
         SELECT
           pl.AptNum,
           appt.AptDateTime AS appointment_datetime,
           CASE
             WHEN appt.ClinicNum IS NOT NULL AND appt.ClinicNum <> 0 THEN appt.ClinicNum
             ELSE pl.ClinicNum
           END AS effective_clinic_num,
           cln.Abbr AS clinic_code,
           COALESCE(pat.PatNum, pl.PatNum) AS patient_number_num,
           pat.LName AS surname,
           pat.FName AS name,
           -- Provider name normalization:
           -- Removes blanks, trims whitespace, provides fallback label,
           -- safe for GROUP_CONCAT(DISTINCT ...)
           COALESCE(
             NULLIF(
               CONCAT_WS(
                ' ',
                NULLIF(TRIM(COALESCE(prv.FName, '')), ''),
                NULLIF(TRIM(COALESCE(prv.LName, '')), '')
              ),
              ''
            ),
            CONCAT('Prov ', pl.ProvNum)
          ) AS provider_full_name,
           pc.Descript AS treatment_description,
           pc.ProcCode AS proc_code,
           pl.CodeNum AS code_num,
           pl.ProcFee AS proc_fee
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
           AND appt.AptDateTime >= ?
           AND appt.AptDateTime <= ?
           AND CASE
             WHEN appt.ClinicNum IS NOT NULL AND appt.ClinicNum <> 0 THEN appt.ClinicNum
             ELSE pl.ClinicNum
           END = ?
           AND COALESCE(pc.ProcCat, -1) <> 314
       ) raw
       GROUP BY raw.AptNum
     ) grouped
     ORDER BY grouped.appointment_datetime, grouped.patient_number`, [filters.department_code, filters.report_start_at, filters.report_end_at, clinic.clinic_num]);
    return rows.map((row) => ({
        time: String(row.time ?? ''),
        patient_number: String(row.patient_number ?? ''),
        surname: row.surname === null ? null : String(row.surname),
        name: row.name === null ? null : String(row.name),
        treatments: String(row.treatments ?? ''),
        provider: String(row.provider ?? ''),
        fee_total: Number(row.fee_total ?? 0),
        clinic_code: row.clinic_code === null ? clinic.clinic_code : String(row.clinic_code),
        department_code: String(row.department_code ?? filters.department_code),
        patient_visit_key: String(row.patient_visit_key ?? ''),
        source_proc_count: Number(row.source_proc_count ?? 0),
        appointment_datetime: String(row.appointment_datetime ?? '')
    }));
};
export const getProductionVisits = async (mysql, req) => {
    const filters = parseRequest(req);
    const clinic = await resolveClinic(mysql, filters);
    const rows = await loadProductionVisits(mysql, filters, clinic);
    return {
        rows,
        filters: {
            ...filters,
            clinic_code: clinic.clinic_code,
            clinic_num: clinic.clinic_num
        }
    };
};
export const handleProductionVisitsRequest = async (mysql, req, res) => {
    try {
        // TODO: Add real EOS authentication / authorization before exposing this endpoint to the UI.
        const result = await getProductionVisits(mysql, req);
        return res.json({
            ok: true,
            filters: result.filters,
            count: result.rows.length,
            rows: result.rows
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return res.status(400).json({ ok: false, error: message });
    }
};
