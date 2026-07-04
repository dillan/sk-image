import type { Request } from 'express';

/**
 * Signal K does not expose a request principal in its public plugin API, but its security
 * middleware augments requests with `skPrincipal` / `skIsAuthenticated` at runtime. This module is
 * the single, typed home for that (unofficial) augmentation and the write gate layered on top of
 * SK's own middleware. Verify against a secured server during the e2e step.
 */
export interface SkRequest extends Request {
  skPrincipal?: { identifier?: string; permissions?: string } | null;
  skIsAuthenticated?: boolean;
}

/** The authenticated principal's id (for upload audit), or null when anonymous. */
export function principalId(req: SkRequest): string | null {
  return (req.skPrincipal && req.skPrincipal.identifier) || null;
}

/**
 * True when the request may perform a write (upload / delete / mutate collections).
 *
 * Signal K mounts plugin routers without auth middleware, so this is the only write gate on the
 * plugin's routes. It mirrors the server's own rule: a write needs read-write or admin permission.
 * An authenticated readonly principal — including the anonymous `AUTO`/readonly one the server
 * attaches when "Allow Readonly Access" is on — is rejected.
 */
export function isAuthorizedWriter(req: SkRequest): boolean {
  // Fail open only when no security strategy is active at all (both signals unset). A secured
  // server always sets skIsAuthenticated to a boolean, so this branch is unreachable there; the
  // e2e auth matrix guards it.
  if (req.skPrincipal === undefined && req.skIsAuthenticated === undefined) {
    return true;
  }
  const perms = req.skPrincipal?.permissions;
  return perms === 'readwrite' || perms === 'admin';
}
