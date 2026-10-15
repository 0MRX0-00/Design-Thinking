/**
 * CampusShield Render Cloud Keep-Alive Daemon
 * Pings the Render deployment every 4 minutes to prevent free-tier instances from spinning down (cold sleep).
 */
import https from 'https';

const RENDER_HEALTH_URL = 'https://design-thinking-7ne9.onrender.com/api/health';
const PING_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes

function pingRenderServer() {
  const startTime = Date.now();
  const req = https.get(RENDER_HEALTH_URL, { timeout: 15000 }, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      const elapsed = Date.now() - startTime;
      const timeStr = new Date().toLocaleTimeString();
      try {
        const json = JSON.parse(data);
        console.log(`[KeepAlive ${timeStr}] ✅ Render Cloud Awake (${elapsed}ms) | DB: ${json.dbConnected ? 'Online' : 'Pending'} | HTTP ${res.statusCode}`);
      } catch {
        console.log(`[KeepAlive ${timeStr}] ⚡ Render Ping OK (${elapsed}ms) | HTTP ${res.statusCode}`);
      }
    });
  });

  req.on('error', (err) => {
    console.warn(`[KeepAlive ${new Date().toLocaleTimeString()}] ⚠️ Ping error:`, err.message);
  });

  req.on('timeout', () => {
    req.destroy();
    console.warn(`[KeepAlive ${new Date().toLocaleTimeString()}] ⏳ Ping timed out (server might be waking up).`);
  });
}

console.log('=======================================================');
console.log('  🛡️  CampusShield 24/7 Render Keep-Alive Service');
console.log(`  🌐  Target: ${RENDER_HEALTH_URL}`);
console.log(`  ⏱️  Interval: Every 4 minutes`);
console.log('=======================================================');

// Initial ping
pingRenderServer();

// Continuous heartbeat
setInterval(pingRenderServer, PING_INTERVAL_MS);
