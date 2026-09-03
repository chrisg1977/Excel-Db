import type { EmailProviderAdapter, HealthCheckResult, TokenExchangeResult } from './types.js';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

// Read-only Gmail access is enough for any current or future
// parsing/import feature; nothing in this layer ever sends or deletes mail.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/userinfo.email'];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Google OAuth connect flow is not configured.`);
  }
  return value;
}

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; scope: string }> {
  const clientId = requireEnv('GOOGLE_OAUTH_CLIENT_ID');
  const clientSecret = requireEnv('GOOGLE_OAUTH_CLIENT_SECRET');

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    })
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const err: any = new Error(body?.error_description || body?.error || `Google token refresh failed (${response.status})`);
    err.googleError = body?.error;
    err.status = response.status;
    throw err;
  }

  return body;
}

export const gmailProvider: EmailProviderAdapter = {
  name: 'gmail',

  getAuthUrl(state: string): string {
    const clientId = requireEnv('GOOGLE_OAUTH_CLIENT_ID');
    const redirectUri = requireEnv('GOOGLE_OAUTH_REDIRECT_URI');

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      access_type: 'offline',
      // Forces Google to re-issue a refresh token even for a returning user,
      // which the reconnect/re-auth flow depends on.
      prompt: 'consent',
      scope: SCOPES.join(' '),
      state
    });

    return `${AUTH_URL}?${params.toString()}`;
  },

  async exchangeCodeForTokens(code: string): Promise<TokenExchangeResult> {
    const clientId = requireEnv('GOOGLE_OAUTH_CLIENT_ID');
    const clientSecret = requireEnv('GOOGLE_OAUTH_CLIENT_SECRET');
    const redirectUri = requireEnv('GOOGLE_OAUTH_REDIRECT_URI');

    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code,
        grant_type: 'authorization_code'
      })
    });

    const tokenBody: any = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) {
      throw new Error(tokenBody?.error_description || tokenBody?.error || `Google token exchange failed (${tokenResponse.status})`);
    }
    if (!tokenBody.refresh_token) {
      throw new Error(
        'Google did not return a refresh token. The account may already be connected with a stale grant — remove it in Google Account permissions and try again.'
      );
    }

    const userinfoResponse = await fetch(USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` }
    });
    const userinfo: any = await userinfoResponse.json().catch(() => ({}));
    if (!userinfoResponse.ok || !userinfo.email) {
      throw new Error('Could not read the connected account email from Google.');
    }

    return {
      refreshToken: tokenBody.refresh_token,
      accessToken: tokenBody.access_token,
      scope: tokenBody.scope || SCOPES.join(' '),
      emailAddress: userinfo.email
    };
  },

  async checkAuth(refreshToken: string): Promise<HealthCheckResult> {
    try {
      await refreshAccessToken(refreshToken);
      return { ok: true };
    } catch (err: any) {
      // invalid_grant: the refresh token was revoked/expired/changed password.
      // That is never going to succeed on retry — it needs a human to
      // reconnect. Anything else (network blip, Google 5xx, rate limit) is
      // treated as transient and retried on the next scheduled check.
      const needsReauth = err?.googleError === 'invalid_grant' || err?.googleError === 'unauthorized_client';
      return { ok: false, reason: err?.message || 'Unknown auth error', needsReauth };
    }
  }
};
