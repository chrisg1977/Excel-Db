import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Pool as PgPool, PoolClient } from 'pg';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPORTED_REPORT_TYPES = new Set(['standard', 'management_exception']);
const SUPPORTED_WALKOUT_STATUSES = new Set(['printed', 'not_printed', 'unknown']);
const EOS_ACCOUNTING_TIMEZONE = 'Europe/Malta';

type ReportRowPayload = {
  patient_visit_key: string;
  patient_number: string;
  surname: string;
  name: string;
  provider: string;
  treatments: string;
  fee_total: number;
  appointment_datetime: string;
  appointment_dismissed_at: string | null;
  walkout_issued_at: string | null;
  walkout_status: string;
  included: boolean;
  carry_forward: boolean;
  display_order: number;
};

type ReportSummaryPayload = {
  opening_cash: number;
  payment_total: number;
  cash_envelope_total: number;
  cashbox_expenses_total: number;
  sell_total: number;
  fee_total: number;
  expected_total: number;
  actual_total: number;
  discrepancy_total: number;
  manager_alert_created: boolean;
};

type CreatedReportAuditRow = {
  audit_entry_id: string;
};

type ReportHeaderPayload = {
  shift_session_id: string;
  location_code: string;
  department_code: string;
  clinic_code: string;
  report_start_at: string;
  report_end_at: string;
  report_type: string;
  generated_by: string;
  rows: ReportRowPayload[];
  summary: ReportSummaryPayload | null;
};

type ShiftSessionRow = {
  id: string;
};

type AccountingPeriodRow = {
  id: string;
  period_code: string;
  is_closed: boolean;
};

type CreatedReportHeaderRow = {
  report_header_id: string;
  accounting_period_id: string;
  generated_at: string;
};

type ReportListFilters = {
  accounting_period_id: string | null;
  clinic_code: string | null;
  department_code: string | null;
  location_code: string | null;
  shift_session_id: string | null;
  generated_by: string | null;
  report_type: string | null;
  status: string | null;
  report_start_at_from: string | null;
  report_start_at_to: string | null;
  include_all_snapshots: boolean;
  limit: number;
  offset: number;
};

type ReportListRow = {
  report_header_id: string;
  shift_session_id: string;
  location_code: string;
  clinic_code: string;
  department_code: string;
  report_start_at: string;
  report_end_at: string;
  generated_at: string;
  generated_by: string;
  report_type: string;
  status: string;
  accounting_period_id: string;
  discrepancy_present: boolean;
  manager_alert_created: boolean;
  temporary_closed_pending_review: boolean;
  unresolved_review_pending: boolean;
  is_latest_for_shift: boolean;
};

type ReportListResponse = {
  items: ReportListRow[];
  total_count: number;
  limit: number;
  offset: number;
};

type ReportListCountRow = {
  total_count: number;
};

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

type ReportHeaderDetailRow = {
  report_header_id: string;
  shift_session_id: string;
  location_code: string;
  clinic_code: string;
  department_code: string;
  report_start_at: string;
  report_end_at: string;
  generated_at: string;
  generated_by: string;
  report_type: string;
  status: string;
  accounting_period_id: string;
};

type ReportHeaderSnapshotSourceRow = {
  id: string;
  shift_session_id: string;
  location_code: string;
  clinic_code: string;
  department_code: string;
  report_start_at: string;
  report_end_at: string;
  generated_at: string;
  generated_by: string;
  report_type: string;
  status: string;
  accounting_period_id: string;
};

type ReportRowDetailRow = {
  id: string;
  report_header_id: string;
  patient_visit_key: string;
  patient_number: string;
  surname: string;
  name: string;
  provider: string;
  treatments: string;
  fee_total: number;
  appointment_datetime: string;
  appointment_dismissed_at: string | null;
  walkout_issued_at: string | null;
  walkout_status: string;
  included: boolean;
  carry_forward: boolean;
  display_order: number;
};

type ReportSummaryDetailRow = {
  id: string;
  report_header_id: string;
  opening_cash: number;
  payment_total: number;
  cash_envelope_total: number;
  cashbox_expenses_total: number;
  sell_total: number;
  fee_total: number;
  expected_total: number;
  actual_total: number;
  discrepancy_total: number;
  manager_alert_created: boolean;
};

type ReportAuditDetailRow = {
  id: string;
  report_header_id: string;
  action: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  acted_at: string;
  acted_by: string;
  reason: string | null;
};

type ReportAuditSnapshotSourceRow = {
  id: string;
  report_header_id: string;
  action: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  acted_at: string;
  acted_by: string;
  reason?: string | null;
};

class ApiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const getRequestBodyRecord = (req: Request): Record<string, unknown> => {
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiRequestError(400, 'Request body must be a JSON object');
  }
  return body as Record<string, unknown>;
};

const normalizeRequiredText = (value: unknown, key: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiRequestError(400, `${key} is required`);
  }
  return value.trim();
};

const normalizeRequiredCode = (value: unknown, key: string): string => {
  return normalizeRequiredText(value, key).toUpperCase();
};

const normalizeRequiredUuid = (value: unknown, key: string): string => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new ApiRequestError(400, `${key} must be a valid UUID`);
  }
  return value.trim();
};

const normalizeOptionalUuid = (value: unknown, key: string): string | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new ApiRequestError(400, `${key} must be a valid UUID when provided`);
  }
  return value.trim();
};

const normalizeRequiredDateTime = (value: unknown, key: string): string => {
  const text = normalizeRequiredText(value, key);
  if (!Number.isFinite(Date.parse(text))) {
    throw new ApiRequestError(400, `${key} must be a valid datetime`);
  }
  return text;
};

const normalizeOptionalDateTime = (value: unknown, key: string): string | null => {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const text = String(value).trim();
  if (!text || !Number.isFinite(Date.parse(text))) {
    throw new ApiRequestError(400, `${key} must be a valid datetime when provided`);
  }
  return text;
};

const normalizeOptionalText = (value: unknown): string | null => {
  if (value === undefined || value === null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized ? normalized : null;
};

const normalizeOptionalCode = (value: unknown): string | null => {
  const normalized = normalizeOptionalText(value);
  return normalized ? normalized.toUpperCase() : null;
};

const normalizeOptionalFlag = (value: unknown): boolean => {
  const normalized = normalizeOptionalText(value)?.toLowerCase() || '';
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
};

const normalizeRequiredNumber = (value: unknown, key: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiRequestError(400, `${key} must be numeric`);
  }
  return Number(parsed.toFixed(2));
};

const normalizeRequiredInteger = (value: unknown, key: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new ApiRequestError(400, `${key} must be an integer`);
  }
  return parsed;
};

const normalizeOptionalNonNegativeInteger = (
  value: unknown,
  key: string,
  defaultValue: number,
  maxValue: number
): number => {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ApiRequestError(400, `${key} must be a non-negative integer`);
  }

  return Math.min(parsed, maxValue);
};

const normalizeRequiredBoolean = (value: unknown, key: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new ApiRequestError(400, `${key} must be a boolean`);
  }
  return value;
};

const parseReportSummaryPayload = (value: unknown): ReportSummaryPayload | null => {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiRequestError(400, 'summary must be an object when provided');
  }

  const summary = value as Record<string, unknown>;
  return {
    opening_cash: normalizeRequiredNumber(summary.opening_cash, 'summary.opening_cash'),
    payment_total: normalizeRequiredNumber(summary.payment_total, 'summary.payment_total'),
    cash_envelope_total: normalizeRequiredNumber(
      summary.cash_envelope_total,
      'summary.cash_envelope_total'
    ),
    cashbox_expenses_total: normalizeRequiredNumber(
      summary.cashbox_expenses_total,
      'summary.cashbox_expenses_total'
    ),
    sell_total: normalizeRequiredNumber(summary.sell_total, 'summary.sell_total'),
    fee_total: normalizeRequiredNumber(summary.fee_total, 'summary.fee_total'),
    expected_total: normalizeRequiredNumber(summary.expected_total, 'summary.expected_total'),
    actual_total: normalizeRequiredNumber(summary.actual_total, 'summary.actual_total'),
    discrepancy_total: normalizeRequiredNumber(
      summary.discrepancy_total,
      'summary.discrepancy_total'
    ),
    manager_alert_created: normalizeRequiredBoolean(
      summary.manager_alert_created,
      'summary.manager_alert_created'
    )
  };
};

const normalizeReportType = (value: unknown): string => {
  const reportType = normalizeRequiredText(value, 'report_type').toLowerCase();
  if (!SUPPORTED_REPORT_TYPES.has(reportType)) {
    throw new ApiRequestError(400, 'report_type is not supported');
  }
  return reportType;
};

const normalizeOptionalReportType = (value: unknown): string | null => {
  const normalized = normalizeOptionalText(value)?.toLowerCase() || null;
  if (!normalized) {
    return null;
  }
  if (!SUPPORTED_REPORT_TYPES.has(normalized)) {
    throw new ApiRequestError(400, 'report_type is not supported');
  }
  return normalized;
};

const normalizeWalkoutStatus = (value: unknown, key: string): string => {
  const walkoutStatus = normalizeRequiredText(value, key).toLowerCase();
  if (!SUPPORTED_WALKOUT_STATUSES.has(walkoutStatus)) {
    throw new ApiRequestError(400, `${key} is not supported`);
  }
  return walkoutStatus;
};

const parseReportRowsPayload = (value: unknown): ReportRowPayload[] => {
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

    const row = entry as Record<string, unknown>;
    return {
      patient_visit_key: normalizeRequiredText(row.patient_visit_key, `rows[${index}].patient_visit_key`),
      patient_number: normalizeRequiredText(row.patient_number, `rows[${index}].patient_number`),
      surname: normalizeRequiredText(row.surname, `rows[${index}].surname`),
      name: normalizeRequiredText(row.name, `rows[${index}].name`),
      provider: normalizeRequiredText(row.provider, `rows[${index}].provider`),
      treatments: normalizeRequiredText(row.treatments, `rows[${index}].treatments`),
      fee_total: normalizeRequiredNumber(row.fee_total, `rows[${index}].fee_total`),
      appointment_datetime: normalizeRequiredDateTime(
        row.appointment_datetime,
        `rows[${index}].appointment_datetime`
      ),
      appointment_dismissed_at: normalizeOptionalDateTime(
        row.appointment_dismissed_at,
        `rows[${index}].appointment_dismissed_at`
      ),
      walkout_issued_at: normalizeOptionalDateTime(
        row.walkout_issued_at,
        `rows[${index}].walkout_issued_at`
      ),
      walkout_status: normalizeWalkoutStatus(row.walkout_status, `rows[${index}].walkout_status`),
      included: normalizeRequiredBoolean(row.included, `rows[${index}].included`),
      carry_forward: normalizeRequiredBoolean(row.carry_forward, `rows[${index}].carry_forward`),
      display_order: normalizeRequiredInteger(row.display_order, `rows[${index}].display_order`)
    };
  });
};

const parseReportHeaderPayload = (req: Request): ReportHeaderPayload => {
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

const parseReportListFilters = (req: Request): ReportListFilters => {
  const query = req.query as Record<string, unknown>;
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
    include_all_snapshots: normalizeOptionalFlag(query.include_all_snapshots),
    limit: normalizeOptionalNonNegativeInteger(query.limit, 'limit', 100, 500),
    offset: normalizeOptionalNonNegativeInteger(query.offset, 'offset', 0, 100000)
  };
};

const loadShiftSessionById = async (
  client: PoolClient,
  shiftSessionId: string
): Promise<ShiftSessionRow | null> => {
  const result = await client.query<ShiftSessionRow>(
    `
      SELECT id::text AS id
      FROM eos_shift_session
      WHERE id = $1
      LIMIT 1
    `,
    [shiftSessionId]
  );

  return result.rows[0] ?? null;
};

const loadAccountingPeriodContaining = async (
  client: PoolClient,
  atDateTime: string
): Promise<AccountingPeriodRow | null> => {
  const result = await client.query<AccountingPeriodRow>(
    `
      SELECT
        id::text AS id,
        period_code,
        is_closed
      FROM eos_accounting_period
      WHERE (($1::timestamptz AT TIME ZONE $2)::date BETWEEN start_date AND end_date)
      ORDER BY start_date DESC
      LIMIT 1
    `,
    [atDateTime, EOS_ACCOUNTING_TIMEZONE]
  );

  return result.rows[0] ?? null;
};

const buildReportListFilterParams = (filters: ReportListFilters): Array<string | number | null> => [
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

const listReportHeaders = async (
  client: PoolClient,
  filters: ReportListFilters
): Promise<ReportListRow[]> => {
  const filterValues = buildReportListFilterParams(filters);

  const result = await client.query<ReportListRow>(
    `
      WITH filtered AS (
        SELECT
          h.id::text AS report_header_id,
          h.shift_session_id::text AS shift_session_id,
          h.location_code,
          h.clinic_code,
          h.department_code,
          h.report_start_at::text AS report_start_at,
          h.report_end_at::text AS report_end_at,
          h.generated_at,
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
          ) AS unresolved_review_pending,
          ROW_NUMBER() OVER (
            PARTITION BY h.shift_session_id
            ORDER BY h.generated_at DESC, h.id DESC
          ) AS shift_snapshot_rank
        FROM eos_report_header h
        LEFT JOIN eos_report_summary rs
          ON rs.report_header_id = h.id
        LEFT JOIN eos_shift_session ss
          ON ss.id = h.shift_session_id
        ${REPORT_HEADER_LIST_FILTER_SQL}
      )
      SELECT
        report_header_id,
        shift_session_id,
        location_code,
        clinic_code,
        department_code,
        report_start_at,
        report_end_at,
        generated_at::text AS generated_at,
        generated_by,
        report_type,
        status,
        accounting_period_id,
        discrepancy_present,
        manager_alert_created,
        temporary_closed_pending_review,
        unresolved_review_pending,
        (shift_snapshot_rank = 1) AS is_latest_for_shift
      FROM filtered
      WHERE ($11::boolean IS TRUE OR shift_snapshot_rank = 1)
      ORDER BY generated_at DESC, report_header_id DESC
      LIMIT $12 OFFSET $13
    `,
    [
      ...filterValues,
      filters.include_all_snapshots,
      filters.limit,
      filters.offset
    ]
  );

  return result.rows;
};

const countReportHeaders = async (
  client: PoolClient,
  filters: ReportListFilters
): Promise<number> => {
  const filterValues = buildReportListFilterParams(filters);
  const result = await client.query<ReportListCountRow>(
    `
      WITH filtered AS (
        SELECT
          h.shift_session_id,
          ROW_NUMBER() OVER (
            PARTITION BY h.shift_session_id
            ORDER BY h.generated_at DESC, h.id DESC
          ) AS shift_snapshot_rank
        FROM eos_report_header h
        LEFT JOIN eos_report_summary rs
          ON rs.report_header_id = h.id
        LEFT JOIN eos_shift_session ss
          ON ss.id = h.shift_session_id
        ${REPORT_HEADER_LIST_FILTER_SQL}
      )
      SELECT COUNT(*)::int AS total_count
      FROM filtered
      WHERE ($11::boolean IS TRUE OR shift_snapshot_rank = 1)
    `,
    [...filterValues, filters.include_all_snapshots]
  );

  return result.rows[0] ? Number(result.rows[0].total_count || 0) : 0;
};

const loadReportHeaderSnapshot = async (
  client: PoolClient,
  reportHeaderId: string
): Promise<ReportHeaderDetailRow | null> => {
  const result = await client.query<ReportHeaderSnapshotSourceRow>(
    `
      SELECT *
      FROM eos_report_header
      WHERE id = $1
      LIMIT 1
    `,
    [reportHeaderId]
  );

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

const loadReportRowsSnapshot = async (
  client: PoolClient,
  reportHeaderId: string
): Promise<ReportRowDetailRow[]> => {
  const result = await client.query<ReportRowDetailRow>(
    `
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
    `,
    [reportHeaderId]
  );

  return result.rows;
};

const loadReportSummarySnapshot = async (
  client: PoolClient,
  reportHeaderId: string
): Promise<ReportSummaryDetailRow | null> => {
  const result = await client.query<ReportSummaryDetailRow>(
    `
      SELECT *
      FROM eos_report_summary
      WHERE report_header_id = $1
    `,
    [reportHeaderId]
  );

  return result.rows[0] ?? null;
};

const loadReportAuditSnapshot = async (
  client: PoolClient,
  reportHeaderId: string
): Promise<ReportAuditDetailRow[]> => {
  const result = await client.query<ReportAuditSnapshotSourceRow>(
    `
      SELECT *
      FROM eos_report_audit
      WHERE report_header_id = $1
      ORDER BY acted_at ASC, id ASC
    `,
    [reportHeaderId]
  );

  return result.rows.map((row: ReportAuditSnapshotSourceRow) => ({
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

const insertReportHeader = async (
  client: PoolClient,
  payload: ReportHeaderPayload,
  accountingPeriodId: string
): Promise<CreatedReportHeaderRow> => {
  const reportHeaderId = randomUUID();
  const result = await client.query<CreatedReportHeaderRow>(
    `
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
    `,
    [
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
    ]
  );

  return result.rows[0];
};

const insertReportRows = async (
  client: PoolClient,
  reportHeaderId: string,
  rows: ReportRowPayload[]
): Promise<number> => {
  if (!rows.length) {
    return 0;
  }

  // Persist the grouped visit snapshot exactly as supplied for this report.
  // Walkout enrichment remains outside this write path for now.
  const values: unknown[] = [];
  const rowSql = rows.map((row, index) => {
    const base = index * 16;
    values.push(
      randomUUID(),
      reportHeaderId,
      row.patient_visit_key,
      row.patient_number,
      row.surname,
      row.name,
      row.provider,
      row.treatments,
      row.fee_total,
      row.appointment_datetime,
      row.appointment_dismissed_at,
      row.walkout_issued_at,
      row.walkout_status,
      row.included,
      row.carry_forward,
      row.display_order
    );

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

  await client.query(
    `
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
    `,
    values
  );

  return rows.length;
};

const insertReportSummary = async (
  client: PoolClient,
  reportHeaderId: string,
  summary: ReportSummaryPayload | null
): Promise<number> => {
  if (!summary) {
    return 0;
  }

  await client.query(
    `
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
    `,
    [
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
    ]
  );

  return 1;
};

const insertReportCreatedAudit = async (
  client: PoolClient,
  options: {
    reportHeaderId: string;
    shiftSessionId: string;
    departmentCode: string;
    clinicCode: string;
    reportStartAt: string;
    reportEndAt: string;
    actedBy: string;
  }
): Promise<CreatedReportAuditRow> => {
  const auditEntryId = randomUUID();
  const newValue = JSON.stringify({
    shift_session_id: options.shiftSessionId,
    department_code: options.departmentCode,
    clinic_code: options.clinicCode,
    report_start_at: options.reportStartAt,
    report_end_at: options.reportEndAt
  });

  const result = await client.query<CreatedReportAuditRow>(
    `
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
    `,
    [
      auditEntryId,
      options.reportHeaderId,
      newValue,
      options.actedBy
    ]
  );

  return result.rows[0];
};

export const handleCreateReportHeaderRequest = async (
  pg: PgPool,
  req: Request,
  res: Response
) => {
  let client: PoolClient | null = null;

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
      throw new ApiRequestError(
        409,
        `Accounting period ${startPeriod.period_code} is closed`
      );
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
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch {}
    }

    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof ApiRequestError ? error.status : 500;
    return res.status(status).json({ ok: false, error: message });
  } finally {
    client?.release();
  }
};

export const handleListReportsRequest = async (
  pg: PgPool,
  req: Request,
  res: Response
) => {
  let client: PoolClient | null = null;

  try {
    // TODO: Harden management-report retrieval with the final shared auth/access layer.
    // Current implementation is read-only and intentionally does not enforce the
    // planned management-only retrieval role until auth is wired centrally.
    // Listing now defaults to the latest report_header snapshot per shift_session_id
    // (is_latest_for_shift), so repeated Save Draft/Submit snapshots for the same shift
    // no longer read as duplicate rows in management browsing. Pass
    // include_all_snapshots=true to see the full append-only history for a shift.
    const filters = parseReportListFilters(req);
    client = await pg.connect();
    const [items, total_count] = await Promise.all([
      listReportHeaders(client, filters),
      countReportHeaders(client, filters)
    ]);
    const payload: ReportListResponse = {
      items,
      total_count,
      limit: filters.limit,
      offset: filters.offset
    };
    return res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof ApiRequestError ? error.status : 500;
    return res.status(status).json({ ok: false, error: message });
  } finally {
    client?.release();
  }
};

export const handleGetReportSnapshotRequest = async (
  pg: PgPool,
  req: Request,
  res: Response
) => {
  let client: PoolClient | null = null;

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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof ApiRequestError ? error.status : 500;
    return res.status(status).json({ ok: false, error: message });
  } finally {
    client?.release();
  }
};
