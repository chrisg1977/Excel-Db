import type { Request, Response } from 'express';
import type { Pool as PgPool, PoolClient } from 'pg';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANAGEMENT_OR_HIGHER_ROLES = new Set(['management', 'manager', 'admin']);
// V1 period statuses are intentionally locked to this minimal set.
const SUPPORTED_PERIOD_STATUSES = new Set(['open', 'closing_review', 'closed', 'reopened']);
const KNOWN_REPORT_STATUSES = new Set(['draft', 'saved', 'submitted', 'locked']);
const KNOWN_DISCREPANCY_STATUSES = new Set([
  'detected',
  'pending_notification',
  'pending_manager_review',
  'resolved',
  'closed'
]);
const KNOWN_SHIFT_STATUSES = new Set([
  'open',
  'report_in_progress',
  'submitted',
  'locked',
  'abandoned',
  'superseded',
  'temporary_closed_pending_review',
  'temporary_handover_started',
  'manager_review_required'
]);

type PeriodListFilters = {
  status: string | null;
  start_from: string | null;
  start_to: string | null;
  limit: number;
  offset: number;
};

type PeriodListSourceRow = {
  accounting_period_id: string;
  period_code: string;
  start_at: string;
  end_at: string;
  status: string;
  total_count: number;
};

type PeriodListItem = {
  accounting_period_id: string;
  period_code: string;
  start_at: string;
  end_at: string;
  status: string;
};

type PeriodListResponse = {
  items: PeriodListItem[];
  total_count: number;
  limit: number;
  offset: number;
};

type PeriodSummaryFilters = {
  location_code: string | null;
  department_code: string | null;
};

type PeriodSummarySourceRow = {
  accounting_period_id: string;
  period_code: string;
  start_at: string;
  end_at: string;
  period_status: string;
  total_report_snapshots: number;
  total_submitted_reports: number;
  total_draft_saved_only_reports: number;
  total_reports_with_discrepancies: number;
  total_discrepancy_events: number;
  total_manager_reviews_pending: number;
  total_temporary_closures_pending_review: number;
  total_abandoned_shifts: number;
  total_superseded_shifts: number;
  unknown_report_status_count: number;
  unknown_discrepancy_status_count: number;
  unknown_shift_status_count: number;
};

type PeriodSummaryResponse = {
  accounting_period_id: string;
  period_code: string;
  start_at: string;
  end_at: string;
  period_status: string;
  filters_applied: {
    location_code: string | null;
    department_code: string | null;
  };
  summary: {
    total_report_snapshots: number;
    total_submitted_reports: number;
    total_draft_saved_only_reports: number;
    total_reports_with_discrepancies: number;
    total_discrepancy_events: number;
    total_manager_reviews_pending: number;
    total_temporary_closures_pending_review: number;
    total_abandoned_shifts: number;
    total_superseded_shifts: number;
  };
};

class ApiRequestError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const getSingleHeaderValue = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const getHeaderText = (req: Request, ...names: string[]): string | undefined => {
  for (const name of names) {
    const value = getSingleHeaderValue(req.headers[name.toLowerCase()] as string | string[] | undefined);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

const getSingleQueryValue = (value: unknown, key: string): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) {
    throw new ApiRequestError(400, `Query parameter ${key} must be provided once`);
  }
  if (typeof value !== 'string') {
    throw new ApiRequestError(400, `Query parameter ${key} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeRole = (value: string | undefined): string | null => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
};

const assertManagementAccessIfRolePresent = (req: Request): void => {
  // TODO: Replace this soft placeholder gate with final shared auth/role enforcement.
  // For now, only reject callers when an explicit placeholder role is supplied and
  // that role is below management level. Missing role context remains allowed.
  const role = normalizeRole(getHeaderText(req, 'x-eos-role', 'x-role', 'x-user-role'));
  if (role && !MANAGEMENT_OR_HIGHER_ROLES.has(role)) {
    throw new ApiRequestError(403, 'Management-or-higher access is required');
  }
};

const normalizeRequiredUuidPathValue = (value: unknown, key: string): string => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new ApiRequestError(400, `${key} must be a valid UUID`);
  }
  return value.trim();
};

const normalizeOptionalDateTime = (value: string | undefined, key: string): string | null => {
  if (value === undefined) return null;
  if (!Number.isFinite(Date.parse(value))) {
    throw new ApiRequestError(400, `${key} must be a valid datetime`);
  }
  return value;
};

const normalizeOptionalNonNegativeInteger = (
  value: string | undefined,
  key: string,
  defaultValue: number,
  maxValue: number
): number => {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new ApiRequestError(400, `${key} must be a non-negative integer`);
  }
  return Math.min(parsed, maxValue);
};

const normalizeOptionalCode = (value: string | undefined): string | null => {
  if (value === undefined) return null;
  const normalized = value.trim().toUpperCase();
  return normalized || null;
};

const normalizeOptionalPeriodStatus = (value: string | undefined): string | null => {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (!SUPPORTED_PERIOD_STATUSES.has(normalized)) {
    throw new ApiRequestError(400, 'status is not supported');
  }
  return normalized;
};

const parsePeriodListFilters = (req: Request): PeriodListFilters => {
  const query = req.query as Record<string, unknown>;
  const filters: PeriodListFilters = {
    status: normalizeOptionalPeriodStatus(getSingleQueryValue(query.status, 'status')),
    start_from: normalizeOptionalDateTime(getSingleQueryValue(query.start_from, 'start_from'), 'start_from'),
    start_to: normalizeOptionalDateTime(getSingleQueryValue(query.start_to, 'start_to'), 'start_to'),
    limit: normalizeOptionalNonNegativeInteger(getSingleQueryValue(query.limit, 'limit'), 'limit', 50, 500),
    offset: normalizeOptionalNonNegativeInteger(getSingleQueryValue(query.offset, 'offset'), 'offset', 0, 100000)
  };

  if (
    filters.start_from &&
    filters.start_to &&
    Date.parse(filters.start_to) < Date.parse(filters.start_from)
  ) {
    throw new ApiRequestError(400, 'start_to must be greater than or equal to start_from');
  }

  return filters;
};

const parsePeriodSummaryFilters = (req: Request): PeriodSummaryFilters => {
  const query = req.query as Record<string, unknown>;
  return {
    location_code: normalizeOptionalCode(getSingleQueryValue(query.location_code, 'location_code')),
    department_code: normalizeOptionalCode(getSingleQueryValue(query.department_code, 'department_code'))
  };
};

const PERIOD_LIST_SQL = `
  SELECT
    p.id::text AS accounting_period_id,
    p.period_code,
    p.start_at::text AS start_at,
    p.end_at::text AS end_at,
    p.status,
    COUNT(*) OVER()::int AS total_count
  FROM eos_accounting_period p
  WHERE ($1::text IS NULL OR p.status = $1)
    AND ($2::timestamptz IS NULL OR p.start_at >= $2)
    AND ($3::timestamptz IS NULL OR p.start_at < $3)
  ORDER BY p.start_at DESC, p.id DESC
  LIMIT $4 OFFSET $5
`;

const PERIOD_SUMMARY_SQL = `
  WITH selected_period AS (
    SELECT
      p.id::text AS accounting_period_id,
      p.period_code,
      p.start_at,
      p.end_at,
      p.status
    FROM eos_accounting_period p
    WHERE p.id = $1
  ),
  report_scope AS (
    SELECT
      h.id::text AS report_header_id,
      h.status
    FROM eos_report_header h
    JOIN selected_period p
      ON h.accounting_period_id::text = p.accounting_period_id
    WHERE ($2::text IS NULL OR h.location_code = $2)
      AND ($3::text IS NULL OR h.department_code = $3)
  ),
  report_summary_scope AS (
    SELECT
      rs.report_header_id::text AS report_header_id,
      rs.discrepancy_total
    FROM eos_report_summary rs
    JOIN report_scope h
      ON h.report_header_id = rs.report_header_id::text
  ),
  discrepancy_scope AS (
    SELECT
      e.id::text AS event_id,
      e.status
    FROM eos_discrepancy_event e
    JOIN selected_period p
      ON e.created_at >= p.start_at
     AND e.created_at < p.end_at
    WHERE ($2::text IS NULL OR e.location_code = $2)
      AND ($3::text IS NULL OR e.department_code = $3)
  ),
  shift_scope AS (
    SELECT
      s.id::text AS shift_session_id,
      s.status
    FROM eos_shift_session s
    JOIN selected_period p
      ON s.shift_date >= p.start_at::date
     AND s.shift_date < p.end_at::date
    WHERE ($2::text IS NULL OR s.location_code = $2)
      AND ($3::text IS NULL OR s.department_code = $3)
  )
  SELECT
    p.accounting_period_id,
    p.period_code,
    p.start_at::text AS start_at,
    p.end_at::text AS end_at,
    p.status AS period_status,
    COALESCE((SELECT COUNT(*) FROM report_scope), 0)::int AS total_report_snapshots,
    COALESCE((SELECT COUNT(*) FROM report_scope WHERE status = 'submitted'), 0)::int AS total_submitted_reports,
    COALESCE((SELECT COUNT(*) FROM report_scope WHERE status IN ('draft', 'saved')), 0)::int AS total_draft_saved_only_reports,
    COALESCE((SELECT COUNT(*) FROM report_summary_scope WHERE COALESCE(discrepancy_total, 0) <> 0), 0)::int AS total_reports_with_discrepancies,
    COALESCE((SELECT COUNT(*) FROM discrepancy_scope), 0)::int AS total_discrepancy_events,
    COALESCE((SELECT COUNT(*) FROM discrepancy_scope WHERE status = 'pending_manager_review'), 0)::int AS total_manager_reviews_pending,
    COALESCE((SELECT COUNT(*) FROM shift_scope WHERE status IN ('temporary_closed_pending_review', 'temporary_handover_started', 'manager_review_required')), 0)::int AS total_temporary_closures_pending_review,
    COALESCE((SELECT COUNT(*) FROM shift_scope WHERE status = 'abandoned'), 0)::int AS total_abandoned_shifts,
    COALESCE((SELECT COUNT(*) FROM shift_scope WHERE status = 'superseded'), 0)::int AS total_superseded_shifts,
    COALESCE((SELECT COUNT(*) FROM report_scope WHERE status IS NULL OR status NOT IN ('draft', 'saved', 'submitted', 'locked')), 0)::int AS unknown_report_status_count,
    COALESCE((SELECT COUNT(*) FROM discrepancy_scope WHERE status IS NULL OR status NOT IN ('detected', 'pending_notification', 'pending_manager_review', 'resolved', 'closed')), 0)::int AS unknown_discrepancy_status_count,
    COALESCE((SELECT COUNT(*) FROM shift_scope WHERE status IS NULL OR status NOT IN ('open', 'report_in_progress', 'submitted', 'locked', 'abandoned', 'superseded', 'temporary_closed_pending_review', 'temporary_handover_started', 'manager_review_required')), 0)::int AS unknown_shift_status_count
  FROM selected_period p
`;

const warnIfUnknownPeriodStatuses = (items: PeriodListItem[]): void => {
  const unknownStatuses = Array.from(new Set(
    items
      .map((item) => item.status)
      .filter((status) => !SUPPORTED_PERIOD_STATUSES.has(status))
  ));

  if (unknownStatuses.length) {
    console.warn('[eos-periods] Unknown accounting period statuses in list response', {
      unknown_statuses: unknownStatuses
    });
  }
};

const warnIfUnknownScopedStatuses = (row: PeriodSummarySourceRow, periodId: string): void => {
  const anomalies: Record<string, number> = {};
  if (row.unknown_report_status_count > 0) {
    anomalies.unknown_report_status_count = row.unknown_report_status_count;
  }
  if (row.unknown_discrepancy_status_count > 0) {
    anomalies.unknown_discrepancy_status_count = row.unknown_discrepancy_status_count;
  }
  if (row.unknown_shift_status_count > 0) {
    anomalies.unknown_shift_status_count = row.unknown_shift_status_count;
  }

  if (Object.keys(anomalies).length) {
    console.warn('[eos-periods] Unknown scoped statuses detected during period summary aggregation', {
      accounting_period_id: periodId,
      ...anomalies
    });
  }
};

const listPeriods = async (
  client: PoolClient,
  filters: PeriodListFilters
): Promise<PeriodListResponse> => {
  const result = await client.query<PeriodListSourceRow>(PERIOD_LIST_SQL, [
    filters.status,
    filters.start_from,
    filters.start_to,
    filters.limit,
    filters.offset
  ]);

  const items: PeriodListItem[] = result.rows.map((row: PeriodListSourceRow) => ({
    accounting_period_id: row.accounting_period_id,
    period_code: row.period_code,
    start_at: row.start_at,
    end_at: row.end_at,
    status: row.status
  }));

  warnIfUnknownPeriodStatuses(items);

  return {
    items,
    total_count: result.rows[0] ? Number(result.rows[0].total_count || 0) : 0,
    limit: filters.limit,
    offset: filters.offset
  };
};

const loadPeriodSummary = async (
  client: PoolClient,
  accountingPeriodId: string,
  filters: PeriodSummaryFilters
): Promise<PeriodSummaryResponse | null> => {
  const result = await client.query<PeriodSummarySourceRow>(PERIOD_SUMMARY_SQL, [
    accountingPeriodId,
    filters.location_code,
    filters.department_code
  ]);

  const row = result.rows[0];
  if (!row) return null;

  if (!SUPPORTED_PERIOD_STATUSES.has(row.period_status)) {
    console.warn('[eos-periods] Unknown accounting period status in summary response', {
      accounting_period_id: accountingPeriodId,
      status: row.period_status
    });
  }

  warnIfUnknownScopedStatuses(row, accountingPeriodId);

  return {
    accounting_period_id: row.accounting_period_id,
    period_code: row.period_code,
    start_at: row.start_at,
    end_at: row.end_at,
    period_status: row.period_status,
    filters_applied: {
      location_code: filters.location_code,
      department_code: filters.department_code
    },
    summary: {
      total_report_snapshots: Number(row.total_report_snapshots || 0),
      total_submitted_reports: Number(row.total_submitted_reports || 0),
      total_draft_saved_only_reports: Number(row.total_draft_saved_only_reports || 0),
      total_reports_with_discrepancies: Number(row.total_reports_with_discrepancies || 0),
      total_discrepancy_events: Number(row.total_discrepancy_events || 0),
      total_manager_reviews_pending: Number(row.total_manager_reviews_pending || 0),
      total_temporary_closures_pending_review: Number(row.total_temporary_closures_pending_review || 0),
      total_abandoned_shifts: Number(row.total_abandoned_shifts || 0),
      total_superseded_shifts: Number(row.total_superseded_shifts || 0)
    }
  };
};

export const handleListAccountingPeriodsRequest = async (
  pg: PgPool,
  req: Request,
  res: Response
) => {
  let client: PoolClient | null = null;
  try {
    // TODO: Harden period-dashboard access with the final shared auth/access layer.
    assertManagementAccessIfRolePresent(req);
    const filters = parsePeriodListFilters(req);
    client = await pg.connect();
    const payload = await listPeriods(client, filters);
    return res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof ApiRequestError ? error.status : 500;
    return res.status(status).json({ ok: false, error: message });
  } finally {
    client?.release();
  }
};

export const handleGetAccountingPeriodSummaryRequest = async (
  pg: PgPool,
  req: Request,
  res: Response
) => {
  let client: PoolClient | null = null;
  try {
    // TODO: Harden period-dashboard access with the final shared auth/access layer.
    assertManagementAccessIfRolePresent(req);
    const accountingPeriodId = normalizeRequiredUuidPathValue(req.params.id, 'id');
    const filters = parsePeriodSummaryFilters(req);
    client = await pg.connect();
    const payload = await loadPeriodSummary(client, accountingPeriodId, filters);
    if (!payload) {
      throw new ApiRequestError(404, 'Accounting period not found');
    }
    return res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof ApiRequestError ? error.status : 500;
    return res.status(status).json({ ok: false, error: message });
  } finally {
    client?.release();
  }
};
