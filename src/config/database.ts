import mongoose from 'mongoose';
import { env } from './env';

export const connectDatabase = async (customUri?: string): Promise<typeof mongoose> => {
  try {
    const uri = customUri || env.MONGODB_URI;
    const conn = await mongoose.connect(uri, {
      autoIndex: true, // Build indexes in dev, consider false in massive scale
    });

    console.info(`MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);

    // Check if connected instance supports transactions (requires replica set)
    if (conn.connection.db) {
      try {
        const hello = await conn.connection.db.command({ hello: 1 });
        const hasReplicaSet = Boolean(hello.setName);
        if (!hasReplicaSet && env.NODE_ENV !== 'test') {
          console.warn(
            '⚠️  Connected MongoDB is NOT running as a Replica Set. Multi-document transactions (Stage 3+) will require a replica set (e.g. MongoDB Atlas M0 free tier or local rs.initiate()).',
          );
        } else if (hasReplicaSet) {
          console.info(
            `✅ MongoDB Replica Set active [${hello.setName}]. Multi-document transactions supported.`,
          );
        }
      } catch (_err) {
        console.info('MongoDB connected. (Skipped replica set check)');
      }
    }

    return conn;
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error);
    if (env.NODE_ENV !== 'test') {
      process.exit(1);
    }
    throw error;
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  await mongoose.disconnect();
  console.info('MongoDB disconnected.');
};

export const mapReadyStateToString = (readyState: number): string => {
  switch (readyState) {
    case 0:
      return 'disconnected';
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnecting';
    case 99:
      return 'uninitialized';
    default:
      return 'unknown';
  }
};

export const getDatabaseStatus = (): {
  state: string;
  connected: boolean;
} => {
  const readyState = mongoose.connection.readyState;

  return {
    state: mapReadyStateToString(readyState),
    connected: readyState === 1,
  };
};
