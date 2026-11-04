"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireRole = exports.protect = void 0;
const errorHandler_1 = require("./errorHandler");
const token_service_1 = require("../services/token.service");
const User_1 = require("../models/User");
const protect = async (req, _res, next) => {
    try {
        let token;
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.split(' ')[1];
        }
        if (!token) {
            throw new errorHandler_1.AppError('Authentication required. Please sign in.', 401);
        }
        // Verify token
        const decoded = (0, token_service_1.verifyToken)(token);
        // Verify user exists and is active
        const user = await User_1.User.findById(decoded.userId).select('+status');
        if (!user) {
            throw new errorHandler_1.AppError('The user belonging to this token no longer exists.', 401);
        }
        if (user.status !== 'active') {
            throw new errorHandler_1.AppError('Your account has been deactivated. Please contact support.', 403);
        }
        // Attach to request
        req.user = {
            id: user._id.toString(),
            email: user.email,
            phone: user.phone,
            role: user.role,
            orgId: user.organization.toString(),
        };
        req.orgId = user.organization.toString();
        next();
    }
    catch (error) {
        next(error);
    }
};
exports.protect = protect;
const requireRole = (...roles) => {
    return (req, _res, next) => {
        if (!req.user || !roles.includes(req.user.role)) {
            throw new errorHandler_1.AppError('Forbidden: You do not have permission to perform this action', 403);
        }
        next();
    };
};
exports.requireRole = requireRole;
