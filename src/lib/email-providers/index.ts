import type { EmailProviderAdapter } from './types.js';
import { gmailProvider } from './gmail.js';

const PROVIDERS: Record<string, EmailProviderAdapter> = {
  gmail: gmailProvider
};

/** Adding a provider later: implement EmailProviderAdapter and add it here. */
export function getProviderAdapter(provider: string): EmailProviderAdapter {
  const adapter = PROVIDERS[provider];
  if (!adapter) {
    throw new Error(`No email provider adapter registered for "${provider}".`);
  }
  return adapter;
}

export type { EmailProviderAdapter, HealthCheckResult, TokenExchangeResult } from './types.js';
