import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { Organization } from '../src/models/Organization';
import { User } from '../src/models/User';
import { Subscription } from '../src/models/Subscription';
import { Property } from '../src/models/Property';
import { Room } from '../src/models/Room';
import { Bed } from '../src/models/Bed';
import { Tenant } from '../src/models/Tenant';

let replSet: MongoMemoryReplSet | null = null;

export const startTestDatabase = async (): Promise<void> => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const uri = replSet.getUri();
  await connectDatabase(uri);

  // Initialize collections and build indexes prior to transaction runs
  await Promise.all([
    Organization.init(),
    User.init(),
    Subscription.init(),
    Property.init(),
    Room.init(),
    Bed.init(),
    Tenant.init(),
  ]);
};

export const stopTestDatabase = async (): Promise<void> => {
  if (mongoose.connection.readyState !== 0) {
    await disconnectDatabase();
  }
  if (replSet) {
    await replSet.stop();
    replSet = null;
  }
};
