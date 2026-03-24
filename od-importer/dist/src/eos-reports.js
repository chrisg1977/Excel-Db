import { randomUUID } from 'node:crypto';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPORTED_REPORT_TYPES = new Set(['standard', 'management_exception']);
const SUPPORTED_WALKOUT_STATUSES = new Set(['printed', 'not_printed', 'unknown']);
const EOS_ACCOUNTING_TIMEZONE = 'Europe/Malta';
const REPORT_HEADER_LIST_FILTER_SQL = `
  WHERE 1 = 1
    AND ($1::uuid IS NULL OR h.accounting_period_id = $1)
    AND ($2::text IS NULL OR h.clinic_code = $2)
    AND ($3::text IS NULL OR h.department_code = $3)
    AND ($4::text IS NULL OR h.location_code = $4)
    AND ($5::uuid IS NULL OR h.shift_session_id = $5)
    AND ($6::text IS NULL OR h.generated_by = $6)
    AND ($7::text IS NULL OR h.report_type = $7)
    AND ($8::text IS NULL OR h.status = $8)
    AND ($9::timestamptz IS NULL OR h.report_start_at >= $9)
    AND ($10::timestamptz IS NULL OR h.report_start_at < $10)
`;
class ApiRequestError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
const getRequestBodyRecord = (req) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ApiRequestError(400, 'Request body must be a JSON object');
    }
    return body;
};
const normalizeRequiredText = (value, key) => {
    if (typeof value !== 'string' || !value.trim()) {
        throw new ApiRequestError(400, `${key} is required`);
    }
    return value.trim();
};
const normalizeRequiredCode = (value, key) => {
    return normalizeRequiredText(value, key).toUpperCase();
};
const normalizeRequiredUuid = (value, key) => {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
        throw new ApiRequestError(400, `${key} must be a valid UUID`);
    }
    return value.trim();
};
const normalizeOptionalUuid = (value, key) => {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
        throw new ApiRequestError(400, `${key} must be a valid UUID when provided`);
    }
    return value.trim();
};
const normalizeRequiredDateTime = (value, key) => {
    const text = normalizeRequiredText(value, key);
    if (!Number.isFinite(Date.parse(text))) {
        throw new ApiRequestError(400, `${key} must be a valid datetime`);
    }
    return text;
};
const normalizeOptionalDateTime = (value, key) => {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    const text = String(value).trim();
    if (!text || !Number.isFinite(Date.parse(text))) {
        throw new ApiRequestError(400, `${key} must be a valid datetime when provided`);
    }
    return text;
};
const normalizeOptionalText = (value) => {
    if (value === undefined || value === null) {
        return null;
    }
    const normalized = String(value).trim();
    return normalized ? normalized : null;
};
const normalizeOptionalCode = (value) => {
    const normalized = normalizeOptionalText(value);
    return normalized ? normalized.toUpperCase() : null;
};
const normalizeRequiredNumber = (value, key) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new ApiRequestError(400, `${key} must be numeric`);
    }
    return Number(parsed.toFixed(2));
};
const normalizeRequiredInteger = (value, key) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) {
        throw new ApiRequestError(400, `${key} must be an integer`);
    }
    return parsed;
};
const normalizeOptionalNonNegativeInteger = (value, key, defaultValue, maxValue) => {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new ApiRequestError(400, `${key} must be a non-negative integer`);
    }
    return Math.min(parsed, maxValue);
};
const normalizeRequiredBoolean = (value, key) => {
    if (typeof value !== 'boolean') {
        throw new ApiRequestError(400, `${key} must be a boolean`);
    }
    return value;
};
const parseReportSummaryPayload = (value) => {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new ApiRequestError(400, 'summary must be an object when provided');
    }
    const summary = value;
    return {
        opening_cash: normalizeRequiredNumber(summary.opening_cash, 'summary.opening_cash'),
        payment_total: normalizeRequiredNumber(summary.payment_total, 'summary.payment_total'),
        cash_envelope_total: normalizeRequiredNumber(summary.cash_envelope_total, 'summary.cash_envelope_total'),
        cashbox_expenses_total: normalizeRequiredNumber(summary.cashbox_expenses_total, 'summary.cashbox_expenses_total'),
        sell_total: normalizeRequiredNumber(summary.sell_total, 'summary.sell_total'),
        fee_total: normalizeRequiredNumber(summary.fee_total, 'summary.fee_total'),
        expected_total: normalizeRequiredNumber(summary.expected_total, 'summary.expected_total'),
        actual_total: normalizeRequiredNumber(summary.actual_total, 'summary.actual_total'),
        discrepancy_total: normalizeRequiredNumber(summary.discrepancy_total, 'summary.discrepancy_total'),
        manager_alert_created: normalizeRequiredBoolean(summary.manager_alert_created, 'summary.manager_alert_created')
    };
};
const normalizeReportType = (value) => {
    const reportType = normalizeRequiredText(value, 'report_type').toLowerCase();
    if (!SUPPORTED_REPORT_TYPES.has(reportType)) {
        throw new ApiRequestError(400, 'report_type is not supported');
    }
    return reportType;
};
const normalizeOptionalReportType = (value) => {
    const normalized = normalizeOptionalText(value)?.toLowerCase() || null;
    if (!normalized) {
        return null;
    }
    if (!SUPPORTED_REPORT_TYPES.has(normalized)) {
        throw new ApiRequestError(400, 'report_type is not supported');
    }
    return normalized;
};
const normalizeWalkoutStatus = (value, key) => {
    const walkoutStatus = normalizeRequiredText(value, key).toLowerCase();
    if (!SUPPORTED_WALKOUT_STATUSES.has(walkoutStatus)) {
        throw new ApiRequestError(400, `${key} is not supported`);
    }
    return walkoutStatus;
};
const parseReportRowsPayload = (value) => {
    if (value === undefined || value === null) {
        return [];
    }
    if (!Array.isArray(value)) {
        throw new ApiRequestError(400, 'rows must be an array when provided');
    }
    return value.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            throw new ApiRequestError(400, `rows[${index}] must be an object`);
        }
        const row = entry;
        return {
            patient_visit_key: normalizeRequiredText(row.patient_visit_key, `rows[${index}].patient_visit_key`),
            patient_number: normalizeRequiredText(row.patient_number, `rows[${index}].patient_number`),
            surname: normalizeRequiredText(row.surname, `rows[${index}].surname`),
            name: normalizeRequiredText(row.name, `rows[${index}].name`),
            provider: normalizeRequiredText(row.provider, `rows[${index}].provider`),
            treatments: normalizeRequiredText(row.treatments, `rows[${index}].treatments`),
            fee_total: normalizeRequiredNumber(row.fee_total, `rows[${index}].fee_total`),
            appointment_datetime: normalizeRequiredDateTime(row.appointment_datetime, `rows[${index}].appointment_datetime`),
            appointment_dismissed_at: normalizeOptionalDateTime(row.appointment_dismissed_at, `rows[${index}].appointment_dismissed_at`),
            walkout_issued_at: normalizeOptionalDateTime(row.walkout_issued_at, `rows[${index}].walkout_issued_at`),
            walkout_status: normalizeWalkoutStatus(row.walkout_status, `rows[${index}].walkout_status`),
            included: normalizeRequiredBoolean(row.included, `rows[${index}].included`),
            carry_forward: normalizeRequiredBoolean(row.carry_forward, `rows[${index}].carry_forward`),
            display_order: normalizeRequiredInteger(row.display_order, `rows[${index}].display_order`)
        };
    });
};
const parseReportHeaderPayload = (req) => {
    const payload = getRequestBodyRecord(req);
    const report_start_at = normalizeRequiredDateTime(payload.report_start_at, 'report_start_at');
    const report_end_at = normalizeRequiredDateTime(payload.report_end_at, 'report_end_at');
    if (Date.parse(report_end_at) < Date.parse(report_start_at)) {
        throw new ApiRequestError(400, 'report_end_at must be greater than or equal to report_start_at');
    }
    return {
        shift_session_id: normalizeRequiredUuid(payload.shift_session_id, 'shift_session_id'),
        location_code: normalizeRequiredCode(payload.location_code, 'location_code'),
        department_code: normalizeRequiredCode(payload.department_code, 'department_code'),
        clinic_code: normalizeRequiredCode(payload.clinic_code, 'clinic_code'),
        report_start_at,
        report_end_at,
        report_type: normalizeReportType(payload.report_type),
        generated_by: normalizeRequiredText(payload.generated_by, 'generated_by'),
        rows: parseReportRowsPayload(payload.rows),
        summary: parseReportSummaryPayload(payload.summary)
    };
};
const parseReportListFilters = (req) => {
    const query = req.query;
    return {
        accounting_period_id: normalizeOptionalUuid(query.accounting_period_id, 'accounting_period_id'),
        clinic_code: normalizeOptionalCode(query.clinic_code),
        department_code: normalizeOptionalCode(query.department_code),
        location_code: normalizeOptionalCode(query.location_code),
        shift_session_id: normalizeOptionalUuid(query.shift_session_id, 'shift_session_id'),
        generated_by: normalizeOptionalText(query.generated_by),
        report_type: normalizeOptionalReportType(query.report_type),
        status: normalizeOptionalText(query.status)?.toLowerCase() || null,
        report_start_at_from: normalizeOptionalDateTime(query.report_start_at_from, 'report_start_at_from'),
        report_start_at_to: normalizeOptionalDateTime(query.report_start_at_to, 'report_start_at_to'),
        limit: normalizeOptionalNonNegativeInteger(query.limit, 'limit', 100, 500),
        offset: normalizeOptionalNonNegativeInteger(query.offset, 'offset', 0, 100000)
    };
};
const loadShiftSessionById = async (client, shiftSessionId) => {
    const result = await client.query(`
      SELECT id::text AS id
      FROM eos_shift_session
      WHERE id = $1
      LIMIT 1
    `, [shiftSessionId]);
    return result.rows[0] ?? null;
};
const loadAccountingPeriodContaining = async (client, atDateTime) => {
    const result = await client.query(`
      SELECT
        id::text AS id,
        period_code,
        is_closed
      FROM eos_accounting_period
      WHERE (($1::timestamptz AT TIME ZONE $2)::date BETWEEN start_date AND end_date)
      ORDER BY start_date DESC
      LIMIT 1
    `, [atDateTime, EOS_ACCOUNTING_TIMEZONE]);
    return result.rows[0] ?? null;
};
const buildReportListFilterParams = (filters) => [
    filters.accounting_period_id,
    filters.clinic_code,
    filters.department_code,
    filters.location_code,
    filters.shift_session_id,
    filters.generated_by,
    filters.report_type,
    filters.status,
    filters.report_start_at_from,
    filters.report_start_at_to
];
const listReportHeaders = async (client, filters) => {
    const filterValues = buildReportListFilterParams(filters);
    const result = await client.query(`
      SELECT
        h.id::text AS report_header_id,
        h.shift_session_id::text AS shift_session_id,
        h.location_code,
        h.clinic_code,
        h.department_code,
        h.report_start_at::text AS report_start_at,
        h.report_end_at::text AS report_end_at,
        h.generated_at::text AS generated_at,
        h.generated_by,
        h.report_type,
        h.status,
        h.accounting_period_id::text AS accounting_period_id,
        COALESCE(ABS(rs.discrepancy_total) > 0.00001, FALSE) AS discrepancy_present,
        COALESCE(rs.manager_alert_created, FALSE) AS manager_alert_created,
        COALESCE(ss.status = 'temporary_closed_pending_review', FALSE) AS temporary_closed_pending_review,
        COALESCE(
          ss.status IN (
            'temporary_closed_pending_review',
            'temporary_handover_started',
            'manager_review_required'
          ),
          FALSE
        ) AS unresolved_review_pending
      FROM eos_report_header h
      LEFT JOIN eos_report_summary rs
        ON rs.report_header_id = h.id
      LEFT JOIN eos_shift_session ss
        ON ss.id = h.shift_session_id
      ${REPORT_HEADER_LIST_FILTER_SQL}
      ORDER BY h.generated_at DESC, h.id DESC
      LIMIT $11 OFFSET $12
    `, [
        ...filterValues,
        filters.limit,
        filters.offset
    ]);
    return result.rows;
};
const countReportHeaders = async (client, filters) => {
    const filterValues = buildReportListFilterParams(filters);
    const result = await client.query(`
      SELECT COUNT(*)::int AS total_count
      FROM eos_report_header h
      ${REPORT_HEADER_LIST_FILTER_SQL}
    `, filterValues);
    return result.rows[0] ? Number(result.rows[0].total_count || 0) : 0;
};
const loadReportHeaderSnapshot = async (client, reportHeaderId) => {
    const result = await client.query(`
      SELECT *
      FROM eos_report_header
      WHERE id = $1
      LIMIT 1
    `, [reportHeaderId]);
    const row = result.rows[0];
    if (!row) {
        return null;
    }
    return {
        report_header_id: row.id,
        shift_session_id: row.shift_session_id,
        location_code: row.location_code,
        clinic_code: row.clinic_code,
        department_code: row.department_code,
        report_start_at: row.report_start_at,
        report_end_at: row.report_end_at,
        generated_at: row.generated_at,
        generated_by: row.generated_by,
        report_type: row.report_type,
        status: row.status,
        accounting_period_id: row.accounting_period_id
    };
};
const loadReportRowsSnapshot = async (client, reportHeaderId) => {
    const result = await client.query(`
      SELECT
        id::text AS id,
        report_header_id::text AS report_header_id,
        patient_visit_key,
        patient_number,
        surname,
        name,
        provider,
        treatments,
        fee_total,
        appointment_datetime::text AS appointment_datetime,
        appointment_dismissed_at::text AS appointment_dismissed_at,
        walkout_issued_at::text AS walkout_issued_at,
        walkout_status,
        included,
        carry_forward,
        display_order
      FROM eos_report_row
      WHERE report_header_id = $1
      ORDER BY display_order ASC, appointment_datetime ASC, id ASC
    `, [reportHeaderId]);
    return result.rows;
};
const loadReportSummarySnapshot = async (client, reportHeaderId) => {
    const result = await client.query(`
      SELECT *
      FROM eos_report_summary
      WHERE report_header_id = $1
    `, [reportHeaderId]);
    return result.rows[0] ?? null;
};
const loadReportAuditSnapshot = async (client, reportHeaderId) => {
    const result = await client.query(`
      SELECT *
      FROM eos_report_audit
      WHERE report_header_id = $1
      ORDER BY acted_at ASC, id ASC
    `, [reportHeaderId]);
    return result.rows.map((row) => ({
        id: row.id,
        report_header_id: row.report_header_id,
        action: row.action,
        field_name: row.field_name,
        old_value: row.old_value,
        new_value: row.new_value,
        acted_at: row.acted_at,
        acted_by: row.acted_by,
        reason: row.reason ?? null
    }));
};
const insertReportHeader = async (client, payload, accountingPeriodId) => {
    const reportHeaderId = randomUUID();
    const result = await client.query(`
      INSERT INTO eos_report_header (
        id,
        accounting_period_id,
        shift_session_id,
        location_code,
        department_code,
        clinic_code,
        report_start_at,
        report_end_at,
        generated_at,
        generated_by,
        report_type,
        status
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7::timestamptz,
        $8::timestamptz,
        NOW(),
        $9,
        $10,
        'draft'
      )
      RETURNING
        id::text AS report_header_id,
        accounting_period_id::text AS accounting_period_id,
        generated_at::text AS generated_at
    `, [
        reportHeaderId,
        accountingPeriodId,
        payload.shift_session_id,
        payload.location_code,
        payload.department_code,
        payload.clinic_code,
        payload.report_start_at,
        payload.report_end_at,
        payload.generated_by,
        payload.report_type
    ]);
    return result.rows[0];
};
const insertReportRows = async (client, reportHeaderId, rows) => {
    if (!rows.length) {
        return 0;
    }
    // Persist the grouped visit snapshot exactly as supplied for this report.
    // Walkout enrichment remains outside this write path for now.
    const values = [];
    const rowSql = rows.map((row, index) => {
        const base = index * 16;
        values.push(randomUUID(), reportHeaderId, row.patient_visit_key, row.patient_number, row.surname, row.name, row.provider, row.treatments, row.fee_total, row.appointment_datetime, row.appointment_dismissed_at, row.walkout_issued_at, row.walkout_status, row.included, row.carry_forward, row.display_order);
        return `(
      $${base + 1},
      $${base + 2},
      $${base + 3},
      $${base + 4},
      $${base + 5},
      $${base + 6},
      $${base + 7},
      $${base + 8},
      $${base + 9},
      $${base + 10}::timestamptz,
      $${base + 11}::timestamptz,
      $${base + 12}::timestamptz,
      $${base + 13},
      $${base + 14},
      $${base + 15},
      $${base + 16}
    )`;
    });
    await client.query(`
      INSERT INTO eos_report_row (
        id,
        report_header_id,
        patient_visit_key,
        patient_number,
        surname,
        name,
        provider,
        treatments,
        fee_total,
        appointment_datetime,
        appointment_dismissed_at,
        walkout_issued_at,
        walkout_status,
        included,
        carry_forward,
        display_order
      )
      VALUES ${rowSql.join(',\n')}
    `, values);
    return rows.length;
};
const insertReportSummary = async (client, reportHeaderId, summary) => {
    if (!summary) {
        return 0;
    }
    await client.query(`
      INSERT INTO eos_report_summary (
        id,
        report_header_id,
        opening_cash,
        payment_total,
        cash_envelope_total,
        cashbox_expenses_total,
        sell_total,
        fee_total,
        expected_total,
        actual_total,
        discrepancy_total,
        manager_alert_created
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12
      )
    `, [
        randomUUID(),
        reportHeaderId,
        summary.opening_cash,
        summary.payment_total,
        summary.cash_envelope_total,
        summary.cashbox_expenses_total,
        summary.sell_total,
        summary.fee_total,
        summary.expected_total,
        summary.actual_total,
        summary.discrepancy_total,
        summary.manager_alert_created
    ]);
    return 1;
};
const insertReportCreatedAudit = async (client, options) => {
    const auditEntryId = randomUUID();
    const newValue = JSON.stringify({
        shift_session_id: options.shiftSessionId,
        department_code: options.departmentCode,
        clinic_code: options.clinicCode,
        report_start_at: options.reportStartAt,
        report_end_at: options.reportEndAt
    });
    const result = await client.query(`
      INSERT INTO eos_report_audit (
        id,
        report_header_id,
        action,
        field_name,
        old_value,
        new_value,
        acted_at,
        acted_by
      )
      VALUES (
        $1,
        $2,
        'report_created',
        NULL,
        NULL,
        $3,
        NOW(),
        $4
      )
      RETURNING id::text AS audit_entry_id
    `, [
        auditEntryId,
        options.reportHeaderId,
        newValue,
        options.actedBy
    ]);
    return result.rows[0];
};
export const handleCreateReportHeaderRequest = async (pg, req, res) => {
    let client = null;
    try {
        // TODO: Replace payload-provided generated_by with the shared auth/session identity
        // once EOS persistence is wired to the real authenticated user context.
        // TODO: Extend audit writes later with explicit actions such as
        // report_submitted, report_locked, manager_takeover, and discrepancy_reviewed,
        // plus field-level amendments once the rest of the EOS flow is persisted.
        const payload = parseReportHeaderPayload(req);
        client = await pg.connect();
        await client.query('BEGIN');
        const shiftSession = await loadShiftSessionById(client, payload.shift_session_id);
        if (!shiftSession) {
            throw new ApiRequestError(404, 'Shift session not found');
        }
        const startPeriod = await loadAccountingPeriodContaining(client, payload.report_start_at);
        if (!startPeriod) {
            throw new ApiRequestError(409, 'No accounting period found for report_start_at');
        }
        const endPeriod = await loadAccountingPeriodContaining(client, payload.report_end_at);
        if (!endPeriod) {
            throw new ApiRequestError(409, 'No accounting period found for report_end_at');
        }
        if (startPeriod.id !== endPeriod.id) {
            throw new ApiRequestError(409, 'Report window spans multiple accounting periods');
        }
        if (startPeriod.is_closed) {
            throw new ApiRequestError(409, `Accounting period ${startPeriod.period_code} is closed`);
        }
        const created = await insertReportHeader(client, payload, startPeriod.id);
        const rowsCreated = await insertReportRows(client, created.report_header_id, payload.rows);
        const summaryCreated = await insertReportSummary(client, created.report_header_id, payload.summary);
        const auditEntry = await insertReportCreatedAudit(client, {
            reportHeaderId: created.report_header_id,
            shiftSessionId: payload.shift_session_id,
            departmentCode: payload.department_code,
            clinicCode: payload.clinic_code,
            reportStartAt: payload.report_start_at,
            reportEndAt: payload.report_end_at,
            actedBy: payload.generated_by
        });
        await client.query('COMMIT');
        return res.status(201).json({
            ...created,
            rows_created: rowsCreated,
            summary_created: summaryCreated,
            audit_entries_created: auditEntry ? 1 : 0
        });
    }
    catch (error) {
        if (client) {
            try {
                await client.query('ROLLBACK');
            }
            catch { }
        }
        const message = error instanceof Error ? error.message : String(error);
        const status = error instanceof ApiRequestError ? error.status : 500;
        return res.status(status).json({ ok: false, error: message });
    }
    finally {
        client?.release();
    }
};
export const handleListReportsRequest = async (pg, req, res) => {
    let client = null;
    try {
        // TODO: Harden management-report retrieval with the final shared auth/access layer.
        // Current implementation is read-only and intentionally does not enforce the
        // planned management-only retrieval role until auth is wired centrally.
        // TODO: Append-only snapshots can later add snapshot_kind, snapshot_version,
        // and is_latest_for_shift so management browsing can distinguish repeated
        // drafts from submitted or locked business outcomes more clearly.
        const filters = parseReportListFilters(req);
        client = await pg.connect();
        const [items, total_count] = await Promise.all([
            listReportHeaders(client, filters),
            countReportHeaders(client, filters)
        ]);
        const payload = {
            items,
            total_count,
            limit: filters.limit,
            offset: filters.offset
        };
        return res.json(payload);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = error instanceof ApiRequestError ? error.status : 500;
        return res.status(status).json({ ok: false, error: message });
    }
    finally {
        client?.release();
    }
};
export const handleGetReportSnapshotRequest = async (pg, req, res) => {
    let client = null;
    try {
        // TODO: Harden management snapshot retrieval with the final shared auth/access layer.
        // Current implementation is read-only and intentionally does not enforce the
        // planned management-only retrieval role until auth is wired centrally.
        // TODO: If snapshot versioning is introduced later, keep this detail endpoint
        // pinned to a concrete report_header id rather than silently redirecting to a
        // newer "latest" snapshot for the same shift session.
        const reportHeaderId = normalizeRequiredUuid(req.params.id, 'id');
        client = await pg.connect();
        const header = await loadReportHeaderSnapshot(client, reportHeaderId);
        if (!header) {
            throw new ApiRequestError(404, 'EOS report not found');
        }
        const [rows, summary, audit] = await Promise.all([
            loadReportRowsSnapshot(client, reportHeaderId),
            loadReportSummarySnapshot(client, reportHeaderId),
            loadReportAuditSnapshot(client, reportHeaderId)
        ]);
        return res.json({
            header,
            rows,
            summary,
            audit
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = error instanceof ApiRequestError ? error.status : 500;
        return res.status(status).json({ ok: false, error: message });
    }
    finally {
        client?.release();
    }
};
