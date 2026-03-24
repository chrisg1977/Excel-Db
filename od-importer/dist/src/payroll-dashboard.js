import { createWriteStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';
import { calculateLeaveEntitlements, validateLeaveUsage } from './leave-calculator.js';
import { calculateTax, determineSocialSecurityClass, lookupSocialSecurityContribution, lookupTaxBracket } from './wage-calculator.js';
const PAYROLL_ALIAS = {
    MAIN: 'MAIN',
    PROV: 'PROVIDER',
    PROVIDER: 'PROVIDER',
    O3P: 'THIRDPARTY',
    THIRDPARTY: 'THIRDPARTY'
};
const SMTP_HOST = 'smtp.gmail.com';
const SMTP_PORT = 465;
const SMTP_USER = 'drchrisgauci@gmail.com';
const SMTP_PASS = 'mrbw yukx boyr wuqn';
const FROM_EMAIL = 'drchrisgauci@gmail.com';
const TEST_PAYROLL_EMAIL = 'drchrisgauci@gmail.com';
const TEST_PAYROLL_MOBILE = '99466570';
const OUTPUT_ROOT = process.env.PAYROLL_OUTPUT_ROOT?.trim() || path.join(os.homedir(), 'Desktop', 'ZZZ DIRECTOR ONLY');
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const CLINIC_ADDRESSES = [
    '7, Mediatrix, Sanctuary Str. Zabbar ZBR1010',
    '8, Mediatrix, Guze Duca Str., Qormi QRM9088'
];
const PAYROLL_EXCEL_CACHE = path.resolve(process.cwd(), 'data', 'payroll_excel_cache.json');
const mailer = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: true,
    auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
    }
});
const parsePayroll = (value) => {
    const raw = String(value || 'MAIN').trim().toUpperCase();
    return PAYROLL_ALIAS[raw] || 'MAIN';
};
const parsePeriod = (value) => {
    const raw = String(value || '').trim();
    if (!/^\d{4}-\d{2}$/.test(raw)) {
        return null;
    }
    const [yearText, monthText] = raw.split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
        return null;
    }
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 1));
    const periodFrom = start.toISOString().slice(0, 10);
    const periodTo = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    return { raw, year, month, start, end, periodFrom, periodTo };
};
const toNumber = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};
const truncateMoney = (value) => {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.trunc(value * 100) / 100;
};
const cleanText = (value) => {
    const text = String(value ?? '').trim();
    return /^nan$/i.test(text) ? '' : text;
};
const cleanIban = (value) => {
    const text = cleanText(value).replace(/\s+/g, '');
    if (!text)
        return '';
    if (/^(0|#N\/A|null|undefined)$/i.test(text))
        return '';
    return text;
};
const parseHoursText = (value) => {
    const text = cleanText(value);
    if (!text)
        return 0;
    const normalized = text.replace(',', '.');
    const match = normalized.match(/-?\d+(?:\.\d+)?/);
    return match ? toNumber(match[0]) : 0;
};
const countMondaysInMonth = (year, month) => {
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
        return 0;
    }
    let mondays = 0;
    const date = new Date(year, month - 1, 1);
    while (date.getMonth() === (month - 1)) {
        if (date.getDay() === 1)
            mondays += 1;
        date.setDate(date.getDate() + 1);
    }
    return mondays;
};
const normalizeLegacyPayType = (value) => {
    const raw = cleanText(value).toUpperCase();
    if (raw === 'HOURLY_RATE')
        return 'HOURLY';
    if (raw === 'MONTHLY_RATE')
        return 'MONTHLY';
    if (raw === 'YEARLY_RATE')
        return 'YEARLY';
    return raw;
};
const getCurrentMonthResult = async (pg, payroll, period, empId) => {
    const result = await pg.query(`SELECT *
     FROM payroll_month_results
     WHERE emp_id = $1
       AND payroll_type = $2
       AND period_year = $3
       AND period_month = $4
       AND is_current = TRUE
     ORDER BY calc_version DESC, id DESC
     LIMIT 1`, [empId, payroll, period.year, period.month]);
    return result.rows[0] || null;
};
const upsertMainHourlyRateOverride = async (pg, empId, period, hourlyRate) => {
    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0)
        return;
    const rateNote = `Hourly rate amended in payslip popup for ${period.raw}`;
    const existing = await pg.query(`SELECT id
     FROM employee_payroll_terms
     WHERE emp_id = $1
       AND payroll_type = 'MAIN'
       AND effective_from <= DATE '${period.periodTo}'
       AND (effective_to IS NULL OR effective_to >= DATE '${period.periodFrom}')
       AND is_active = TRUE
     ORDER BY effective_from DESC, id DESC
     LIMIT 1`, [empId]);
    if (existing.rows[0]?.id) {
        await pg.query(`UPDATE employee_payroll_terms
       SET pay_input_basis_main = 'HOURLY',
           input_amount_main = $2,
           hourly_rate_main = $2,
           updated_at = NOW(),
           updated_by = 'issue_flow',
           notes = CONCAT(COALESCE(notes, ''), CASE WHEN COALESCE(notes, '') = '' THEN '' ELSE ' | ' END, $3::text)
       WHERE id = $1`, [Number(existing.rows[0].id), hourlyRate, rateNote]);
        return;
    }
    const employment = await pg.query(`SELECT
       COALESCE(NULLIF(TRIM(et.employment_type), ''), '') AS employment_type,
       COALESCE(et.weekly_hours, efp.fixed_hours_week, 0) AS weekly_hours,
       COALESCE(NULLIF(TRIM(efp.fs4_status), ''), 'Single') AS fs4_status,
       efp.timesheet_required
     FROM employees e
     LEFT JOIN LATERAL (
       SELECT *
       FROM employee_employment_terms et
       WHERE et.emp_id = e.emp_id
       ORDER BY et.effective_from DESC
       LIMIT 1
     ) et ON TRUE
     LEFT JOIN employee_form_profile efp
       ON efp.emp_id = e.emp_id
     WHERE e.emp_id = $1
     LIMIT 1`, [empId]);
    const employmentRow = employment.rows[0] || {};
    const rawType = cleanText(employmentRow.employment_type).toUpperCase();
    const normalizedEmploymentType = rawType.includes('REDUCED')
        ? 'FULL_TIME_REDUCED'
        : rawType.includes('CASUAL')
            ? 'CASUAL_PART_TIME'
            : rawType.includes('PART')
                ? 'PART_TIME'
                : rawType
                    ? 'FULL_TIME'
                    : 'FULL_TIME';
    await pg.query(`INSERT INTO employee_payroll_terms (
       emp_id, payroll_type, effective_from, effective_to, is_active,
       employment_type_main, weekly_hours_main, pay_input_basis_main, input_amount_main, hourly_rate_main,
       timesheet_required, student_flag, tax_status, created_by, updated_by, notes
     ) VALUES (
       $1, 'MAIN', $2::date, NULL, TRUE,
       $3::text, $4, 'HOURLY', $5, $5,
       $6, FALSE, $7::text, 'issue_flow', 'issue_flow', $8::text
     )`, [
        empId,
        period.periodFrom,
        normalizedEmploymentType,
        toNumber(employmentRow.weekly_hours),
        hourlyRate,
        employmentRow.timesheet_required === null || employmentRow.timesheet_required === undefined ? true : !!employmentRow.timesheet_required,
        cleanText(employmentRow.fs4_status) || 'Single',
        rateNote
    ]);
};
let excelPayslipCachePromise = null;
const loadExcelPayslipCache = async () => {
    if (!excelPayslipCachePromise) {
        excelPayslipCachePromise = fs
            .readFile(PAYROLL_EXCEL_CACHE, 'utf8')
            .then((raw) => {
            const parsed = JSON.parse(raw);
            return parsed.employees || {};
        })
            .catch(() => ({}));
    }
    return excelPayslipCachePromise;
};
const getExcelPayslipMonth = async (empId, periodRaw) => {
    const cache = await loadExcelPayslipCache();
    return cache[String(empId)]?.months?.[periodRaw] || null;
};
const getExcelSourceEmpId = async (pg, empId) => {
    const result = await pg.query(`SELECT source_emp_id
     FROM employees
     WHERE emp_id = $1
     LIMIT 1`, [empId]);
    return Number(result.rows[0]?.source_emp_id) || null;
};
const getExcelPayslipMonthWithFallback = async (pg, empId, periodRaw) => {
    const direct = await getExcelPayslipMonth(empId, periodRaw);
    if (direct) {
        return direct;
    }
    const sourceEmpId = await getExcelSourceEmpId(pg, empId);
    if (!sourceEmpId || sourceEmpId === empId) {
        return null;
    }
    return getExcelPayslipMonth(sourceEmpId, periodRaw);
};
const getExcelPayslipYearView = async (pg, payroll, empId, periodRaw) => {
    const cache = await loadExcelPayslipCache();
    let employee = cache[String(empId)];
    if (!employee?.months) {
        const sourceEmpId = await getExcelSourceEmpId(pg, empId);
        if (sourceEmpId && sourceEmpId !== empId) {
            employee = cache[String(sourceEmpId)];
        }
    }
    if (!employee?.months) {
        return { rows: [], previousYearSummary: null };
    }
    const [yearText, monthText] = String(periodRaw || '').split('-');
    const year = Number(yearText);
    const month = Number(monthText);
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
        return { rows: [], previousYearSummary: null };
    }
    const payrollStatuses = await pg.query(`SELECT
       TO_CHAR(pe.payroll_month, 'YYYY-MM') AS period_key,
       UPPER(COALESCE(ps.status, '')) AS payslip_status
     FROM payslips ps
     JOIN payroll_entries pe
       ON pe.id = ps.payroll_entry_id
     WHERE ps.emp_id = $1
       AND pe.payroll_number LIKE $2
       AND EXTRACT(YEAR FROM pe.payroll_month) = $3
     ORDER BY pe.payroll_month, ps.id DESC`, [empId, `${payroll}-%`, year]);
    const statusByMonth = new Map();
    for (const row of payrollStatuses.rows) {
        const key = cleanText(row.period_key);
        if (!key || statusByMonth.has(key))
            continue;
        statusByMonth.set(key, cleanText(row.payslip_status).toUpperCase());
    }
    const dbRowsByMonth = new Map();
    await Promise.all(Array.from({ length: 12 }, async (_, index) => {
        const monthNumber = index + 1;
        const monthKey = `${year}-${String(monthNumber).padStart(2, '0')}`;
        const monthPeriod = parsePeriod(monthKey);
        if (!monthPeriod) {
            dbRowsByMonth.set(monthKey, null);
            return;
        }
        const monthRows = await loadRowsByEmployee(pg, payroll, monthPeriod, [empId]);
        dbRowsByMonth.set(monthKey, monthRows[0] || null);
    }));
    const rows = [];
    for (let m = 1; m <= 12; m += 1) {
        const key = `${year}-${String(m).padStart(2, '0')}`;
        const monthData = employee.months[key];
        const dbRow = dbRowsByMonth.get(key) || null;
        const weeksValue = monthData?.weeks_value ?? null;
        const hoursPerWeek = monthData?.hours_per_week ?? dbRow?.contracted_weekly_hours ?? null;
        const mondaysInMonth = countMondaysInMonth(year, m);
        const contractedHours = (toNumber(hoursPerWeek) > 0 && mondaysInMonth > 0)
            ? roundMoney(mondaysInMonth * toNumber(hoursPerWeek))
            : null;
        const weeklyWage = dbRow
            ? roundMoney(toNumber(dbRow.hourly_rate) * toNumber(dbRow.contracted_weekly_hours))
            : (monthData?.basic_wage != null && mondaysInMonth > 0)
                ? roundMoney(toNumber(monthData.basic_wage) / mondaysInMonth)
                : null;
        const hourlyRate = dbRow?.hourly_rate != null
            ? roundMoney(toNumber(dbRow.hourly_rate))
            : (weeklyWage != null && toNumber(hoursPerWeek) !== 0)
                ? roundMoney(toNumber(weeklyWage) / toNumber(hoursPerWeek))
                : null;
        const dbEmploymentType = cleanText(dbRow?.employment_type).toUpperCase();
        const ftLike = dbEmploymentType.startsWith('FT') || dbEmploymentType.includes('FULL');
        const dbBasicWage = dbRow
            ? ftLike
                ? roundMoney(toNumber(dbRow.contracted_weekly_hours) * toNumber(dbRow.hourly_rate) * 52 / 12)
                : roundMoney(toNumber(dbRow.hours_worked) * toNumber(dbRow.hourly_rate))
            : null;
        const monthBonus = roundMoney(toNumber(monthData?.bonus));
        const monthPerfBonus = roundMoney(toNumber(monthData?.performance_bonus));
        const monthSupBonus = roundMoney(toNumber(monthData?.supervisor_bonus));
        const monthExtraDue = monthData?.extra_under_amount == null ? null : roundMoney(toNumber(monthData.extra_under_amount));
        const monthOther = monthData?.other_amount == null ? null : roundMoney(toNumber(monthData.other_amount));
        const computedBonusTotal = roundMoney(monthBonus + monthPerfBonus + monthSupBonus);
        const dbGrossTotal = dbBasicWage != null
            ? roundMoney(dbBasicWage
                + (monthExtraDue ?? 0)
                + computedBonusTotal
                + (monthOther ?? 0))
            : null;
        rows.push({
            month: key,
            weeks_value: weeksValue,
            contracted_hours: contractedHours,
            hourly_rate: hourlyRate,
            weekly_wage: weeklyWage,
            gross_total: dbGrossTotal ?? monthData?.gross_total ?? null,
            basic_wage: dbBasicWage ?? monthData?.basic_wage ?? null,
            extra_under_hours: monthData ? parseHoursText(monthData.extra_under_hours_text) : null,
            extra_due: monthExtraDue,
            bonus: monthData?.bonus ?? null,
            performance_bonus: monthData?.performance_bonus ?? null,
            supervisor_bonus: monthData?.supervisor_bonus ?? null,
            bonus_total: computedBonusTotal,
            tax: monthData?.tax_on_gross ?? null,
            overtime_hours: monthData ? parseHoursText(monthData.overtime_hours_text) : null,
            overtime_tax: monthData?.overtime_tax ?? null,
            ssc_employer: monthData?.ssc_employer ?? null,
            ssc_employee: monthData?.ssc_employee ?? null,
            ssc_total: monthData?.ssc_total ?? null,
            mlf: monthData?.mlf ?? null,
            other_amount: monthData?.other_amount ?? null,
            net_wage: monthData?.net_wage ?? null,
            leave_balance_end: monthData?.leave_balance_end ?? null,
            banked_hours_since_last_month: monthData?.banked_hours_since_last_month ?? null,
            transaction_id_text: String(monthData?.transaction_id_text || '').trim(),
            payslip_status: statusByMonth.get(key) || ''
        });
    }
    const prevDec = employee.months[`${year - 1}-12`];
    const previousYearSummary = prevDec ? {
        label: `${year - 1} carry-forward`,
        leave_balance_end: prevDec.leave_balance_end ?? null,
        banked_hours_since_last_month: prevDec.banked_hours_since_last_month ?? null,
        transaction_id_text: String(prevDec.transaction_id_text || '').trim()
    } : null;
    return { rows, previousYearSummary };
};
const roundMoney = (value) => Math.round(value * 100) / 100;
const parseIsoDate = (value) => {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
    }
    const raw = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        return null;
    }
    const date = new Date(`${raw}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
};
const formatIsoDate = (value) => value.toISOString().slice(0, 10);
const addDays = (value, days) => {
    const copy = new Date(value.getTime());
    copy.setUTCDate(copy.getUTCDate() + days);
    return copy;
};
const coveredDayCount = (periodFrom, periodTo) => {
    const from = parseIsoDate(periodFrom);
    const to = parseIsoDate(periodTo);
    if (!from || !to || to < from) {
        return 0;
    }
    return Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
};
const sanitizeFilePart = (value) => value.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
const monthShort = (month) => MONTH_LABELS[Math.max(0, Math.min(11, month - 1))] || 'Month';
const toIsoDate = (value) => {
    if (!value)
        return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, '0');
        const day = String(value.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    const text = String(value).trim();
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
    if (match) {
        return match[1];
    }
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
        const year = parsed.getFullYear();
        const month = String(parsed.getMonth() + 1).padStart(2, '0');
        const day = String(parsed.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    return text || null;
};
const lastFridayOfMonth = (year, month) => {
    const d = new Date(Date.UTC(year, month, 0));
    while (d.getUTCDay() !== 5) {
        d.setUTCDate(d.getUTCDate() - 1);
    }
    return d.toISOString().slice(0, 10);
};
const daysUntil = (isoDate) => {
    const today = new Date();
    const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const target = Date.parse(`${isoDate}T00:00:00Z`);
    return Math.ceil((target - startOfToday) / 86400000);
};
const buildDisplayName = (row) => `${cleanText(row.first_name)} ${cleanText(row.surname)}`.trim() || String(row.emp_id);
const normalizeTimesheetHourType = (value) => {
    const raw = cleanText(value).toUpperCase().replace(/\s+/g, '_');
    if (!raw)
        return 'WORK';
    if (raw === 'WORK' || raw === 'VACATION_LEAVE' || raw === 'SICK_LEAVE' || raw === 'UNPAID_LEAVE' || raw === 'OVERTIME') {
        return raw;
    }
    if (raw === 'VL')
        return 'VACATION_LEAVE';
    if (raw === 'SL')
        return 'SICK_LEAVE';
    if (raw === 'UL')
        return 'UNPAID_LEAVE';
    if (raw === 'OT')
        return 'OVERTIME';
    return 'WORK';
};
const normalizeLeaveStatus = (value, hourType) => {
    const raw = cleanText(value).toUpperCase().replace(/\s+/g, '_');
    if (!raw) {
        return hourType === 'UNPAID_LEAVE' ? 'UNPAID' : 'PAID';
    }
    if (raw === 'PAID' || raw === 'UNPAID')
        return raw;
    return hourType === 'UNPAID_LEAVE' ? 'UNPAID' : 'PAID';
};
const parseEditableTimesheetRows = (payload) => {
    if (!Array.isArray(payload))
        return [];
    return payload.map((row) => {
        const value = row;
        const workDateValue = toIsoDate(value.work_date) || '';
        const hour_type = normalizeTimesheetHourType(value.hour_type);
        return {
            work_date: workDateValue,
            hours: roundMoney(toNumber(value.hours)),
            hour_type,
            leave_status: normalizeLeaveStatus(value.leave_status, hour_type),
            notes: cleanText(value.notes),
            source: cleanText(value.source) || 'PayrollReview'
        };
    }).filter((row) => row.work_date && row.hours >= 0);
};
const parseTimesheetCsv = (csvText) => {
    const lines = String(csvText || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    const rows = [];
    for (const line of lines) {
        const [workDateRaw = '', hoursRaw = '', hourTypeRaw = '', leaveStatusRaw = '', ...noteParts] = line.split(',');
        const work_date = toIsoDate(workDateRaw.trim());
        if (!work_date)
            continue;
        const hour_type = normalizeTimesheetHourType(hourTypeRaw);
        rows.push({
            work_date,
            hours: roundMoney(toNumber(hoursRaw)),
            hour_type,
            leave_status: normalizeLeaveStatus(leaveStatusRaw, hour_type),
            notes: noteParts.join(',').trim(),
            source: 'PayrollReview'
        });
    }
    return rows;
};
const resolveHourlyRate = (payType, amount) => {
    const rawType = cleanText(payType).toUpperCase();
    const numericAmount = toNumber(amount);
    if (rawType === 'MONTHLY_RATE') {
        return truncateMoney((numericAmount * 12) / 52 / 40);
    }
    if (rawType === 'YEARLY_RATE') {
        return truncateMoney(numericAmount / 52 / 40);
    }
    return truncateMoney(numericAmount);
};
const ensureDir = async (dirPath) => {
    await fs.mkdir(dirPath, { recursive: true });
};
const writePdf = async (targetPath, writer, options) => {
    await ensureDir(path.dirname(targetPath));
    await new Promise((resolve, reject) => {
        const doc = new PDFDocument({ margin: 40, ...(options || {}) });
        const stream = createWriteStream(targetPath);
        stream.on('finish', () => resolve());
        stream.on('error', reject);
        doc.on('error', reject);
        doc.pipe(stream);
        writer(doc);
        doc.end();
    });
};
const formatPdfMoney = (value) => `EUR ${toNumber(value).toFixed(2)}`;
const formatPdfHours = (value) => `${roundMoney(toNumber(value)).toFixed(2)} HRS`;
const isNonZero = (value) => Math.abs(toNumber(value)) > 0.00001;
const monthCompactLabel = (period) => `${monthShort(period.month)}-${String(period.year).slice(-2)}`;
const weeksInPayrollMonth = (period) => String(Math.ceil(new Date(Date.UTC(period.year, period.month, 0)).getUTCDate() / 7));
const resolveDepartmentBrandLogoPath = (departmentRaw) => {
    const department = cleanText(departmentRaw).toUpperCase();
    const fileName = department === 'MDC' ? 'mdcz.png' : (department === 'MDCQ' ? 'mdcq.png' : 'group-logo.png');
    return path.resolve(process.cwd(), 'dashboard', 'assets', 'logos', fileName);
};
const resolveGroupLogoPath = () => path.resolve(process.cwd(), 'dashboard', 'assets', 'logos', 'group-logo.png');
const readImageBufferFromDataUri = (value) => {
    const raw = cleanText(value);
    const match = /^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/i.exec(raw);
    if (!match)
        return null;
    try {
        return Buffer.from(match[1], 'base64');
    }
    catch {
        return null;
    }
};
let uploadedPayrollSignatureBufferPromise = null;
const loadUploadedPayrollSignatureBuffer = async (pg) => {
    if (uploadedPayrollSignatureBufferPromise) {
        return uploadedPayrollSignatureBufferPromise;
    }
    uploadedPayrollSignatureBufferPromise = (async () => {
        try {
            const result = await pg.query(`SELECT id, item_key, title, description, file_name, mime_type, file_base64, updated_at
         FROM admin_item_library
         WHERE is_active = true
           AND file_base64 IS NOT NULL
           AND COALESCE(mime_type, '') ILIKE 'image/%'`);
            const scored = result.rows
                .map((item) => {
                const haystack = [
                    item?.item_key,
                    item?.title,
                    item?.file_name,
                    item?.description
                ].map((v) => String(v || '').toLowerCase()).join(' ');
                let score = 0;
                if (/signature|sign/.test(haystack))
                    score += 10;
                if (/gauci|christian|principal|director/.test(haystack))
                    score += 6;
                if (/payroll/.test(haystack))
                    score += 3;
                if (/logo/.test(haystack))
                    score -= 4;
                const updated = Date.parse(String(item?.updated_at || '')) || 0;
                score += updated / 1e15;
                return { item, score };
            })
                .sort((a, b) => b.score - a.score);
            const selected = scored[0]?.item;
            const base64 = cleanText(selected?.file_base64);
            if (!base64)
                return null;
            return Buffer.from(base64, 'base64');
        }
        catch {
            return null;
        }
    })();
    return uploadedPayrollSignatureBufferPromise;
};
const resolvePayslipSignatureBuffer = async (pg, signatureRaw) => {
    const direct = readImageBufferFromDataUri(signatureRaw);
    if (direct)
        return direct;
    return loadUploadedPayrollSignatureBuffer(pg);
};
const renderLegacyPayslipPdf = (doc, row, payroll, payslipNumber, paymentDate) => {
    doc.fontSize(18).text('MEDIATRIX PAYSLIP', { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(11);
    doc.text(`Employee: ${buildDisplayName(row)}`);
    doc.text(`Employee ID: ${row.emp_id}`);
    doc.text(`Payroll: ${payroll}`);
    doc.text(`Payslip No: ${payslipNumber}`);
    doc.text(`Period: ${row.period_from} to ${row.period_to}`);
    doc.text(`Payment Date: ${paymentDate}`);
    doc.moveDown(1);
    doc.text(`Department: ${row.department || '-'}`);
    doc.text(`Designation: ${row.designation || '-'}`);
    doc.text(`Hourly Rate: EUR ${row.hourly_rate.toFixed(2)}`);
    doc.text(`Hours Worked: ${row.hours_worked.toFixed(2)}`);
    doc.text(`Gross: EUR ${row.gross_including_bonuses.toFixed(2)}`);
    doc.text(`Tax Deduction: EUR ${row.tax_deduction.toFixed(2)}`);
    doc.text(`Net Payment: EUR ${row.net_payment.toFixed(2)}`);
    doc.moveDown(1);
    doc.text(`Vacation Leave Remaining: ${row.vl_pending.toFixed(2)} hours`);
    doc.text(`Sick Leave Remaining: ${row.sl_pending.toFixed(2)} hours`);
    doc.text(`Banked Hours Balance: ${row.banked_hours_balance.toFixed(2)} hours`);
    if (row.warnings.length) {
        doc.moveDown(1);
        doc.text(`Warnings: ${row.warnings.join('; ')}`);
    }
};
const renderPayslipPdf = async (pg, row, payroll, period, payslipNumber, paymentDate) => {
    const yearFolder = String(period.year);
    const folder = path.join(OUTPUT_ROOT, yearFolder, 'payslips', monthShort(period.month));
    const fileName = sanitizeFilePart(`${buildDisplayName(row)}_Mediatrix_${monthShort(period.month)}_Payslip`) + '.pdf';
    const fullPath = path.join(folder, fileName);
    const detail = payroll === 'MAIN' ? await getPayrollDashboardDetail(pg, payroll, period, row.emp_id) : null;
    const employee = detail?.employee || null;
    const calculation = detail?.calculation || null;
    const issue = detail?.issue || null;
    const bankedApplicable = !(employee?.timesheet_required === false ||
        cleanText(employee?.timesheet_mode).toUpperCase() === 'NONE');
    const signatureBuffer = payroll === 'MAIN'
        ? await resolvePayslipSignatureBuffer(pg, calculation?.signature_image_url)
        : null;
    await writePdf(fullPath, (doc) => {
        if (payroll !== 'MAIN' || !detail || !employee || !calculation) {
            renderLegacyPayslipPdf(doc, row, payroll, payslipNumber, paymentDate);
            return;
        }
        const pageWidth = doc.page.width;
        const left = 26;
        const right = pageWidth - 26;
        const contentWidth = right - left;
        const top = 24;
        const cardRadius = 8;
        const drawRoundedBox = (x, y, w, h, fillColor, strokeColor, radius = cardRadius) => {
            doc.save();
            doc.roundedRect(x, y, w, h, radius).fillAndStroke(fillColor, strokeColor);
            doc.restore();
        };
        const drawLabelValue = (x, y, w, h, label, value) => {
            drawRoundedBox(x, y, w, h, '#f8fbff', '#d8e3f1');
            doc.font('Helvetica').fontSize(7).fillColor('#64748b').text(label, x + 8, y + 6, { width: w - 16, ellipsis: true });
            doc.font('Helvetica-Bold').fontSize(9).fillColor('#173a73').text(value || '-', x + 8, y + 18, { width: w - 16, ellipsis: true });
        };
        const grossTotal = toNumber(calculation.gross_total);
        const overtimeTax = toNumber(calculation.overtime_tax);
        const compactMonth = monthCompactLabel(period);
        const fsValue = cleanText(employee.fs_status || employee.fs4_status);
        const sscValue = cleanText(calculation.ssc_class);
        const fsSsc = [fsValue, sscValue].filter(Boolean).join(' / ') || '-';
        const runRef = `${payroll} ${String(period.raw || '').replace('-', '')}`;
        const earnings = [
            { label: 'Basic Wage', hours: '', amount: toNumber(calculation.gross_before_bonuses), visible: true },
            { label: 'Extra / Under Hours', hours: formatPdfHours(calculation.extra_under_hours), amount: toNumber(calculation.extra_under_amount), visible: isNonZero(calculation.extra_under_amount) },
            { label: 'Unpaid Leave', hours: formatPdfHours(calculation.unpaid_leave_hours), amount: toNumber(calculation.unpaid_leave_amount), visible: isNonZero(calculation.unpaid_leave_amount) },
            { label: 'Bonus', hours: '', amount: toNumber(calculation.bonus_total ?? calculation.bonus), visible: isNonZero(calculation.bonus_total ?? calculation.bonus) },
            { label: 'Performance Bonus', hours: '', amount: toNumber(calculation.performance_bonus), visible: isNonZero(calculation.performance_bonus) },
            { label: 'Supervisor Bonus', hours: '', amount: toNumber(calculation.supervisor_bonus), visible: isNonZero(calculation.supervisor_bonus) },
            { label: 'Other', hours: '', amount: toNumber(calculation.other_payments), visible: isNonZero(calculation.other_payments) },
            { label: 'Overtime', hours: formatPdfHours(calculation.overtime_hours), amount: toNumber(calculation.overtime_amount), visible: isNonZero(calculation.overtime_amount) },
            { label: 'Overtime Tax', hours: '', amount: overtimeTax, visible: isNonZero(overtimeTax) }
        ].filter((rowData) => rowData.visible);
        const topCardHeight = 170;
        drawRoundedBox(left, top, contentWidth, topCardHeight, '#ffffff', '#9eb4d4', 8);
        const brandColW = 92;
        const rightColW = Math.max(160, Math.round((contentWidth - brandColW) * 0.365));
        const centerColW = contentWidth - brandColW - rightColW;
        const centerX = left + brandColW;
        const rightX = centerX + centerColW;
        const topPad = 8;
        const brandLogoPath = resolveDepartmentBrandLogoPath(employee.department);
        const footerLogoPath = resolveGroupLogoPath();
        drawRoundedBox(left, top, brandColW, topCardHeight, '#f8fbff', '#c8d9ef', 2);
        doc.moveTo(centerX, top).lineTo(centerX, top + topCardHeight).lineWidth(1).strokeColor('#c8d9ef').stroke();
        doc.moveTo(rightX, top).lineTo(rightX, top + topCardHeight).lineWidth(1).strokeColor('#c8d9ef').stroke();
        try {
            doc.image(brandLogoPath, left + 10, top + 12, { fit: [72, 42], align: 'center' });
        }
        catch {
            doc.font('Helvetica-Bold').fontSize(11).fillColor('#173a73').text('Mediatrix', left + 10, top + 20, { width: 72, align: 'center' });
        }
        doc.font('Helvetica').fontSize(8).fillColor('#6b7b92').text('Mediatrix Dental Clinic', left + 8, top + 56, { width: 76, align: 'center' });
        doc.font('Helvetica-Bold').fontSize(20).fillColor('#0f2447').text(cleanText(employee.surname) || '-', centerX + 10, top + topPad + 2, { width: centerColW - 110, ellipsis: true });
        doc.font('Helvetica-Bold').fontSize(14).fillColor('#173a73').text(cleanText(employee.first_name) || '-', centerX + 10, top + topPad + 24, { width: centerColW - 110, ellipsis: true });
        doc.font('Helvetica').fontSize(8).fillColor('#607089').text(cleanText(employee.designation) || '-', centerX + 10, top + topPad + 41, { width: centerColW - 110, ellipsis: true });
        const codeMetaW = 88;
        const codeMetaX = centerX + centerColW - codeMetaW - 10;
        drawLabelValue(codeMetaX, top + topPad, codeMetaW, 34, 'Code', String(employee.emp_id || '-'));
        drawLabelValue(codeMetaX, top + topPad + 36, codeMetaW, 34, 'IBAN', cleanIban(employee.iban) || '-');
        drawRoundedBox(centerX, top + 72, centerColW, 34, '#dcecff', '#c8d9ef', 2);
        doc.font('Helvetica').fontSize(8).fillColor('#173a73').text(`${compactMonth} Gross Total`, centerX + 10, top + 83);
        doc.font('Helvetica-Bold').fontSize(15).fillColor('#081a38').text(formatPdfMoney(grossTotal), centerX + 160, top + 81, { width: centerColW - 170, align: 'right' });
        drawRoundedBox(rightX, top, rightColW, topCardHeight, '#edf5ff', '#c8d9ef', 2);
        const metaY1 = top + 10;
        const metaY2 = top + 89;
        const metaW = (rightColW - 20 - 12) / 4;
        const metaCols = [
            ['ID Card', cleanText(employee.id_value || employee.national_id) || '-'],
            ['Type', cleanText(employee.employment_type) || '-'],
            ['P.E. No.', cleanText(employee.pe_number) || '-'],
            ['Ref', runRef],
            ['Weeks', weeksInPayrollMonth(period)],
            ['Hrs/Wk', String(calculation.contracted_weekly_hours ?? '-')],
            ['FS / SSC', fsSsc],
            ['Department', cleanText(employee.department) || '-']
        ];
        metaCols.slice(0, 4).forEach(([label, value], idx) => {
            drawLabelValue(rightX + 10 + (idx * (metaW + 4)), metaY1, metaW, 34, label, value);
        });
        metaCols.slice(4).forEach(([label, value], idx) => {
            drawLabelValue(rightX + 10 + (idx * (metaW + 4)), metaY2, metaW, 34, label, value);
        });
        const bodyTop = top + topCardHeight + 6;
        const midGap = 6;
        const leftSectionW = Math.round((contentWidth - midGap) / 2);
        const rightSectionW = contentWidth - leftSectionW - midGap;
        const earningsHeight = 196;
        drawRoundedBox(left, bodyTop, leftSectionW, earningsHeight, '#ffffff', '#d9e4f2', 4);
        drawRoundedBox(left + leftSectionW + midGap, bodyTop, rightSectionW, earningsHeight, '#ffffff', '#d9e4f2', 4);
        drawRoundedBox(left, bodyTop, leftSectionW, 18, '#edf4ff', '#d9e4f2', 2);
        drawRoundedBox(left + leftSectionW + midGap, bodyTop, rightSectionW, 18, '#edf4ff', '#d9e4f2', 2);
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#173a73').text('Earnings & Adjustments', left + 8, bodyTop + 5, { characterSpacing: 0.4 });
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#173a73').text('Statutory Deductions / Contributions', left + leftSectionW + midGap + 8, bodyTop + 5, { characterSpacing: 0.4 });
        let rowY = bodyTop + 22;
        earnings.forEach((entry) => {
            doc.save();
            doc.rect(left + 1, rowY - 1, leftSectionW - 2, 17).fill('#ffffff');
            doc.restore();
            doc.moveTo(left + 4, rowY + 16).lineTo(left + leftSectionW - 4, rowY + 16).lineWidth(0.7).strokeColor('#edf2f8').stroke();
            doc.font('Helvetica-Bold').fontSize(8.2).fillColor('#173a73').text(entry.label, left + 8, rowY + 2, { width: leftSectionW * 0.54, ellipsis: true });
            if (entry.hours) {
                doc.font('Helvetica').fontSize(8).fillColor('#334155').text(entry.hours, left + (leftSectionW * 0.58), rowY + 2, { width: leftSectionW * 0.16, align: 'right' });
            }
            doc.font('Helvetica-Bold').fontSize(9.2).fillColor('#111827').text(formatPdfMoney(entry.amount), left + leftSectionW - 96, rowY + 1, { width: 88, align: 'right' });
            rowY += 17;
        });
        const deductionBoxW = (rightSectionW - 12) / 4;
        const deductionMetrics = [
            ['Employee', formatPdfMoney(calculation.ssc_employee)],
            ['Employer', formatPdfMoney(calculation.ssc_employer)],
            ['SSC Total', formatPdfMoney(calculation.ssc_total)],
            ['MLF', formatPdfMoney(calculation.mlf)],
            ['Tax on Gross', formatPdfMoney(calculation.tax_deduction)]
        ];
        if (isNonZero(overtimeTax)) {
            deductionMetrics.push(['Tax on Overtime', formatPdfMoney(overtimeTax)]);
        }
        deductionMetrics.forEach(([label, value], idx) => {
            const isTaxRow = idx >= 4;
            const col = isTaxRow ? idx - 4 + 3 : idx;
            const x = left + leftSectionW + midGap + 4 + (col * deductionBoxW);
            const y = bodyTop + (isTaxRow ? 76 : 30);
            const boxW = isTaxRow ? deductionBoxW : deductionBoxW - 1;
            drawRoundedBox(x, y, boxW, 42, '#ffffff', '#edf2f8', 2);
            doc.font('Helvetica').fontSize(7.2).fillColor('#607089').text(label, x + 5, y + 8, { width: boxW - 10, ellipsis: true });
            doc.font('Helvetica-Bold').fontSize(9.6).fillColor('#0f2447').text(value, x + 5, y + 20, { width: boxW - 10, align: 'right', ellipsis: true });
        });
        const lowerTop = bodyTop + earningsHeight + 6;
        const lowerHeight = 52;
        drawRoundedBox(left, lowerTop, contentWidth, lowerHeight, '#edf6ff', '#d5e1f2', 2);
        const lowerCols = bankedApplicable ? 4 : 3;
        const lowerGap = 6;
        const lowerW = (contentWidth - 12 - (lowerGap * (lowerCols - 1))) / lowerCols;
        const lowerItems = [
            { label: 'Leave Taken', value: String(roundMoney(toNumber(calculation.leave_taken_ytd)).toFixed(2)) },
            { label: 'Leave Balance / End', value: String(roundMoney(toNumber(calculation.leave_left_ytd)).toFixed(2)) },
            {
                label: 'Net Wage',
                value: formatPdfMoney(calculation.net_payment),
                sub: `Transaction ID: ${cleanText(issue?.bank_transaction_number) || 'Pending'}`
            }
        ];
        if (bankedApplicable) {
            lowerItems.push({ label: 'Banked Hour Balance', value: String(roundMoney(toNumber(calculation.banked_hours_since_last_month)).toFixed(2)) });
        }
        lowerItems.forEach((item, idx) => {
            const x = left + 6 + (idx * (lowerW + lowerGap));
            drawRoundedBox(x, lowerTop + 5, lowerW, lowerHeight - 10, '#edf6ff', '#d5e1f2', 1);
            doc.font('Helvetica').fontSize(7).fillColor('#607089').text(item.label, x + 6, lowerTop + 12, { width: lowerW - 12, ellipsis: true });
            doc.font('Helvetica-Bold').fontSize(item.label === 'Net Wage' ? 14 : 10.5).fillColor(item.label === 'Net Wage' ? '#0a1c3d' : '#102a4d').text(item.value, x + 6, lowerTop + 22, { width: lowerW - 12, align: item.label === 'Net Wage' ? 'left' : 'right' });
            if (item.sub) {
                doc.font('Helvetica').fontSize(7).fillColor('#7c3aed').text(item.sub, x + 6, lowerTop + 37, { width: lowerW - 12, ellipsis: true });
            }
        });
        const footerTop = lowerTop + lowerHeight + 6;
        const footerHeight = 78;
        drawRoundedBox(left, footerTop, contentWidth, footerHeight, '#ffffff', '#e5edf7', 2);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#173a73').text('Mediatrix Dental Clinic', left + 10, footerTop + 10);
        doc.font('Helvetica').fontSize(7.5).fillColor('#475569').text('7, Mediatrix, Sanctuary Str. Zabbar ZBR1010', left + 10, footerTop + 24, { width: 205 });
        doc.font('Helvetica').fontSize(7.5).fillColor('#475569').text('8, Mediatrix, Guze Duca Str., Qormi QRM9088', left + 10, footerTop + 36, { width: 205 });
        const footerCenterX = left + Math.round(contentWidth * 0.43);
        try {
            doc.image(footerLogoPath, footerCenterX - 36, footerTop + 16, { fit: [72, 40] });
        }
        catch {
            doc.font('Helvetica-Bold').fontSize(10).fillColor('#173a73').text('MEDIATRIX', footerCenterX - 30, footerTop + 28);
        }
        const sigX = right - 190;
        if (signatureBuffer) {
            try {
                doc.image(signatureBuffer, sigX, footerTop + 8, { fit: [96, 38] });
            }
            catch {
                doc.font('Helvetica-Oblique').fontSize(14).fillColor('#173a73').text('Christian Gauci', sigX, footerTop + 22);
            }
        }
        else {
            doc.font('Helvetica-Oblique').fontSize(14).fillColor('#173a73').text('Christian Gauci', sigX, footerTop + 22);
        }
        doc.font('Helvetica-Bold').fontSize(7.8).fillColor('#173a73').text('Dr Christian Gauci B.Ch.D M.Sc. Oral Implantology (Frankfkurt)', sigX - 2, footerTop + 52, { width: 182, align: 'right' });
        doc.font('Helvetica').fontSize(7.2).fillColor('#475569').text('Principal Dentist and Group Director', sigX - 2, footerTop + 64, { width: 182, align: 'right' });
        doc.font('Helvetica').fontSize(6.5).fillColor('#64748b').text(`Payslip No: ${payslipNumber}   Payment Date: ${paymentDate}`, left, doc.page.height - 20, { width: contentWidth, align: 'center' });
    }, { size: 'A4', margin: 24 });
    return fullPath;
};
const sendPayslipEmail = async (row, attachmentPath, month) => {
    console.warn(`[payroll] payslip email suppressed during vetting for emp_id=${row.emp_id} attachment=${attachmentPath} month=${monthShort(month)}`);
};
const renderFs3Pdf = async (row, year, totals) => {
    const folder = path.join(OUTPUT_ROOT, String(year), 'FS3');
    const fileName = sanitizeFilePart(`${buildDisplayName(row)}_FS3_${year}`) + '.pdf';
    const fullPath = path.join(folder, fileName);
    await writePdf(fullPath, (doc) => {
        doc.fontSize(18).text(`MEDIATRIX FS3 ${year}`, { align: 'center' });
        doc.moveDown(1);
        doc.fontSize(11);
        doc.text(`Employee: ${buildDisplayName(row)}`);
        doc.text(`Employee ID: ${row.emp_id}`);
        doc.text(`Department: ${row.department || '-'}`);
        doc.text(`Gross Emoluments: EUR ${totals.gross.toFixed(2)}`);
        doc.text(`Tax Deducted: EUR ${totals.tax.toFixed(2)}`);
        doc.text(`Net Amount: EUR ${totals.net.toFixed(2)}`);
        doc.moveDown(1);
        doc.text('Best regards,');
        doc.text('Dr Christian Gauci');
        doc.text('MEDIATRIX GROUP');
    });
    return fullPath;
};
const sendFs3Email = async (row, year, attachmentPath) => {
    console.warn(`[payroll] FS3 email suppressed during vetting for emp_id=${row.emp_id} attachment=${attachmentPath} year=${year}`);
};
const safeTaxCategory = (status) => {
    const raw = String(status || '').trim();
    return raw || 'Single';
};
const formatTaxStatusLabel = (value) => {
    const raw = cleanText(value).toUpperCase();
    if (!raw)
        return 'Single';
    if (raw === 'SING' || raw === 'SIN' || raw === 'SNG' || raw === 'SINGLE')
        return 'Single';
    if (raw === 'MAR' || raw === 'MARRIED')
        return 'Married';
    if (raw === 'MAR1' || raw === 'MARRIED1')
        return 'Married1';
    if (raw === 'MAR2' || raw === 'MARRIED2')
        return 'Married2';
    if (raw === 'PAR' || raw === 'PARENT')
        return 'Parent';
    if (raw === 'PAR1' || raw === 'PARENT1')
        return 'Parent1';
    if (raw === 'PAR2' || raw === 'PARENT2')
        return 'Parent2';
    return cleanText(value) || 'Single';
};
const scheduledEmailAtForPeriod = (period) => `${lastFridayOfMonth(period.year, period.month)} 18:30`;
const buildRows = async (pg, payroll, period) => {
    const result = await pg.query(`WITH employee_scope AS (
       SELECT DISTINCT ON (ps.employee_id)
         ps.employee_id AS emp_id,
         ps.active_from,
         ps.active_to,
         to_char(
           GREATEST(
             ps.active_from,
             $1::date,
             COALESCE(target_transition.effective_on, $1::date)
           ),
           'YYYY-MM-DD'
         ) AS coverage_from,
         to_char(
           LEAST(
             COALESCE(ps.active_to, $4::date),
             $4::date,
             COALESCE((source_transition.effective_on - INTERVAL '1 day')::date, $4::date)
           ),
           'YYYY-MM-DD'
         ) AS coverage_to,
         ec.surname,
         ec.first_name,
         COALESCE(NULLIF(TRIM(ec.position_held), ''), '') AS designation,
         COALESCE(NULLIF(TRIM(ec.department_code), ''), '') AS department,
         COALESCE(NULLIF(TRIM(current_terms.employment_type_main), ''), NULLIF(TRIM(ec.employment_type), ''), '') AS employment_type,
         COALESCE(current_terms.timesheet_required, current_result.timesheet_required, form_profile.timesheet_required, true) AS timesheet_required,
         COALESCE(current_terms.weekly_hours_main, current_result.weekly_hours_main, ec.weekly_hours, profile.weekly_hours, 0) AS weekly_hours,
         COALESCE(current_terms.hourly_rate_main, current_result.hourly_rate_main, pay.hourly_rate, trunc(COALESCE(profile.current_salary_hourly_rate, 0)::numeric, 2), 0) AS hourly_rate,
         COALESCE(NULLIF(TRIM(current_terms.tax_status), ''), NULLIF(TRIM(current_result.tax_status), ''), NULLIF(TRIM(ec.fs_status), ''), 'Single') AS tax_status,
         COALESCE(NULLIF(TRIM(ec.email), ''), '') AS email,
         source_transition.effective_on AS source_transition_effective_on,
         target_transition.effective_on AS target_transition_effective_on,
         current_result.gross_total AS current_result_gross_total,
         current_result.net_wage AS current_result_net_wage,
         current_result.ssc_employee AS current_result_ssc_employee,
         current_result.ssc_employer AS current_result_ssc_employer,
         current_result.mlf AS current_result_mlf,
         current_result.tax_on_gross AS current_result_tax_on_gross
       FROM payroll_subscriptions ps
       JOIN vw_employee_current ec
         ON ec.emp_id = ps.employee_id
       LEFT JOIN vw_employee_payroll_profile profile
         ON profile.emp_id = ps.employee_id
       LEFT JOIN employee_form_profile form_profile
         ON form_profile.emp_id = ps.employee_id
       LEFT JOIN LATERAL (
         SELECT *
         FROM employee_payroll_terms ept
         WHERE ept.emp_id = ps.employee_id
           AND ept.payroll_type = ps.payroll_type
           AND ept.effective_from <= $4::date
           AND (ept.effective_to IS NULL OR ept.effective_to >= $1::date)
           AND ept.is_active = TRUE
         ORDER BY ept.effective_from DESC, ept.id DESC
         LIMIT 1
       ) current_terms ON TRUE
       LEFT JOIN LATERAL (
         SELECT *
         FROM payroll_month_results pmr
         WHERE pmr.emp_id = ps.employee_id
           AND pmr.payroll_type = ps.payroll_type
           AND pmr.period_year = EXTRACT(YEAR FROM $1::date)::int
           AND pmr.period_month = EXTRACT(MONTH FROM $1::date)::int
           AND pmr.is_current = TRUE
         ORDER BY pmr.calc_version DESC, pmr.id DESC
         LIMIT 1
       ) current_result ON TRUE
       LEFT JOIN LATERAL (
         SELECT eft.effective_on
         FROM employee_file_transitions eft
         WHERE eft.source_emp_id = ps.employee_id
         ORDER BY eft.effective_on DESC NULLS LAST, eft.updated_at DESC NULLS LAST, eft.created_at DESC NULLS LAST
         LIMIT 1
       ) source_transition ON TRUE
       LEFT JOIN LATERAL (
         SELECT eft.effective_on
         FROM employee_file_transitions eft
         WHERE eft.target_emp_id = ps.employee_id
         ORDER BY eft.effective_on DESC NULLS LAST, eft.updated_at DESC NULLS LAST, eft.created_at DESC NULLS LAST
         LIMIT 1
       ) target_transition ON TRUE
       LEFT JOIN LATERAL (
         SELECT
           epp.pay_type,
           epp.emp_id AS source_emp_id,
           CASE
             WHEN epp.pay_type = 'HOURLY_RATE' THEN trunc(epp.amount, 2)
             WHEN epp.pay_type = 'MONTHLY_RATE' THEN trunc((epp.amount * 12) / 52 / 40, 2)
             WHEN epp.pay_type = 'YEARLY_RATE' THEN trunc(epp.amount / 52 / 40, 2)
             ELSE NULL
           END AS hourly_rate
         FROM employee_pay_private epp
         LEFT JOIN employee_file_transitions eft
           ON eft.target_emp_id = ps.employee_id
         WHERE epp.emp_id IN (ps.employee_id, eft.source_emp_id)
           AND epp.pay_type IN ('HOURLY_RATE', 'MONTHLY_RATE', 'YEARLY_RATE')
           AND epp.effective_from <= $4::date
           AND (epp.effective_to IS NULL OR epp.effective_to >= $1::date)
         ORDER BY
           CASE WHEN epp.emp_id = ps.employee_id THEN 0 ELSE 1 END,
           eft.effective_on DESC NULLS LAST,
           epp.effective_from DESC,
           epp.created_at DESC,
           epp.pay_id DESC
         LIMIT 1
       ) pay ON TRUE
       WHERE ps.payroll_type = $3
         AND ps.active_from <= $2::date
         AND (ps.active_to IS NULL OR ps.active_to >= $1::date)
       ORDER BY ps.employee_id, ps.active_from DESC, ps.updated_at DESC, ps.id DESC
     ),
     work_scope AS (
       SELECT
         t.emp_id,
         COALESCE(SUM(CASE WHEN t.hour_type = 'WORK' THEN t.hours ELSE 0 END), 0) AS work_hours,
         COALESCE(SUM(CASE WHEN t.hour_type = 'VACATION_LEAVE' AND COALESCE(t.leave_status, 'PAID') <> 'UNPAID' THEN t.hours ELSE 0 END), 0) AS paid_vl_hours,
         COALESCE(SUM(CASE WHEN t.hour_type = 'SICK_LEAVE' AND COALESCE(t.leave_status, 'PAID') <> 'UNPAID' THEN t.hours ELSE 0 END), 0) AS paid_sl_hours,
         COALESCE(SUM(CASE WHEN t.hour_type = 'UNPAID_LEAVE' OR COALESCE(t.leave_status, '') = 'UNPAID' THEN t.hours ELSE 0 END), 0) AS unpaid_hours
       FROM timesheets t
       WHERE t.work_date >= $1::date
         AND t.work_date < $2::date
       GROUP BY t.emp_id
     ),
     clock_scope AS (
       SELECT
         te.employee_id AS emp_id,
         COUNT(*) AS event_count,
         MAX(te.updated_at) AS last_import_at
       FROM timesheet_events te
       GROUP BY te.employee_id
     ),
     conflict_scope AS (
       SELECT
         tic.emp_id,
         COUNT(*) FILTER (WHERE tic.status = 'PENDING') AS pending_conflict_count
       FROM timesheet_import_conflicts tic
       GROUP BY tic.emp_id
     ),
     payslip_scope AS (
       SELECT DISTINCT ON (ps.emp_id)
         ps.emp_id,
         ps.status AS payslip_status,
         ps.issue_date,
         ps.email_sent_at
       FROM payslips ps
       JOIN payroll_entries pe
         ON pe.id = ps.payroll_entry_id
       WHERE pe.payroll_number = $5
       ORDER BY ps.emp_id, ps.id DESC
     )
     SELECT
       e.emp_id,
       e.surname,
       e.first_name,
       e.designation,
       e.department,
       e.employment_type,
       e.timesheet_required,
       e.weekly_hours,
       e.hourly_rate,
       e.tax_status,
       e.email,
       e.active_from,
       e.active_to,
       e.coverage_from,
       e.coverage_to,
       e.source_transition_effective_on,
       e.target_transition_effective_on,
       EXISTS (
         SELECT 1
         FROM payroll_subscriptions ps_provider
         WHERE ps_provider.employee_id = e.emp_id
           AND UPPER(COALESCE(ps_provider.payroll_type, '')) IN ('PROVIDER', 'PROV')
       ) AS provider_subscription_exists,
       COALESCE(w.work_hours, 0) AS work_hours,
       COALESCE(w.paid_vl_hours, 0) AS paid_vl_hours,
       COALESCE(w.paid_sl_hours, 0) AS paid_sl_hours,
       COALESCE(w.unpaid_hours, 0) AS unpaid_hours,
       COALESCE(c.event_count, 0) AS event_count,
       c.last_import_at,
       COALESCE(cs.pending_conflict_count, 0) AS pending_conflict_count,
       COALESCE(ps.payslip_status, '') AS payslip_status
     FROM employee_scope e
     LEFT JOIN work_scope w
       ON w.emp_id = e.emp_id
     LEFT JOIN clock_scope c
       ON c.emp_id = e.emp_id
     LEFT JOIN conflict_scope cs
       ON cs.emp_id = e.emp_id
     LEFT JOIN payslip_scope ps
       ON ps.emp_id = e.emp_id
     ORDER BY e.department, e.surname, e.first_name, e.emp_id`, [period.periodFrom, period.end.toISOString().slice(0, 10), payroll, period.periodTo, `${payroll}-${period.raw}`]);
    const rows = [];
    for (const record of result.rows) {
        const coverageStartDate = parseIsoDate(record.coverage_from);
        const coverageEndDate = parseIsoDate(record.coverage_to);
        if (!coverageStartDate || !coverageEndDate || coverageEndDate < coverageStartDate) {
            continue;
        }
        const coverageFrom = formatIsoDate(coverageStartDate);
        const coverageTo = formatIsoDate(coverageEndDate);
        const coverageDays = coveredDayCount(coverageFrom, coverageTo);
        const hoursWorked = toNumber(record.work_hours);
        const paidVlHours = toNumber(record.paid_vl_hours);
        const paidSlHours = toNumber(record.paid_sl_hours);
        const hourlyRate = truncateMoney(toNumber(record.hourly_rate));
        const contractedWeeklyHours = toNumber(record.weekly_hours);
        const employmentType = cleanText(record.employment_type).toUpperCase();
        const providerEmployee = record.provider_subscription_exists === true;
        const timesheetRequired = record.timesheet_required !== false;
        const excelMonth = !timesheetRequired ? await getExcelPayslipMonth(Number(record.emp_id), period.raw) : null;
        const isCasual = employmentType.includes('CASUAL');
        const payableHours = hoursWorked + paidVlHours + paidSlHours;
        const useContractedWeeklyHours = employmentType.startsWith('FT') || employmentType.startsWith('FULL');
        const grossHours = useContractedWeeklyHours ? roundMoney((contractedWeeklyHours * coverageDays) / 7) : payableHours;
        const gross = roundMoney(grossHours * hourlyRate);
        const warnings = [];
        const pendingConflictCount = toNumber(record.pending_conflict_count);
        if (hourlyRate <= 0) {
            warnings.push('Missing pay setup');
        }
        if (useContractedWeeklyHours && contractedWeeklyHours <= 0) {
            warnings.push('Missing contracted weekly hours');
        }
        if (timesheetRequired && pendingConflictCount > 0) {
            warnings.push('Timesheet import requires review');
        }
        if (timesheetRequired && payableHours <= 0 && toNumber(record.event_count) > 0) {
            if (pendingConflictCount <= 0) {
                warnings.push('Timesheet import requires review');
            }
            warnings.push('Clock events not imported to timesheets');
        }
        if (timesheetRequired && payableHours <= 0 && toNumber(record.event_count) <= 0) {
            warnings.push('No timesheet data');
        }
        const lastImportAt = cleanText(record.last_import_at) || null;
        if (timesheetRequired && lastImportAt) {
            const ageMs = Date.now() - new Date(lastImportAt).getTime();
            if (Number.isFinite(ageMs) && ageMs > (7 * 24 * 60 * 60 * 1000)) {
                warnings.push('Last import stale');
            }
        }
        if (!cleanText(record.email)) {
            warnings.push('Missing email');
        }
        const payslipStatus = cleanText(record.payslip_status).toUpperCase();
        if (payslipStatus === 'ISSUED' || payslipStatus === 'EMAILED') {
            warnings.push('Payslip sent');
        }
        else {
            warnings.push('Payslip pending');
        }
        if (coverageFrom !== period.periodFrom || coverageTo !== period.periodTo) {
            warnings.push(`Split-month coverage ${coverageFrom} to ${coverageTo}`);
        }
        let taxRateApplied = 0;
        let taxDeduction = 0;
        let ssClassCode = '';
        let ssEmployeeContribution = 0;
        let ssEmployerContribution = 0;
        let mlfContribution = 0;
        if (gross > 0) {
            if (toNumber(record.current_result_tax_on_gross) > 0 || toNumber(record.current_result_ssc_employee) > 0 || toNumber(record.current_result_ssc_employer) > 0) {
                taxDeduction = roundMoney(toNumber(record.current_result_tax_on_gross));
                ssEmployeeContribution = roundMoney(toNumber(record.current_result_ssc_employee));
                ssEmployerContribution = roundMoney(toNumber(record.current_result_ssc_employer));
                mlfContribution = roundMoney(toNumber(record.current_result_mlf));
            }
            else {
                try {
                    const bracket = await lookupTaxBracket(pg, gross * 12, safeTaxCategory(record.tax_status));
                    taxRateApplied = toNumber(bracket.rate);
                    taxDeduction = roundMoney(calculateTax(gross, taxRateApplied / 100, toNumber(bracket.subtract) / 12));
                }
                catch {
                    warnings.push('Missing tax bracket');
                }
                try {
                    const employeeDobResult = await pg.query(`SELECT to_char(dob, 'YYYY-MM-DD') AS dob FROM employees WHERE emp_id = $1 LIMIT 1`, [Number(record.emp_id)]);
                    const employeeDob = cleanText(employeeDobResult.rows[0]?.dob) || null;
                    const ssContribution = await lookupSocialSecurityContribution(pg, period.year, gross, employeeDob);
                    if (ssContribution) {
                        ssClassCode = cleanText(ssContribution.class_code);
                        ssEmployeeContribution = roundMoney(ssContribution.employee_contribution);
                        ssEmployerContribution = roundMoney(ssContribution.employer_contribution);
                        mlfContribution = roundMoney(ssContribution.mlf_contribution);
                    }
                    else {
                        warnings.push('Missing SSC class');
                    }
                }
                catch {
                    warnings.push('SSC data unavailable');
                }
            }
        }
        const grossTotal = roundMoney(toNumber(record.current_result_gross_total) || gross);
        const totalDeductions = roundMoney(taxDeduction + ssEmployeeContribution);
        const netPayment = roundMoney(toNumber(record.current_result_net_wage) || (grossTotal - totalDeductions));
        let vlPending = 0;
        let slPending = 0;
        let vlTakenYtd = 0;
        let slTakenYtd = 0;
        let vlTakenPeriod = payableHours > 0 ? roundMoney(paidVlHours) : 0;
        let slTakenPeriod = payableHours > 0 ? roundMoney(paidSlHours) : 0;
        let vlWarning = '';
        let slWarning = '';
        if (!isCasual) {
            try {
                const leave = await calculateLeaveEntitlements(pg, {
                    employee_id: Number(record.emp_id),
                    payroll_year: period.year,
                    payroll_month: period.month,
                    payroll_type: payroll
                });
                vlPending = roundMoney(leave.vl_remaining_hours);
                slPending = roundMoney(leave.sl_remaining_hours);
                vlTakenYtd = roundMoney(leave.vl_used_hours_ytd);
                slTakenYtd = roundMoney(leave.sl_used_hours_ytd);
                const violations = validateLeaveUsage(leave);
                const vlViolation = violations.find((item) => item.type === 'VL_EXCEEDED');
                const slViolation = violations.find((item) => item.type === 'SL_EXCEEDED');
                if (vlViolation) {
                    vlWarning = vlViolation.message;
                    warnings.push(vlViolation.message);
                }
                if (slViolation) {
                    slWarning = slViolation.message;
                    warnings.push(slViolation.message);
                }
                if (!leave.payment_due) {
                    warnings.push('Leave requires review');
                }
            }
            catch {
                warnings.push('Leave data unavailable');
                vlWarning = 'Leave data unavailable';
                slWarning = 'Leave data unavailable';
            }
        }
        const bankedTotal = providerEmployee
            ? 0
            : (timesheetRequired
                ? (payableHours > 0 ? roundMoney(payableHours - grossHours) : 0)
                : (payroll === 'PROVIDER' ? 0 : Math.max(0, roundMoney(toNumber(excelMonth?.banked_hours_since_last_month)))));
        const casualVlTakenYtd = isCasual ? 0 : vlTakenYtd;
        const casualVlTakenPeriod = isCasual ? 0 : vlTakenPeriod;
        const casualVlPending = isCasual ? 0 : vlPending;
        const casualVlWarning = isCasual ? '' : vlWarning;
        const casualSlTakenYtd = isCasual ? 0 : slTakenYtd;
        const casualSlTakenPeriod = isCasual ? 0 : slTakenPeriod;
        const casualSlPending = isCasual ? 0 : slPending;
        const casualSlWarning = isCasual ? '' : slWarning;
        rows.push({
            emp_id: Number(record.emp_id),
            surname: cleanText(record.surname),
            first_name: cleanText(record.first_name),
            provider_subscription_exists: providerEmployee,
            designation: cleanText(record.designation),
            department: cleanText(record.department),
            employment_type: employmentType,
            timesheet_required: timesheetRequired,
            period_from: coverageFrom,
            period_to: coverageTo,
            timesheet_acquired: !timesheetRequired
                ? 'Not required'
                : (payableHours > 0 ? 'Acquired' : ((pendingConflictCount > 0 || toNumber(record.event_count) > 0) ? 'Review needed' : 'Pending')),
            last_timesheet_import: lastImportAt,
            hourly_rate: hourlyRate,
            contracted_weekly_hours: roundMoney(contractedWeeklyHours),
            net_payment: netPayment,
            gross_including_bonuses: gross,
            gross_total: grossTotal,
            my_cost_per_cheque: roundMoney(grossTotal + ssEmployerContribution + mlfContribution),
            vl_taken_ytd: casualVlTakenYtd,
            vl_taken_period: casualVlTakenPeriod,
            vl_pending: casualVlPending,
            vl_warning: casualVlWarning,
            sl_taken_ytd: casualSlTakenYtd,
            sl_taken_period: casualSlTakenPeriod,
            sl_pending: casualSlPending,
            sl_warning: casualSlWarning,
            banked_hours_balance: bankedTotal,
            warnings,
            hours_worked: roundMoney(payableHours),
            tax_rate_applied: taxRateApplied,
            tax_deduction: taxDeduction,
            ss_class_code: ssClassCode,
            ss_employee_contribution: ssEmployeeContribution,
            ss_employer_contribution: ssEmployerContribution,
            mlf_contribution: mlfContribution,
            total_deductions: totalDeductions,
            email: cleanText(record.email),
            tax_status: cleanText(record.tax_status) || 'Single'
        });
    }
    return rows;
};
const loadRowsByEmployee = async (pg, payroll, period, employeeIds) => {
    const rows = await buildRows(pg, payroll, period);
    const allowed = new Set(employeeIds);
    return rows.filter((row) => allowed.has(row.emp_id));
};
const getRateSource = async (pg, empId, period) => {
    const newTermsResult = await pg.query(`SELECT
       pay_input_basis_main,
       input_amount_main,
       hourly_rate_main,
       effective_from,
       notes
     FROM employee_payroll_terms
     WHERE emp_id = $1
       AND payroll_type = 'MAIN'
       AND effective_from <= $3::date
       AND (effective_to IS NULL OR effective_to >= $2::date)
       AND is_active = TRUE
     ORDER BY effective_from DESC, id DESC
     LIMIT 1`, [empId, period.periodFrom, period.periodTo]);
    if (newTermsResult.rows[0]) {
        return {
            pay_type: normalizeLegacyPayType(cleanText(newTermsResult.rows[0].pay_input_basis_main)),
            input_amount: toNumber(newTermsResult.rows[0].input_amount_main),
            derived_hourly_rate: toNumber(newTermsResult.rows[0].hourly_rate_main),
            effective_from: toIsoDate(newTermsResult.rows[0].effective_from),
            notes: cleanText(newTermsResult.rows[0].notes),
            source_emp_id: empId
        };
    }
    const result = await pg.query(`SELECT
       epp.pay_type,
       epp.amount,
       epp.effective_from,
       COALESCE(epp.notes, '') AS notes,
       epp.emp_id AS source_emp_id
     FROM employee_pay_private epp
     LEFT JOIN employee_file_transitions eft
       ON eft.target_emp_id = $1
     WHERE epp.emp_id IN ($1, eft.source_emp_id)
       AND epp.pay_type IN ('HOURLY_RATE', 'MONTHLY_RATE', 'YEARLY_RATE')
       AND epp.effective_from <= $3::date
       AND (epp.effective_to IS NULL OR epp.effective_to >= $2::date)
     ORDER BY
       CASE WHEN epp.emp_id = $1 THEN 0 ELSE 1 END,
       eft.effective_on DESC NULLS LAST,
       epp.effective_from DESC,
       epp.created_at DESC,
       epp.pay_id DESC
     LIMIT 1`, [empId, period.periodFrom, period.periodTo]);
    if (!result.rows[0]) {
        return null;
    }
    return {
        pay_type: cleanText(result.rows[0].pay_type),
        input_amount: toNumber(result.rows[0].amount),
        derived_hourly_rate: resolveHourlyRate(result.rows[0].pay_type, toNumber(result.rows[0].amount)),
        effective_from: toIsoDate(result.rows[0].effective_from),
        notes: cleanText(result.rows[0].notes),
        source_emp_id: Number(result.rows[0].source_emp_id) || null
    };
};
const getPayrollDashboardDetail = async (pg, payroll, period, empId) => {
    const rows = await loadRowsByEmployee(pg, payroll, period, [empId]);
    const row = rows[0];
    if (!row) {
        return null;
    }
    const employeeResult = await pg.query(`SELECT
       ec.emp_id,
       COALESCE(NULLIF(TRIM(ec.pe_number), ''), '') AS pe_number,
       COALESCE(NULLIF(TRIM(ec.national_id), ''), NULLIF(TRIM(e.national_id), ''), '') AS national_id,
       COALESCE(NULLIF(TRIM(ec.eu_residency_no), ''), NULLIF(TRIM(e.eu_residency_no), ''), '') AS eu_residency_no,
       COALESCE(NULLIF(TRIM(ec.passport_no), ''), NULLIF(TRIM(e.passport_no), ''), '') AS passport_no,
       to_char(e.dob, 'YYYY-MM-DD') AS dob,
       COALESCE(NULLIF(TRIM(ec.iban), ''), NULLIF(TRIM(e.iban), ''), '') AS iban,
       COALESCE(NULLIF(TRIM(ec.email), ''), NULLIF(TRIM(e.email), ''), '') AS email,
       COALESCE(NULLIF(TRIM(efp.middle_name), ''), '') AS middle_name,
       COALESCE(NULLIF(TRIM(e.phone_primary), ''), '') AS phone_primary,
       COALESCE(NULLIF(TRIM(e.phone_secondary), ''), '') AS phone_secondary,
       COALESCE(NULLIF(TRIM(e.social_security_no), ''), '') AS social_security_no,
       COALESCE(NULLIF(TRIM(e.tax_number), ''), '') AS tax_number,
      COALESCE(NULLIF(TRIM(ec.nationality), ''), NULLIF(TRIM(e.nationality), ''), '') AS nationality,
       COALESCE(NULLIF(TRIM(e.spouse_national_id), ''), '') AS spouse_national_id,
       COALESCE(NULLIF(TRIM(e.address1), ''), '') AS address1,
       COALESCE(NULLIF(TRIM(ec.address2), ''), NULLIF(TRIM(e.address2), ''), '') AS address2,
       COALESCE(NULLIF(TRIM(ec.city), ''), NULLIF(TRIM(e.city), ''), '') AS city,
       COALESCE(NULLIF(TRIM(ec.postcode), ''), NULLIF(TRIM(e.postcode), ''), '') AS postcode,
       COALESCE(NULLIF(TRIM(ec.fs_status), ''), '') AS fs_status,
       COALESCE(NULLIF(TRIM(efp.fs4_status), ''), '') AS fs4_status,
       COALESCE(NULLIF(TRIM(ec.employment_type), ''), '') AS employment_type,
       COALESCE(ec.weekly_hours, 0) AS weekly_hours
     FROM vw_employee_current ec
     LEFT JOIN employees e
       ON e.emp_id = ec.emp_id
     LEFT JOIN employee_form_profile efp
       ON efp.emp_id = ec.emp_id
     WHERE ec.emp_id = $1
     LIMIT 1`, [empId]);
    const payrollSubscriptionsResult = await pg.query(`SELECT
       payroll_type,
       active_from,
       active_to
     FROM payroll_subscriptions
     WHERE employee_id = $1
     ORDER BY
       CASE payroll_type
         WHEN 'MAIN' THEN 1
         WHEN 'PROVIDER' THEN 2
         WHEN 'O3P' THEN 3
         ELSE 99
       END,
       active_from DESC,
       id DESC`, [empId]);
    const workResult = await pg.query(`SELECT
       COALESCE(SUM(CASE WHEN hour_type = 'WORK' THEN hours ELSE 0 END), 0) AS work_hours,
       COALESCE(SUM(CASE WHEN hour_type = 'VACATION_LEAVE' AND COALESCE(leave_status, 'PAID') <> 'UNPAID' THEN hours ELSE 0 END), 0) AS paid_vl_hours,
       COALESCE(SUM(CASE WHEN hour_type = 'SICK_LEAVE' AND COALESCE(leave_status, 'PAID') <> 'UNPAID' THEN hours ELSE 0 END), 0) AS paid_sl_hours,
       COALESCE(SUM(CASE WHEN hour_type = 'UNPAID_LEAVE' OR COALESCE(leave_status, '') = 'UNPAID' THEN hours ELSE 0 END), 0) AS unpaid_hours
     FROM timesheets
     WHERE emp_id = $1
       AND work_date >= $2::date
       AND work_date < ($3::date + INTERVAL '1 day')`, [empId, row.period_from, row.period_to]);
    const savedLineResult = await pg.query(`SELECT
       pl.*,
       ps.signature_image_url,
       ps.bank_transaction_number,
       ps.pdf_file_url,
       ps.source_funds_label,
       ps.paid_previously_amount,
       ps.review_adjustments,
       ps.status AS payslip_status
     FROM payroll_lines pl
     JOIN payroll_entries pe
       ON pe.id = pl.payroll_entry_id
     LEFT JOIN payslips ps
       ON ps.payroll_line_id = pl.id
      AND ps.payroll_entry_id = pe.id
     WHERE pl.emp_id = $1
       AND pe.payroll_number = $2
     ORDER BY pl.id DESC
     LIMIT 1`, [empId, `${payroll}-${period.raw}`]);
    const currentMonthResult = await getCurrentMonthResult(pg, payroll, period, empId);
    const employee = employeeResult.rows[0] || {};
    const work = workResult.rows[0] || {};
    const savedLine = savedLineResult.rows[0] || {};
    const rateSource = await getRateSource(pg, empId, period);
    const excelMonth = await getExcelPayslipMonthWithFallback(pg, empId, period.raw);
    const rawYearView = await getExcelPayslipYearView(pg, payroll, empId, period.raw);
    const providerEmployee = row.provider_subscription_exists === true;
    let yearView = providerEmployee
        ? {
            rows: (Array.isArray(rawYearView.rows) ? rawYearView.rows : []).map((entry) => ({
                ...entry,
                banked_hours_since_last_month: 0
            })),
            previousYearSummary: rawYearView.previousYearSummary
                ? { ...rawYearView.previousYearSummary, banked_hours_since_last_month: 0 }
                : null
        }
        : rawYearView;
    const employmentType = cleanText(employee.employment_type || row.employment_type).toUpperCase();
    const contractedWeeklyHours = toNumber(employee.weekly_hours || row.contracted_weekly_hours);
    const workHours = roundMoney(toNumber(work.work_hours));
    const paidVlHours = roundMoney(toNumber(work.paid_vl_hours));
    const paidSlHours = roundMoney(toNumber(work.paid_sl_hours));
    const unpaidHours = roundMoney(toNumber(work.unpaid_hours));
    const payableHours = roundMoney(workHours + paidVlHours + paidSlHours);
    const useContractedWeeklyHours = employmentType.startsWith('FT');
    const grossBasisLabel = useContractedWeeklyHours ? 'Contracted weekly hours' : 'Payable worked hours';
    const grossBasisHours = useContractedWeeklyHours ? contractedWeeklyHours : payableHours;
    const identifierValue = cleanText(employee.national_id) || cleanText(employee.eu_residency_no) || cleanText(employee.passport_no);
    const identifierLabel = cleanText(employee.national_id)
        ? 'ID Card'
        : cleanText(employee.eu_residency_no)
            ? 'Residency Number'
            : cleanText(employee.passport_no)
                ? 'Passport'
                : 'ID';
    const ssClass = cleanText(savedLine.ss_class_code) || cleanText(row.ss_class_code) || determineSocialSecurityClass(row.gross_including_bonuses, null);
    const ssEmployee = roundMoney(toNumber(currentMonthResult?.ssc_employee) || toNumber(savedLine.ss_employee_contribution) || row.ss_employee_contribution);
    const ssEmployer = roundMoney(toNumber(currentMonthResult?.ssc_employer) || toNumber(savedLine.ss_employer_contribution) || row.ss_employer_contribution);
    const ssTotal = roundMoney(ssEmployee + ssEmployer);
    const mlf = roundMoney(toNumber(currentMonthResult?.mlf) || toNumber(savedLine.mlf_contribution) || row.mlf_contribution);
    const extraUnderHours = roundMoney(toNumber(savedLine.extra_hours_worked));
    const extraUnderAmount = roundMoney(toNumber(currentMonthResult?.normal_rate_extra_pay) || (extraUnderHours * row.hourly_rate));
    const unpaidLeaveHours = roundMoney(toNumber(currentMonthResult?.unpaid_leave_hours_total) || toNumber(savedLine.unpaid_leave_hours));
    const unpaidLeaveAmount = roundMoney(toNumber(currentMonthResult?.unpaid_leave_deduction_amount) || (unpaidLeaveHours * row.hourly_rate));
    const performanceBonus = roundMoney(toNumber(currentMonthResult?.performance_bonus) || toNumber(savedLine.performance_bonus));
    const supervisorBonus = roundMoney(toNumber(currentMonthResult?.supervisor_bonus) || toNumber(savedLine.supervisor_bonus));
    const discretionaryBonus = roundMoney(toNumber(currentMonthResult?.bonus) || toNumber(savedLine.discretionary_bonus));
    const statutoryBonus = roundMoney(toNumber(savedLine.statutory_bonus_june) +
        toNumber(savedLine.statutory_bonus_december));
    const bonusTotal = roundMoney(performanceBonus + supervisorBonus + discretionaryBonus + statutoryBonus);
    const otherPayments = roundMoney(toNumber(savedLine.weekly_allowance_march) +
        toNumber(savedLine.weekly_allowance_september));
    const overtimeHours = roundMoney(toNumber(savedLine.overtime_hours));
    const overtimeAmount = roundMoney(toNumber(currentMonthResult?.overtime_pay_amount) || toNumber(savedLine.overtime_payment));
    const overtimeTax = 0;
    const grossBeforeBonuses = roundMoney(toNumber(currentMonthResult?.main_base_monthly_wage) || row.gross_including_bonuses);
    const grossIncludingAdjustments = roundMoney(toNumber(currentMonthResult?.gross_total) || (grossBeforeBonuses + bonusTotal + otherPayments + extraUnderAmount - unpaidLeaveAmount));
    const leaveTakenYtd = roundMoney(toNumber(currentMonthResult?.vl_taken_hours) + toNumber(currentMonthResult?.sl_taken_hours) || (toNumber(savedLine.annual_leave_taken_hours) + toNumber(savedLine.sick_leave_taken_hours)));
    const leaveLeftYtd = roundMoney(row.vl_pending);
    const bankedSinceLastMonth = providerEmployee ? 0 : (payroll === 'PROVIDER' ? 0 : roundMoney(toNumber(currentMonthResult?.banked_hours_movement) || toNumber(savedLine.banked_hours_new)));
    const signatureImageUrl = cleanText(savedLine.signature_image_url);
    const transactionNumber = cleanText(savedLine.bank_transaction_number);
    const sourceFundsLabel = cleanText(currentMonthResult?.source_funds_label) || cleanText(savedLine.source_funds_label);
    const paidPreviouslyAmount = roundMoney(toNumber(currentMonthResult?.paid_previously_amount) || toNumber(savedLine.paid_previously_amount));
    const displayFsStatus = formatTaxStatusLabel(cleanText(currentMonthResult?.tax_status)
        || cleanText(excelMonth?.fs4_status)
        || cleanText(row.tax_status)
        || cleanText(employee.fs4_status)
        || cleanText(employee.fs_status)
        || 'Single');
    const currentYearRowSeed = (Array.isArray(yearView.rows) ? yearView.rows : []).find((entry) => String(entry?.month) === period.raw) || null;
    const currentYearRow = (Array.isArray(yearView.rows) ? yearView.rows : []).find((entry) => String(entry?.month) === period.raw) || null;
    const hasSavedLine = Number(savedLine.id) > 0;
    let previewRecalc = null;
    if (payroll === 'MAIN') {
        const weeklyWage = roundMoney(contractedWeeklyHours * row.hourly_rate);
        const ftLike = employmentType.startsWith('FT');
        const currentYearRowData = (currentYearRowSeed || {});
        const previewBonusTotal = roundMoney(toNumber(currentYearRowData.bonus_total)
            || toNumber(currentYearRowData.bonus)
            || toNumber(excelMonth?.bonus)
            || bonusTotal);
        const previewOtherPayments = roundMoney(toNumber(currentYearRowData.other_amount) || otherPayments);
        const previewExtraUnderAmount = roundMoney(toNumber(currentYearRowData.extra_due) || extraUnderAmount);
        const previewUnpaidLeaveAmount = roundMoney(toNumber(currentYearRowData.unpaid_leave_amount) || unpaidLeaveAmount);
        const basicWagePreview = ftLike
            ? roundMoney(contractedWeeklyHours * row.hourly_rate * 52 / 12)
            : roundMoney(payableHours * row.hourly_rate);
        const grossTotalPreview = roundMoney(basicWagePreview + previewBonusTotal + previewOtherPayments + previewExtraUnderAmount - previewUnpaidLeaveAmount);
        let previewTax = 0;
        let previewTaxRate = 0;
        try {
            const bracket = await lookupTaxBracket(pg, grossTotalPreview * 12, safeTaxCategory(displayFsStatus));
            previewTaxRate = toNumber(bracket.rate);
            previewTax = roundMoney(calculateTax(grossTotalPreview, previewTaxRate / 100, toNumber(bracket.subtract) / 12));
        }
        catch {
            previewTax = roundMoney(row.tax_deduction);
        }
        let previewSsClass = ssClass;
        let previewSsEmployee = ssEmployee;
        let previewSsEmployer = ssEmployer;
        let previewMlf = mlf;
        try {
            const employeeDob = toIsoDate(employee.dob) || null;
            const previewSs = await lookupSocialSecurityContribution(pg, period.year, weeklyWage, employeeDob);
            if (previewSs) {
                previewSsClass = cleanText(previewSs.class_code) || previewSsClass;
                previewSsEmployee = roundMoney(previewSs.employee_contribution);
                previewSsEmployer = roundMoney(previewSs.employer_contribution);
                previewMlf = roundMoney(previewSs.mlf_contribution);
            }
        }
        catch {
            // fall back to existing preview values
        }
        const previewSsTotal = roundMoney(previewSsEmployee + previewSsEmployer);
        const previewNet = roundMoney(grossTotalPreview - previewTax - previewSsEmployee);
        const previewCost = roundMoney(grossTotalPreview + previewSsEmployer + previewMlf);
        previewRecalc = {
            basicWage: basicWagePreview,
            grossTotal: grossTotalPreview,
            weeklyWage,
            taxDeduction: previewTax,
            ssClass: previewSsClass,
            ssEmployee: previewSsEmployee,
            ssEmployer: previewSsEmployer,
            ssTotal: previewSsTotal,
            mlf: previewMlf,
            netPayment: previewNet,
            payslipValue: previewCost
        };
        yearView = {
            ...yearView,
            rows: (Array.isArray(yearView.rows) ? yearView.rows : []).map((entry) => {
                if (String(entry?.month) !== period.raw)
                    return entry;
                return {
                    ...entry,
                    hourly_rate: row.hourly_rate,
                    weekly_wage: weeklyWage,
                    basic_wage: basicWagePreview,
                    gross_total: grossTotalPreview,
                    tax: previewTax,
                    ssc_employer: previewSsEmployer,
                    ssc_employee: previewSsEmployee,
                    ssc_total: previewSsTotal,
                    mlf: previewMlf,
                    net_wage: previewNet
                };
            })
        };
    }
    const displayExtraUnderHours = !hasSavedLine && currentYearRow?.extra_under_hours != null
        ? roundMoney(toNumber(currentYearRow.extra_under_hours))
        : extraUnderHours;
    const displayGrossBeforeBonuses = previewRecalc
        ? previewRecalc.basicWage
        : !hasSavedLine && currentYearRow?.basic_wage != null
            ? roundMoney(toNumber(currentYearRow.basic_wage))
            : grossBeforeBonuses;
    const displayBonusTotal = !hasSavedLine && currentYearRow?.bonus_total != null
        ? roundMoney(toNumber(currentYearRow.bonus_total))
        : bonusTotal;
    const displayPerformanceBonus = !hasSavedLine && currentYearRow?.performance_bonus != null
        ? roundMoney(toNumber(currentYearRow.performance_bonus))
        : performanceBonus;
    const displaySupervisorBonus = !hasSavedLine && currentYearRow?.supervisor_bonus != null
        ? roundMoney(toNumber(currentYearRow.supervisor_bonus))
        : supervisorBonus;
    const displayExtraUnderAmount = !hasSavedLine && currentYearRow?.extra_due != null
        ? roundMoney(toNumber(currentYearRow.extra_due))
        : extraUnderAmount;
    const displaySSEmployer = previewRecalc
        ? previewRecalc.ssEmployer
        : !hasSavedLine && currentYearRow?.ssc_employer != null
            ? roundMoney(toNumber(currentYearRow.ssc_employer))
            : ssEmployer;
    const displaySSEmployee = previewRecalc
        ? previewRecalc.ssEmployee
        : !hasSavedLine && currentYearRow?.ssc_employee != null
            ? roundMoney(toNumber(currentYearRow.ssc_employee))
            : ssEmployee;
    const displaySSTotal = previewRecalc
        ? previewRecalc.ssTotal
        : !hasSavedLine && currentYearRow?.ssc_total != null
            ? roundMoney(toNumber(currentYearRow.ssc_total))
            : ssTotal;
    const displayMlf = previewRecalc
        ? previewRecalc.mlf
        : !hasSavedLine && currentYearRow?.mlf != null
            ? roundMoney(toNumber(currentYearRow.mlf))
            : mlf;
    const displayTaxDeduction = previewRecalc
        ? previewRecalc.taxDeduction
        : toNumber(currentMonthResult?.tax_on_gross) > 0
            ? roundMoney(toNumber(currentMonthResult?.tax_on_gross))
            : !hasSavedLine && currentYearRow?.tax != null
                ? roundMoney(toNumber(currentYearRow.tax))
                : roundMoney(row.tax_deduction);
    const displayGrossIncludingAdjustments = previewRecalc
        ? previewRecalc.grossTotal
        : toNumber(currentMonthResult?.gross_total) > 0
            ? roundMoney(toNumber(currentMonthResult?.gross_total))
            : !hasSavedLine && currentYearRow?.gross_total != null
                ? roundMoney(toNumber(currentYearRow.gross_total))
                : grossIncludingAdjustments;
    const baseNetWage = previewRecalc
        ? previewRecalc.netPayment
        : toNumber(currentMonthResult?.net_wage) > 0
            ? roundMoney(toNumber(currentMonthResult?.net_wage))
            : !hasSavedLine && currentYearRow?.net_wage != null
                ? roundMoney(toNumber(currentYearRow.net_wage))
                : roundMoney(row.net_payment);
    const displayLeaveLeftYtd = !hasSavedLine && currentYearRow?.leave_balance_end != null
        ? roundMoney(toNumber(currentYearRow.leave_balance_end))
        : leaveLeftYtd;
    const displayBankedSinceLastMonth = !hasSavedLine && !providerEmployee && currentYearRow?.banked_hours_since_last_month != null
        ? roundMoney(toNumber(currentYearRow.banked_hours_since_last_month))
        : bankedSinceLastMonth;
    const transactionAmount = roundMoney(baseNetWage - paidPreviouslyAmount);
    const payslipValue = previewRecalc
        ? previewRecalc.payslipValue
        : roundMoney(displayGrossIncludingAdjustments + displaySSEmployer + displayMlf);
    const monthGrid = [
        { row_key: 'r19', left_label: identifierLabel, left_value: identifierValue || '-', right_label: 'Gross Total', right_value: displayGrossIncludingAdjustments, far_label: 'SS / Type / Class', far_value: `${displayFsStatus} / ${employmentType || '-'} / ${previewRecalc?.ssClass || ssClass || '-'}` },
        { row_key: 'r20', left_label: useContractedWeeklyHours ? 'Hrs/Wk' : 'Hours Worked', left_value: grossBasisHours, right_label: 'Basic Pay', right_value: displayGrossBeforeBonuses, far_label: 'SSC Tot / Employer / Employee', far_value: `${displaySSTotal.toFixed(2)} / ${displaySSEmployer.toFixed(2)} / ${displaySSEmployee.toFixed(2)}` },
        { row_key: 'r21', left_label: 'Month', left_value: `${monthShort(period.month)}-${String(period.year).slice(-2)}`, right_label: 'Extra/Under Hours', right_value: `${displayExtraUnderHours.toFixed(2)} hrs / ${displayExtraUnderAmount.toFixed(2)}`, far_label: 'MLF', far_value: displayMlf },
        { row_key: 'r22', left_label: 'Payer P.E. Number', left_value: cleanText(employee.pe_number), right_label: 'Unpaid Leave', right_value: `${unpaidLeaveHours.toFixed(2)} hrs / ${unpaidLeaveAmount.toFixed(2)}`, far_label: 'Tax on Gross', far_value: displayTaxDeduction },
        { row_key: 'r23', left_label: 'Employee ID', left_value: row.emp_id, right_label: 'Bonus', right_value: displayBonusTotal, far_label: overtimeHours > 0 ? 'Overtime Tax' : '', far_value: overtimeHours > 0 ? overtimeTax : '' },
        { row_key: 'r24', left_label: 'Other', left_value: otherPayments > 0 ? 'Other Payments' : '0', right_label: 'Other Amount', right_value: otherPayments, far_label: 'Tax on Gross', far_value: displayTaxDeduction },
        { row_key: 'r25', left_label: 'Performance Bonus', left_value: displayPerformanceBonus, right_label: 'Sup Bonus', right_value: displaySupervisorBonus, far_label: 'IBAN', far_value: cleanText(employee.iban) },
        { row_key: 'r26', left_label: overtimeHours > 0 ? 'Overtime Hours' : 'Overtime', left_value: overtimeHours > 0 ? `${overtimeHours.toFixed(2)} hrs` : '-', right_label: 'Overtime Value', right_value: overtimeAmount, far_label: 'Net Wage', far_value: baseNetWage },
        { row_key: 'r27', left_label: 'Leave Taken to Date', left_value: leaveTakenYtd, right_label: 'Leave Left to Date', right_value: displayLeaveLeftYtd, far_label: 'Transaction ID', far_value: transactionNumber || '-' },
        { row_key: 'r28', left_label: 'Banked Hours Since Last Month', left_value: displayBankedSinceLastMonth, right_label: 'Clinic Addresses', right_value: CLINIC_ADDRESSES.join(' | '), far_label: 'Principal Signature', far_value: signatureImageUrl || 'On file / pending attach' }
    ];
    const result = {
        employee: {
            emp_id: row.emp_id,
            first_name: cleanText(row.first_name),
            surname: cleanText(row.surname),
            name: buildDisplayName(row),
            designation: row.designation,
            department: row.department,
            employment_type: employmentType,
            timesheet_required: row.timesheet_required,
            pe_number: cleanText(employee.pe_number),
            dob: toIsoDate(employee.dob),
            id_label: identifierLabel,
            id_value: identifierValue,
            iban: cleanIban(employee.iban),
            fs_status: displayFsStatus,
            email: cleanText(employee.email) || row.email,
            middle_name: cleanText(employee.middle_name),
            phone_primary: cleanText(employee.phone_primary),
            phone_secondary: cleanText(employee.phone_secondary),
            social_security_no: cleanText(employee.social_security_no),
            tax_number: cleanText(employee.tax_number),
            nationality: cleanText(employee.nationality),
            spouse_national_id: cleanText(employee.spouse_national_id),
            address1: cleanText(employee.address1),
            address2: cleanText(employee.address2),
            city: cleanText(employee.city),
            postcode: cleanText(employee.postcode),
            payroll_subscriptions: payrollSubscriptionsResult.rows.map((subscription) => ({
                payroll_type: cleanText(subscription.payroll_type),
                active_from: toIsoDate(subscription.active_from),
                active_to: toIsoDate(subscription.active_to)
            }))
        },
        calculation: {
            hourly_rate: row.hourly_rate,
            pay_type_used: rateSource?.pay_type || 'PROFILE_HOURLY',
            pay_input_amount: rateSource?.input_amount ?? row.hourly_rate,
            derived_hourly_rate: row.hourly_rate,
            contracted_weekly_hours: contractedWeeklyHours,
            work_hours: workHours,
            paid_vl_hours: paidVlHours,
            paid_sl_hours: paidSlHours,
            unpaid_hours: unpaidHours,
            payable_hours: payableHours,
            gross_basis: grossBasisLabel,
            gross_basis_hours: grossBasisHours,
            gross_before_bonuses: displayGrossBeforeBonuses,
            gross_total: displayGrossIncludingAdjustments,
            bonus_total: displayBonusTotal,
            performance_bonus: displayPerformanceBonus,
            supervisor_bonus: displaySupervisorBonus,
            discretionary_bonus: discretionaryBonus,
            other_payments: otherPayments,
            extra_under_hours: displayExtraUnderHours,
            extra_under_amount: displayExtraUnderAmount,
            unpaid_leave_hours: unpaidLeaveHours,
            unpaid_leave_amount: unpaidLeaveAmount,
            ssc_class: previewRecalc?.ssClass || ssClass,
            ssc_total: displaySSTotal,
            ssc_employee: displaySSEmployee,
            ssc_employer: displaySSEmployer,
            mlf: displayMlf,
            overtime_hours: overtimeHours,
            overtime_amount: overtimeAmount,
            overtime_tax: overtimeTax,
            tax_deduction: displayTaxDeduction,
            total_deductions: row.total_deductions,
            net_payment: baseNetWage,
            leave_taken_ytd: leaveTakenYtd,
            leave_left_ytd: displayLeaveLeftYtd,
            banked_hours_since_last_month: providerEmployee
                ? 0
                : displayBankedSinceLastMonth,
            clinic_addresses: CLINIC_ADDRESSES,
            transaction_id: transactionNumber,
            signature_image_url: signatureImageUrl || null,
            payslip_value: payslipValue,
            source_debug: {
                gross_total: previewRecalc ? 'main.preview.recalculated_from_saved_rate' : hasSavedLine ? 'db.calculated.gross_total' : 'year_view.month.gross_total_fallback',
                net_wage: previewRecalc ? 'main.preview.recalculated_from_saved_rate' : hasSavedLine ? 'db.payroll_line.net_payment' : 'year_view.month.net_wage_fallback',
                transaction_amount: 'net_wage - paid_previously_amount',
                payslip_value: previewRecalc ? 'main.preview.recalculated_from_saved_rate' : 'gross_total + ssc_employer + mlf'
            },
            rate_effective_from: rateSource?.effective_from || null,
            rate_notes: rateSource?.notes || ''
        },
        issue: {
            bank_transaction_number: transactionNumber,
            source_funds_label: sourceFundsLabel,
            paid_previously_amount: paidPreviouslyAmount,
            review_adjustments: savedLine.review_adjustments || currentMonthResult?.review_reason || null,
            payslip_total: baseNetWage,
            transaction_amount: transactionAmount,
            payslip_status: cleanText(savedLine.payslip_status) || cleanText(currentMonthResult?.calc_status) || 'PENDING',
            timesheet_acquired: row.timesheet_acquired,
            last_timesheet_import: row.last_timesheet_import,
            notes: (Array.isArray(row.warnings) ? row.warnings : []).filter((warning) => String(warning || '').toLowerCase().includes('loan'))
        },
        year_view: yearView,
        excel_like: {
            sheet_hint: excelMonth?.sheet || `${cleanText(row.first_name).charAt(0)}${cleanText(row.surname)}`.replace(/\s+/g, ''),
            range_hint: excelMonth ? `N${19 + ((period.month - 1) * 10)}:Y${28 + ((period.month - 1) * 10)}` : 'N19:Y28',
            rows: monthGrid
        }
    };
    if (excelMonth) {
        const rowLabels = [
            ['r19', identifierLabel, excelMonth.id_card, 'Gross Total', excelMonth.gross_total, 'FS / Type / SSC Class', `${displayFsStatus} / ${excelMonth.employment_type} / ${excelMonth.ssc_class}`],
            ['r20', 'Hrs/Wk', excelMonth.hours_per_week, 'Basic Wage', excelMonth.basic_wage, 'SSC Tot / Employer / Employee', `${(excelMonth.ssc_total ?? 0).toFixed(2)} / ${(excelMonth.ssc_employer ?? 0).toFixed(2)} / ${(excelMonth.ssc_employee ?? 0).toFixed(2)}`],
            ['r21', excelMonth.extra_under_label || 'Extra/ under Hours', excelMonth.extra_under_hours_text, '', excelMonth.extra_under_amount, 'SSC / Employer / Employee', `${excelMonth.ssc_total ?? 0} / ${excelMonth.ssc_employer ?? 0} / ${excelMonth.ssc_employee ?? 0}`],
            ['r22', 'Payer P.E. Number', cleanText(excelMonth.payer_pe_text).replace(/^Payer P\.E\. Number\s*/i, ''), 'Unpaid Leave', excelMonth.unpaid_leave_hours_text, 'MLF', excelMonth.mlf],
            ['r23', 'Employee ID', row.emp_id, 'Bonus', excelMonth.bonus, 'Overtime Tax', excelMonth.overtime_tax],
            ['r24', 'Other', 'OTHER', 'Other Amount', excelMonth.other_amount, 'Tax on Gross', excelMonth.tax_on_gross],
            ['r25', 'Performance Bonus', excelMonth.performance_bonus, 'Sup Bonus', excelMonth.supervisor_bonus, 'IBAN', excelMonth.iban],
            ['r26', 'Overtime Hours', excelMonth.overtime_hours_text, 'Overtime Value', excelMonth.overtime_amount, 'Net Wage', excelMonth.net_wage],
            ['r27', 'Leave Taken', excelMonth.leave_taken_to_date, 'Transaction ID', excelMonth.transaction_id_text, '', ''],
            ['r28', 'Banked Hour Balance', (providerEmployee || payroll === 'PROVIDER') ? 0 : excelMonth.banked_hours_since_last_month, 'Leave Balance/end', excelMonth.leave_balance_end, 'Principal Signature', 'On file / pending attach']
        ];
        result.excel_like.rows = rowLabels.map(([rowKey, leftLabel, leftValue, rightLabel, rightValue, farLabel, farValue]) => ({
            row_key: String(rowKey),
            left_label: String(leftLabel),
            left_value: leftValue,
            right_label: String(rightLabel),
            right_value: rightValue,
            far_label: String(farLabel),
            far_value: farValue
        }));
    }
    return result;
};
const upsertPayrollEntry = async (client, payroll, period, rows) => {
    const payrollNumber = `${payroll}-${period.raw}`;
    const paymentDate = lastFridayOfMonth(period.year, period.month);
    const totals = rows.reduce((acc, row) => {
        acc.gross += row.gross_total;
        acc.tax += row.tax_deduction;
        acc.net += row.net_payment;
        return acc;
    }, { gross: 0, tax: 0, net: 0 });
    const existing = await client.query(`SELECT id FROM payroll_entries WHERE payroll_number = $1 LIMIT 1`, [payrollNumber]);
    if (existing.rows[0]?.id) {
        const payrollEntryId = Number(existing.rows[0].id);
        await client.query(`UPDATE payroll_entries
       SET payroll_month = $2::date,
           payroll_year = $3,
           period_from = $4::date,
           period_to = $5::date,
           payment_date = $6::date,
           status = 'APPROVED',
           total_employees_processed = $7,
           total_gross_wages = $8,
           total_tax_deducted = $9,
           total_net_wages = $10,
           data_period_month = $2::date,
           updated_at = NOW()
       WHERE id = $1`, [
            payrollEntryId,
            period.periodFrom,
            period.year,
            period.periodFrom,
            period.periodTo,
            paymentDate,
            rows.length,
            roundMoney(totals.gross),
            roundMoney(totals.tax),
            roundMoney(totals.net)
        ]);
        return { payrollEntryId, payrollNumber, paymentDate };
    }
    const inserted = await client.query(`INSERT INTO payroll_entries (
       payroll_month,
       payroll_year,
       payroll_number,
       period_from,
       period_to,
       payment_date,
       status,
       total_employees_processed,
       total_gross_wages,
       total_tax_deducted,
       total_net_wages,
       data_period_month
     ) VALUES ($1::date, $2, $3, $4::date, $5::date, $6::date, 'APPROVED', $7, $8, $9, $10, $1::date)
     RETURNING id`, [
        period.periodFrom,
        period.year,
        payrollNumber,
        period.periodFrom,
        period.periodTo,
        paymentDate,
        rows.length,
        roundMoney(totals.gross),
        roundMoney(totals.tax),
        roundMoney(totals.net)
    ]);
    return { payrollEntryId: Number(inserted.rows[0].id), payrollNumber, paymentDate };
};
const upsertPayrollMonthResult = async (client, payroll, period, row, options) => {
    const termsResult = await client.query(`SELECT *
     FROM employee_payroll_terms
     WHERE emp_id = $1
       AND payroll_type = $2
       AND effective_from <= $4::date
       AND (effective_to IS NULL OR effective_to >= $3::date)
       AND is_active = TRUE
     ORDER BY effective_from DESC, id DESC
     LIMIT 1`, [row.emp_id, payroll, period.periodFrom, period.periodTo]);
    const profileResult = await client.query(`SELECT COALESCE(NULLIF(TRIM(fs4_status), ''), 'Single') AS fs4_status,
            fixed_hours_week,
            timesheet_required
     FROM employee_form_profile
     WHERE emp_id = $1
     LIMIT 1`, [row.emp_id]);
    const terms = termsResult.rows[0] || {};
    const profile = profileResult.rows[0] || {};
    const current = await client.query(`SELECT id, calc_version
     FROM payroll_month_results
     WHERE emp_id = $1
       AND payroll_type = $2
       AND period_year = $3
       AND period_month = $4
       AND is_current = TRUE
     ORDER BY calc_version DESC, id DESC
     LIMIT 1`, [row.emp_id, payroll, period.year, period.month]);
    const paidPreviouslyAmount = options.paidPreviouslyAmount ?? 0;
    const calcStatus = options.calcStatus || 'CONFIRMED';
    const reviewReason = options.reviewAdjustments
        ? JSON.stringify(options.reviewAdjustments)
        : null;
    const payload = [
        row.emp_id,
        payroll,
        period.year,
        period.month,
        cleanText(terms.employment_type_main) || cleanText(row.employment_type),
        toNumber(terms.weekly_hours_main) || roundMoney(row.contracted_weekly_hours),
        cleanText(terms.pay_input_basis_main) || null,
        toNumber(terms.input_amount_main) || row.hourly_rate,
        toNumber(terms.hourly_rate_main) || row.hourly_rate,
        cleanText(terms.tax_status) || cleanText(profile.fs4_status) || 'Single',
        !!terms.student_flag,
        terms.timesheet_required === null || terms.timesheet_required === undefined ? !!row.timesheet_required : !!terms.timesheet_required,
        toNumber(terms.annual_vl_entitlement_hours),
        toNumber(terms.annual_sl_entitlement_hours),
        roundMoney(row.vl_taken_ytd),
        roundMoney(row.sl_taken_ytd),
        roundMoney(row.hours_worked),
        roundMoney(row.banked_hours_balance),
        roundMoney(row.gross_total),
        roundMoney(row.gross_total),
        roundMoney(row.tax_deduction),
        roundMoney(row.tax_deduction),
        roundMoney(row.hourly_rate * row.contracted_weekly_hours),
        roundMoney(row.ss_employee_contribution),
        roundMoney(row.ss_employer_contribution),
        roundMoney(row.ss_employee_contribution + row.ss_employer_contribution),
        roundMoney(row.mlf_contribution),
        roundMoney(row.net_payment),
        roundMoney(paidPreviouslyAmount),
        roundMoney(row.net_payment - paidPreviouslyAmount),
        roundMoney(row.my_cost_per_cheque),
        options.bankTransactionNumber || null,
        options.sourceFundsLabel || null,
        calcStatus,
        row.warnings.join('; '),
        reviewReason
    ];
    if (current.rows[0]?.id) {
        await client.query(`UPDATE payroll_month_results
       SET updated_at = NOW(),
           updated_by = 'issue_flow',
           employment_type_main = $5,
           weekly_hours_main = $6,
           pay_input_basis_main = $7,
           input_amount_main = $8,
           hourly_rate_main = $9,
           tax_status = $10,
           student_flag = $11,
           timesheet_required = $12,
           annual_vl_entitlement_hours = $13,
           annual_sl_entitlement_hours = $14,
           vl_taken_hours = $15,
           sl_taken_hours = $16,
           timesheet_work_hours = $17,
           banked_hours_closing = $18,
           gross_total = $19,
           normal_main_income = $20,
           tax_on_gross = $21,
           total_employee_tax = $22,
           ssc_weekly_wage_basis = $23,
           ssc_employee = $24,
           ssc_employer = $25,
           ssc_total = $26,
           mlf = $27,
           net_wage = $28,
           paid_previously_amount = $29,
           transaction_amount = $30,
           payslip_value = $31,
           transaction_number = $32,
           source_funds_label = $33,
           calc_status = $34,
           calc_notes = $35,
           review_reason = $36
       WHERE id = $1`, [current.rows[0].id, ...payload]);
        return Number(current.rows[0].id);
    }
    const inserted = await client.query(`INSERT INTO payroll_month_results (
       emp_id, payroll_type, period_year, period_month,
       employment_type_main, weekly_hours_main, pay_input_basis_main, input_amount_main, hourly_rate_main,
       tax_status, student_flag, timesheet_required, annual_vl_entitlement_hours, annual_sl_entitlement_hours,
       vl_taken_hours, sl_taken_hours, timesheet_work_hours, banked_hours_closing,
       gross_total, normal_main_income, tax_on_gross, total_employee_tax, ssc_weekly_wage_basis,
       ssc_employee, ssc_employer, ssc_total, mlf, net_wage, paid_previously_amount,
       transaction_amount, payslip_value, transaction_number, source_funds_label, calc_status, calc_notes, review_reason
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7, $8, $9,
       $10, $11, $12, $13, $14,
       $15, $16, $17, $18,
       $19, $20, $21, $22, $23,
       $24, $25, $26, $27, $28, $29,
       $30, $31, $32, $33, $34, $35, $36
     )
     RETURNING id`, payload);
    return Number(inserted.rows[0].id);
};
const syncPayrollHourSourcesAndDecisions = async (client, payrollResultId, payroll, period, row, detail) => {
    await client.query(`DELETE FROM payroll_hour_decisions
     WHERE payroll_result_id = $1`, [payrollResultId]);
    await client.query(`DELETE FROM payroll_hour_deficit_decisions
     WHERE payroll_result_id = $1`, [payrollResultId]);
    await client.query(`DELETE FROM payroll_hour_sources
     WHERE emp_id = $1
       AND payroll_type = $2
       AND period_year = $3
       AND period_month = $4`, [row.emp_id, payroll, period.year, period.month]);
    const calc = detail?.calculation || {};
    const banked = roundMoney(toNumber(calc.banked_hours_since_last_month));
    const extraHours = roundMoney(toNumber(calc.extra_under_hours));
    const overtimeHours = roundMoney(toNumber(calc.overtime_hours));
    const normalExtraPay = roundMoney(toNumber(calc.extra_under_amount));
    const overtimePay = roundMoney(toNumber(calc.overtime_amount));
    const insertSource = async (sourceType, direction, hoursValue) => {
        const inserted = await client.query(`INSERT INTO payroll_hour_sources (
         emp_id, payroll_type, period_year, period_month, source_type, direction, hours_value, origin, is_active, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'SYSTEM_RECALC',TRUE,'issue_flow')
       RETURNING id`, [row.emp_id, payroll, period.year, period.month, sourceType, direction, hoursValue]);
        return Number(inserted.rows[0].id);
    };
    if (banked !== 0) {
        await insertSource('BANKED', banked > 0 ? 'CREDIT' : 'DEFICIT', Math.abs(banked));
    }
    if (extraHours > 0) {
        const sourceId = await insertSource('EXTRA', 'CREDIT', extraHours);
        if (normalExtraPay > 0) {
            await client.query(`INSERT INTO payroll_hour_decisions (
           emp_id, payroll_type, period_year, period_month, payroll_result_id, hour_source_id,
           source_type, source_hours_available, hours_decided, action, rate_mode, hourly_rate_used,
           tax_path, pay_amount, tax_amount, affects_gross_total, affects_transaction_amount, affects_payslip_value,
           created_by, updated_by
         ) VALUES (
           $1,$2,$3,$4,$5,$6,
           'EXTRA',$7,$8,'PAY_NORMAL','NORMAL',$9,
           'NORMAL_PROGRESSIVE',$10,0,TRUE,TRUE,TRUE,
           'issue_flow','issue_flow'
         )`, [row.emp_id, payroll, period.year, period.month, payrollResultId, sourceId, extraHours, extraHours, row.hourly_rate, normalExtraPay]);
        }
    }
    else if (extraHours < 0) {
        const deficitHours = Math.abs(extraHours);
        const sourceId = await insertSource('UNDER_HOURS', 'DEFICIT', deficitHours);
        await client.query(`INSERT INTO payroll_hour_deficit_decisions (
         emp_id, payroll_type, period_year, period_month, payroll_result_id, hour_source_id,
         source_type, source_hours_deficit, hours_decided, action, hourly_rate_used, deduction_amount,
         affects_gross_total, affects_transaction_amount, affects_payslip_value, created_by, updated_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,
         'UNDER_HOURS',$7,$8,'DEDUCT_NOW',$9,$10,
         TRUE,TRUE,TRUE,'issue_flow','issue_flow'
       )`, [row.emp_id, payroll, period.year, period.month, payrollResultId, sourceId, deficitHours, deficitHours, row.hourly_rate, roundMoney(deficitHours * row.hourly_rate)]);
    }
    if (overtimeHours > 0) {
        const sourceId = await insertSource('OVERTIME', 'CREDIT', overtimeHours);
        await client.query(`INSERT INTO payroll_hour_decisions (
         emp_id, payroll_type, period_year, period_month, payroll_result_id, hour_source_id,
         source_type, source_hours_available, hours_decided, action, rate_mode, hourly_rate_used,
         overtime_multiplier_used, overtime_rate_used, tax_path, pay_amount, tax_amount,
         affects_overtime_pay, affects_transaction_amount, affects_payslip_value, created_by, updated_by
       ) VALUES (
         $1,$2,$3,$4,$5,$6,
         'OVERTIME',$7,$8,'PAY_OVERTIME','OVERTIME',$9,
         CASE WHEN $7 > 0 AND $9 > 0 THEN $10 / ($7 * $9) ELSE 0 END,$11,'OVERTIME_FINAL',$10,0,
         TRUE,TRUE,TRUE,'issue_flow','issue_flow'
       )`, [row.emp_id, payroll, period.year, period.month, payrollResultId, sourceId, overtimeHours, overtimeHours, row.hourly_rate, overtimePay, overtimePay > 0 && overtimeHours > 0 && row.hourly_rate > 0 ? (overtimePay / overtimeHours / row.hourly_rate) : 0, overtimePay > 0 && overtimeHours > 0 ? (overtimePay / overtimeHours) : 0]);
    }
};
const syncPayrollLeaveClassifications = async (client, payrollResultId, payroll, period, row) => {
    await client.query(`DELETE FROM payroll_leave_classifications
     WHERE payroll_result_id = $1`, [payrollResultId]);
    const leaveRows = await client.query(`SELECT work_date, hours, hour_type, COALESCE(leave_status, '') AS leave_status
     FROM timesheets
     WHERE emp_id = $1
       AND work_date >= $2::date
       AND work_date < ($3::date + INTERVAL '1 day')
       AND (
         hour_type IN ('VACATION_LEAVE', 'SICK_LEAVE', 'UNPAID_LEAVE')
         OR COALESCE(leave_status, '') = 'UNPAID'
       )
     ORDER BY work_date`, [row.emp_id, period.periodFrom, period.periodTo]);
    for (const leave of leaveRows.rows) {
        const hourType = cleanText(leave.hour_type).toUpperCase();
        const leaveStatus = cleanText(leave.leave_status).toUpperCase();
        let leaveSourceType = 'OTHER_LEAVE';
        let payrollLeaveClass = 'OTHER_PAID';
        let countsAsUnpaid = false;
        let countsForSsc = false;
        let reducesBonusDays = false;
        let affectsGrossDeduction = false;
        if (hourType === 'VACATION_LEAVE') {
            leaveSourceType = 'VL';
            payrollLeaveClass = leaveStatus === 'UNPAID' ? 'EXCESS_VL_UNPAID' : 'PAID_VL';
        }
        else if (hourType === 'SICK_LEAVE') {
            leaveSourceType = 'SL';
            payrollLeaveClass = leaveStatus === 'UNPAID' ? 'EXCESS_SL_UNPAID' : 'PAID_SL';
        }
        else if (hourType === 'UNPAID_LEAVE' || leaveStatus === 'UNPAID') {
            leaveSourceType = 'UNPAID';
            payrollLeaveClass = 'EXPLICIT_UNPAID';
        }
        if (payrollLeaveClass === 'EXPLICIT_UNPAID' || payrollLeaveClass === 'EXCESS_VL_UNPAID' || payrollLeaveClass === 'EXCESS_SL_UNPAID') {
            countsAsUnpaid = true;
            countsForSsc = true;
            reducesBonusDays = true;
            affectsGrossDeduction = true;
        }
        await client.query(`INSERT INTO payroll_leave_classifications (
         emp_id, payroll_type, period_year, period_month, payroll_result_id,
         leave_source_type, date_from, date_to, hours_value, payroll_leave_class,
         reduces_vl_entitlement, reduces_sl_entitlement, counts_as_unpaid_leave, counts_for_ssc_zero_week,
         reduces_bonus_eligible_days, affects_gross_deduction, hourly_rate_used, deduction_amount,
         created_by, updated_by, classification_reason
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6,$7::date,$7::date,$8,$9,
         $10,$11,$12,$13,
         $14,$15,$16,$17,
         'issue_flow','issue_flow',$18
       )`, [
            row.emp_id, payroll, period.year, period.month, payrollResultId,
            leaveSourceType, leave.work_date, toNumber(leave.hours), payrollLeaveClass,
            leaveSourceType === 'VL',
            leaveSourceType === 'SL',
            countsAsUnpaid,
            countsForSsc,
            reducesBonusDays,
            affectsGrossDeduction,
            row.hourly_rate,
            countsAsUnpaid ? roundMoney(toNumber(leave.hours) * row.hourly_rate) : 0,
            'Derived from timesheet leave rows during confirm'
        ]);
    }
};
const syncPayrollBonusAccruals = async (client, payrollResultId, payroll, period, row) => {
    await client.query(`DELETE FROM payroll_bonus_accruals
     WHERE payroll_result_id = $1`, [payrollResultId]);
    const monthKey = {
        3: 'MARCH',
        6: 'JUNE',
        9: 'SEPTEMBER',
        12: 'DECEMBER'
    }[period.month];
    if (!monthKey)
        return;
    const bonusRules = await client.query(`SELECT *
     FROM statutory_bonuses
     WHERE bonus_year = $1
       AND payment_month = $2
     ORDER BY id`, [period.year, monthKey]);
    if (!bonusRules.rows.length)
        return;
    const unpaidDaysResult = await client.query(`SELECT COUNT(DISTINCT work_date)::int AS unpaid_days
     FROM timesheets
     WHERE emp_id = $1
       AND work_date >= (SELECT MIN(accrual_period_from) FROM statutory_bonuses WHERE bonus_year = $2 AND payment_month = $3)
       AND work_date <= (SELECT MAX(accrual_period_to) FROM statutory_bonuses WHERE bonus_year = $2 AND payment_month = $3)
       AND (hour_type = 'UNPAID_LEAVE' OR COALESCE(leave_status, '') = 'UNPAID')`, [row.emp_id, period.year, monthKey]);
    const unpaidDays = Number(unpaidDaysResult.rows[0]?.unpaid_days || 0);
    const employeeDates = await client.query(`SELECT
       COALESCE(efp.start_date, et.date_first_employed) AS start_date,
       efp.termination_date AS termination_date
     FROM employees e
     LEFT JOIN employee_form_profile efp ON efp.emp_id = e.emp_id
     LEFT JOIN LATERAL (
       SELECT *
       FROM employee_employment_terms et
       WHERE et.emp_id = e.emp_id
       ORDER BY effective_from DESC
       LIMIT 1
     ) et ON TRUE
     WHERE e.emp_id = $1`, [row.emp_id]);
    const startDate = employeeDates.rows[0]?.start_date ? new Date(employeeDates.rows[0].start_date) : null;
    const terminationDate = employeeDates.rows[0]?.termination_date ? new Date(employeeDates.rows[0].termination_date) : null;
    for (const rule of bonusRules.rows) {
        const accrualFrom = new Date(rule.accrual_period_from);
        const accrualTo = new Date(rule.accrual_period_to);
        const effectiveStart = startDate && startDate > accrualFrom ? startDate : accrualFrom;
        const effectiveEnd = terminationDate && terminationDate < accrualTo ? terminationDate : accrualTo;
        const totalBonusDays = Math.max(0, Math.floor((accrualTo.getTime() - accrualFrom.getTime()) / 86400000) + 1);
        const daysOnPayroll = effectiveEnd >= effectiveStart ? Math.floor((effectiveEnd.getTime() - effectiveStart.getTime()) / 86400000) + 1 : 0;
        const eligibleBonusDays = Math.max(0, daysOnPayroll - unpaidDays);
        const statutoryBonusAmount = totalBonusDays > 0
            ? roundMoney(toNumber(rule.full_amount) * eligibleBonusDays / totalBonusDays)
            : 0;
        await client.query(`INSERT INTO payroll_bonus_accruals (
         emp_id, payroll_type, period_year, period_month, payroll_result_id,
         bonus_type, bonus_label, full_bonus_amount, accrual_from, accrual_to,
         total_bonus_days, days_on_payroll_in_accrual, unpaid_leave_days_in_accrual, eligible_bonus_days,
         statutory_bonus_amount, rule_version, created_by, updated_by, notes
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6,$7,$8,$9::date,$10::date,
         $11,$12,$13,$14,
         $15,'v1','issue_flow','issue_flow',$16
       )`, [
            row.emp_id, payroll, period.year, period.month, payrollResultId,
            `${rule.payment_month}_${rule.bonus_type}`,
            `${rule.payment_month} ${rule.bonus_type}`,
            toNumber(rule.full_amount),
            rule.accrual_period_from,
            rule.accrual_period_to,
            totalBonusDays,
            daysOnPayroll,
            unpaidDays,
            eligibleBonusDays,
            statutoryBonusAmount,
            'Derived from statutory_bonuses and unpaid leave within accrual window'
        ]);
    }
};
const syncPayrollSscZeroWeeks = async (client, payrollResultId, payroll, period, row) => {
    await client.query(`DELETE FROM payroll_ssc_zero_weeks
     WHERE payroll_result_id = $1`, [payrollResultId]);
    const weeklyHours = roundMoney(row.contracted_weekly_hours);
    if (weeklyHours <= 0)
        return;
    const weekRows = await client.query(`WITH day_rows AS (
       SELECT
         date_trunc('week', work_date::timestamp)::date AS week_from,
         work_date,
         SUM(CASE WHEN hour_type = 'UNPAID_LEAVE' OR COALESCE(leave_status, '') = 'UNPAID' THEN hours ELSE 0 END) AS unpaid_hours,
         SUM(CASE WHEN NOT (hour_type = 'UNPAID_LEAVE' OR COALESCE(leave_status, '') = 'UNPAID') THEN hours ELSE 0 END) AS paid_or_worked_hours
       FROM timesheets
       WHERE emp_id = $1
         AND work_date >= $2::date
         AND work_date < ($3::date + INTERVAL '1 day')
       GROUP BY date_trunc('week', work_date::timestamp)::date, work_date
     )
     SELECT
       week_from,
       (week_from + INTERVAL '6 days')::date AS week_to,
       COALESCE(SUM(unpaid_hours), 0) AS unpaid_hours,
       COALESCE(SUM(paid_or_worked_hours), 0) AS paid_or_worked_hours,
       COUNT(DISTINCT work_date) AS covered_days
     FROM day_rows
     GROUP BY week_from
     ORDER BY week_from`, [row.emp_id, period.periodFrom, period.periodTo]);
    for (const wk of weekRows.rows) {
        const unpaidHours = roundMoney(toNumber(wk.unpaid_hours));
        const paidOrWorkedHours = roundMoney(toNumber(wk.paid_or_worked_hours));
        const qualifies = paidOrWorkedHours === 0 && unpaidHours >= weeklyHours;
        if (!qualifies)
            continue;
        await client.query(`INSERT INTO payroll_ssc_zero_weeks (
         emp_id, payroll_type, period_year, period_month, payroll_result_id,
         week_from, week_to, ssc_zero_week, reason_type, days_covered, hours_covered,
         created_by, updated_by, is_active, system_note
       ) VALUES (
         $1,$2,$3,$4,$5,
         $6::date,$7::date,TRUE,'UNPAID_LEAVE',$8,$9,
         'issue_flow','issue_flow',TRUE,$10
       )`, [row.emp_id, payroll, period.year, period.month, payrollResultId, wk.week_from, wk.week_to, Number(wk.covered_days || 0), unpaidHours, 'Derived from full-week unpaid timesheet coverage']);
    }
};
const upsertPayrollLine = async (client, payrollEntryId, row) => {
    const existing = await client.query(`SELECT id FROM payroll_lines WHERE payroll_entry_id = $1 AND emp_id = $2 LIMIT 1`, [payrollEntryId, row.emp_id]);
    const params = [
        payrollEntryId,
        row.emp_id,
        row.hourly_rate,
        row.hours_worked,
        roundMoney(row.hourly_rate * row.contracted_weekly_hours),
        row.ss_employee_contribution,
        row.ss_employer_contribution,
        row.mlf_contribution,
        row.vl_pending,
        row.sl_pending,
        0,
        0,
        row.banked_hours_balance,
        0,
        0,
        row.gross_total,
        row.tax_rate_applied,
        row.tax_deduction,
        row.net_payment,
        row.total_deductions,
        row.ss_class_code || null,
        row.warnings.join('; ')
    ];
    if (existing.rows[0]?.id) {
        const payrollLineId = Number(existing.rows[0].id);
        await client.query(`UPDATE payroll_lines
       SET hourly_rate = $2,
           hours_worked = $3,
           weekly_wage = $4,
           ss_employee_contribution = $5,
           ss_employer_contribution = $6,
           mlf_contribution = $7,
           annual_leave_taken_hours = $8,
           sick_leave_taken_hours = $9,
           banked_hours_balance = $10,
           gross_earnings = $11,
           tax_rate_applied = $12,
           tax_deduction = $13,
           net_payment = $14,
           total_deductions = $15,
           ss_class_code = $16,
           notes = $17,
           updated_at = NOW()
        WHERE id = $1`, [
            payrollLineId,
            row.hourly_rate,
            row.hours_worked,
            roundMoney(row.hourly_rate * row.contracted_weekly_hours),
            row.ss_employee_contribution,
            row.ss_employer_contribution,
            row.mlf_contribution,
            row.vl_pending,
            row.sl_pending,
            row.banked_hours_balance,
            row.gross_total,
            row.tax_rate_applied,
            row.tax_deduction,
            row.net_payment,
            row.total_deductions,
            row.ss_class_code || null,
            row.warnings.join('; ')
        ]);
        return payrollLineId;
    }
    const inserted = await client.query(`INSERT INTO payroll_lines (
       payroll_entry_id,
       emp_id,
       hourly_rate,
       hours_worked,
       weekly_wage,
       ss_employee_contribution,
       ss_employer_contribution,
       mlf_contribution,
       annual_leave_taken_hours,
       sick_leave_taken_hours,
       unpaid_leave_hours,
       banked_hours_used,
       banked_hours_balance,
       extra_hours_worked,
       overtime_hours,
       gross_earnings,
       tax_rate_applied,
       tax_deduction,
       net_payment,
       total_deductions,
       ss_class_code,
       notes
      ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
      )
      RETURNING id`, params);
    return Number(inserted.rows[0].id);
};
const upsertPayslip = async (client, payrollEntryId, payrollLineId, payroll, period, row, status, bankTransactionNumber, sourceFundsLabel, paidPreviouslyAmount, reviewAdjustments) => {
    const payslipNumber = `${payroll}-${period.raw}-${row.emp_id}`;
    const paymentDate = lastFridayOfMonth(period.year, period.month);
    const existing = await client.query(`SELECT id FROM payslips WHERE payroll_entry_id = $1 AND emp_id = $2 LIMIT 1`, [payrollEntryId, row.emp_id]);
    if (existing.rows[0]?.id) {
        const payslipId = Number(existing.rows[0].id);
        await client.query(`UPDATE payslips
       SET payroll_line_id = $2,
           payslip_number = $3,
           issue_date = CURRENT_DATE,
           payment_date = $4::date,
           status = $5,
           bank_transaction_number = COALESCE($6, bank_transaction_number),
           source_funds_label = COALESCE($7, source_funds_label),
           paid_previously_amount = COALESCE($8, paid_previously_amount),
           review_adjustments = COALESCE($9::jsonb, review_adjustments),
           created_at = COALESCE(created_at, NOW())
       WHERE id = $1`, [payslipId, payrollLineId, payslipNumber, paymentDate, status, bankTransactionNumber ?? null, sourceFundsLabel ?? null, paidPreviouslyAmount ?? null, reviewAdjustments ? JSON.stringify(reviewAdjustments) : null]);
        return { payslipId, payslipNumber, paymentDate, status };
    }
    const inserted = await client.query(`INSERT INTO payslips (
       payroll_line_id,
       payroll_entry_id,
       emp_id,
       payslip_number,
       issue_date,
       payment_date,
       status,
       bank_transaction_number,
       source_funds_label,
       paid_previously_amount,
       review_adjustments
     ) VALUES ($1, $2, $3, $4, CURRENT_DATE, $5::date, $6, $7, $8, $9, $10::jsonb)
     RETURNING id`, [payrollLineId, payrollEntryId, row.emp_id, payslipNumber, paymentDate, status, bankTransactionNumber ?? null, sourceFundsLabel ?? null, paidPreviouslyAmount ?? null, reviewAdjustments ? JSON.stringify(reviewAdjustments) : null]);
    return {
        payslipId: Number(inserted.rows[0]?.id || 0),
        payslipNumber,
        paymentDate,
        status
    };
};
const updatePayslipDelivery = async (pg, payslipId, data) => {
    await pg.query(`UPDATE payslips
     SET status = $2,
         pdf_file_url = COALESCE($3, pdf_file_url),
         pdf_generated_at = CASE WHEN $3 IS NOT NULL THEN NOW() ELSE pdf_generated_at END,
         email_sent_at = CASE WHEN $4 THEN NOW() ELSE email_sent_at END
     WHERE id = $1`, [payslipId, data.status, data.pdfPath ?? null, !!data.emailedAt]);
};
export const handlePayrollDashboardOverviewRequest = async (pg, req, res) => {
    try {
        const period = parsePeriod(req.query.period);
        if (!period) {
            return res.status(400).json({ ok: false, error: 'period must be YYYY-MM' });
        }
        const payroll = parsePayroll(req.query.payroll);
        const rows = await buildRows(pg, payroll, period);
        const totals = rows.reduce((acc, row) => {
            acc.net += row.net_payment;
            acc.gross += row.gross_including_bonuses;
            acc.my_cost += row.my_cost_per_cheque;
            return acc;
        }, { net: 0, gross: 0, my_cost: 0 });
        return res.json({
            meta: {
                viewer: {
                    is_hr: false,
                    role: 'payroll'
                },
                selected_payroll: String(req.query.payroll || 'MAIN').trim().toUpperCase(),
                days_to_payday: daysUntil(lastFridayOfMonth(period.year, period.month)),
                payday_date: lastFridayOfMonth(period.year, period.month)
            },
            rows,
            totals: {
                net: roundMoney(totals.net),
                gross: roundMoney(totals.gross),
                my_cost: roundMoney(totals.my_cost)
            }
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ ok: false, error: message });
    }
};
export const handlePayrollDashboardStatusesRequest = async (pg, req, res) => {
    try {
        const period = parsePeriod(req.query.period);
        if (!period) {
            return res.status(400).json({ ok: false, error: 'period must be YYYY-MM' });
        }
        const payroll = parsePayroll(req.query.payroll);
        const payrollNumber = `${payroll}-${period.raw}`;
        const result = await pg.query(`SELECT
         ps.emp_id,
         ps.status,
         ps.issue_date,
         ps.email_sent_at
       FROM payslips ps
       JOIN payroll_entries pe
         ON pe.id = ps.payroll_entry_id
       WHERE pe.payroll_number = $1
       ORDER BY ps.emp_id, ps.id DESC`, [payrollNumber]);
        const byEmployee = new Map();
        for (const row of result.rows) {
            const empId = Number(row.emp_id);
            if (!Number.isInteger(empId) || byEmployee.has(empId))
                continue;
            byEmployee.set(empId, {
                status: cleanText(row.status).toUpperCase(),
                issue_date: toIsoDate(row.issue_date),
                email_sent_at: row.email_sent_at ? new Date(row.email_sent_at).toISOString() : null
            });
        }
        return res.json({
            ok: true,
            payroll,
            period: period.raw,
            statuses: Array.from(byEmployee.entries()).map(([emp_id, value]) => ({
                emp_id,
                ...value
            }))
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ ok: false, error: message });
    }
};
export const handlePayrollDashboardDetailRequest = async (pg, req, res) => {
    try {
        const period = parsePeriod(req.query.period);
        if (!period) {
            return res.status(400).json({ ok: false, error: 'period must be YYYY-MM' });
        }
        const payroll = parsePayroll(req.query.payroll);
        const empId = Number(req.query.emp_id);
        if (!Number.isInteger(empId) || empId <= 0) {
            return res.status(400).json({ ok: false, error: 'emp_id is required' });
        }
        const detail = await getPayrollDashboardDetail(pg, payroll, period, empId);
        if (!detail) {
            return res.status(404).json({ ok: false, error: 'Payroll row not found' });
        }
        return res.json({
            ok: true,
            period: period.raw,
            payroll,
            ...detail
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ ok: false, error: message });
    }
};
export const handlePayrollDashboardTimesheetReviewRequest = async (pg, req, res) => {
    try {
        const empId = Number(req.query.emp_id);
        const periodFrom = toIsoDate(req.query.period_from);
        const periodTo = toIsoDate(req.query.period_to);
        if (!Number.isInteger(empId) || empId <= 0) {
            return res.status(400).json({ ok: false, error: 'emp_id is required' });
        }
        if (!periodFrom || !periodTo) {
            return res.status(400).json({ ok: false, error: 'period_from and period_to are required' });
        }
        const [employeeResult, timesheetResult, conflictResult, eventSummaryResult] = await Promise.all([
            pg.query(`SELECT emp_id, first_name, surname, designation, department
         FROM vw_employee_current
         WHERE emp_id = $1
         LIMIT 1`, [empId]),
            pg.query(`SELECT id, emp_id, work_date, hours, hour_type, leave_status, source, notes
         FROM timesheets
         WHERE emp_id = $1
           AND work_date >= $2::date
           AND work_date <= $3::date
         ORDER BY work_date, id`, [empId, periodFrom, periodTo]),
            pg.query(`SELECT id, emp_id, work_date, existing_hours, imported_hours, status, source_system, notes, created_at
         FROM timesheet_import_conflicts
         WHERE emp_id = $1
           AND work_date >= $2::date
           AND work_date <= $3::date
         ORDER BY work_date, created_at`, [empId, periodFrom, periodTo]),
            pg.query(`SELECT COUNT(*) AS event_count, MAX(updated_at) AS last_import_at
         FROM timesheet_events
         WHERE employee_id = $1
           AND event_datetime >= $2::date
           AND event_datetime < ($3::date + INTERVAL '1 day')`, [empId, periodFrom, periodTo])
        ]);
        const timesheetRows = timesheetResult.rows.map((row) => ({
            id: Number(row.id),
            emp_id: Number(row.emp_id),
            work_date: toIsoDate(row.work_date),
            hours: roundMoney(toNumber(row.hours)),
            hour_type: cleanText(row.hour_type),
            leave_status: cleanText(row.leave_status),
            source: cleanText(row.source),
            notes: cleanText(row.notes)
        }));
        return res.json({
            ok: true,
            employee: employeeResult.rows[0] || { emp_id: empId },
            period_from: periodFrom,
            period_to: periodTo,
            timesheet_rows: timesheetRows,
            leave_logs: timesheetRows.filter((row) => row.hour_type !== 'WORK'),
            conflicts: conflictResult.rows.map((row) => ({
                id: Number(row.id),
                work_date: toIsoDate(row.work_date),
                existing_hours: roundMoney(toNumber(row.existing_hours)),
                imported_hours: roundMoney(toNumber(row.imported_hours)),
                status: cleanText(row.status),
                source_system: cleanText(row.source_system),
                notes: cleanText(row.notes),
                created_at: row.created_at ? new Date(row.created_at).toISOString() : null
            })),
            summary: {
                event_count: Number(eventSummaryResult.rows[0]?.event_count || 0),
                last_import_at: eventSummaryResult.rows[0]?.last_import_at
                    ? new Date(eventSummaryResult.rows[0].last_import_at).toISOString()
                    : null
            }
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ ok: false, error: message });
    }
};
export const handlePayrollDashboardTimesheetSaveRequest = async (pg, req, res) => {
    const empId = Number(req.body?.emp_id);
    const periodFrom = toIsoDate(req.body?.period_from);
    const periodTo = toIsoDate(req.body?.period_to);
    if (!Number.isInteger(empId) || empId <= 0) {
        return res.status(400).json({ ok: false, error: 'emp_id is required' });
    }
    if (!periodFrom || !periodTo) {
        return res.status(400).json({ ok: false, error: 'period_from and period_to are required' });
    }
    const csvRows = parseTimesheetCsv(cleanText(req.body?.csv_text));
    const payloadRows = parseEditableTimesheetRows(req.body?.rows);
    const finalRows = [...payloadRows, ...csvRows]
        .filter((row) => row.work_date >= periodFrom && row.work_date <= periodTo)
        .filter((row) => row.hours > 0);
    try {
        const client = await pg.connect();
        try {
            await client.query('BEGIN');
            await client.query(`DELETE FROM timesheets
         WHERE emp_id = $1
           AND work_date >= $2::date
           AND work_date <= $3::date`, [empId, periodFrom, periodTo]);
            await client.query(`DELETE FROM timesheet_import_conflicts
         WHERE emp_id = $1
           AND work_date >= $2::date
           AND work_date <= $3::date`, [empId, periodFrom, periodTo]);
            if (finalRows.length) {
                const params = [];
                const values = [];
                for (const row of finalRows) {
                    const base = params.length;
                    values.push(`($${base + 1}, $${base + 2}::date, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, NOW(), NOW(), 'payroll-ui', 'payroll')`);
                    params.push(empId, row.work_date, row.hours, row.hour_type, row.leave_status, 'PayrollReview', row.notes);
                }
                await client.query(`INSERT INTO timesheets
             (emp_id, work_date, hours, hour_type, leave_status, source, notes, created_at, updated_at, imported_by, imported_by_role)
           VALUES ${values.join(',')}`, params);
            }
            await client.query('COMMIT');
            return res.json({
                ok: true,
                emp_id: empId,
                period_from: periodFrom,
                period_to: periodTo,
                saved_rows: finalRows.length,
                message: `Saved ${finalRows.length} reviewed timesheet row(s).`
            });
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ ok: false, error: message });
    }
};
export const handlePayrollDashboardIssueRequest = async (pg, req, res) => {
    const period = parsePeriod(req.body?.period);
    if (!period) {
        return res.status(400).json({ ok: false, error: 'period must be YYYY-MM' });
    }
    const payroll = parsePayroll(req.body?.payroll);
    const action = String(req.body?.action || '').trim();
    const hourlyRateOverride = req.body?.hourly_rate_override === undefined || req.body?.hourly_rate_override === null || req.body?.hourly_rate_override === ''
        ? null
        : Number(req.body?.hourly_rate_override);
    const bankTransactionNumber = cleanText(req.body?.bank_transaction_number);
    const sourceFundsLabel = cleanText(req.body?.source_funds_label);
    const paidPreviouslyAmount = req.body?.paid_previously_amount === undefined || req.body?.paid_previously_amount === null || req.body?.paid_previously_amount === ''
        ? null
        : roundMoney(toNumber(req.body?.paid_previously_amount));
    const reviewAdjustments = req.body?.review_adjustments && typeof req.body.review_adjustments === 'object'
        ? req.body.review_adjustments
        : null;
    const employeeIds = Array.isArray(req.body?.employee_ids)
        ? req.body.employee_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
        : [];
    if (!employeeIds.length) {
        return res.status(400).json({ ok: false, error: 'employee_ids are required' });
    }
    try {
        if (payroll === 'MAIN' && employeeIds.length === 1 && Number.isFinite(hourlyRateOverride) && Number(hourlyRateOverride) > 0) {
            await upsertMainHourlyRateOverride(pg, employeeIds[0], period, Number(hourlyRateOverride));
        }
        const rows = await loadRowsByEmployee(pg, payroll, period, employeeIds);
        if (!rows.length) {
            return res.status(404).json({ ok: false, error: 'No payroll rows found for selection' });
        }
        const client = await pg.connect();
        try {
            await client.query('BEGIN');
            const { payrollEntryId, payrollNumber } = await upsertPayrollEntry(client, payroll, period, rows);
            let missingEmailCount = 0;
            const savedRows = [];
            for (const row of rows) {
                if (!row.email) {
                    missingEmailCount += 1;
                }
                const detail = payroll === 'MAIN'
                    ? await getPayrollDashboardDetail(pg, payroll, period, row.emp_id)
                    : null;
                const payrollMonthResultId = await upsertPayrollMonthResult(client, payroll, period, row, {
                    bankTransactionNumber: bankTransactionNumber || null,
                    sourceFundsLabel: sourceFundsLabel || null,
                    paidPreviouslyAmount,
                    reviewAdjustments,
                    calcStatus: 'CONFIRMED'
                });
                if (payroll === 'MAIN' && detail) {
                    await syncPayrollHourSourcesAndDecisions(client, payrollMonthResultId, payroll, period, row, detail);
                    await syncPayrollLeaveClassifications(client, payrollMonthResultId, payroll, period, row);
                    await syncPayrollBonusAccruals(client, payrollMonthResultId, payroll, period, row);
                    await syncPayrollSscZeroWeeks(client, payrollMonthResultId, payroll, period, row);
                }
                const payrollLineId = await upsertPayrollLine(client, payrollEntryId, row);
                const payslip = await upsertPayslip(client, payrollEntryId, payrollLineId, payroll, period, row, 'ISSUED', bankTransactionNumber || null, sourceFundsLabel || null, paidPreviouslyAmount, reviewAdjustments);
                savedRows.push({ row, payslip });
            }
            await client.query('COMMIT');
            let scheduledEmailCount = 0;
            let printPendingCount = 0;
            const deliveryErrors = [];
            for (const item of savedRows) {
                try {
                    const pdfPath = await renderPayslipPdf(pg, item.row, payroll, period, item.payslip.payslipNumber, item.payslip.paymentDate);
                    if (payroll === 'MAIN') {
                        await updatePayslipDelivery(pg, item.payslip.payslipId, { status: 'ISSUED', pdfPath, emailedAt: false });
                        scheduledEmailCount += 1;
                    }
                    else {
                        await updatePayslipDelivery(pg, item.payslip.payslipId, { status: 'ISSUED', pdfPath, emailedAt: false });
                        printPendingCount += 1;
                    }
                }
                catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    deliveryErrors.push(`${item.row.emp_id}: ${message}`);
                }
            }
            const scheduledEmailAt = payroll === 'MAIN' ? scheduledEmailAtForPeriod(period) : null;
            return res.json({
                ok: true,
                payroll_entry_id: payrollEntryId,
                payroll_number: payrollNumber,
                processed_count: rows.length,
                message: payroll === 'MAIN'
                    ? `Saved ${rows.length} payslip record(s). Email is scheduled for ${scheduledEmailAt}.`
                    : `Saved ${rows.length} payslip record(s). ${printPendingCount} print job(s) pending with 2 copies each.`,
                missing_email_count: missingEmailCount,
                delivery_method: payroll === 'MAIN' ? 'EMAIL_SCHEDULED' : 'PRINT_2_COPIES',
                scheduled_email_at: scheduledEmailAt,
                scheduled_email_count: scheduledEmailCount,
                print_pending_count: printPendingCount,
                print_copy_count: payroll === 'MAIN' ? 0 : 2,
                bank_transaction_number: bankTransactionNumber || null,
                source_funds_label: sourceFundsLabel || null,
                paid_previously_amount: paidPreviouslyAmount,
                review_adjustments: reviewAdjustments,
                delivery_errors: deliveryErrors
            });
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ ok: false, error: message });
    }
};
export const handlePayrollDashboardRateUpdateRequest = async (pg, req, res) => {
    const period = parsePeriod(req.body?.period);
    if (!period) {
        return res.status(400).json({ ok: false, error: 'period must be YYYY-MM' });
    }
    const payroll = parsePayroll(req.body?.payroll);
    if (payroll !== 'MAIN') {
        return res.status(400).json({ ok: false, error: 'Hourly rate updates are only supported for MAIN payroll.' });
    }
    const empId = Number(req.body?.emp_id);
    const hourlyRate = Number(req.body?.hourly_rate);
    if (!Number.isInteger(empId) || empId <= 0) {
        return res.status(400).json({ ok: false, error: 'emp_id is required' });
    }
    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
        return res.status(400).json({ ok: false, error: 'hourly_rate must be greater than zero' });
    }
    try {
        await upsertMainHourlyRateOverride(pg, empId, period, hourlyRate);
        const detail = await getPayrollDashboardDetail(pg, payroll, period, empId);
        return res.json({
            ok: true,
            message: `Hourly rate updated to ${roundMoney(hourlyRate).toFixed(2)}.`,
            detail
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ ok: false, error: message });
    }
};
export const handlePayrollFs3EmailRequest = async (pg, req, res) => {
    const year = Number(req.body?.year);
    const employeeIds = Array.isArray(req.body?.employee_ids)
        ? req.body.employee_ids.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0)
        : [];
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
        return res.status(400).json({ ok: false, error: 'year is required' });
    }
    if (!employeeIds.length) {
        return res.status(400).json({ ok: false, error: 'employee_ids are required' });
    }
    try {
        const rows = await pg.query(`SELECT
         ec.emp_id,
         ec.surname,
         ec.first_name,
         COALESCE(NULLIF(TRIM(ec.position_held), ''), '') AS designation,
         COALESCE(NULLIF(TRIM(ec.department_code), ''), '') AS department,
         COALESCE(NULLIF(TRIM(ec.email), ''), '') AS email,
         COALESCE(SUM(pl.gross_earnings), 0) AS gross,
         COALESCE(SUM(pl.tax_deduction), 0) AS tax,
         COALESCE(SUM(pl.net_payment), 0) AS net
       FROM vw_employee_current ec
       LEFT JOIN payroll_lines pl
         ON pl.emp_id = ec.emp_id
       LEFT JOIN payroll_entries pe
         ON pe.id = pl.payroll_entry_id
        AND pe.payroll_year = $1
       WHERE ec.emp_id = ANY($2::int[])
       GROUP BY ec.emp_id, ec.surname, ec.first_name, ec.position_held, ec.department_code, ec.email
       ORDER BY ec.emp_id`, [year, employeeIds]);
        const sent = [];
        const failed = [];
        for (const record of rows.rows) {
            const row = {
                emp_id: Number(record.emp_id),
                surname: cleanText(record.surname),
                first_name: cleanText(record.first_name),
                designation: cleanText(record.designation),
                department: cleanText(record.department),
                employment_type: '',
                provider_subscription_exists: false,
                timesheet_required: false,
                period_from: `${year}-01-01`,
                period_to: `${year}-12-31`,
                timesheet_acquired: 'FS3',
                last_timesheet_import: null,
                hourly_rate: 0,
                contracted_weekly_hours: 0,
                net_payment: roundMoney(toNumber(record.net)),
                gross_including_bonuses: roundMoney(toNumber(record.gross)),
                gross_total: roundMoney(toNumber(record.gross)),
                my_cost_per_cheque: roundMoney(toNumber(record.gross)),
                vl_taken_ytd: 0,
                vl_taken_period: 0,
                vl_pending: 0,
                vl_warning: '',
                sl_taken_ytd: 0,
                sl_taken_period: 0,
                sl_pending: 0,
                sl_warning: '',
                banked_hours_balance: 0,
                warnings: [],
                hours_worked: 0,
                tax_rate_applied: 0,
                tax_deduction: roundMoney(toNumber(record.tax)),
                ss_class_code: '',
                ss_employee_contribution: 0,
                ss_employer_contribution: 0,
                mlf_contribution: 0,
                total_deductions: roundMoney(toNumber(record.tax)),
                email: cleanText(record.email)
            };
            if (!row.email) {
                failed.push(`${row.emp_id}: missing email`);
                continue;
            }
            try {
                const pdfPath = await renderFs3Pdf(row, year, {
                    gross: row.gross_including_bonuses,
                    tax: row.tax_deduction,
                    net: row.net_payment
                });
                await sendFs3Email(row, year, pdfPath);
                sent.push(row.emp_id);
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                failed.push(`${row.emp_id}: ${message}`);
            }
        }
        return res.json({
            ok: true,
            year,
            sent_count: sent.length,
            sent_employee_ids: sent,
            failed
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ ok: false, error: message });
    }
};
export const handlePayrollDashboardExportRequest = async (pg, req, res) => {
    try {
        const period = parsePeriod(req.query.period);
        if (!period) {
            return res.status(400).json({ ok: false, error: 'period must be YYYY-MM' });
        }
        const payroll = parsePayroll(req.query.payroll);
        const rows = await buildRows(pg, payroll, period);
        const csvLines = [
            [
                'emp_id',
                'surname',
                'first_name',
                'designation',
                'department',
                'period_from',
                'period_to',
                'timesheet_acquired',
                'hourly_rate',
                'gross_basic_pay',
                'gross_total',
                'tax_deduction',
                'ssc_employee',
                'ssc_employer',
                'mlf_contribution',
                'total_deductions',
                'net_payment',
                'my_cost_per_cheque',
                'vl_pending',
                'sl_pending',
                'banked_hours_balance',
                'warnings'
            ].join(',')
        ];
        for (const row of rows) {
            csvLines.push([
                row.emp_id,
                row.surname,
                row.first_name,
                row.designation,
                row.department,
                row.period_from,
                row.period_to,
                row.timesheet_acquired,
                row.hourly_rate,
                row.gross_including_bonuses,
                row.gross_total,
                row.tax_deduction,
                row.ss_employee_contribution,
                row.ss_employer_contribution,
                row.mlf_contribution,
                row.total_deductions,
                row.net_payment,
                row.my_cost_per_cheque,
                row.vl_pending,
                row.sl_pending,
                row.banked_hours_balance,
                row.warnings.join('; ')
            ].map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','));
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="payroll-${payroll.toLowerCase()}-${period.raw}.csv"`);
        return res.send(csvLines.join('\n'));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ ok: false, error: message });
    }
};
