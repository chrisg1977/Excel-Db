/**
 * Gate for admin-only screens (credentials, connection config). No other
 * endpoint in this codebase enforces a role check yet — they only check
 * `req.accountability?.user` for "is logged in". Email account credentials
 * are more sensitive than the existing screens, so this adds the stricter
 * admin-only tier the spec calls for, reusable by any future sensitive
 * config endpoint.
 */
export function requireAdmin(req: any, res: any): boolean {
  if (!req.accountability?.user) {
    res.status(401).json({ status: 'error', message: 'Authentication required' });
    return false;
  }
  if (!req.accountability?.admin) {
    res.status(403).json({ status: 'error', message: 'Admin access required' });
    return false;
  }
  return true;
}
