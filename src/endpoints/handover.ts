import { defineEndpoint } from '@directus/extensions-sdk';
import type { Router } from 'express';

type ActiveUser = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  role_name: string | null;
  label: string;
  employee_id: number | null;
  job_label: string;
};

type Recipient = {
  user_id: string;
  email: string;
  label: string;
};

type HandoverItemRow = {
  id: number;
  source: string;
  title: string;
  details: string | null;
  target_type: string;
  target_user_id: string | null;
  target_user_email: string | null;
  target_group: string | null;
  due_at: string | null;
  created_by_user_id: string | null;
  created_by_email: string | null;
  created_by_label: string | null;
  status: string;
  created_at: string;
};

type HandoverEventRow = {
  id: number;
  item_id: number;
  event_type: string;
  actor_user_id: string | null;
  actor_label: string | null;
  note: string | null;
  payload: any;
  created_at: string;
};

type BootstrapItem = {
  id: number;
  source: string;
  title: string;
  details: string;
  target_label: string;
  target_type: string;
  target_group: string;
  due_at: string | null;
  created_at: string;
  created_by_label: string;
  completion_mode: 'first' | 'all';
  status: string;
  completion_progress_label: string;
  current_user_can_complete: boolean;
  current_user_completed: boolean;
  completed_count: number;
  recipient_count: number;
};

const ROLE_RANK = { 'general user': 1, management: 2, hr: 3, full: 4, admin: 5, administrator: 5, superadmin: 5 };

const normalizeEmail = (value: unknown): string => String(value || '').trim().toLowerCase();

const normalizeRoleRank = (roleName: unknown): number => {
  const normalized = String(roleName || '').trim().toLowerCase();
  if (!normalized) return 0;
  if ((ROLE_RANK as Record<string, number>)[normalized]) return (ROLE_RANK as Record<string, number>)[normalized];
  if (normalized.includes('super') || normalized.includes('admin')) return ROLE_RANK.admin;
  if (normalized.includes('full')) return ROLE_RANK.full;
  if (normalized.includes('hr')) return ROLE_RANK.hr;
  if (normalized.includes('manag')) return ROLE_RANK.management;
  if (normalized.includes('general') || normalized.includes('user')) return ROLE_RANK['general user'];
  return 0;
};

const buildDisplayName = (user: { first_name?: unknown; last_name?: unknown; email?: unknown }): string => {
  const full = `${String(user.first_name || '').trim()} ${String(user.last_name || '').trim()}`.trim();
  return full || String(user.email || '').trim() || 'User';
};

const buildEmployeeDisplayName = (employee: { first_name?: unknown; surname?: unknown; short_name?: unknown; email?: unknown }): string => {
  const full = `${String(employee.first_name || '').trim()} ${String(employee.surname || '').trim()}`.trim();
  const shortName = String(employee.short_name || '').trim();
  return full || shortName || String(employee.email || '').trim() || 'User';
};

const isHrPlaceholderLabel = (value: unknown): boolean => /^hr\s+user$/i.test(String(value || '').trim());

const sanitizeText = (value: unknown): string => String(value || '').trim();

const toIsoDateTime = (value: unknown): string | null => {
  const text = sanitizeText(value);
  if (!text) return null;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
};

const ensureArray = <T>(value: T[] | null | undefined): T[] => Array.isArray(value) ? value : [];

const isAssistantsReceptionRole = (value: unknown): boolean => /(assistant|reception)/i.test(String(value || '').trim());

const GROUP_ASSISTANTS_RECEPTION = {
  key: 'assistants_reception',
  label: 'Assistants / Reception',
};

const getCreatedPayload = (events: HandoverEventRow[]): any => {
  const created = events.find((event) => String(event.event_type || '').trim().toLowerCase() === 'created');
  return created?.payload && typeof created.payload === 'object' ? created.payload : {};
};

const getCompletionEmails = (events: HandoverEventRow[]): Set<string> => {
  const emails = new Set<string>();
  events
    .filter((event) => String(event.event_type || '').trim().toLowerCase() === 'completed')
    .forEach((event) => {
      const payloadEmail = normalizeEmail(event.payload?.email);
      const noteEmail = normalizeEmail(event.note);
      if (payloadEmail) emails.add(payloadEmail);
      else if (noteEmail) emails.add(noteEmail);
    });
  return emails;
};

const deriveRecipients = (item: HandoverItemRow, events: HandoverEventRow[]): Recipient[] => {
  const createdPayload = getCreatedPayload(events);
  const payloadRecipients = ensureArray(createdPayload?.recipients)
    .map((recipient: any) => ({
      user_id: sanitizeText(recipient?.user_id),
      email: normalizeEmail(recipient?.email),
      label: sanitizeText(recipient?.label),
    }))
    .filter((recipient) => recipient.email);

  if (payloadRecipients.length) return payloadRecipients;
  if (item.target_type === 'user' && item.target_user_email) {
    return [{
      user_id: sanitizeText(item.target_user_id),
      email: normalizeEmail(item.target_user_email),
      label: sanitizeText(item.target_user_email),
    }];
  }
  return [];
};

const getCompletionMode = (item: HandoverItemRow, events: HandoverEventRow[]): 'first' | 'all' => {
  const createdPayload = getCreatedPayload(events);
  return String(createdPayload?.completion_mode || '').trim().toLowerCase() === 'all' ? 'all' : 'first';
};

const createAutoTitle = (source: string, note: string): string => {
  const firstLine = note.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  if (firstLine) return firstLine.slice(0, 120);
  return source === 'todo' ? 'To Do' : 'Handover';
};

const getTargetLabel = (item: HandoverItemRow): string => {
  if (item.target_type === 'group') {
    return item.target_group === GROUP_ASSISTANTS_RECEPTION.key
      ? GROUP_ASSISTANTS_RECEPTION.label
      : sanitizeText(item.target_group) || 'Group';
  }
  return sanitizeText(item.target_user_email) || '-';
};

async function getActiveUsers(database: any): Promise<ActiveUser[]> {
  const [users, odMaps, employees, profiles] = await Promise.all([
    database.withSchema('directus')
      .from('directus_users as u')
      .leftJoin('directus_roles as r', 'u.role', 'r.id')
      .select('u.id', 'u.email', 'u.first_name', 'u.last_name', 'u.status', 'r.name as role_name')
      .where('u.status', 'active'),
    database('od_user_map')
      .select('employee_id', 'directus_user_email')
      .where('is_active', true),
    database('vw_employee_current')
      .select('emp_id', 'email', 'position_held'),
    database('employee_form_profile')
      .select('emp_id', 'designation'),
  ]);

  const employeeIdByEmail = new Map<string, number>();
  ensureArray(odMaps).forEach((row: any) => {
    const email = normalizeEmail(row?.directus_user_email);
    const employeeId = Number(row?.employee_id);
    if (email && Number.isFinite(employeeId)) employeeIdByEmail.set(email, employeeId);
  });
  ensureArray(employees).forEach((row: any) => {
    const email = normalizeEmail(row?.email);
    const employeeId = Number(row?.emp_id);
    if (email && Number.isFinite(employeeId) && !employeeIdByEmail.has(email)) {
      employeeIdByEmail.set(email, employeeId);
    }
  });

  const employeeById = new Map<number, any>();
  ensureArray(employees).forEach((row: any) => {
    const employeeId = Number(row?.emp_id);
    if (Number.isFinite(employeeId)) employeeById.set(employeeId, row);
  });

  const profileById = new Map<number, any>();
  ensureArray(profiles).forEach((row: any) => {
    const employeeId = Number(row?.emp_id);
    if (Number.isFinite(employeeId)) profileById.set(employeeId, row);
  });

  const directusByEmail = new Map<string, any>();
  ensureArray(users).forEach((user: any) => {
    const email = normalizeEmail(user?.email);
    if (email) directusByEmail.set(email, user);
  });

  const candidates: ActiveUser[] = [];

  ensureArray(employees).forEach((employee: any) => {
    const email = normalizeEmail(employee?.email);
    if (!email) return;
    const employeeId = Number(employee?.emp_id);
    const directusUser = directusByEmail.get(email) || null;
    const profile = Number.isFinite(employeeId) ? profileById.get(employeeId) : null;
    const jobLabel = sanitizeText(profile?.designation || employee?.position_held);

    candidates.push({
      id: sanitizeText(directusUser?.id),
      email,
      first_name: sanitizeText(employee?.first_name) || sanitizeText(directusUser?.first_name) || null,
      last_name: sanitizeText(employee?.surname) || sanitizeText(directusUser?.last_name) || null,
      role_name: sanitizeText(directusUser?.role_name) || null,
      label: buildEmployeeDisplayName(employee),
      employee_id: Number.isFinite(employeeId) ? employeeId : null,
      job_label: jobLabel,
    });
  });

  ensureArray(users).forEach((user: any) => {
    const email = normalizeEmail(user?.email);
    if (!email) return;
    const employeeId = employeeIdByEmail.get(email) ?? null;
    const employee = employeeId ? employeeById.get(employeeId) : null;
    const profile = employeeId ? profileById.get(employeeId) : null;
    const jobLabel = sanitizeText(profile?.designation || employee?.position_held);

    candidates.push({
      id: sanitizeText(user?.id),
      email,
      first_name: sanitizeText(user?.first_name) || null,
      last_name: sanitizeText(user?.last_name) || null,
      role_name: sanitizeText(user?.role_name) || null,
      label: employee ? buildEmployeeDisplayName(employee) : buildDisplayName(user),
      employee_id: employeeId,
      job_label: jobLabel,
    });
  });

  const scoreCandidate = (user: ActiveUser): number => {
    let score = 0;
    if (user.id) score += 100;
    if (user.employee_id) score += 50;
    if (user.job_label) score += 20;
    if (user.role_name) score += 10;
    if (user.first_name || user.last_name) score += 10;
    if (isHrPlaceholderLabel(user.label)) score -= 200;
    return score;
  };

  const deduped = new Map<string, ActiveUser>();
  candidates.filter((user) => user.email).forEach((user) => {
    const key = user.employee_id ? `emp:${user.employee_id}` : `email:${user.email}`;
    const existing = deduped.get(key);
    if (!existing || scoreCandidate(user) > scoreCandidate(existing)) {
      deduped.set(key, user);
    }
  });

  return Array.from(deduped.values())
    .filter((user) => user.email)
    .sort((left, right) => left.label.localeCompare(right.label));
}

function getAssistantsReceptionMembers(users: ActiveUser[]): ActiveUser[] {
  return users.filter((user) => isAssistantsReceptionRole(user.job_label));
}

async function getCurrentUser(database: any, userId: string): Promise<ActiveUser | null> {
  const users = await getActiveUsers(database);
  return users.find((user) => user.id === userId) || null;
}

async function getOpenItemsWithEvents(database: any): Promise<Array<{ item: HandoverItemRow; events: HandoverEventRow[] }>> {
  const items = await database('handover_items')
    .select(
      'id',
      'source',
      'title',
      'details',
      'target_type',
      'target_user_id',
      'target_user_email',
      'target_group',
      'due_at',
      'created_by_user_id',
      'created_by_email',
      'created_by_label',
      'status',
      'created_at'
    )
    .where('status', 'open')
    .orderBy([{ column: 'created_at', order: 'desc' }, { column: 'id', order: 'desc' }]);

  const itemIds = ensureArray(items).map((item: any) => Number(item.id)).filter(Number.isFinite);
  const events = itemIds.length
    ? await database('handover_item_events')
        .select('id', 'item_id', 'event_type', 'actor_user_id', 'actor_label', 'note', 'payload', 'created_at')
        .whereIn('item_id', itemIds)
        .orderBy([{ column: 'created_at', order: 'asc' }, { column: 'id', order: 'asc' }])
    : [];

  const eventsByItemId = new Map<number, HandoverEventRow[]>();
  ensureArray(events).forEach((event: any) => {
    const itemId = Number(event?.item_id);
    if (!Number.isFinite(itemId)) return;
    const bucket = eventsByItemId.get(itemId) || [];
    bucket.push(event);
    eventsByItemId.set(itemId, bucket);
  });

  return ensureArray(items).map((item: any) => ({
    item,
    events: eventsByItemId.get(Number(item.id)) || [],
  }));
}

function canUserSeeItem(item: HandoverItemRow, events: HandoverEventRow[], currentUser: ActiveUser): boolean {
  if (normalizeRoleRank(currentUser.role_name) >= ROLE_RANK.admin) return true;
  const recipients = deriveRecipients(item, events);
  return recipients.some((recipient) => recipient.email === currentUser.email);
}

function canUserCompleteItem(item: HandoverItemRow, events: HandoverEventRow[], currentUser: ActiveUser): boolean {
  if (normalizeRoleRank(currentUser.role_name) >= ROLE_RANK.admin) return true;
  const recipients = deriveRecipients(item, events);
  return recipients.some((recipient) => recipient.email === currentUser.email);
}

function toBootstrapItem(item: HandoverItemRow, events: HandoverEventRow[], currentUser: ActiveUser): BootstrapItem {
  const completionMode = getCompletionMode(item, events);
  const recipients = deriveRecipients(item, events);
  const completionEmails = getCompletionEmails(events);
  const currentUserCompleted = completionEmails.has(currentUser.email);
  const completedCount = completionEmails.size;
  const recipientCount = recipients.length;
  const status = completionMode === 'all' && completedCount > 0 ? 'in progress' : 'open';
  const completionProgressLabel = completionMode === 'all'
    ? `${completedCount}/${recipientCount || 0} done`
    : recipientCount > 1
      ? 'First done closes'
      : 'Done removes item';

  return {
    id: Number(item.id),
    source: sanitizeText(item.source) || 'handover',
    title: sanitizeText(item.title) || (sanitizeText(item.source) === 'todo' ? 'To Do' : 'Handover'),
    details: sanitizeText(item.details),
    target_label: getTargetLabel(item),
    target_type: sanitizeText(item.target_type),
    target_group: sanitizeText(item.target_group),
    due_at: item.due_at || null,
    created_at: item.created_at,
    created_by_label: sanitizeText(item.created_by_label || item.created_by_email) || '-',
    completion_mode: completionMode,
    status,
    completion_progress_label: completionProgressLabel,
    current_user_can_complete: canUserCompleteItem(item, events, currentUser),
    current_user_completed: currentUserCompleted,
    completed_count: completedCount,
    recipient_count: recipientCount,
  };
}

async function buildBootstrap(database: any, currentUser: ActiveUser) {
  const activeUsers = await getActiveUsers(database);
  const assistantsReceptionMembers = getAssistantsReceptionMembers(activeUsers);
  const groups = [{
    key: GROUP_ASSISTANTS_RECEPTION.key,
    label: GROUP_ASSISTANTS_RECEPTION.label,
    member_count: assistantsReceptionMembers.length,
  }];

  const openItems = await getOpenItemsWithEvents(database);
  const visibleItems = openItems
    .filter(({ item, events }) => canUserSeeItem(item, events, currentUser))
    .map(({ item, events }) => toBootstrapItem(item, events, currentUser));

  const handoverCount = visibleItems.filter((item) => item.source !== 'todo').length;
  const todoCount = visibleItems.filter((item) => item.source === 'todo').length;
  const groupClaimedByOthers = visibleItems.filter((item) => {
    if (item.target_type !== 'group' || item.completion_mode !== 'all') return false;
    return item.completed_count > 0 && !item.current_user_completed;
  }).length;

  return {
    current_user: {
      id: currentUser.id,
      email: currentUser.email,
      label: currentUser.label,
      role_name: currentUser.role_name || '',
      role_rank: normalizeRoleRank(currentUser.role_name),
    },
    available_users: activeUsers
      .map((user) => ({
        id: user.id,
        email: user.email,
        label: user.label,
        role_name: user.role_name || '',
        job_label: user.job_label || '',
      }))
      .sort((left, right) => left.label.localeCompare(right.label)),
    available_groups: groups,
    items: visibleItems,
    summary: {
      handover_count: handoverCount,
      todo_count: todoCount,
      group_claimed_by_others: groupClaimedByOthers,
    },
  };
}

export default defineEndpoint((router: Router, { database, logger }: any) => {
  router.get('/summary', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const currentUser = await getCurrentUser(database, String(req.accountability.user));
      if (!currentUser) {
        return res.status(403).json({ error: 'Access denied' });
      }
      const bootstrap = await buildBootstrap(database, currentUser);
      return res.json({ data: bootstrap.summary });
    } catch (error: any) {
      logger.error('Handover summary failed', error);
      return res.status(500).json({ error: 'Failed to load handover summary', message: error?.message || 'Unknown error' });
    }
  });

  router.get('/bootstrap', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const currentUser = await getCurrentUser(database, String(req.accountability.user));
      if (!currentUser) {
        return res.status(403).json({ error: 'Access denied' });
      }
      return res.json(await buildBootstrap(database, currentUser));
    } catch (error: any) {
      logger.error('Handover bootstrap failed', error);
      return res.status(500).json({ error: 'Failed to load handover data', message: error?.message || 'Unknown error' });
    }
  });

  router.post('/items', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const currentUser = await getCurrentUser(database, String(req.accountability.user));
      if (!currentUser) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const source = sanitizeText(req.body?.source).toLowerCase() === 'todo' ? 'todo' : 'handover';
      const recipientMode = sanitizeText(req.body?.recipient_mode).toLowerCase();
      const note = sanitizeText(req.body?.note);
      const dueAt = toIsoDateTime(req.body?.due_at);
      if (!note) {
        return res.status(400).json({ error: 'Note is required' });
      }

      const activeUsers = await getActiveUsers(database);
      let recipients: Recipient[] = [];
      let targetType: 'user' | 'group' = 'user';
      let targetUser: ActiveUser | null = null;
      let targetGroupKey = '';
      let completionMode: 'first' | 'all' = 'first';

      if (recipientMode === 'self') {
        if (source !== 'todo') {
          return res.status(400).json({ error: 'Self target is allowed only for To Do items' });
        }
        recipients = [{ user_id: currentUser.id, email: currentUser.email, label: currentUser.label }];
        targetUser = currentUser;
      } else if (recipientMode === 'group') {
        targetType = 'group';
        targetGroupKey = GROUP_ASSISTANTS_RECEPTION.key;
        completionMode = sanitizeText(req.body?.group_completion_mode).toLowerCase() === 'all' ? 'all' : 'first';
        recipients = getAssistantsReceptionMembers(activeUsers).map((user) => ({
          user_id: user.id,
          email: user.email,
          label: user.label,
        }));
        if (!recipients.length) {
          return res.status(400).json({ error: 'No active app users found in Assistants / Reception' });
        }
      } else {
        const targetEmail = normalizeEmail(req.body?.target_user_email);
        targetUser = activeUsers.find((user) => user.email === targetEmail) || null;
        if (!targetUser) {
          return res.status(400).json({ error: 'Select a valid recipient user' });
        }
        recipients = [{ user_id: targetUser.id, email: targetUser.email, label: targetUser.label }];
      }

      const insertedRows = await database('handover_items')
        .insert({
          source,
          title: createAutoTitle(source, note),
          details: note,
          target_type: targetType,
          target_user_id: targetType === 'user' ? targetUser?.id || null : null,
          target_user_email: targetType === 'user' ? targetUser?.email || null : null,
          target_group: targetType === 'group' ? targetGroupKey : null,
          due_at: dueAt,
          created_by_user_id: currentUser.id,
          created_by_email: currentUser.email,
          created_by_label: currentUser.label,
          status: 'open',
        })
        .returning(['id']);

      const itemId = Number(insertedRows?.[0]?.id || insertedRows?.id);
      await database('handover_item_events').insert({
        item_id: itemId,
        event_type: 'created',
        actor_user_id: currentUser.id,
        actor_label: currentUser.label,
        note,
        payload: {
          source,
          recipient_mode: recipientMode === 'self' ? 'user' : recipientMode,
          completion_mode: completionMode,
          recipients,
        },
      });

      return res.json({ ok: true, item_id: itemId });
    } catch (error: any) {
      logger.error('Handover item creation failed', error);
      return res.status(500).json({ error: 'Failed to create handover item', message: error?.message || 'Unknown error' });
    }
  });

  router.post('/items/:id/complete', async (req: any, res: any) => {
    try {
      if (!req.accountability?.user) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const currentUser = await getCurrentUser(database, String(req.accountability.user));
      if (!currentUser) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const itemId = Number(req.params.id);
      if (!Number.isFinite(itemId)) {
        return res.status(400).json({ error: 'Invalid item ID' });
      }

      const item = await database('handover_items')
        .select(
          'id',
          'source',
          'title',
          'details',
          'target_type',
          'target_user_id',
          'target_user_email',
          'target_group',
          'due_at',
          'created_by_user_id',
          'created_by_email',
          'created_by_label',
          'status',
          'created_at'
        )
        .where('id', itemId)
        .first();
      if (!item) {
        return res.status(404).json({ error: 'Item not found' });
      }

      const events = await database('handover_item_events')
        .select('id', 'item_id', 'event_type', 'actor_user_id', 'actor_label', 'note', 'payload', 'created_at')
        .where('item_id', itemId)
        .orderBy([{ column: 'created_at', order: 'asc' }, { column: 'id', order: 'asc' }]);

      if (!canUserCompleteItem(item, events, currentUser)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const completionMode = getCompletionMode(item, events);
      const recipients = deriveRecipients(item, events);
      const completionEmails = getCompletionEmails(events);

      if (!completionEmails.has(currentUser.email)) {
        await database('handover_item_events').insert({
          item_id: itemId,
          event_type: 'completed',
          actor_user_id: currentUser.id,
          actor_label: currentUser.label,
          note: currentUser.email,
          payload: {
            user_id: currentUser.id,
            email: currentUser.email,
            label: currentUser.label,
          },
        });
        completionEmails.add(currentUser.email);
      }

      const shouldDelete = completionMode === 'first'
        || recipients.length <= 1
        || recipients.every((recipient) => completionEmails.has(recipient.email));

      if (shouldDelete) {
        await database('handover_items').where('id', itemId).del();
        return res.json({ ok: true, removed: true });
      }

      return res.json({
        ok: true,
        removed: false,
        completed_count: completionEmails.size,
        recipient_count: recipients.length,
      });
    } catch (error: any) {
      logger.error('Handover item completion failed', error);
      return res.status(500).json({ error: 'Failed to complete handover item', message: error?.message || 'Unknown error' });
    }
  });
});
