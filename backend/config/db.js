import mongoose from 'mongoose';

let mongoMemoryServer = null;
let isUsingMemoryFallback = false;

/**
 * Sanitizes MongoDB connection string by redacting password credentials in logs
 */
export const maskMongoUri = (uri) => {
  if (!uri || typeof uri !== 'string') return '[empty]';
  return uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@');
};

export const connectDB = async (customUri) => {
  const uri = customUri || process.env.MONGODB_URI;

  if (!uri) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[CampusShield DB FATAL] MONGODB_URI environment variable is missing in production.');
      return null;
    }
  }

  const targetUri = uri || 'mongodb://127.0.0.1:27017/campusshield';

  try {
    const conn = await mongoose.connect(targetUri, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 20,
      minPoolSize: 2,
      maxIdleTimeMS: 60000,
      autoIndex: process.env.NODE_ENV !== 'production'
    });

    isUsingMemoryFallback = false;
    console.log(`[CampusShield DB] Connected to MongoDB Server: ${conn.connection.host} / ${conn.connection.name}`);
    return conn;
  } catch (error) {
    console.warn(`[CampusShield DB] Persistent MongoDB connection failed: ${error.message}`);

    // Strictly forbid in-memory fallback in production to ensure data safety and truthful readiness
    if (process.env.NODE_ENV === 'production') {
      console.error('[CampusShield DB FATAL] Persistent Atlas database is unreachable in production. In-memory fallback is disabled.');
      return null;
    }

    // Optional development/test-only fallback if explicitly permitted
    if (process.env.ALLOW_MEMORY_FALLBACK === 'true' || process.env.NODE_ENV === 'test') {
      console.log('[CampusShield DB] Initializing development in-memory database fallback...');
      try {
        const { MongoMemoryServer } = await import('mongodb-memory-server');
        mongoMemoryServer = await MongoMemoryServer.create({
          instance: { dbName: 'campusshield' }
        });
        const memoryUri = mongoMemoryServer.getUri();
        const conn = await mongoose.connect(memoryUri, {
          autoIndex: true
        });
        isUsingMemoryFallback = true;
        console.log(`[CampusShield DB] Connected to development In-Memory MongoDB: ${maskMongoUri(memoryUri)}`);
        return conn;
      } catch (memErr) {
        console.error('[CampusShield DB] In-memory database initialization failed:', memErr.message);
        return null;
      }
    }

    return null;
  }
};

export const isDbConnected = () => {
  return mongoose.connection.readyState === 1;
};

export const isMemoryFallback = () => {
  return isUsingMemoryFallback;
};

export const closeDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.close();
    console.log('[CampusShield DB] MongoDB connection closed.');
  }
  if (mongoMemoryServer) {
    await mongoMemoryServer.stop();
    mongoMemoryServer = null;
    isUsingMemoryFallback = false;
  }
};

