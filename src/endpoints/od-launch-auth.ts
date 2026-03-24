import { createHmac, randomBytes } from 'node:crypto';
import { defineEndpoint } from '@directus/extensions-sdk';
import type { Router } from 'express';

type LaunchPayload = {
  od_user: string;
  od_user_num: string;
  directus_email: string;
  od_ts: string;
  od_sig: string;
};

type DirectusUserRow = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  status: string;
  role: string | null;
  role_name: string | null;
};

type EmployeeRow = {
  emp_id: number;
  email: string | null;
  first_name: string | null;
  surname: string | null;
};

type OdUserMapRow = {
  id: number;
  employee_id: number | null;
  od_user_num: number | null;
  is_active: boolean | null;
  directus_user_email: string | null;
  od_username: string | null;
  op_username: string | null;
};

const ACCESS_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const normalizeEmail = (value: unknown): string => String(value || '').trim().toLowerCase();
const normalizeKey = (value: unknown): string => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
const emailLocalPart = (email: string): string => normalizeKey(email.split('@')[0] || '');

const base64UrlEncode = (value: Buffer | string): string => Buffer
  .from(value)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/g, '');

const signJwt = (payload: Record<string, unknown>, secret: string): string => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest();
  return `${encodedHeader}.${encodedPayload}.${base64UrlEncode(signature)}`;
};

const parseLaunchPayload = (body: Record<string, unknown>): LaunchPayload => ({
  od_user: String(body?.od_user || '').trim(),
  od_user_num: String(body?.od_user_num || '').trim(),
  directus_email: String(body?.directus_email || '').trim(),
  od_ts: String(body?.od_ts || '').trim(),
  od_sig: String(body?.od_sig || '').trim(),
});

const isAdminRole = (roleName: string | null): boolean => {
  const normalized = String(roleName || '').trim().toLowerCase();
  return normalized.includes('admin') || normalized.includes('super');
};

const scoreOdUserMapMatch = (row: OdUserMapRow, launch: LaunchPayload): number => {
  let score = 0;
  const directusEmail = normalizeEmail(launch.directus_email);
  const odUser = String(launch.od_user || '').trim();
  const odUserKey = normalizeKey(odUser);
  const launchUserNum = Number(launch.od_user_num);
  const rowEmail = normalizeEmail(row.directus_user_email);
  const rowOdUsername = String(row.od_username || '').trim();
  const rowOpUsername = String(row.op_username || '').trim();

  if (directusEmail && rowEmail && directusEmail === rowEmail) score += 1200;
  if (Number.isFinite(launchUserNum) && row.od_user_num === launchUserNum) score += 1100;

  if (odUser) {
    if (rowOdUsername && odUser.localeCompare(rowOdUsername, undefined, { sensitivity: 'accent' }) === 0) score += 1000;
    if (rowOpUsername && odUser.localeCompare(rowOpUsername, undefined, { sensitivity: 'accent' }) === 0) score += 980;
    if (rowEmail && odUser.includes('@') && normalizeEmail(odUser) === rowEmail) score += 960;
  }

  if (odUserKey) {
    if (rowOdUsername && odUserKey === normalizeKey(rowOdUsername)) score += 900;
    if (rowOpUsername && odUserKey === normalizeKey(rowOpUsername)) score += 880;
    if (rowEmail && odUserKey === emailLocalPart(rowEmail)) score += 860;
  }

  return score;
};

const resolveOdUserMap = (rows: OdUserMapRow[], launch: LaunchPayload): OdUserMapRow | null => {
  const scored = rows
    .filter((row) => row.is_active !== false)
    .map((row) => ({ row, score: scoreOdUserMapMatch(row, launch) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) {
    const top = scored[0].row;
    const next = scored[1].row;
    const topKey = `${normalizeEmail(top.directus_user_email)}|${top.employee_id || ''}|${top.od_user_num || ''}`;
    const nextKey = `${normalizeEmail(next.directus_user_email)}|${next.employee_id || ''}|${next.od_user_num || ''}`;
    if (topKey !== nextKey) return null;
  }
  return scored[0].row;
};

const scoreUserMatch = (
  user: DirectusUserRow,
  launch: LaunchPayload,
  employee: EmployeeRow | null
): number => {
  let score = 0;
  const userEmail = normalizeEmail(user.email);
  const userFullName = normalizeKey(`${user.first_name || ''}${user.last_name || ''}`);
  const directusEmail = normalizeEmail(launch.directus_email);
  const odUser = String(launch.od_user || '').trim();
  const odUserEmail = normalizeEmail(odUser.includes('@') ? odUser : '');
  const odUserKey = normalizeKey(odUser);

  if (directusEmail && directusEmail === userEmail) score += 1000;
  if (odUserEmail && odUserEmail === userEmail) score += 950;
  if (employee) {
    const employeeEmail = normalizeEmail(employee.email);
    const employeeFullName = normalizeKey(`${employee.first_name || ''}${employee.surname || ''}`);
    if (employeeEmail && employeeEmail === userEmail) score += 850;
    if (employeeFullName && employeeFullName === userFullName) score += 800;
  }
  if (odUserKey) {
    if (odUserKey === emailLocalPart(userEmail)) score += 600;
    if (odUserKey === userFullName) score += 550;
    if (odUserKey === normalizeKey(user.first_name)) score += 500;
  }

  return score;
};

const resolveMappedUser = (
  users: DirectusUserRow[],
  launch: LaunchPayload,
  employee: EmployeeRow | null
): DirectusUserRow | null => {
  const scored = users
    .filter((user) => String(user.status || '').toLowerCase() === 'active')
    .map((user) => ({ user, score: scoreUserMatch(user, launch, employee) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].score === scored[1].score) return null;
  return scored[0].user;
};

export default defineEndpoint((router: Router, { database, env, logger }: any) => {
  router.post('/auth/od/launch', async (req: any, res: any) => {
    try {
      const launch = parseLaunchPayload(req.body || {});
      if (!launch.od_user && !launch.od_user_num && !launch.directus_email) {
        return res.status(400).json({ error: 'od_user, od_user_num, or directus_email is required' });
      }

      const jwtKey = String(env?.SECRET || env?.KEY || '').trim();
      if (!jwtKey) {
        return res.status(500).json({ error: 'JWT signing key is not configured' });
      }

      const launchUserNum = Number(launch.od_user_num);
      const [users, odUserMaps] = await Promise.all([
        database.withSchema('directus')
          .from('directus_users as u')
          .leftJoin('directus_roles as r', 'u.role', 'r.id')
          .select(
            'u.id',
            'u.email',
            'u.first_name',
            'u.last_name',
            'u.status',
            'u.role',
            'r.name as role_name'
          ),
        database('od_user_map')
          .select(
            'id',
            'employee_id',
            'od_user_num',
            'is_active',
            'directus_user_email',
            'od_username',
            'op_username'
          ),
      ]);

      const resolvedOdMap = resolveOdUserMap(odUserMaps as OdUserMapRow[], launch);
      const candidateEmployeeIds = new Set<number>();
      if (resolvedOdMap?.employee_id && Number.isFinite(Number(resolvedOdMap.employee_id))) {
        candidateEmployeeIds.add(Number(resolvedOdMap.employee_id));
      }
      if (Number.isFinite(launchUserNum)) {
        candidateEmployeeIds.add(launchUserNum);
      }

      const employees = candidateEmployeeIds.size > 0
        ? await database('vw_employee_current')
            .select('emp_id', 'email', 'first_name', 'surname')
            .whereIn('emp_id', Array.from(candidateEmployeeIds))
        : [];

      const employeeById = new Map<number, EmployeeRow>(
        (employees as EmployeeRow[]).map((employee) => [Number(employee.emp_id), employee])
      );
      const mappedEmployee = resolvedOdMap?.employee_id
        ? employeeById.get(Number(resolvedOdMap.employee_id)) || null
        : null;
      const fallbackEmployee = Number.isFinite(launchUserNum)
        ? employeeById.get(launchUserNum) || null
        : null;

      const activeUsers = (users as DirectusUserRow[])
        .filter((user) => String(user.status || '').toLowerCase() === 'active');
      const mappedEmail = normalizeEmail(
        resolvedOdMap?.directus_user_email ||
        launch.directus_email ||
        mappedEmployee?.email ||
        ''
      );

      let mappedUser = mappedEmail
        ? activeUsers.find((user) => normalizeEmail(user.email) === mappedEmail) || null
        : null;

      if (!mappedUser) {
        const heuristicLaunch = {
          ...launch,
          directus_email: launch.directus_email || resolvedOdMap?.directus_user_email || mappedEmployee?.email || '',
        };
        mappedUser = resolveMappedUser(
          activeUsers,
          heuristicLaunch,
          mappedEmployee || fallbackEmployee
        );
      }

      if (!mappedUser) {
        logger.warn('No Directus mapping found for OpenDental launch', {
          od_user: launch.od_user || '',
          od_user_num: launch.od_user_num || '',
          directus_email: launch.directus_email || '',
          od_map_id: resolvedOdMap?.id || null,
          od_map_email: resolvedOdMap?.directus_user_email || null,
          od_map_employee_id: resolvedOdMap?.employee_id || null,
        });
        return res.status(404).json({ error: 'No Directus mapping found for OpenDental launch' });
      }

      const nowSeconds = Math.floor(Date.now() / 1000);
      const payload = {
        id: mappedUser.id,
        role: mappedUser.role || null,
        app_access: true,
        admin_access: isAdminRole(mappedUser.role_name),
        iat: nowSeconds,
        exp: nowSeconds + ACCESS_TOKEN_TTL_SECONDS,
        iss: 'directus',
      };
      const accessToken = signJwt(payload, jwtKey);
      const refreshToken = base64UrlEncode(randomBytes(48)).slice(0, 64);

      try {
        await database.withSchema('directus')
          .from('directus_sessions')
          .insert({
            token: refreshToken,
            user: mappedUser.id,
            expires: new Date((nowSeconds + ACCESS_TOKEN_TTL_SECONDS) * 1000),
            ip: req.ip || null,
            user_agent: String(req.get?.('user-agent') || '').trim() || null,
            origin: 'od-launch',
          });
      } catch (sessionError) {
        logger.warn('Unable to persist OD launch refresh token', sessionError);
      }

      try {
        await database.withSchema('directus')
          .from('directus_users')
          .where('id', mappedUser.id)
          .update({ last_access: new Date() });
      } catch (userUpdateError) {
        logger.warn('Unable to update last_access after OD launch', userUpdateError);
      }

      return res.json({
        data: {
          access_token: accessToken,
          refresh_token: refreshToken,
          expires: ACCESS_TOKEN_TTL_SECONDS * 1000,
          auth_mode: 'od_launch',
          user: {
            id: mappedUser.id,
            email: mappedUser.email,
            first_name: mappedUser.first_name,
            last_name: mappedUser.last_name,
            role_name: mappedUser.role_name,
          },
        },
      });
    } catch (error: any) {
      logger.error('OpenDental launch authentication failed', error);
      return res.status(500).json({
        error: 'OpenDental launch failed',
        message: error?.message || 'Unknown error',
      });
    }
  });
});
