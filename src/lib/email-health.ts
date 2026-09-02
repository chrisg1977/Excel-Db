import type { HealthCheckResult } from './email-providers/types.js';

// One bad poll doesn't mean the grant is dead — only flag the account as
// needing attention once a run of failures makes it clear this isn't noise.
export const TRANSIENT_FAILURE_THRESHOLD = 3;

export type HealthCheckUpdate = {
  status?: 'active' | 'error';
  needs_reauth: boolean;
  consecutive_failures: number;
  last_success_at?: Date;
  last_error: string | null;
  last_error_at: Date | null;
  alertMessage: string | null;
};

/**
 * Pure decision function for what a health check result means for the
 * account row and whether it's alert-worthy. Kept separate from the DB/HTTP
 * plumbing in email-accounts.ts so the revoked-grant-vs-transient-failure
 * behavior can be unit tested without a running Directus/Postgres instance.
 */
export function classifyHealthCheckResult(previousConsecutiveFailures: number, result: HealthCheckResult, now: Date): HealthCheckUpdate {
  if (result.ok) {
    return {
      status: 'active',
      needs_reauth: false,
      consecutive_failures: 0,
      last_success_at: now,
      last_error: null,
      last_error_at: null,
      alertMessage: null
    };
  }

  const newFailures = previousConsecutiveFailures + 1;
  const justCrossedThreshold = previousConsecutiveFailures < TRANSIENT_FAILURE_THRESHOLD && newFailures >= TRANSIENT_FAILURE_THRESHOLD;
  const becomesError = result.needsReauth || justCrossedThreshold;

  return {
    status: becomesError ? 'error' : undefined,
    needs_reauth: result.needsReauth,
    consecutive_failures: newFailures,
    last_error: result.reason,
    last_error_at: now,
    alertMessage:
      result.needsReauth || justCrossedThreshold
        ? result.needsReauth
          ? `Needs re-authentication: ${result.reason}`
          : `${newFailures} consecutive failed health checks: ${result.reason}`
        : null
  };
}
