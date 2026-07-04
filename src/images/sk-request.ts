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

export function isAuthorizedWriter(req: SkRequest): boolean {
  if (req.skPrincipal === undefined && req.skIsAuthenticated === undefined) {
    return true; // security disabled (no users)
  }
  return Boolean(req.skPrincipal && req.skPrincipal.identifier) || req.skIsAuthenticated === true;
}
