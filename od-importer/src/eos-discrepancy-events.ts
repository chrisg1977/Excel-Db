import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Pool as PgPool, PoolClient } from 'pg';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUPPORTED_EVENT_TYPES = new Set([
  'opening_cash_mismatch',
  'reconciliation_discrepancy',
  'temporary_handover_discrepancy'
]);
const SUPPORTED_EVENT_STATUSES = new Set([
  'detected',
  'pending_notification',
  'pending_manager_review',
  'resolved',
  'closed'
]);
const SUPPORTED_REVIEW_DECISIONS = new Set([
  'acknowledged',
  'accepted',
  'corrected',
  'escalated',
  'rejected'
]);
const SUPPORTED_REVIEW_ACTION_TYPES = new Set([
  'no_change',
  'manager_note_only',
  'cash_adjustment_reviewed',
  'handover_reviewed',
  'follow_up_required'
]);
const SUPPORTED_REVIEW_OUTCOME_STATUSES = new Set([
  'closed',
  'pending_follow_up',
  'escalated'
]);
const MANAGER_OR_HIGHER_ROLES = new Set(['management', 'manager', 'admin']);

type DiscrepancyEventPayload = {
  event_type: string;
  source_module: string;
  shift_session_id: string | null;
  report_header_id: string | null;
  location_code: string;
  department_code: string;
  department_id: string | null;
  created_by: string;
  discrepancy_type: string;
  discrepancy_amount: number | null;
  note: string | null;
  manager_resolution_preview: unknown;
  admin_summary_required: boolean;
  status: string;
};

type QueueInsertPayload = {
  source_event_id: string;
  notification_type: 'discrepancy_alert' | 'admin_summary';
  primary_recipient_employee_id: string | null;
  fallback_recipient_employee_id: string | null;
  admin_summary_required: boolean;
  payload_json: unknown;
  status: 'queued';
};

type QueueablePreviewRecipient = {
  id: string;
};

type QueueableManagerResolutionPreview = {
  primary_recipient?: QueueablePreviewRecipient | null;
  fallback_recipient?: QueueablePreviewRecipient | null;
  admin_summary_required?: boolean;
  resolution_path?: string;
};

type CurrentUserContext = {
  username: string;
  role: string;
  isManagerOrHigher: boolean;
};

type ReviewOutcomePayload = {
  decision: string;
  decision_note: string | null;
  action_type: string;
  final_outcome_status: string;
};

type DiscrepancyEventRow = {
  id: string;
  status: string;
};

type DiscrepancyEventListFilters = {
  location_code: string | null;
  department_code: string | null;
  event_type: string | null;
  status: string | null;
  created_by: string | null;
  created_at_from: string | null;
  created_at_to: string | null;
  limit: number;
  offset: number;
};

type DiscrepancyEventListRow = {
  event_id: string;
  event_type: string;
  source_module: string;
  shift_session_id: string | null;
  report_header_id: string | null;
  location_code: string;
  department_code: string;
  department_id: string | null;
  created_by: string;
  created_at: string;
  discrepancy_type: string;
  discrepancy_amount: number | null;
  note: string | null;
  admin_summary_required: boolean;
  status: string;
};

type DiscrepancyEventListCountRow = {
  total_count: number;
};

type DiscrepancyEventListResponse = {
  items: DiscrepancyEventListRow[];
  total_count: number;
  limit: number;
  offset: number;
};

type DiscrepancyEventDetailSourceRow = {
  id: string;
  event_type: string;
  source_module: string;
  shift_session_id: string | null;
  report_header_id: string | null;
  location_code: string;
  department_code: string;
  department_id: string | null;
  created_by: string;
  created_at: string;
  discrepancy_type: string;
  discrepancy_amount: number | null;
  note: string | null;
  manager_resolution_preview_json: unknown;
  admin_summary_required: boolean;
  status: string;
};

type DiscrepancyEventDetailRow = {
  event_id: string;
  event_type: string;
  source_module: string;
  shift_session_id: string | null;
  report_header_id: string | null;
  location_code: string;
  department_code: string;
  department_id: string | null;
  created_by: string;
  created_at: string;
  discrepancy_type: string;
  discrepancy_amount: number | null;
  note: string | null;
  manager_resolution_preview: unknown;
  admin_summary_required: boolean;
  status: string;
};

type ManagerReviewOutcomeRow = {
  review_id: string;
  source_event_id: string;
  reviewed_by: string;
  reviewed_at: string;
  decision: string;
  decision_note: string | null;
  action_type: string;
  final_outcome_status: string;
  admin_summary_generated: boolean;
};

type DiscrepancyEventQueueSourceRow = {
  id: string;
  source_event_id: string;
  notification_type: string;
  primary_recipient_employee_id: string | null;
  fallback_recipient_employee_id: string | null;
  admin_summary_required: boolean;
  payload_json: unknown;
  status: string;
  created_at: string;
  scheduled_at: string | null;
  processed_at: string | null;
  error_note: string | null;
};

type DiscrepancyEventQueueRow = {
  queue_id: string;
  source_event_id: string;
  notification_type: string;
  primary_recipient_employee_id: string | null;
  fallback_recipient_employee_id: string | null;
  admin_summary_required: boolean;
  payload_json: unknown;
  status: string;
  created_at: string;
  scheduled_at: string | null;
  processed_at: string | null;
  error_note: string | null;
};

type DiscrepancyEventDetailResponse = {
  event: DiscrepancyEventDetailRow;
  queue_items: DiscrepancyEventQueueRow[];
  latest_review: ManagerReviewOutcomeRow | null;
};

const DISCREPANCY_EVENT_LIST_FILTER_SQL = `
  WHERE 1 = 1
    AND ($1::text IS NULL OR e.location_code = $1)
    AND ($2::text IS NULL OR e.department_code = $2)
    AND ($3::text IS NULL OR e.event_type = $3)
    AND ($4::text IS NULL OR e.status = $4)
    AND ($5::text IS NULL OR e.created_by = $5)
    AND ($6::timestamptz IS NULL OR e.created_at >= $6)
    AND ($7::timestamptz IS NULL OR e.created_at < $7)
`;

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

const getSingleHeaderValue = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) return value[0];
  return value;
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

const getHeaderText = (req: Request, ...names: string[]): string | undefined => {
  for (const name of names) {
    const value = getSingleHeaderValue(req.headers[name.toLowerCase()] as string | string[] | undefined);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

const normalizeRequiredText = (value: unknown, key: string): string => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiRequestError(400, `${key} is required`);
  }
  return value.trim();
};

const normalizeRole = (value: string | undefined): string => {
  return value ? value.trim().toLowerCase() : 'operational';
};

const resolveCurrentUserContext = (req: Request): CurrentUserContext => {
  // TODO: Replace header-based placeholder identity with the real shared auth/session source.
  const username =
    getHeaderText(req, 'x-auth-user', 'x-user', 'x-directus-user', 'x-user-name') ?? 'placeholder-user';
  const role = normalizeRole(getHeaderText(req, 'x-eos-role', 'x-role', 'x-user-role'));
  return {
    username,
    role,
    isManagerOrHigher: MANAGER_OR_HIGHER_ROLES.has(role)
  };
};

const normalizeRequiredUuidPathValue = (value: unknown, key: string): string => {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new ApiRequestError(400, `${key} must be a valid UUID`);
  }
  return value.trim();
};

const normalizeRequiredCode = (value: unknown, key: string): string => {
  return normalizeRequiredText(value, key).toUpperCase();
};

const normalizeOptionalCode = (value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null;
  const normalized = String(value).trim().toUpperCase();
  return normalized || null;
};

const normalizeOptionalUuid = (value: unknown, key: string): string | null => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new ApiRequestError(400, `${key} must be a valid UUID when provided`);
  }
  return value.trim();
};

const normalizeOptionalNumber = (value: unknown, key: string): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiRequestError(400, `${key} must be numeric when provided`);
  }
  return Number(parsed.toFixed(2));
};

const normalizeOptionalText = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
};

const normalizeOptionalDateTime = (value: unknown, key: string): string | null => {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value).trim();
  if (!text || !Number.isFinite(Date.parse(text))) {
    throw new ApiRequestError(400, `${key} must be a valid datetime when provided`);
  }
  return text;
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

const normalizeBoolean = (value: unknown, key: string, defaultValue?: boolean): boolean => {
  if (value === undefined || value === null) {
    if (typeof defaultValue === 'boolean') return defaultValue;
    throw new ApiRequestError(400, `${key} must be a boolean`);
  }
  if (typeof value !== 'boolean') {
    throw new ApiRequestError(400, `${key} must be a boolean`);
  }
  return value;
};

const normalizeEventType = (value: unknown): string => {
  const eventType = normalizeRequiredText(value, 'event_type');
  if (!SUPPORTED_EVENT_TYPES.has(eventType)) {
    throw new ApiRequestError(400, 'event_type is not supported');
  }
  return eventType;
};

const normalizeStatus = (value: unknown): string => {
  const status = normalizeRequiredText(value, 'status');
  if (!SUPPORTED_EVENT_STATUSES.has(status)) {
    throw new ApiRequestError(400, 'status is not supported');
  }
  return status;
};

const normalizeReviewDecision = (value: unknown): string => {
  const decision = normalizeRequiredText(value, 'decision').toLowerCase();
  if (!SUPPORTED_REVIEW_DECISIONS.has(decision)) {
    throw new ApiRequestError(400, 'decision is not supported');
  }
  return decision;
};

const normalizeReviewActionType = (value: unknown): string => {
  const actionType = normalizeRequiredText(value, 'action_type').toLowerCase();
  if (!SUPPORTED_REVIEW_ACTION_TYPES.has(actionType)) {
    throw new ApiRequestError(400, 'action_type is not supported');
  }
  return actionType;
};

const normalizeReviewOutcomeStatus = (value: unknown): string => {
  const outcomeStatus = normalizeRequiredText(value, 'final_outcome_status').toLowerCase();
  if (!SUPPORTED_REVIEW_OUTCOME_STATUSES.has(outcomeStatus)) {
    throw new ApiRequestError(400, 'final_outcome_status is not supported');
  }
  return outcomeStatus;
};

const parseDiscrepancyEventPayload = (req: Request): DiscrepancyEventPayload => {
  const payload = getRequestBodyRecord(req);
  return {
    event_type: normalizeEventType(payload.event_type),
    source_module: normalizeRequiredText(payload.source_module, 'source_module'),
    shift_session_id: normalizeOptionalUuid(payload.shift_session_id, 'shift_session_id'),
    report_header_id: normalizeOptionalUuid(payload.report_header_id, 'report_header_id'),
    location_code: normalizeRequiredCode(payload.location_code, 'location_code'),
    department_code: normalizeRequiredCode(payload.department_code, 'department_code'),
    department_id: normalizeOptionalUuid(payload.department_id, 'department_id'),
    created_by: normalizeRequiredText(payload.created_by, 'created_by'),
    discrepancy_type: normalizeRequiredText(payload.discrepancy_type, 'discrepancy_type'),
    discrepancy_amount: normalizeOptionalNumber(payload.discrepancy_amount, 'discrepancy_amount'),
    note: normalizeOptionalText(payload.note),
    manager_resolution_preview: payload.manager_resolution_preview ?? null,
    admin_summary_required: normalizeBoolean(
      payload.admin_summary_required,
      'admin_summary_required',
      true
    ),
    status: normalizeStatus(payload.status)
  };
};

const parseDiscrepancyEventListFilters = (req: Request): DiscrepancyEventListFilters => {
  const query = req.query as Record<string, unknown>;
  return {
    location_code: normalizeOptionalCode(getSingleQueryValue(query.location_code, 'location_code')),
    department_code: normalizeOptionalCode(getSingleQueryValue(query.department_code, 'department_code')),
    event_type: normalizeOptionalText(getSingleQueryValue(query.event_type, 'event_type')),
    status: normalizeOptionalText(getSingleQueryValue(query.status, 'status')),
    created_by: normalizeOptionalText(getSingleQueryValue(query.created_by, 'created_by')),
    created_at_from: normalizeOptionalDateTime(
      getSingleQueryValue(query.created_at_from, 'created_at_from'),
      'created_at_from'
    ),
    created_at_to: normalizeOptionalDateTime(
      getSingleQueryValue(query.created_at_to, 'created_at_to'),
      'created_at_to'
    ),
    limit: normalizeOptionalNonNegativeInteger(getSingleQueryValue(query.limit, 'limit'), 'limit', 50, 500),
    offset: normalizeOptionalNonNegativeInteger(getSingleQueryValue(query.offset, 'offset'), 'offset', 0, 100000)
  };
};

const parseReviewOutcomePayload = (req: Request): ReviewOutcomePayload => {
  const payload = getRequestBodyRecord(req);
  return {
    decision: normalizeReviewDecision(payload.decision),
    decision_note: normalizeOptionalText(payload.decision_note),
    action_type: normalizeReviewActionType(payload.action_type),
    final_outcome_status: normalizeReviewOutcomeStatus(payload.final_outcome_status)
  };
};

const getUpdatedDiscrepancyEventStatus = (finalOutcomeStatus: string): string => {
  if (finalOutcomeStatus === 'closed') return 'closed';
  if (finalOutcomeStatus === 'pending_follow_up') return 'pending_manager_review';
  return 'pending_notification';
};

const parseManagerResolutionPreviewJson = (value: unknown): unknown => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
};

const parseStoredJsonValue = (value: unknown): unknown => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
};

const asQueueableManagerResolutionPreview = (
  value: unknown
): QueueableManagerResolutionPreview | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as QueueableManagerResolutionPreview;
};

const getPreviewRecipientId = (
  preview: QueueableManagerResolutionPreview | null,
  key: 'primary_recipient' | 'fallback_recipient'
): string | null => {
  const recipient = preview && preview[key];
  if (!recipient || typeof recipient !== 'object') return null;
  const id = typeof recipient.id === 'string' ? recipient.id.trim() : '';
  return UUID_PATTERN.test(id) ? id : null;
};

const buildQueueInsertPayloads = (
  eventId: string,
  payload: DiscrepancyEventPayload
): QueueInsertPayload[] => {
  const preview = asQueueableManagerResolutionPreview(payload.manager_resolution_preview);
  const primaryRecipientEmployeeId = getPreviewRecipientId(preview, 'primary_recipient');
  const fallbackRecipientEmployeeId = getPreviewRecipientId(preview, 'fallback_recipient');
  const queueItems: QueueInsertPayload[] = [];

  if (primaryRecipientEmployeeId) {
    queueItems.push({
      source_event_id: eventId,
      notification_type: 'discrepancy_alert',
      primary_recipient_employee_id: primaryRecipientEmployeeId,
      fallback_recipient_employee_id: fallbackRecipientEmployeeId,
      admin_summary_required: payload.admin_summary_required,
      payload_json: {
        event_type: payload.event_type,
        source_module: payload.source_module,
        location_code: payload.location_code,
        department_code: payload.department_code,
        discrepancy_type: payload.discrepancy_type,
        discrepancy_amount: payload.discrepancy_amount,
        note: payload.note,
        resolution_path: preview && typeof preview.resolution_path === 'string'
          ? preview.resolution_path
          : null
      },
      status: 'queued'
    });
  }

  if (payload.admin_summary_required) {
    queueItems.push({
      source_event_id: eventId,
      notification_type: 'admin_summary',
      primary_recipient_employee_id: null,
      fallback_recipient_employee_id: null,
      admin_summary_required: true,
      payload_json: {
        event_type: payload.event_type,
        source_module: payload.source_module,
        location_code: payload.location_code,
        department_code: payload.department_code,
        discrepancy_type: payload.discrepancy_type,
        discrepancy_amount: payload.discrepancy_amount,
        note: payload.note
      },
      status: 'queued'
    });
  }

  return queueItems;
};

const insertDiscrepancyEvent = async (
  client: PoolClient,
  payload: DiscrepancyEventPayload
): Promise<{ id: string; created_at: string }> => {
  const eventId = randomUUID();
  const previewJson =
    payload.manager_resolution_preview === null
      ? null
      : JSON.stringify(payload.manager_resolution_preview);

  const result = await client.query<{ id: string; created_at: string }>(
    `
      INSERT INTO eos_discrepancy_event (
        id,
        event_type,
        source_module,
        shift_session_id,
        report_header_id,
        location_code,
        department_code,
        department_id,
        created_by,
        discrepancy_type,
        discrepancy_amount,
        note,
        manager_resolution_preview_json,
        admin_summary_required,
        status
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
        $12,
        $13::jsonb,
        $14,
        $15
      )
      RETURNING id, created_at::text AS created_at
    `,
    [
      eventId,
      payload.event_type,
      payload.source_module,
      payload.shift_session_id,
      payload.report_header_id,
      payload.location_code,
      payload.department_code,
      payload.department_id,
      payload.created_by,
      payload.discrepancy_type,
      payload.discrepancy_amount,
      payload.note,
      previewJson,
      payload.admin_summary_required,
      payload.status
    ]
  );

  return result.rows[0];
};

const insertNotificationQueueRows = async (
  client: PoolClient,
  queueItems: QueueInsertPayload[]
): Promise<number> => {
  let insertedCount = 0;
  for (const item of queueItems) {
    await client.query(
      `
        INSERT INTO eos_notification_queue (
          id,
          source_event_id,
          notification_type,
          primary_recipient_employee_id,
          fallback_recipient_employee_id,
          admin_summary_required,
          payload_json,
          status,
          created_at,
          scheduled_at,
          processed_at,
          error_note
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7::jsonb,
          $8,
          NOW(),
          NULL,
          NULL,
          NULL
        )
      `,
      [
        randomUUID(),
        item.source_event_id,
        item.notification_type,
        item.primary_recipient_employee_id,
        item.fallback_recipient_employee_id,
        item.admin_summary_required,
        JSON.stringify(item.payload_json ?? null),
        item.status
      ]
    );
    insertedCount += 1;
  }
  return insertedCount;
};

const buildDiscrepancyEventListFilterParams = (
  filters: DiscrepancyEventListFilters
): Array<string | number | null> => [
  filters.location_code,
  filters.department_code,
  filters.event_type,
  filters.status,
  filters.created_by,
  filters.created_at_from,
  filters.created_at_to
];

const listDiscrepancyEvents = async (
  client: PoolClient,
  filters: DiscrepancyEventListFilters
): Promise<DiscrepancyEventListRow[]> => {
  const filterValues = buildDiscrepancyEventListFilterParams(filters);
  const result = await client.query<DiscrepancyEventListRow>(
    `
      SELECT
        e.id::text AS event_id,
        e.event_type,
        e.source_module,
        e.shift_session_id::text AS shift_session_id,
        e.report_header_id::text AS report_header_id,
        e.location_code,
        e.department_code,
        e.department_id::text AS department_id,
        e.created_by,
        e.created_at::text AS created_at,
        e.discrepancy_type,
        e.discrepancy_amount,
        e.note,
        e.admin_summary_required,
        e.status
      FROM eos_discrepancy_event e
      ${DISCREPANCY_EVENT_LIST_FILTER_SQL}
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $8 OFFSET $9
    `,
    [
      ...filterValues,
      filters.limit,
      filters.offset
    ]
  );

  return result.rows;
};

const countDiscrepancyEvents = async (
  client: PoolClient,
  filters: DiscrepancyEventListFilters
): Promise<number> => {
  const filterValues = buildDiscrepancyEventListFilterParams(filters);
  const result = await client.query<DiscrepancyEventListCountRow>(
    `
      SELECT COUNT(*)::int AS total_count
      FROM eos_discrepancy_event e
      ${DISCREPANCY_EVENT_LIST_FILTER_SQL}
    `,
    filterValues
  );

  return result.rows[0] ? Number(result.rows[0].total_count || 0) : 0;
};

const loadDiscrepancyEventDetailById = async (
  client: PoolClient,
  eventId: string
): Promise<DiscrepancyEventDetailRow | null> => {
  const result = await client.query<DiscrepancyEventDetailSourceRow>(
    `
      SELECT *
      FROM eos_discrepancy_event
      WHERE id = $1
      LIMIT 1
    `,
    [eventId]
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    event_id: row.id,
    event_type: row.event_type,
    source_module: row.source_module,
    shift_session_id: row.shift_session_id,
    report_header_id: row.report_header_id,
    location_code: row.location_code,
    department_code: row.department_code,
    department_id: row.department_id,
    created_by: row.created_by,
    created_at: row.created_at,
    discrepancy_type: row.discrepancy_type,
    discrepancy_amount: row.discrepancy_amount,
    note: row.note,
    manager_resolution_preview: parseManagerResolutionPreviewJson(row.manager_resolution_preview_json),
    admin_summary_required: row.admin_summary_required,
    status: row.status
  };
};

const loadDiscrepancyEventById = async (
  client: PoolClient,
  eventId: string
): Promise<DiscrepancyEventRow | null> => {
  const result = await client.query<DiscrepancyEventRow>(
    `
      SELECT
        id,
        status
      FROM eos_discrepancy_event
      WHERE id = $1
      LIMIT 1
    `,
    [eventId]
  );

  return result.rows[0] ?? null;
};

const loadLatestManagerReviewOutcome = async (
  client: PoolClient,
  eventId: string
): Promise<ManagerReviewOutcomeRow | null> => {
  const result = await client.query<ManagerReviewOutcomeRow>(
    `
      SELECT
        review_id::text AS review_id,
        source_event_id::text AS source_event_id,
        reviewed_by,
        reviewed_at::text AS reviewed_at,
        decision,
        decision_note,
        action_type,
        final_outcome_status,
        admin_summary_generated
      FROM eos_manager_review_outcome
      WHERE source_event_id = $1
      ORDER BY reviewed_at DESC, review_id DESC
      LIMIT 1
    `,
    [eventId]
  );

  return result.rows[0] ?? null;
};

const loadDiscrepancyEventQueueRows = async (
  client: PoolClient,
  eventId: string
): Promise<DiscrepancyEventQueueRow[]> => {
  const result = await client.query<DiscrepancyEventQueueSourceRow>(
    `
      SELECT
        id::text AS id,
        source_event_id::text AS source_event_id,
        notification_type,
        primary_recipient_employee_id::text AS primary_recipient_employee_id,
        fallback_recipient_employee_id::text AS fallback_recipient_employee_id,
        admin_summary_required,
        payload_json,
        status,
        created_at::text AS created_at,
        scheduled_at::text AS scheduled_at,
        processed_at::text AS processed_at,
        error_note
      FROM eos_notification_queue
      WHERE source_event_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [eventId]
  );

  return result.rows.map((row: DiscrepancyEventQueueSourceRow) => ({
    queue_id: row.id,
    source_event_id: row.source_event_id,
    notification_type: row.notification_type,
    primary_recipient_employee_id: row.primary_recipient_employee_id,
    fallback_recipient_employee_id: row.fallback_recipient_employee_id,
    admin_summary_required: row.admin_summary_required,
    payload_json: parseStoredJsonValue(row.payload_json),
    status: row.status,
    created_at: row.created_at,
    scheduled_at: row.scheduled_at,
    processed_at: row.processed_at,
    error_note: row.error_note
  }));
};

const insertManagerReviewOutcome = async (
  client: PoolClient,
  sourceEventId: string,
  reviewedBy: string,
  payload: ReviewOutcomePayload
): Promise<{ review_id: string; reviewed_at: string; admin_summary_generated: boolean }> => {
  const reviewId = randomUUID();
  const result = await client.query<{
    review_id: string;
    reviewed_at: string;
    admin_summary_generated: boolean;
  }>(
    `
      INSERT INTO eos_manager_review_outcome (
        review_id,
        source_event_id,
        reviewed_by,
        reviewed_at,
        decision,
        decision_note,
        action_type,
        final_outcome_status,
        admin_summary_generated
      )
      VALUES (
        $1,
        $2,
        $3,
        NOW(),
        $4,
        $5,
        $6,
        $7,
        false
      )
      RETURNING
        review_id,
        reviewed_at::text AS reviewed_at,
        admin_summary_generated
    `,
    [
      reviewId,
      sourceEventId,
      reviewedBy,
      payload.decision,
      payload.decision_note,
      payload.action_type,
      payload.final_outcome_status
    ]
  );

  return result.rows[0];
};

const updateDiscrepancyEventStatus = async (
  client: PoolClient,
  eventId: string,
  status: string
): Promise<string> => {
  const result = await client.query<{ status: string }>(
    `
      UPDATE eos_discrepancy_event
      SET status = $2
      WHERE id = $1
      RETURNING status
    `,
    [eventId, status]
  );

  return result.rows[0].status;
};

export const handleListDiscrepancyEventsRequest = async (
  pg: PgPool,
  req: Request,
  res: Response
) => {
  let client: PoolClient | null = null;
  try {
    // TODO: Harden discrepancy-review list access with the final shared auth/access layer.
    // Current implementation is read-only and intentionally keeps management gating
    // as a backend/UI placeholder until centralized auth claims are finalized.
    const filters = parseDiscrepancyEventListFilters(req);
    client = await pg.connect();
    const [items, total_count] = await Promise.all([
      listDiscrepancyEvents(client, filters),
      countDiscrepancyEvents(client, filters)
    ]);
    const payload: DiscrepancyEventListResponse = {
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

export const handleGetDiscrepancyEventRequest = async (
  pg: PgPool,
  req: Request,
  res: Response
) => {
  let client: PoolClient | null = null;
  try {
    // TODO: Harden discrepancy-review detail access with the final shared auth/access layer.
    // Current implementation is read-only and intentionally leaves final role enforcement
    // to the future shared management auth policy.
    const eventId = normalizeRequiredUuidPathValue(req.params.id, 'id');
    client = await pg.connect();
    const event = await loadDiscrepancyEventDetailById(client, eventId);
    if (!event) {
      throw new ApiRequestError(404, 'Discrepancy event not found');
    }
    const [queue_items, latest_review] = await Promise.all([
      loadDiscrepancyEventQueueRows(client, eventId),
      loadLatestManagerReviewOutcome(client, eventId)
    ]);
    const payload: DiscrepancyEventDetailResponse = {
      event,
      queue_items,
      latest_review
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

export const handleCreateDiscrepancyEventRequest = async (
  pg: PgPool,
  req: Request,
  res: Response
) => {
  let client: PoolClient | null = null;
  try {
    // TODO: Replace simple queue-row creation with a shared notification workflow
    // that supports delivery scheduling, retries, and channel-specific processing.
    // TODO: Resolve the concrete admin recipient target before turning queued
    // admin_summary items into real deliveries.
    // TODO: Align caller identity with the final shared EOS auth/session source
    // instead of trusting payload-created_by alone.
    const payload = parseDiscrepancyEventPayload(req);
    client = await pg.connect();
    await client.query('BEGIN');
    const created = await insertDiscrepancyEvent(client, payload);
    const queueItems = buildQueueInsertPayloads(created.id, payload);
    const queueItemsCreated = queueItems.length
      ? await insertNotificationQueueRows(client, queueItems)
      : 0;
    await client.query('COMMIT');
    return res.status(201).json({
      ...created,
      queue_items_created: queueItemsCreated
    });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof ApiRequestError ? error.status : 500;
    return res.status(status).json({ ok: false, error: message });
  } finally {
    client?.release();
  }
};

export const handleCreateDiscrepancyEventReviewRequest = async (
  pg: PgPool,
  req: Request,
  res: Response
) => {
  let client: PoolClient | null = null;
  try {
    const currentUser = resolveCurrentUserContext(req);
    if (!currentUser.isManagerOrHigher) {
      throw new ApiRequestError(403, 'Manager-or-higher access is required');
    }

    const eventId = normalizeRequiredUuidPathValue(req.params.id, 'id');
    const payload = parseReviewOutcomePayload(req);
    const nextEventStatus = getUpdatedDiscrepancyEventStatus(payload.final_outcome_status);

    client = await pg.connect();
    await client.query('BEGIN');

    const eventRow = await loadDiscrepancyEventById(client, eventId);
    if (!eventRow) {
      throw new ApiRequestError(404, 'Discrepancy event not found');
    }

    const review = await insertManagerReviewOutcome(client, eventId, currentUser.username, payload);
    const discrepancyEventStatus = await updateDiscrepancyEventStatus(client, eventId, nextEventStatus);

    // TODO: Use the persisted review outcome to generate admin outcome-summary
    // queue items once the manager-outcome notification flow is implemented.
    // TODO: Later connect this review outcome to report audit/history as needed.
    await client.query('COMMIT');

    return res.status(201).json({
      review_id: review.review_id,
      reviewed_at: review.reviewed_at,
      discrepancy_event_status: discrepancyEventStatus,
      admin_summary_generated: review.admin_summary_generated
    });
  } catch (error) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    const message = error instanceof Error ? error.message : String(error);
    const status = error instanceof ApiRequestError ? error.status : 500;
    return res.status(status).json({ ok: false, error: message });
  } finally {
    client?.release();
  }
};
