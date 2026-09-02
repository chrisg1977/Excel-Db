import { defineEndpoint } from '@directus/extensions-sdk';
import type { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { requireAdmin } from '../lib/require-admin.js';
import { encryptSecret, decryptSecret } from '../lib/crypto.js';
import { getProviderAdapter } from '../lib/email-providers/index.js';
import { classifyHealthCheckResult } from '../lib/email-health.js';

const ALLOWED_FEATURE_FLAGS = ['invoice_import'];

type Alert = { accountId: number; email: string; message: string };

async function runHealthCheck(database: any, logger: any, account: any): Promise<{ alert: Alert | null }> {
  if (!account.oauth_refresh_token_encrypted) {
    return { alert: null };
  }

  let refreshToken: string;
  try {
    refreshToken = decryptSecret(account.oauth_refresh_token_encrypted);
  } catch (err) {
    logger?.error(`email-accounts: failed to decrypt token for account ${account.id}: ${(err as Error).message}`);
    await database('email_accounts').where('id', account.id).update({
      status: 'error',
      last_error: 'Stored credential could not be decrypted (encryption key mismatch?)',
      last_error_at: new Date(),
      last_checked_at: new Date()
    });
    return {
      alert: { accountId: account.id, email: account.email_address, message: 'Credential could not be decrypted — check EMAIL_ACCOUNTS_ENCRYPTION_KEY.' }
    };
  }

  const adapter = getProviderAdapter(account.provider);
  const result = await adapter.checkAuth(refreshToken);
  const now = new Date();

  const decision = classifyHealthCheckResult(account.consecutive_failures || 0, result, now);
  const { alertMessage, status, ...update } = decision;
  const columns: Record<string, any> = { ...update, last_checked_at: now };
  // `status` is only set on the decision when it should change (active/error);
  // omit it entirely rather than writing `undefined` into the update, which
  // node-postgres rejects as a bound parameter.
  if (status !== undefined) columns.status = status;
  await database('email_accounts').where('id', account.id).update(columns);

  return {
    alert: alertMessage ? { accountId: account.id, email: account.email_address, message: alertMessage } : null
  };
}

export default defineEndpoint((router: Router, { database, logger }: any) => {
  /**
   * GET /email-accounts/accounts
   * List connected mailboxes. Never returns the encrypted token column.
   */
  router.get('/accounts', async (req: any, res: any) => {
    if (!requireAdmin(req, res)) return;
    try {
      const rows = await database('vw_email_accounts_admin').select('*');
      res.json({ status: 'success', data: rows });
    } catch (err) {
      logger?.error('email-accounts list error', err);
      res.status(500).json({ status: 'error', message: 'Failed to load email accounts' });
    }
  });

  /**
   * GET /email-accounts/accounts/:id
   */
  router.get('/accounts/:id', async (req: any, res: any) => {
    if (!requireAdmin(req, res)) return;
    try {
      const row = await database('vw_email_accounts_admin').where('id', Number(req.params.id)).first();
      if (!row) return res.status(404).json({ status: 'error', message: 'Account not found' });
      res.json({ status: 'success', data: row });
    } catch (err) {
      logger?.error('email-accounts get error', err);
      res.status(500).json({ status: 'error', message: 'Failed to load email account' });
    }
  });

  /**
   * PATCH /email-accounts/accounts/:id
   * Update the feature flags allowed to read this mailbox. Credentials are
   * never editable here — re-authenticate via the OAuth flow instead.
   */
  router.patch('/accounts/:id', async (req: any, res: any) => {
    if (!requireAdmin(req, res)) return;
    try {
      const id = Number(req.params.id);
      const { feature_flags } = req.body || {};

      if (!Array.isArray(feature_flags)) {
        return res.status(400).json({ status: 'error', message: 'feature_flags must be an array' });
      }
      const invalid = feature_flags.filter((f: string) => !ALLOWED_FEATURE_FLAGS.includes(f));
      if (invalid.length) {
        return res.status(400).json({ status: 'error', message: `Unknown feature flag(s): ${invalid.join(', ')}` });
      }

      const updated = await database('email_accounts').where('id', id).update({ feature_flags }).returning('id');
      if (!updated.length) return res.status(404).json({ status: 'error', message: 'Account not found' });

      const row = await database('vw_email_accounts_admin').where('id', id).first();
      res.json({ status: 'success', data: row });
    } catch (err) {
      logger?.error('email-accounts patch error', err);
      res.status(500).json({ status: 'error', message: 'Failed to update email account' });
    }
  });

  /**
   * POST /email-accounts/accounts/:id/deactivate
   * Soft-disable: stop polling, keep all history (email_messages/attachments
   * and the account row itself) intact.
   */
  router.post('/accounts/:id/deactivate', async (req: any, res: any) => {
    if (!requireAdmin(req, res)) return;
    try {
      const id = Number(req.params.id);
      const updated = await database('email_accounts').where('id', id).update({ status: 'disabled' }).returning('id');
      if (!updated.length) return res.status(404).json({ status: 'error', message: 'Account not found' });
      const row = await database('vw_email_accounts_admin').where('id', id).first();
      res.json({ status: 'success', data: row });
    } catch (err) {
      logger?.error('email-accounts deactivate error', err);
      res.status(500).json({ status: 'error', message: 'Failed to deactivate email account' });
    }
  });

  /**
   * POST /email-accounts/accounts/:id/activate
   * Resume polling. Status is left for the next health check to determine
   * rather than assumed healthy.
   */
  router.post('/accounts/:id/activate', async (req: any, res: any) => {
    if (!requireAdmin(req, res)) return;
    try {
      const id = Number(req.params.id);
      const account = await database('email_accounts').where('id', id).first();
      if (!account) return res.status(404).json({ status: 'error', message: 'Account not found' });

      const nextStatus = account.needs_reauth ? 'error' : 'pending';
      await database('email_accounts').where('id', id).update({ status: nextStatus });
      const row = await database('vw_email_accounts_admin').where('id', id).first();
      res.json({ status: 'success', data: row });
    } catch (err) {
      logger?.error('email-accounts activate error', err);
      res.status(500).json({ status: 'error', message: 'Failed to activate email account' });
    }
  });

  /**
   * GET /email-accounts/oauth/start
   * Returns the Google consent URL for the admin's browser to navigate to.
   * Pass ?reconnect_id=<id> to re-authenticate an existing account in place
   * (same email_accounts.id, no history lost) instead of connecting a new one.
   */
  router.get('/oauth/start', async (req: any, res: any) => {
    if (!requireAdmin(req, res)) return;
    try {
      const provider = String(req.query.provider || 'gmail');
      const reconnectId = req.query.reconnect_id ? Number(req.query.reconnect_id) : null;

      if (reconnectId) {
        const existing = await database('email_accounts').where('id', reconnectId).first();
        if (!existing) return res.status(404).json({ status: 'error', message: 'Account not found' });
      }

      const state = randomBytes(24).toString('hex');
      await database('email_oauth_states').insert({
        state,
        requested_by: req.accountability.user,
        reconnect_account_id: reconnectId
      });

      const adapter = getProviderAdapter(provider);
      res.json({ status: 'success', data: { url: adapter.getAuthUrl(state) } });
    } catch (err) {
      logger?.error('email-accounts oauth/start error', err);
      res.status(500).json({ status: 'error', message: (err as Error).message || 'Failed to start OAuth flow' });
    }
  });

  /**
   * GET /email-accounts/oauth/callback
   * Google redirects the admin's browser here — there is no Directus session
   * on this request, so the CSRF `state` row (tied to the admin who started
   * the flow) is what we trust, not req.accountability.
   */
  router.get('/oauth/callback', async (req: any, res: any) => {
    const { code, state, error: oauthError } = req.query || {};
    const sendResultPage = (ok: boolean, message: string) => {
      res.set('Content-Type', 'text/html').send(`<!doctype html><html><body style="font-family:sans-serif;padding:2rem;">
<h3>${ok ? 'Account connected' : 'Connection failed'}</h3>
<p>${message}</p>
<p>You can close this window and return to the Email Accounts admin screen.</p>
<script>try{window.opener&&window.opener.postMessage({ source:'email-accounts-oauth', ok:${ok} },'*');}catch(e){}</script>
</body></html>`);
    };

    try {
      if (oauthError) return sendResultPage(false, `Google returned an error: ${oauthError}`);
      if (!code || !state) return sendResultPage(false, 'Missing code or state from Google redirect.');

      const stateRow = await database('email_oauth_states').where('state', state).first();
      if (!stateRow) return sendResultPage(false, 'This connect link has expired or was already used. Start again from the admin screen.');
      await database('email_oauth_states').where('state', state).delete();
      if (new Date(stateRow.expires_at).getTime() < Date.now()) {
        return sendResultPage(false, 'This connect link has expired. Start again from the admin screen.');
      }

      const adapter = getProviderAdapter('gmail');
      const tokens = await adapter.exchangeCodeForTokens(String(code));
      const encryptedToken = encryptSecret(tokens.refreshToken);
      const now = new Date();

      if (stateRow.reconnect_account_id) {
        const existing = await database('email_accounts').where('id', stateRow.reconnect_account_id).first();
        if (existing && existing.email_address !== tokens.emailAddress) {
          return sendResultPage(
            false,
            `Google account ${tokens.emailAddress} does not match the account being reconnected (${existing.email_address}). Sign in to the matching Google account.`
          );
        }
        await database('email_accounts').where('id', stateRow.reconnect_account_id).update({
          oauth_refresh_token_encrypted: encryptedToken,
          oauth_token_scope: tokens.scope,
          status: 'pending',
          needs_reauth: false,
          consecutive_failures: 0,
          last_error: null,
          last_error_at: null
        });
        return sendResultPage(true, `Reconnected ${tokens.emailAddress}.`);
      }

      await database('email_accounts')
        .insert({
          email_address: tokens.emailAddress,
          provider: 'gmail',
          status: 'pending',
          oauth_refresh_token_encrypted: encryptedToken,
          oauth_token_scope: tokens.scope,
          feature_flags: [],
          connected_by: stateRow.requested_by,
          connected_at: now
        })
        .onConflict('email_address')
        .merge({
          oauth_refresh_token_encrypted: encryptedToken,
          oauth_token_scope: tokens.scope,
          status: 'pending',
          needs_reauth: false,
          consecutive_failures: 0,
          last_error: null,
          last_error_at: null
        });

      return sendResultPage(true, `Connected ${tokens.emailAddress}.`);
    } catch (err) {
      logger?.error('email-accounts oauth/callback error', err);
      return sendResultPage(false, (err as Error).message || 'Failed to complete the connect flow.');
    }
  });

  /**
   * POST /email-accounts/accounts/:id/health-check
   * On-demand check for a single account (used by the admin UI's "Check now").
   */
  router.post('/accounts/:id/health-check', async (req: any, res: any) => {
    if (!requireAdmin(req, res)) return;
    try {
      const account = await database('email_accounts').where('id', Number(req.params.id)).first();
      if (!account) return res.status(404).json({ status: 'error', message: 'Account not found' });
      if (account.status === 'disabled') {
        return res.status(409).json({ status: 'error', message: 'Account is deactivated. Reactivate it first.' });
      }

      await runHealthCheck(database, logger, account);
      const row = await database('vw_email_accounts_admin').where('id', account.id).first();
      res.json({ status: 'success', data: row });
    } catch (err) {
      logger?.error('email-accounts health-check (single) error', err);
      res.status(500).json({ status: 'error', message: 'Health check failed to run' });
    }
  });

  /**
   * POST /email-accounts/health-check
   * Bulk check for every non-disabled account, for the scheduled job
   * (scripts/check-email-accounts.ps1). Unlike the existing tax/source-check
   * scheduled endpoints (which only require login), this requires admin: the
   * response includes account emails and provider error detail, which is
   * more sensitive than a public rate-source check. The scheduled script
   * authenticates with an admin Directus login.
   */
  router.post('/health-check', async (req: any, res: any) => {
    if (!requireAdmin(req, res)) return;
    try {
      const accounts = await database('email_accounts').whereNot('status', 'disabled');
      const alerts: Alert[] = [];
      let healthy = 0;

      for (const account of accounts) {
        const { alert } = await runHealthCheck(database, logger, account);
        if (alert) alerts.push(alert);
        else healthy++;
      }

      res.json({
        status: 'success',
        data: { checked: accounts.length, healthy, alerts }
      });
    } catch (err) {
      logger?.error('email-accounts health-check (bulk) error', err);
      res.status(500).json({ status: 'error', message: 'Health check run failed' });
    }
  });
});
