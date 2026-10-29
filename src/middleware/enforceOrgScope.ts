import { Response, NextFunction } from 'express';
import { AppError } from './errorHandler';
import { AuthenticatedRequest } from '../types';

/**
 * Middleware that guarantees the request is hard-scoped to the authenticated organization.
 * Rejects any request attempting to access or supply a different organization ID.
 */
export const enforceOrgScope = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction,
): void => {
  if (!req.orgId) {
    return next(new AppError('Organization context is required for this route', 403));
  }

  // If request contains an explicit orgId in params, verify it matches
  if (req.params.orgId && req.params.orgId !== req.orgId) {
    return next(new AppError('Forbidden: Access denied to resources of another organization', 403));
  }

  // If request body contains organization, ensure it matches or overwrite with authenticated orgId
  if (req.body && typeof req.body === 'object') {
    if (req.body.organization && req.body.organization.toString() !== req.orgId) {
      return next(
        new AppError('Forbidden: Cannot modify resources belonging to another organization', 403),
      );
    }
    // Hard-bind body organization to authenticated org
    req.body.organization = req.orgId;
  }

  next();
};

/**
 * Helper to enforce organization scoping on any Mongoose query filter.
 * Ensures cross-tenant leakage is impossible.
 */
export const scopeFilter = <T extends Record<string, unknown>>(
  req: AuthenticatedRequest,
  filter: T = {} as T,
): T & { organization: string } => {
  if (!req.orgId) {
    throw new AppError('Cannot scope query without authenticated organization context', 403);
  }

  return {
    ...filter,
    organization: req.orgId,
  };
};
