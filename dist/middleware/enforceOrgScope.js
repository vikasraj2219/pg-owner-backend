"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scopeFilter = exports.enforceOrgScope = void 0;
const errorHandler_1 = require("./errorHandler");
/**
 * Middleware that guarantees the request is hard-scoped to the authenticated organization.
 * Rejects any request attempting to access or supply a different organization ID.
 */
const enforceOrgScope = (req, _res, next) => {
    if (!req.orgId) {
        return next(new errorHandler_1.AppError('Organization context is required for this route', 403));
    }
    // If request contains an explicit orgId in params, verify it matches
    if (req.params.orgId && req.params.orgId !== req.orgId) {
        return next(new errorHandler_1.AppError('Forbidden: Access denied to resources of another organization', 403));
    }
    // If request body contains organization, ensure it matches or overwrite with authenticated orgId
    if (req.body && typeof req.body === 'object') {
        if (req.body.organization && req.body.organization.toString() !== req.orgId) {
            return next(new errorHandler_1.AppError('Forbidden: Cannot modify resources belonging to another organization', 403));
        }
        // Hard-bind body organization to authenticated org
        req.body.organization = req.orgId;
    }
    next();
};
exports.enforceOrgScope = enforceOrgScope;
/**
 * Helper to enforce organization scoping on any Mongoose query filter.
 * Ensures cross-tenant leakage is impossible.
 */
const scopeFilter = (req, filter = {}) => {
    if (!req.orgId) {
        throw new errorHandler_1.AppError('Cannot scope query without authenticated organization context', 403);
    }
    return {
        ...filter,
        organization: req.orgId,
    };
};
exports.scopeFilter = scopeFilter;
