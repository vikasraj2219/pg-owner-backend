"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getHealth = void 0;
const database_1 = require("../config/database");
const env_1 = require("../config/env");
const getHealth = (_req, res) => {
    const dbStatus = (0, database_1.getDatabaseStatus)();
    res.status(200).json({
        success: true,
        data: {
            status: 'ok',
            timestamp: new Date().toISOString(),
            uptimeSeconds: Math.floor(process.uptime()),
            environment: env_1.env.NODE_ENV,
            database: dbStatus,
            version: '0.1.0',
        },
    });
};
exports.getHealth = getHealth;
