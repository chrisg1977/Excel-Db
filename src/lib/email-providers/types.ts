/**
 * Provider-agnostic contract for connecting a mailbox. Gmail is the only
 * implementation today, but nothing in email-accounts.ts or the DB schema
 * should assume Gmail — a second provider is a new file implementing this
 * interface plus a registry entry, not a schema or endpoint change.
 */

export type TokenExchangeResult = {
  refreshToken: string;
  accessToken: string;
  scope: string;
  emailAddress: string;
};

export type HealthCheckResult =
  | { ok: true }
  | { ok: false; reason: string; needsReauth: boolean };

export interface EmailProviderAdapter {
  readonly name: string;

  /** Build the provider consent URL the admin's browser is redirected to. */
  getAuthUrl(state: string): string;

  /** Exchange an authorization code (from the OAuth redirect) for tokens. */
  exchangeCodeForTokens(code: string): Promise<TokenExchangeResult>;

  /**
   * Lightweight check that the stored refresh token still works. Must not
   * fetch or modify any mail — this is an auth probe only.
   */
  checkAuth(refreshToken: string): Promise<HealthCheckResult>;
}
