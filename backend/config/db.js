import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { seedDatabaseData } from '../scripts/seed.js';

let mongoMemoryServer = null;

export const connectDB = async (customUri) => {
  const uri = customUri || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/campusshield';
  
  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 2000,
      autoIndex: true
    });

    console.log(`[CampusShield DB] Connected to MongoDB Server: ${conn.connection.host} / ${conn.connection.name}`);
    await autoSeedIfEmpty();
    return conn;
  } catch (error) {
    console.warn(`[CampusShield DB] Local MongoDB (127.0.0.1:27017) not reachable: ${error.message}`);
    console.log('[CampusShield DB] Initializing embedded In-Memory database fallback...');
    
    try {
      const { MongoMemoryServer } = await import('mongodb-memory-server');
      mongoMemoryServer = await MongoMemoryServer.create({
        instance: { dbName: 'campusshield' }
      });
      const memoryUri = mongoMemoryServer.getUri();
      const conn = await mongoose.connect(memoryUri, {
        autoIndex: true
      });
      console.log(`[CampusShield DB] Connected to In-Memory MongoDB: ${memoryUri}`);
      await autoSeedIfEmpty();
      return conn;
    } catch (memErr) {
      console.error('[CampusShield DB] In-memory database initialization failed:', memErr.message);
      return null;
    }
  }
};

async function autoSeedIfEmpty() {
  try {
    const count = await User.countDocuments();
    if (count === 0) {
      console.log('[CampusShield DB] Empty database detected. Auto-seeding initial KEC records...');
      await seedDatabaseData();
    }
  } catch (err) {
    console.warn('[CampusShield DB] Auto-seed check notice:', err.message);
  }
}

export const isDbConnected = () => {
  return mongoose.connection.readyState === 1;
};

export const closeDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
    console.log('[CampusShield DB] MongoDB connection closed.');
  }
  if (mongoMemoryServer) {
    await mongoMemoryServer.stop();
  }
};
