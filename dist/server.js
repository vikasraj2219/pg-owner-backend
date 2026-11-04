"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const env_1 = require("./config/env");
const database_1 = require("./config/database");
const startServer = async () => {
    try {
        // 1. Connect to Database
        await (0, database_1.connectDatabase)();
        // 2. Start HTTP Server
        const server = app_1.app.listen(env_1.env.PORT, '0.0.0.0', () => {
            console.info(`===============================================`);
            console.info(`  PG Owner Backend API running in [${env_1.env.NODE_ENV}]`);
            console.info(`  Server URL: http://localhost:${env_1.env.PORT}`);
            console.info(`  Health Check: http://localhost:${env_1.env.PORT}${env_1.env.API_PREFIX}/health`);
            console.info(`===============================================`);
        });
        // 3. Graceful Shutdown Handlers
        const handleShutdown = async (signal) => {
            console.info(`\nReceived ${signal}. Starting graceful shutdown...`);
            server.close(async () => {
                console.info('HTTP server closed.');
                try {
                    await (0, database_1.disconnectDatabase)();
                    console.info('Process terminated gracefully.');
                    process.exit(0);
                }
                catch (err) {
                    console.error('Error during database disconnect:', err);
                    process.exit(1);
                }
            });
            // Force shutdown after 10 seconds timeout
            setTimeout(() => {
                console.error('Graceful shutdown timeout exceeded. Forcing exit.');
                process.exit(1);
            }, 10000);
        };
        process.on('SIGINT', () => handleShutdown('SIGINT'));
        process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    }
    catch (error) {
        console.error('Fatal error starting server:', error);
        process.exit(1);
    }
};
void startServer();
