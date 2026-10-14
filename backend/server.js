import dotenv from 'dotenv';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import app from './app.js';
import { connectDB, closeDB } from './config/db.js';
import { initSocketIO } from './sockets/socketHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config();

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  // Connect to MongoDB
  await connectDB();

  const server = http.createServer(app);

  // Initialize Socket.IO
  initSocketIO(server);

  server.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`  🛡️  CampusShield - Campus Safety & Emergency System`);
    console.log(`  🏢  Institution: Kongu Engineering College`);
    console.log(`  🚀  Server running at: http://localhost:${PORT}`);
    console.log(`  📡  Socket.IO real-time engine ready`);
    console.log(`  🌐  Frontend served from: /frontend`);
    console.log(`=======================================================`);
  });

  const shutdown = async () => {
    console.log('\n[CampusShield] Initiating graceful shutdown...');
    server.close(async () => {
      await closeDB();
      console.log('[CampusShield] Server and database terminated gracefully.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
};

startServer().catch((err) => {
  console.error('[CampusShield Fatal Server Error]:', err);
});
