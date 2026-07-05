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
 * True when the request carries a real logged-in principal — i.e. not anonymous. The server uses the
 * identifier `AUTO` for the anonymous read-only principal it attaches under "Allow Readonly Access",
 * so that one is treated as not-logged-in: a write attempt should prompt a login (401), not report a
 * permission error (403). Used to pick the right status for a denied write.
 */
export function isAuthenticatedUser(req: SkRequest): boolean {
  const id = req.skPrincipal?.identifier;
  return Boolean(id && id !== 'AUTO');
}

/**
 * True when the request may read sensitive per-image metadata — capture GPS coordinates and raw
 * EXIF. Open on an unsecured server (no security strategy at all) and to any logged-in user; a
 * secured server's anonymous or read-only `AUTO` visitor is excluded, so a shared library doesn't
 * leak where photos were taken to the public.
 */
export function canReadSensitiveMetadata(req: SkRequest): boolean {
  if (req.skPrincipal === undefined && req.skIsAuthenticated === undefined) return true;
  return isAuthenticatedUser(req);
}

/**
 * True when the request may perform a write (upload / delete / mutate collections).
 *
 * Reachability note: when server security is enabled, signalk-server fronts ALL `/plugins/*` routes
 * with an admin-only guard (`app.use('/plugins', adminAuthenticationMiddleware)` in tokensecurity),
 * so only an `admin` principal ever reaches this plugin — read-write, read-only, and anonymous
 * requests all get 401 from the server first. This in-handler check is therefore defense-in-depth:
 * the effective gate only on an UNSECURED server (no `/plugins` middleware), and a redundant belt on
 * a secured one (where only admins arrive, and admins always have write permission). It mirrors the
 * server's write rule regardless — a write needs read-write or admin permission; an authenticated
 * read-only principal (including the anonymous `AUTO`/readonly one) is rejected.
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
