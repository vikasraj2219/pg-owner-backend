import mongoose from 'mongoose';
import { getDatabaseStatus, mapReadyStateToString } from '../src/config/database';
import { startTestDatabase, stopTestDatabase } from './testDb';

describe('Database Configuration & Status', () => {
  afterEach(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });

  describe('mapReadyStateToString', () => {
    it('maps 0 to disconnected', () => {
      expect(mapReadyStateToString(0)).toBe('disconnected');
    });

    it('maps 1 to connected', () => {
      expect(mapReadyStateToString(1)).toBe('connected');
    });

    it('maps 2 to connecting', () => {
      expect(mapReadyStateToString(2)).toBe('connecting');
    });

    it('maps 3 to disconnecting', () => {
      expect(mapReadyStateToString(3)).toBe('disconnecting');
    });

    it('maps 99 to uninitialized', () => {
      expect(mapReadyStateToString(99)).toBe('uninitialized');
    });

    it('maps unknown number to unknown', () => {
      expect(mapReadyStateToString(42)).toBe('unknown');
    });
  });

  describe('getDatabaseStatus', () => {
    it('returns disconnected when mongoose is not connected', () => {
      expect(getDatabaseStatus()).toEqual({
        state: 'disconnected',
        connected: false,
      });
    });
  });

  describe('Database Connection Flow', () => {
    it('successfully connects and disconnects with active replica set', async () => {
      await startTestDatabase();
      expect(mongoose.connection.readyState).toBe(1);

      const status = getDatabaseStatus();
      expect(status).toEqual({
        state: 'connected',
        connected: true,
      });

      await stopTestDatabase();
      expect(mongoose.connection.readyState).toBe(0);
      expect(getDatabaseStatus().connected).toBe(false);
    }, 20000);
  });
});
