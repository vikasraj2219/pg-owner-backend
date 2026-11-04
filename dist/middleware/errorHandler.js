"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = exports.AppError = void 0;
const zod_1 = require("zod");
const env_1 = require("../config/env");
class AppError extends Error {
    statusCode;
    isOperational;
    errors;
    constructor(message, statusCode = 500, errors) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        this.errors = errors;
        Object.setPrototypeOf(this, AppError.prototype);
        Error.captureStackTrace(this, this.constructor);
    }
}
exports.AppError = AppError;
const errorHandler = (err, _req, res, _next) => {
    // Handle custom AppError
    if (err instanceof AppError) {
        res.status(err.statusCode).json({
            success: false,
            message: err.message,
            errors: err.errors,
            ...(env_1.env.NODE_ENV === 'development' && { stack: err.stack }),
        });
        return;
    }
    // Handle Zod validation errors
    if (err instanceof zod_1.ZodError) {
        res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: err.flatten().fieldErrors,
            ...(env_1.env.NODE_ENV === 'development' && { stack: err.stack }),
        });
        return;
    }
    // Handle Mongoose duplicate key error (code 11000)
    if ('code' in err && err.code === 11000) {
        res.status(409).json({
            success: false,
            message: 'Duplicate key error: A resource with that unique identifier already exists.',
            ...(env_1.env.NODE_ENV === 'development' && { stack: err.stack }),
        });
        return;
    }
    // Handle Mongoose CastError (invalid ObjectId)
    if (err.name === 'CastError') {
        res.status(400).json({
            success: false,
            message: 'Invalid resource ID format',
            ...(env_1.env.NODE_ENV === 'development' && { stack: err.stack }),
        });
        return;
    }
    // Handle JWT errors
    if (err.name === 'JsonWebTokenError') {
        res.status(401).json({
            success: false,
            message: 'Invalid authorization token',
        });
        return;
    }
    if (err.name === 'TokenExpiredError') {
        res.status(401).json({
            success: false,
            message: 'Authorization token has expired',
        });
        return;
    }
    // Generic internal server error
    console.error('Unhandled Server Error:', err);
    res.status(500).json({
        success: false,
        message: env_1.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
        ...(env_1.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
};
exports.errorHandler = errorHandler;
