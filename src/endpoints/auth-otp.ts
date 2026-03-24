/**
 * OTP auth endpoints:
 *   POST /auth/login-identity/resolve  — resolve username / emp-id to email
 *   POST /auth/otp/request             — generate + send OTP via watcher SMS queue
 *   POST /auth/otp/verify              — verify code, return fresh Directus tokens
 */
import { createHmac, randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineEndpoint } from '@directus/extensions-sdk';
import type { Router } from 'express';

// ─── constants ────────────────────────────────────────────────────────────────
const OTP_TTL_SECONDS       = 10 * 60;          // 10 minutes
const ACCESS_TOKEN_TTL_SECS = 7 * 24 * 60 * 60; // 7 days (matches od-launch-auth)
const OTP_CODE_LENGTH       = 6;

// ─── tiny JWT helpers (same as od-launch-auth.ts) ─────────────────────────────
const base64UrlEncode = (v: Buffer | string): string =>
  Buffer.from(v).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const signJwt = (payload: Record<string, unknown>, secret: string): string => {
  const hdr = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const pay = base64UrlEncode(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${hdr}.${pay}`).digest();
  return `${hdr}.${pay}.${base64UrlEncode(sig)}`;
};

// ─── utilities ────────────────────────────────────────────────────────────────
const normalizeEmail = (v: unknown) => String(v || '').trim().toLowerCase();
const normalizeKey   = (v: unknown) =>
  String(v || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');

const isAdminRole = (roleName: string | null) => {
  const n = String(roleName || '').trim().toLowerCase();
  return n.includes('admin') || n.includes('super');
};

const maskPhone = (phone: string): string => {
  const d = phone.replace(/\D/g, '');
  if (d.length < 4) return '****';
  return d.slice(0, 2) + '****' + d.slice(-2);
};

const hmacOtp = (code: string, secret: string) =>
  createHmac('sha256', secret).update(`otp:${code}`).digest('hex');

const generateCode = (): string =>
  String(Math.floor(Math.random() * 10 ** OTP_CODE_LENGTH)).padStart(OTP_CODE_LENGTH, '0');

// ─── watcher SMS queue writer ─────────────────────────────────────────────────
function writeWatcherSmsRequest(opts: {
  to: string;
  message: string;
  requestId: string;
  queueDir: string;
}): void {
  const { to, message, requestId, queueDir } = opts;
  const payload = {
    version: 1,
    request_type: 'send_sms',
    to: [to.replace(/\D/g, '')],
    message,
    comp_name: 'MCODEZ-API',
    win_user: 'directus',
    od_username: '',
    purpose: 'request_sms',
    request_id: requestId,
    requested_at: new Date().toISOString().slice(0, 19),
  };
  mkdirSync(queueDir, { recursive: true });
  const ts  = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const uid = randomBytes(8).toString('hex');
  const file = join(queueDir, `send_sms_MCODEZ_${ts}_${uid}.req.json`);
  writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
}

// ─── ensure auth_otp_codes table exists ───────────────────────────────────────
const ensureOtpTable = async (database: any): Promise<void> => {
  await database.raw(`
    CREATE TABLE IF NOT EXISTS auth_otp_codes (
      id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
      email        text        NOT NULL,
      code_hash    text        NOT NULL,
      expires_at   timestamptz NOT NULL,
      used_at      timestamptz,
      created_at   timestamptz NOT NULL DEFAULT now()
    )
  `);
  await database.raw(`
    CREATE INDEX IF NOT EXISTS auth_otp_codes_email_idx ON auth_otp_codes (email)
  `);
};

// ─── main export ──────────────────────────────────────────────────────────────
export default defineEndpoint((router: Router, { database, env, logger }: any) => {

  // ── POST /auth/login-identity/resolve ────────────────────────────────────
  router.post('/login-identity/resolve', async (req: any, res: any) => {
    try {
      const login = String(req.body?.login || '').trim();
      if (!login) {
        return res.status(400).json({ error: 'login is required' });
      }

      // If already an email, return immediately.
      if (login.includes('@')) {
        return res.json({ data: { resolved_email: login.toLowerCase() } });
      }

      // Try emp_id (numeric) or name match against employee view.
      const isNumeric = /^\d+$/.test(login);
      const rows = await database('vw_employee_current')
        .select('emp_id', 'email', 'first_name', 'surname');

      const norm = normalizeKey(login);
      let email = '';

      for (const row of rows) {
        if (isNumeric && String(row.emp_id) === login) {
          email = normalizeEmail(row.email);
          break;
        }
        const fullKey = normalizeKey(`${row.first_name || ''}${row.surname || ''}`);
        const firstKey = normalizeKey(row.first_name);
        if (norm === fullKey || norm === firstKey) {
          email = normalizeEmail(row.email);
          break;
        }
      }

      if (!email) {
        // Fall back to Directus users by email-local-part.
        const users = await database.withSchema('directus')
          .from('directus_users')
          .select('email')
          .where('status', 'active');
        for (const u of users) {
          if (normalizeKey(u.email?.split('@')[0] || '') === norm) {
            email = normalizeEmail(u.email);
            break;
          }
        }
      }

      if (!email) {
        return res.status(404).json({ error: 'Identity not found' });
      }
      return res.json({ data: { resolved_email: email } });
    } catch (err: any) {
      logger.error('login-identity/resolve failed', err);
      return res.status(500).json({ error: 'Identity resolution failed', message: err?.message });
    }
  });

  // ── POST /auth/otp/request ────────────────────────────────────────────────
  router.post('/otp/request', async (req: any, res: any) => {
    try {
      const email = normalizeEmail(req.body?.email);
      if (!email) {
        return res.status(400).json({ error: 'email is required' });
      }

      const secret = String(env?.SECRET || env?.KEY || '').trim();
      if (!secret) {
        return res.status(500).json({ error: 'JWT secret not configured' });
      }

      // Ensure table exists (idempotent).
      await ensureOtpTable(database);

      // Look up phone from employee record.
      const empRow = await database('vw_employee_current')
        .select('phone_primary', 'phone_secondary')
        .whereRaw("lower(coalesce(email, '')) = ?", [email])
        .first();

      const phone = String(empRow?.phone_primary || empRow?.phone_secondary || '').replace(/\D/g, '');
      if (!phone) {
        logger.warn(`OTP request: no phone on record for ${email}`);
        return res.status(422).json({ error: 'No phone number on record for this account' });
      }

      // Generate code + store hash.
      const code     = generateCode();
      const codeHash = hmacOtp(code, secret);
      const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000);

      // Invalidate old unused codes for this email.
      await database('auth_otp_codes')
        .whereRaw("lower(email) = lower(?)", [email])
        .whereNull('used_at')
        .delete();

      const [{ id: otpId }] = await database('auth_otp_codes')
        .insert({ email, code_hash: codeHash, expires_at: expiresAt })
        .returning('id');

      // Write to watcher queue.
      const queueDir = String(env?.WATCHER_SMS_QUEUE_DIR || '').trim();
      if (!queueDir) {
        logger.warn('WATCHER_SMS_QUEUE_DIR not set — OTP not sent');
        return res.status(503).json({ error: 'SMS gateway not configured on this server' });
      }
      if (!existsSync(queueDir)) {
        logger.warn(`WATCHER_SMS_QUEUE_DIR does not exist: ${queueDir}`);
        return res.status(503).json({ error: 'SMS queue directory not accessible' });
      }

      const message = `Mediatrix Dental login code: ${code}. Valid for 10 minutes. Do not share this code.`;
      writeWatcherSmsRequest({
        to: phone,
        message,
        requestId: `otp-${otpId}`,
        queueDir,
      });

      return res.json({
        otp_id:      otpId,
        phone:       maskPhone(phone),
        masked_phone: maskPhone(phone),
      });
    } catch (err: any) {
      logger.error('OTP request failed', err);
      return res.status(500).json({ error: 'OTP request failed', message: err?.message });
    }
  });

  // ── POST /auth/otp/verify ─────────────────────────────────────────────────
  router.post('/otp/verify', async (req: any, res: any) => {
    try {
      const email  = normalizeEmail(req.body?.email);
      const code   = String(req.body?.code  || '').trim();
      const otpId  = String(req.body?.otp_id || '').trim();

      if (!email || !code || !otpId) {
        return res.status(400).json({ error: 'email, code and otp_id are required' });
      }

      const secret = String(env?.SECRET || env?.KEY || '').trim();
      if (!secret) {
        return res.status(500).json({ error: 'JWT secret not configured' });
      }

      await ensureOtpTable(database);

      const otpRow = await database('auth_otp_codes')
        .whereRaw("id = ? AND lower(email) = lower(?)", [otpId, email])
        .whereNull('used_at')
        .first();

      if (!otpRow) {
        return res.status(401).json({ error: 'Invalid or already-used OTP' });
      }

      if (new Date(otpRow.expires_at) < new Date()) {
        return res.status(401).json({ error: 'OTP has expired' });
      }

      const expectedHash = hmacOtp(code, secret);
      if (otpRow.code_hash !== expectedHash) {
        return res.status(401).json({ error: 'Incorrect OTP code' });
      }

      // Mark as used.
      await database('auth_otp_codes')
        .where('id', otpId)
        .update({ used_at: new Date() });

      // Issue fresh Directus tokens for the user.
      const directusUser = await database.withSchema('directus')
        .from('directus_users as u')
        .leftJoin('directus_roles as r', 'u.role', 'r.id')
        .select('u.id', 'u.email', 'u.first_name', 'u.last_name', 'u.role', 'r.name as role_name')
        .whereRaw("lower(u.email) = lower(?)", [email])
        .where('u.status', 'active')
        .first();

      if (!directusUser) {
        return res.status(404).json({ error: 'Directus user not found for this email' });
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const jwtPayload = {
        id:           directusUser.id,
        role:         directusUser.role || null,
        app_access:   true,
        admin_access: isAdminRole(directusUser.role_name),
        iat:          nowSec,
        exp:          nowSec + ACCESS_TOKEN_TTL_SECS,
        iss:          'directus',
      };
      const accessToken  = signJwt(jwtPayload, secret);
      const refreshToken = base64UrlEncode(randomBytes(48)).slice(0, 64);

      try {
        await database.withSchema('directus')
          .from('directus_sessions')
          .insert({
            token:      refreshToken,
            user:       directusUser.id,
            expires:    new Date((nowSec + ACCESS_TOKEN_TTL_SECS) * 1000),
            ip:         req.ip || null,
            user_agent: String(req.get?.('user-agent') || '').trim() || null,
            origin:     'otp',
          });
      } catch (sessionErr) {
        logger.warn('Unable to persist OTP refresh token', sessionErr);
      }

      try {
        await database.withSchema('directus')
          .from('directus_users')
          .where('id', directusUser.id)
          .update({ last_access: new Date() });
      } catch (updateErr) {
        logger.warn('Unable to update last_access after OTP verify', updateErr);
      }

      return res.json({
        data: {
          access_token:  accessToken,
          refresh_token: refreshToken,
          expires:       ACCESS_TOKEN_TTL_SECS * 1000,
          otp_verified:  true,
        },
      });
    } catch (err: any) {
      logger.error('OTP verify failed', err);
      return res.status(500).json({ error: 'OTP verification failed', message: err?.message });
    }
  });
});
