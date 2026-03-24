import { randomUUID } from 'node:crypto';
const SHIFT_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHIFT_TIME_PATTERN = /^\d{2}:\d{2}(?::\d{2})?$/;
const ACTIVE_SHIFT_STATUSES = ['open', 'report_in_progress'];
const UNRESOLVED_SHIFT_STATUSES = [
    'submitted',
    'temporary_closed_pending_review',
    'temporary_handover_started',
    'manager_review_required'
];
const MANAGER_OR_HIGHER_ROLES = new Set(['management', 'manager', 'admin']);
class DuplicateShiftSessionError extends Error {
    constructor() {
        super('Shift session already exists');
    }
}
const getSingleHeaderValue = (value) => {
    if (Array.isArray(value))
        return value[0];
    return value;
};
const getHeaderText = (req, ...names) => {
    for (const name of names) {
        const value = getSingleHeaderValue(req.headers[name.toLowerCase()]);
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return undefined;
};
const normalizeRequiredText = (value, key) => {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${key} is required`);
    }
    return value.trim().toUpperCase();
};
const normalizeRequiredFreeText = (value, key) => {
    if (typeof value !== 'string' || !value.trim()) {
        throw new Error(`${key} is required`);
    }
    return value.trim();
};
const normalizeShiftDate = (value) => {
    const shiftDate = normalizeRequiredText(value, 'shift_date');
    if (!SHIFT_DATE_PATTERN.test(shiftDate)) {
        throw new Error('shift_date must be in YYYY-MM-DD format');
    }
    return shiftDate;
};
const normalizeShiftTime = (value) => {
    const rawValue = typeof value === 'string' ? value.trim() : '';
    if (!rawValue) {
        throw new Error('shift_start_time is required');
    }
    if (!SHIFT_TIME_PATTERN.test(rawValue)) {
        throw new Error('shift_start_time must be in HH:MM or HH:MM:SS format');
    }
    return rawValue.length === 5 ? `${rawValue}:00` : rawValue;
};
const normalizeBoolean = (value, key) => {
    if (typeof value !== 'boolean') {
        throw new Error(`${key} must be a boolean`);
    }
    return value;
};
const normalizeOptionalBoolean = (value) => {
    if (value === undefined || value === null)
        return false;
    if (typeof value !== 'boolean') {
        throw new Error('manager_unavailable must be a boolean when provided');
    }
    return value;
};
const normalizeNonNegativeNumber = (value, key) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`${key} must be numeric`);
    }
    if (parsed < 0) {
        throw new Error(`${key} must be greater than or equal to 0`);
    }
    return Number(parsed.toFixed(2));
};
const normalizeOptionalNumber = (value, key) => {
    if (value === undefined || value === null || value === '')
        return null;
    return normalizeNonNegativeNumber(value, key);
};
const getRequestBodyRecord = (req) => {
    const body = req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new Error('Request body must be a JSON object');
    }
    return body;
};
const parseCreateShiftSessionPayload = (payload) => {
    const openingCashMatches = normalizeBoolean(payload.opening_cash_matches, 'opening_cash_matches');
    const correctedOpeningCash = normalizeOptionalNumber(payload.corrected_opening_cash, 'corrected_opening_cash');
    if (!openingCashMatches && correctedOpeningCash === null) {
        throw new Error('corrected_opening_cash is required when opening_cash_matches is false');
    }
    return {
        location_code: normalizeRequiredText(payload.location_code, 'location_code'),
        department_code: normalizeRequiredText(payload.department_code, 'department_code'),
        clinic_code: normalizeRequiredText(payload.clinic_code, 'clinic_code'),
        shift_date: normalizeShiftDate(payload.shift_date),
        shift_start_time: normalizeShiftTime(payload.shift_start_time),
        opening_cash: normalizeNonNegativeNumber(payload.opening_cash, 'opening_cash'),
        opening_cash_matches: openingCashMatches,
        previous_cashbox_end: normalizeOptionalNumber(payload.previous_cashbox_end, 'previous_cashbox_end'),
        corrected_opening_cash: correctedOpeningCash,
        manager_unavailable: normalizeOptionalBoolean(payload.manager_unavailable)
    };
};
const parseRequestBody = (req) => {
    return parseCreateShiftSessionPayload(getRequestBodyRecord(req));
};
const parseTakeoverRequestBody = (req) => {
    const payload = getRequestBodyRecord(req);
    return {
        takeover_reason: normalizeRequiredFreeText(payload.takeover_reason, 'takeover_reason')
    };
};
const parseAbandonRequestBody = (req) => {
    const payload = getRequestBodyRecord(req);
    return {
        abandon_reason: normalizeRequiredFreeText(payload.abandon_reason, 'abandon_reason')
    };
};
const parseSupersedeRequestBody = (req) => {
    const payload = getRequestBodyRecord(req);
    return {
        ...parseCreateShiftSessionPayload(payload),
        supersede_reason: normalizeRequiredFreeText(payload.supersede_reason, 'supersede_reason')
    };
};
const normalizeRole = (value) => {
    if (!value)
        return 'operational';
    const normalized = value.trim().toLowerCase();
    if (normalized === 'admin')
        return 'admin';
    if (normalized === 'management' || normalized === 'manager')
        return 'management';
    if (normalized === 'supervisor')
        return 'supervisor';
    return 'operational';
};
const resolveCurrentUserContext = (req) => {
    // TODO: Replace header-based placeholder identity with the real EOS auth/session source.
    const username = getHeaderText(req, 'x-auth-user', 'x-user', 'x-directus-user', 'x-user-name') ?? 'placeholder-user';
    const role = normalizeRole(getHeaderText(req, 'x-eos-role', 'x-role', 'x-user-role'));
    return {
        username,
        role,
        isManagerOrHigher: MANAGER_OR_HIGHER_ROLES.has(role)
    };
};
const mapShiftSessionRow = (row) => ({
    id: String(row.id),
    location_code: String(row.location_code ?? ''),
    department_code: String(row.department_code ?? ''),
    clinic_code: String(row.clinic_code ?? ''),
    shift_date: String(row.shift_date ?? ''),
    shift_start_time: String(row.shift_start_time ?? ''),
    opening_cash: Number(row.opening_cash ?? 0),
    opening_cash_matches: Boolean(row.opening_cash_matches),
    previous_cashbox_end: row.previous_cashbox_end === null || row.previous_cashbox_end === undefined
        ? null
        : Number(row.previous_cashbox_end),
    corrected_opening_cash: row.corrected_opening_cash === null || row.corrected_opening_cash === undefined
        ? null
        : Number(row.corrected_opening_cash),
    created_at: new Date(String(row.created_at)).toISOString(),
    created_by: String(row.created_by ?? ''),
    current_owner: String(row.current_owner ?? ''),
    taken_over_from_user: row.taken_over_from_user === null || row.taken_over_from_user === undefined
        ? null
        : String(row.taken_over_from_user),
    taken_over_at: row.taken_over_at === null || row.taken_over_at === undefined
        ? null
        : new Date(String(row.taken_over_at)).toISOString(),
    takeover_reason: row.takeover_reason === null || row.takeover_reason === undefined
        ? null
        : String(row.takeover_reason),
    status: String(row.status ?? '')
});
const toShiftSessionSummary = (row) => ({
    id: row.id,
    location_code: row.location_code,
    current_owner: row.current_owner,
    status: row.status,
    clinic_code: row.clinic_code,
    department_code: row.department_code,
    shift_date: row.shift_date,
    shift_start_time: row.shift_start_time,
    created_at: row.created_at,
    created_by: row.created_by,
    taken_over_from_user: row.taken_over_from_user,
    taken_over_at: row.taken_over_at,
    takeover_reason: row.takeover_reason
});
const assertManagerOrHigher = (user) => {
    if (!user.isManagerOrHigher) {
        throw new Error('Manager or admin access is required');
    }
};
const isActiveShiftStatus = (status) => {
    return ACTIVE_SHIFT_STATUSES.includes(status);
};
const isUnresolvedShiftStatus = (status) => {
    return UNRESOLVED_SHIFT_STATUSES.includes(status);
};
const normalizeRequiredSessionIdParam = (req) => {
    const sessionId = String(req.params.id || '').trim();
    if (!sessionId) {
        throw new Error('shift session id is required');
    }
    return sessionId;
};
const findLatestShiftByLocationAndStatuses = async (client, locationCode, statuses) => {
    const result = await client.query(`SELECT
       id::text AS id,
       location_code,
       department_code,
       clinic_code,
       shift_date::text AS shift_date,
       to_char(shift_start_time, 'HH24:MI:SS') AS shift_start_time,
       opening_cash,
       opening_cash_matches,
       previous_cashbox_end,
       corrected_opening_cash,
       created_at,
       created_by,
       current_owner,
       taken_over_from_user,
       taken_over_at,
       takeover_reason,
       status
     FROM eos_shift_session
     WHERE location_code = $1
       AND status = ANY($2::text[])
     ORDER BY created_at DESC
     LIMIT 1`, [locationCode, statuses]);
    if (!result.rows.length) {
        return null;
    }
    return mapShiftSessionRow(result.rows[0]);
};
const findDuplicateShiftSession = async (client, payload) => {
    const result = await client.query(`SELECT
       id::text AS id,
       location_code,
       department_code,
       clinic_code,
       shift_date::text AS shift_date,
       to_char(shift_start_time, 'HH24:MI:SS') AS shift_start_time,
       opening_cash,
       opening_cash_matches,
       previous_cashbox_end,
       corrected_opening_cash,
       created_at,
       created_by,
       current_owner,
       taken_over_from_user,
       taken_over_at,
       takeover_reason,
       status
     FROM eos_shift_session
     WHERE clinic_code = $1
       AND shift_date = $2::date
       AND shift_start_time = $3::time
     ORDER BY created_at DESC
     LIMIT 1`, [payload.clinic_code, payload.shift_date, payload.shift_start_time]);
    if (!result.rows.length) {
        return null;
    }
    return mapShiftSessionRow(result.rows[0]);
};
const insertShiftSession = async (client, payload, user, options = {}) => {
    const result = await client.query(`INSERT INTO eos_shift_session (
       id,
       location_code,
       department_code,
       clinic_code,
       shift_date,
       shift_start_time,
       opening_cash,
       opening_cash_matches,
       previous_cashbox_end,
       corrected_opening_cash,
       created_by,
       current_owner,
       supersedes_shift_session_id,
       status
     ) VALUES (
       $1,
       $2,
       $3,
       $4,
       $5::date,
       $6::time,
       $7,
       $8,
       $9,
       $10,
       $11,
       $12,
       $13,
       'open'
     )
     RETURNING
       id::text AS id,
       location_code,
       department_code,
       clinic_code,
       shift_date::text AS shift_date,
       to_char(shift_start_time, 'HH24:MI:SS') AS shift_start_time,
       opening_cash,
       opening_cash_matches,
       previous_cashbox_end,
       corrected_opening_cash,
       created_at,
       created_by,
       current_owner,
       taken_over_from_user,
       taken_over_at,
       takeover_reason,
       status`, [
        randomUUID(),
        payload.location_code,
        payload.department_code,
        payload.clinic_code,
        payload.shift_date,
        payload.shift_start_time,
        payload.opening_cash,
        payload.opening_cash_matches,
        payload.previous_cashbox_end,
        payload.corrected_opening_cash,
        user.username,
        user.username,
        options.supersedesShiftSessionId || null
    ]);
    return mapShiftSessionRow(result.rows[0]);
};
const findShiftSessionByIdForUpdate = async (client, shiftSessionId) => {
    const result = await client.query(`SELECT
       id::text AS id,
       location_code,
       department_code,
       clinic_code,
       shift_date::text AS shift_date,
       to_char(shift_start_time, 'HH24:MI:SS') AS shift_start_time,
       opening_cash,
       opening_cash_matches,
       previous_cashbox_end,
       corrected_opening_cash,
       created_at,
       created_by,
       current_owner,
       taken_over_from_user,
       taken_over_at,
       takeover_reason,
       status
     FROM eos_shift_session
     WHERE id::text = $1
     FOR UPDATE`, [shiftSessionId]);
    if (!result.rows.length) {
        return null;
    }
    return mapShiftSessionRow(result.rows[0]);
};
const buildCreateSuccessResponse = (row) => ({
    status: 201,
    body: {
        ok: true,
        id: row.id,
        created_at: row.created_at,
        shift_session: toShiftSessionSummary(row)
    }
});
const normalizeIsoDateTime = (value) => {
    const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return parsed.toISOString();
};
const buildShiftSessionAuditPayload = (options) => ({
    action: options.action,
    previous_owner: options.previousOwner,
    new_owner: options.newOwner,
    acted_by: options.actedBy,
    acted_at: options.actedAt || normalizeIsoDateTime(new Date()),
    reason: options.reason,
    shift_session_id: options.shiftSession.id,
    previous_shift_session_id: options.previousShiftSessionId ?? null,
    new_shift_session_id: options.newShiftSessionId ?? null
});
const buildTakeoverAuditPayload = (row, previousOwner, actingUser, takeoverReason) => buildShiftSessionAuditPayload({
    action: 'manager_takeover',
    shiftSession: row,
    previousOwner,
    newOwner: row.current_owner,
    actedBy: actingUser.username,
    actedAt: row.taken_over_at,
    reason: takeoverReason
});
const buildTakeoverSuccessResponse = (row, audit) => ({
    status: 200,
    body: {
        ok: true,
        message: 'Manager takeover completed',
        shift_session: toShiftSessionSummary(row),
        audit
    }
});
const buildAbandonSuccessResponse = (row, audit) => ({
    status: 200,
    body: {
        ok: true,
        message: 'Shift session marked abandoned',
        shift_session: toShiftSessionSummary(row),
        audit
    }
});
const buildSupersedeSuccessResponse = (row, audit) => ({
    status: 201,
    body: {
        ok: true,
        message: 'Previous shift superseded and new shift session created',
        shift_session: toShiftSessionSummary(row),
        audit
    }
});
const buildShiftSessionNotFoundResponse = () => ({
    status: 404,
    body: {
        ok: false,
        error: 'Shift session not found'
    }
});
const buildShiftSessionNotActiveResponse = (row) => ({
    status: 409,
    body: {
        ok: false,
        error: 'Shift session is not active',
        shift_session: toShiftSessionSummary(row)
    }
});
const buildShiftSessionNotUnresolvedResponse = (row) => ({
    status: 409,
    body: {
        ok: false,
        error: 'Shift session is not unresolved',
        shift_session: toShiftSessionSummary(row)
    }
});
const buildActiveShiftAlreadyExistsResponse = (row) => ({
    status: 409,
    body: {
        ok: false,
        error: 'Another active shift already exists for this location',
        shift_session: toShiftSessionSummary(row)
    }
});
const updateShiftSessionTakeover = async (client, row, actingUser, takeoverReason) => {
    const previousOwner = row.current_owner;
    const result = await client.query(`UPDATE eos_shift_session
     SET current_owner = $2,
         taken_over_from_user = $3,
         taken_over_at = NOW(),
         takeover_reason = $4
     WHERE id::text = $1
     RETURNING
       id::text AS id,
       location_code,
       department_code,
       clinic_code,
       shift_date::text AS shift_date,
       to_char(shift_start_time, 'HH24:MI:SS') AS shift_start_time,
       opening_cash,
       opening_cash_matches,
       previous_cashbox_end,
       corrected_opening_cash,
       created_at,
       created_by,
       current_owner,
       taken_over_from_user,
       taken_over_at,
       takeover_reason,
       status`, [row.id, actingUser.username, previousOwner, takeoverReason]);
    return mapShiftSessionRow(result.rows[0]);
};
const updateShiftSessionAbandon = async (client, row, actingUser, abandonReason) => {
    const result = await client.query(`UPDATE eos_shift_session
     SET status = 'abandoned',
         closed_at = NOW(),
         closed_by = $2,
         abandoned_at = NOW(),
         abandoned_by = $2,
         abandon_reason = $3
     WHERE id::text = $1
     RETURNING
       id::text AS id,
       location_code,
       department_code,
       clinic_code,
       shift_date::text AS shift_date,
       to_char(shift_start_time, 'HH24:MI:SS') AS shift_start_time,
       opening_cash,
       opening_cash_matches,
       previous_cashbox_end,
       corrected_opening_cash,
       created_at,
       created_by,
       current_owner,
       taken_over_from_user,
       taken_over_at,
       takeover_reason,
       status`, [row.id, actingUser.username, abandonReason]);
    return mapShiftSessionRow(result.rows[0]);
};
const updateShiftSessionSuperseded = async (client, previousShiftSessionId, newShiftSessionId, actingUser) => {
    await client.query(`UPDATE eos_shift_session
     SET status = 'superseded',
         closed_at = NOW(),
         closed_by = $3,
         superseded_by_shift_session_id = $2
     WHERE id::text = $1`, [previousShiftSessionId, newShiftSessionId, actingUser.username]);
};
const buildSameOwnerResumeResponse = (row) => ({
    status: 200,
    body: {
        ok: true,
        action_code: 'open_shift_exists_same_owner',
        message: 'Active EOS resumed for the same owner',
        id: row.id,
        created_at: row.created_at,
        shift_session: toShiftSessionSummary(row),
        allowed_actions: ['resume_existing_shift']
    }
});
const buildBlockedByOtherUserResponse = (row) => ({
    status: 409,
    body: {
        ok: false,
        action_code: 'active_shift_owned_by_other_user',
        message: 'EOS is already open by the original user',
        shift_session: toShiftSessionSummary(row),
        allowed_actions: []
    }
});
const buildManagerTakeoverAvailableResponse = (row) => ({
    status: 409,
    body: {
        ok: false,
        action_code: 'manager_takeover_available',
        message: 'Manager takeover is available for this active EOS',
        shift_session: toShiftSessionSummary(row),
        allowed_actions: ['take_over_and_resume'],
        required_reason_fields: ['takeover_reason']
    }
});
const buildUnresolvedShiftResponse = (row, user) => {
    if (!user.isManagerOrHigher) {
        return {
            status: 409,
            body: {
                ok: false,
                action_code: 'unresolved_shift_requires_resolution',
                message: 'Previous shift is unresolved and requires manager resolution',
                shift_session: toShiftSessionSummary(row),
                allowed_actions: []
            }
        };
    }
    return {
        status: 409,
        body: {
            ok: false,
            action_code: 'unresolved_shift_requires_resolution',
            message: 'Previous shift is unresolved and must be handled explicitly',
            shift_session: toShiftSessionSummary(row),
            allowed_actions: [
                'resume_previous_shift',
                'mark_previous_shift_abandoned',
                'supersede_previous_shift_and_start_new'
            ],
            required_reason_fields_by_action: {
                resume_previous_shift: ['takeover_reason'],
                mark_previous_shift_abandoned: ['abandon_reason'],
                supersede_previous_shift_and_start_new: ['supersede_reason']
            }
        }
    };
};
const buildEmergencyHandoverAvailableResponse = (row) => ({
    status: 409,
    body: {
        ok: false,
        action_code: 'emergency_handover_available',
        message: 'Temporary closure pending manager review',
        shift_session: toShiftSessionSummary(row),
        allowed_actions: ['emergency_handover_close_previous_and_start_new'],
        required_reason_fields: ['temporary_close_reason', 'discrepancy_note']
    }
});
const buildDuplicateShiftSessionResponse = () => ({
    status: 409,
    body: {
        ok: false,
        error: 'Shift session already exists'
    }
});
const safeRollback = async (client) => {
    try {
        await client.query('ROLLBACK');
    }
    catch {
        // Ignore rollback errors so the original failure can surface.
    }
};
export const createOrResumeShiftSession = async (pg, req) => {
    const payload = parseRequestBody(req);
    const user = resolveCurrentUserContext(req);
    const client = await pg.connect();
    try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [payload.location_code]);
        const activeShift = await findLatestShiftByLocationAndStatuses(client, payload.location_code, ACTIVE_SHIFT_STATUSES);
        if (activeShift) {
            await client.query('ROLLBACK');
            if (activeShift.current_owner === user.username) {
                return buildSameOwnerResumeResponse(activeShift);
            }
            if (user.isManagerOrHigher) {
                return buildManagerTakeoverAvailableResponse(activeShift);
            }
            return buildBlockedByOtherUserResponse(activeShift);
        }
        const unresolvedShift = await findLatestShiftByLocationAndStatuses(client, payload.location_code, UNRESOLVED_SHIFT_STATUSES);
        if (unresolvedShift) {
            await client.query('ROLLBACK');
            if (payload.manager_unavailable && !user.isManagerOrHigher) {
                return buildEmergencyHandoverAvailableResponse(unresolvedShift);
            }
            return buildUnresolvedShiftResponse(unresolvedShift, user);
        }
        const duplicateShift = await findDuplicateShiftSession(client, payload);
        if (duplicateShift) {
            await client.query('ROLLBACK');
            throw new DuplicateShiftSessionError();
        }
        const createdShiftSession = await insertShiftSession(client, payload, user);
        await client.query('COMMIT');
        return buildCreateSuccessResponse(createdShiftSession);
    }
    catch (error) {
        await safeRollback(client);
        if (error instanceof DuplicateShiftSessionError) {
            return buildDuplicateShiftSessionResponse();
        }
        throw error;
    }
    finally {
        client.release();
    }
};
export const takeOverShiftSession = async (pg, req) => {
    const actingUser = resolveCurrentUserContext(req);
    assertManagerOrHigher(actingUser);
    const shiftSessionId = normalizeRequiredSessionIdParam(req);
    const takeoverPayload = parseTakeoverRequestBody(req);
    const client = await pg.connect();
    try {
        await client.query('BEGIN');
        const existingShiftSession = await findShiftSessionByIdForUpdate(client, shiftSessionId);
        if (!existingShiftSession) {
            await client.query('ROLLBACK');
            return buildShiftSessionNotFoundResponse();
        }
        if (!ACTIVE_SHIFT_STATUSES.includes(existingShiftSession.status)) {
            await client.query('ROLLBACK');
            return buildShiftSessionNotActiveResponse(existingShiftSession);
        }
        const updatedShiftSession = await updateShiftSessionTakeover(client, existingShiftSession, actingUser, takeoverPayload.takeover_reason);
        await client.query('COMMIT');
        // TODO: Persist this audit payload in a dedicated EOS audit store once
        // shift-session audit persistence is implemented.
        const audit = buildTakeoverAuditPayload(updatedShiftSession, existingShiftSession.current_owner, actingUser, takeoverPayload.takeover_reason);
        return buildTakeoverSuccessResponse(updatedShiftSession, audit);
    }
    catch (error) {
        await safeRollback(client);
        throw error;
    }
    finally {
        client.release();
    }
};
export const abandonShiftSession = async (pg, req) => {
    const actingUser = resolveCurrentUserContext(req);
    assertManagerOrHigher(actingUser);
    const shiftSessionId = normalizeRequiredSessionIdParam(req);
    const abandonPayload = parseAbandonRequestBody(req);
    const client = await pg.connect();
    try {
        await client.query('BEGIN');
        const existingShiftSession = await findShiftSessionByIdForUpdate(client, shiftSessionId);
        if (!existingShiftSession) {
            await client.query('ROLLBACK');
            return buildShiftSessionNotFoundResponse();
        }
        if (!isUnresolvedShiftStatus(existingShiftSession.status)) {
            await client.query('ROLLBACK');
            return buildShiftSessionNotUnresolvedResponse(existingShiftSession);
        }
        const updatedShiftSession = await updateShiftSessionAbandon(client, existingShiftSession, actingUser, abandonPayload.abandon_reason);
        await client.query('COMMIT');
        const audit = buildShiftSessionAuditPayload({
            action: 'shift_abandoned',
            shiftSession: updatedShiftSession,
            previousOwner: existingShiftSession.current_owner,
            newOwner: '',
            actedBy: actingUser.username,
            actedAt: normalizeIsoDateTime(new Date()),
            reason: abandonPayload.abandon_reason,
            previousShiftSessionId: existingShiftSession.id
        });
        return buildAbandonSuccessResponse(updatedShiftSession, audit);
    }
    catch (error) {
        await safeRollback(client);
        throw error;
    }
    finally {
        client.release();
    }
};
export const supersedeShiftSession = async (pg, req) => {
    const actingUser = resolveCurrentUserContext(req);
    assertManagerOrHigher(actingUser);
    const previousShiftSessionId = normalizeRequiredSessionIdParam(req);
    const supersedePayload = parseSupersedeRequestBody(req);
    const client = await pg.connect();
    try {
        await client.query('BEGIN');
        const existingShiftSession = await findShiftSessionByIdForUpdate(client, previousShiftSessionId);
        if (!existingShiftSession) {
            await client.query('ROLLBACK');
            return buildShiftSessionNotFoundResponse();
        }
        if (!isUnresolvedShiftStatus(existingShiftSession.status)) {
            await client.query('ROLLBACK');
            return buildShiftSessionNotUnresolvedResponse(existingShiftSession);
        }
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [existingShiftSession.location_code]);
        if (supersedePayload.location_code !== existingShiftSession.location_code) {
            throw new Error('location_code must match the unresolved shift location');
        }
        const activeShift = await findLatestShiftByLocationAndStatuses(client, existingShiftSession.location_code, ACTIVE_SHIFT_STATUSES);
        if (activeShift) {
            await client.query('ROLLBACK');
            return buildActiveShiftAlreadyExistsResponse(activeShift);
        }
        const createdShiftSession = await insertShiftSession(client, supersedePayload, actingUser, { supersedesShiftSessionId: existingShiftSession.id });
        await updateShiftSessionSuperseded(client, existingShiftSession.id, createdShiftSession.id, actingUser);
        await client.query('COMMIT');
        const audit = buildShiftSessionAuditPayload({
            action: 'shift_superseded',
            shiftSession: createdShiftSession,
            previousOwner: existingShiftSession.current_owner,
            newOwner: createdShiftSession.current_owner,
            actedBy: actingUser.username,
            actedAt: normalizeIsoDateTime(new Date()),
            reason: supersedePayload.supersede_reason,
            previousShiftSessionId: existingShiftSession.id,
            newShiftSessionId: createdShiftSession.id
        });
        return buildSupersedeSuccessResponse(createdShiftSession, audit);
    }
    catch (error) {
        await safeRollback(client);
        throw error;
    }
    finally {
        client.release();
    }
};
export const handleCreateShiftSessionRequest = async (pg, req, res) => {
    try {
        // TODO: Replace placeholder header-based auth/role lookup with the real EOS auth/session source.
        const result = await createOrResumeShiftSession(pg, req);
        return res.status(result.status).json(result.body);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = message === 'Manager or admin access is required' ? 403 : 400;
        return res.status(status).json({ ok: false, error: message });
    }
};
export const handleTakeoverShiftSessionRequest = async (pg, req, res) => {
    try {
        // TODO: Replace placeholder header-based auth/role lookup with the real EOS auth/session source.
        // TODO: Persist takeover audit rows once the EOS audit storage layer is implemented.
        const result = await takeOverShiftSession(pg, req);
        return res.status(result.status).json(result.body);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = message === 'Manager or admin access is required' ? 403 : 400;
        return res.status(status).json({ ok: false, error: message });
    }
};
export const handleAbandonShiftSessionRequest = async (pg, req, res) => {
    try {
        // TODO: Replace placeholder header-based auth/role lookup with the real EOS auth/session source.
        // TODO: Persist abandonment audit rows once the EOS audit storage layer is implemented.
        const result = await abandonShiftSession(pg, req);
        return res.status(result.status).json(result.body);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = message === 'Manager or admin access is required' ? 403 : 400;
        return res.status(status).json({ ok: false, error: message });
    }
};
export const handleSupersedeShiftSessionRequest = async (pg, req, res) => {
    try {
        // TODO: Replace placeholder header-based auth/role lookup with the real EOS auth/session source.
        // TODO: Persist supersede audit rows once the EOS audit storage layer is implemented.
        const result = await supersedeShiftSession(pg, req);
        return res.status(result.status).json(result.body);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = message === 'Manager or admin access is required' ? 403 : 400;
        return res.status(status).json({ ok: false, error: message });
    }
};
