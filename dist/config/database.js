"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDatabaseStatus = exports.mapReadyStateToString = exports.disconnectDatabase = exports.connectDatabase = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const env_1 = require("./env");
const connectDatabase = async (customUri) => {
    try {
        const uri = customUri || env_1.env.MONGODB_URI;
        const conn = await mongoose_1.default.connect(uri, {
            autoIndex: true, // Build indexes in dev, consider false in massive scale
        });
        console.info(`MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`);
        // Check if connected instance supports transactions (requires replica set)
        if (conn.connection.db) {
            try {
                const hello = await conn.connection.db.command({ hello: 1 });
                const hasReplicaSet = Boolean(hello.setName);
                if (!hasReplicaSet && env_1.env.NODE_ENV !== 'test') {
                    console.warn('⚠️  Connected MongoDB is NOT running as a Replica Set. Multi-document transactions (Stage 3+) will require a replica set (e.g. MongoDB Atlas M0 free tier or local rs.initiate()).');
                }
                else if (hasReplicaSet) {
                    console.info(`✅ MongoDB Replica Set active [${hello.setName}]. Multi-document transactions supported.`);
                }
            }
            catch (_err) {
                console.info('MongoDB connected. (Skipped replica set check)');
            }
        }
        return conn;
    }
    catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        if (env_1.env.NODE_ENV !== 'test') {
            process.exit(1);
        }
        throw error;
    }
};
exports.connectDatabase = connectDatabase;
const disconnectDatabase = async () => {
    await mongoose_1.default.disconnect();
    console.info('MongoDB disconnected.');
};
exports.disconnectDatabase = disconnectDatabase;
const mapReadyStateToString = (readyState) => {
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
exports.mapReadyStateToString = mapReadyStateToString;
const getDatabaseStatus = () => {
    const readyState = mongoose_1.default.connection.readyState;
    return {
        state: (0, exports.mapReadyStateToString)(readyState),
        connected: readyState === 1,
    };
};
exports.getDatabaseStatus = getDatabaseStatus;
