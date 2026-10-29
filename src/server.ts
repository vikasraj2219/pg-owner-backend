import { app } from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './config/database';

const startServer = async (): Promise<void> => {
  try {
    // 1. Connect to Database
    await connectDatabase();

    // 2. Start HTTP Server
    const server = app.listen(env.PORT, () => {
      console.info(`===============================================`);
      console.info(`  PG Owner Backend API running in [${env.NODE_ENV}]`);
      console.info(`  Server URL: http://localhost:${env.PORT}`);
      console.info(`  Health Check: http://localhost:${env.PORT}${env.API_PREFIX}/health`);
      console.info(`===============================================`);
    });

    // 3. Graceful Shutdown Handlers
    const handleShutdown = async (signal: string) => {
      console.info(`\nReceived ${signal}. Starting graceful shutdown...`);
      server.close(async () => {
        console.info('HTTP server closed.');
        try {
          await disconnectDatabase();
          console.info('Process terminated gracefully.');
          process.exit(0);
        } catch (err) {
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
  } catch (error) {
    console.error('Fatal error starting server:', error);
    process.exit(1);
  }
};

void startServer();
