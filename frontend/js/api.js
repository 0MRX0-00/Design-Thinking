// CampusShield Centralized API Client
export const getApiBase = () => {
  if (typeof window === 'undefined') return 'https://design-thinking-7ne9.onrender.com';

  // 1. User manual override (configured in app settings modal)
  const custom = localStorage.getItem('cs_backend_url');
  if (custom && custom.trim()) {
    return custom.trim().replace(/\/+$/, '');
  }

  const { protocol, hostname, port, origin } = window.location;
  if (protocol === 'file:') return 'https://design-thinking-7ne9.onrender.com';

  // 2. Native Android / Capacitor app detection
  // Inside APK, window.location.hostname is localhost, but the backend is hosted on Render
  const isCapacitor = Boolean(window.Capacitor) || protocol === 'capacitor:' || (hostname === 'localhost' && (!port || port === '80'));
  if (isCapacitor) {
    return 'https://design-thinking-7ne9.onrender.com';
  }

  // 3. If hosted on production / cloud domain (Render, Vercel, etc.)
  if (hostname && !['localhost', '127.0.0.1'].includes(hostname) && !hostname.startsWith('192.168.') && !hostname.startsWith('10.')) {
    return origin;
  }

  // 4. If accessing directly on port 5000 (localhost or LAN IP:5000)
  if (port === '5000') return origin;

  // 5. Default cloud production backend
  return 'https://design-thinking-7ne9.onrender.com';
};

let API_BASE = getApiBase();

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('cs_token') || null;
    this.isBackendOnline = false;
  }

  getBaseUrl() {
    return API_BASE;
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('cs_token', token);
    } else {
      localStorage.removeItem('cs_token');
    }
  }

  getToken() {
    if (!this.token) {
      this.token = localStorage.getItem('cs_token');
    }
    return this.token;
  }

  async _executeFetch(baseUrl, endpoint, options = {}, timeoutMs = 5000) {
    const url = new URL(`${baseUrl}${endpoint}`);
    if (options.params) {
      Object.keys(options.params).forEach((key) => {
        if (options.params[key] !== undefined && options.params[key] !== null && options.params[key] !== '') {
          url.searchParams.append(key, options.params[key]);
        }
      });
    }

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });

      const data = await response.json().catch(() => ({
        success: false,
        message: 'Non-JSON server response or parsing error'
      }));

      if (!response.ok) {
        if (response.status === 401 && !endpoint.includes('/auth/login')) {
          console.warn('[CampusShield API] Unauthorized or session expired for:', endpoint);
        }
        const error = new Error(data.message || `Request failed with HTTP status ${response.status}`);
        error.status = response.status;
        error.data = data;
        throw error;
      }

      return data;
    } finally {
      clearTimeout(timeoutTimer);
    }
  }

  async request(endpoint, options = {}) {
    const startTime = performance.now();
    let warmupTimer = null;

    if (API_BASE.includes('onrender.com')) {
      warmupTimer = setTimeout(() => {
        showToast('Connecting to Server ⏳', 'Connecting to cloud backend...', 'info');
      }, 2500);
    }

    // 1. Attempt Primary Request with 4.5s timeout
    try {
      const result = await this._executeFetch(API_BASE, endpoint, options, 4500);
      this.isBackendOnline = true;
      const latency = Math.round(performance.now() - startTime);
      updateBackendConnectionBadge(true, latency);
      return result;
    } catch (primaryErr) {
      // 2. Intelligent Auto-Failover: If primary server times out or fails to connect, try alternate server immediately
      const alternate = API_BASE.includes('10.229.94.151')
        ? 'https://design-thinking-7ne9.onrender.com'
        : 'http://10.229.94.151:5000';

      console.warn(`[CampusShield Failover] Primary server (${API_BASE}) slow or unreachable. Auto-trying ${alternate}...`);
      
      try {
        const altResult = await this._executeFetch(alternate, endpoint, options, 6000);
        // Fallback succeeded! Dynamically switch API_BASE so future calls are immediate
        API_BASE = alternate;
        localStorage.setItem('cs_backend_url', API_BASE);
        this.isBackendOnline = true;
        const latency = Math.round(performance.now() - startTime);
        updateBackendConnectionBadge(true, latency);
        console.log(`[CampusShield Failover] Successfully connected to ${alternate} (${latency}ms)!`);
        return altResult;
      } catch (fallbackErr) {
        // Both servers failed or server explicitly returned 4xx/5xx business error
        if (primaryErr.status) {
          // If the primary server actually answered with HTTP error (e.g. wrong password), throw that
          throw primaryErr;
        }
        this.isBackendOnline = false;
        updateBackendConnectionBadge(false);
        const err = new Error(primaryErr.message || 'Cannot reach CampusShield backend. Check connection.');
        err.isOffline = !window.navigator.onLine;
        throw err;
      }
    } finally {
      if (warmupTimer) clearTimeout(warmupTimer);
    }
  }

  get(endpoint, params) {
    return this.request(endpoint, { method: 'GET', params });
  }

  post(endpoint, body) {
    return this.request(endpoint, { method: 'POST', body });
  }

  patch(endpoint, body) {
    return this.request(endpoint, { method: 'PATCH', body });
  }

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  }
}

export const api = new ApiClient();

// Connection status indicator helper
export function updateBackendConnectionBadge(isOnline, latencyMs = null) {
  const badge = document.getElementById('backend-status-badge');
  const serverLabel = API_BASE.includes('10.229.94.151') || API_BASE.includes('localhost') || API_BASE.includes('127.0.0.1')
    ? 'LOCAL WI-FI ⚡'
    : 'CLOUD (RENDER) 🌐';
  const latencyLabel = latencyMs ? ` (${latencyMs}ms)` : '';

  if (badge) {
    if (isOnline) {
      badge.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        <span class="text-emerald-300 font-mono text-[11px] font-bold">${serverLabel}${latencyLabel}</span>
        <span class="text-[10px] text-emerald-400 opacity-70">⚙️</span>
      `;
      badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-700/60 text-xs cursor-pointer hover:bg-emerald-900/60 transition';
      badge.title = `Connected to ${API_BASE}. Click to test speed or change server.`;
      badge.onclick = () => showBackendSettingsModal();
    } else {
      badge.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
        <span class="text-rose-300 font-mono text-[11px] font-bold">CONNECTING / RETRY</span>
        <span class="text-[10px] text-rose-300 underline font-bold ml-1">Settings</span>
      `;
      badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-950/80 border border-rose-600 text-xs cursor-pointer';
      badge.title = `Cannot connect to ${API_BASE}. Click to configure server URL.`;
      badge.onclick = () => showBackendSettingsModal();
    }
  }

  // Update login card server display if on index.html
  updateLoginCardDisplay(isOnline, latencyMs);
}

export function updateLoginCardDisplay(isOnline, latencyMs = null) {
  const nameEl = document.getElementById('login-server-name');
  const dotEl = document.getElementById('login-server-dot');
  if (nameEl) {
    const isLocal = API_BASE.includes('10.229.94.151') || API_BASE.includes('localhost') || API_BASE.includes('127.0.0.1');
    const latStr = latencyMs ? ` • ${latencyMs}ms` : '';
    if (isOnline) {
      if (isLocal) {
        nameEl.innerHTML = `<span class="text-emerald-400 font-bold">Local Wi-Fi Server (10.229.94.151)${latStr} ⚡</span>`;
        if (dotEl) dotEl.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shrink-0';
      } else {
        nameEl.innerHTML = `<span class="text-cyan-300 font-bold">Render Cloud (Live)${latStr} 🌐</span>`;
        if (dotEl) dotEl.className = 'w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse shrink-0';
      }
    } else {
      nameEl.innerHTML = `<span class="text-rose-400 font-bold">Connecting to ${isLocal ? 'Local Wi-Fi' : 'Cloud'}...</span>`;
      if (dotEl) dotEl.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping shrink-0';
    }
  }
}

/**
 * Interactive Backend Server URL Configuration Modal
 * Lets users switch between Local Wi-Fi, Render Cloud, or custom backend URL directly from the app.
 */
export function showBackendSettingsModal() {
  const existing = document.getElementById('backend-settings-modal');
  if (existing) existing.remove();

  const currentUrl = localStorage.getItem('cs_backend_url') || API_BASE;

  const modal = document.createElement('div');
  modal.id = 'backend-settings-modal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in';
  modal.innerHTML = `
    <div class="tactical-glass max-w-md w-full p-6 rounded-2xl border border-slate-700 bg-slate-900/95 shadow-2xl text-slate-100 space-y-4">
      <div class="flex items-center justify-between border-b border-slate-800 pb-3">
        <div class="flex items-center gap-2">
          <span class="text-xl">⚡</span>
          <h3 class="font-bold text-white text-base">Backend Connection & Speed</h3>
        </div>
        <button onclick="document.getElementById('backend-settings-modal').remove()" 
                class="text-slate-400 hover:text-white font-mono text-sm px-2 py-1 rounded bg-slate-800">✕</button>
      </div>

      <p class="text-xs text-slate-300 leading-relaxed">
        Choose your connection mode. <b>Local Wi-Fi</b> gives instant 1ms response on campus. <b>Render Cloud</b> works anywhere globally.
      </p>

      <!-- Quick 1-Tap Preset Buttons -->
      <div class="space-y-2">
        <div class="text-[10px] font-mono text-slate-400 uppercase font-bold tracking-wider">TAP TO SWITCH INSTANTLY</div>
        <div class="grid grid-cols-1 gap-2 text-xs">
          
          <button type="button" 
                  onclick="window.csApi?.quickSwitchBackend('http://10.229.94.151:5000')"
                  class="p-3 text-left ${API_BASE.includes('10.229.94.151') ? 'bg-emerald-950/70 border-emerald-500' : 'bg-slate-800/80 hover:bg-emerald-950/40 border-slate-700 hover:border-emerald-600'} border rounded-xl flex items-center justify-between transition cursor-pointer group">
            <div>
              <div class="font-bold text-white flex items-center gap-1.5">
                <span>📶</span> Local Wi-Fi (10.229.94.151:5000)
                ${API_BASE.includes('10.229.94.151') ? '<span class="text-[9px] bg-emerald-500 text-black px-1.5 py-0.2 rounded font-bold font-mono">ACTIVE</span>' : ''}
              </div>
              <div class="text-[11px] text-emerald-400 mt-0.5">⚡ Instant 1ms response time (Best for campus testing)</div>
            </div>
            <span class="text-xs text-emerald-400 font-bold px-2 py-1 rounded bg-emerald-900/50 group-hover:bg-emerald-600 group-hover:text-black transition">Connect</span>
          </button>

          <button type="button" 
                  onclick="window.csApi?.quickSwitchBackend('https://design-thinking-7ne9.onrender.com')"
                  class="p-3 text-left ${API_BASE.includes('onrender.com') ? 'bg-cyan-950/70 border-cyan-500' : 'bg-slate-800/80 hover:bg-cyan-950/40 border-slate-700 hover:border-cyan-600'} border rounded-xl flex items-center justify-between transition cursor-pointer group">
            <div>
              <div class="font-bold text-white flex items-center gap-1.5">
                <span>🌐</span> Render Cloud (design-thinking-7ne9)
                ${API_BASE.includes('onrender.com') ? '<span class="text-[9px] bg-cyan-500 text-black px-1.5 py-0.2 rounded font-bold font-mono">ACTIVE</span>' : ''}
              </div>
              <div class="text-[11px] text-cyan-300 mt-0.5">🌍 Global access anywhere (Pings active 24/7)</div>
            </div>
            <span class="text-xs text-cyan-400 font-bold px-2 py-1 rounded bg-cyan-900/50 group-hover:bg-cyan-600 group-hover:text-black transition">Connect</span>
          </button>

        </div>
      </div>

      <div class="space-y-1.5 pt-1">
        <label class="block text-[10px] font-mono font-bold text-slate-400 uppercase">CUSTOM SERVER URL</label>
        <div class="flex gap-2">
          <input type="text" 
                 id="custom-backend-url-input" 
                 value="${currentUrl}" 
                 placeholder="http://10.229.94.151:5000"
                 class="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl font-mono text-xs text-white focus:outline-none focus:border-cyan-400" />
          <button type="button" 
                  id="btn-test-save-backend"
                  onclick="window.csApi?.testAndSaveBackend()"
                  class="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl text-xs transition cursor-pointer">
            Save
          </button>
        </div>
      </div>

      <div id="backend-test-status" class="hidden text-xs p-2.5 rounded-lg font-mono"></div>

      <!-- Actions -->
      <div class="pt-2 flex items-center justify-between border-t border-slate-800 text-xs">
        <button type="button"
                onclick="window.csApi?.runLatencyTest()"
                class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-xl font-mono text-xs transition cursor-pointer flex items-center gap-1.5">
          <span>⏱️</span> Test Server Latency
        </button>
        <button type="button"
                onclick="localStorage.removeItem('cs_backend_url'); window.location.reload();"
                class="px-3 py-2 text-slate-400 hover:text-white rounded-xl text-xs font-mono transition cursor-pointer">
          Reset Default
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

export async function quickSwitchBackend(targetUrl) {
  const statusEl = document.getElementById('backend-test-status');
  if (statusEl) {
    statusEl.className = 'text-xs p-2.5 rounded-lg font-mono bg-cyan-950/80 text-cyan-300 border border-cyan-800 block';
    statusEl.innerText = `⏳ Connecting to ${targetUrl}...`;
  }

  try {
    const start = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${targetUrl}/api/health`, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);

    if (res.ok) {
      const ping = Math.round(performance.now() - start);
      localStorage.setItem('cs_backend_url', targetUrl);
      API_BASE = targetUrl;
      showToast('Switched! ⚡', `Connected to ${targetUrl} (${ping}ms latency). Reloading...`, 'success');
      setTimeout(() => window.location.reload(), 700);
      return;
    }
  } catch (err) {
    showToast('Connection Failed', `Could not reach ${targetUrl}. Is device on same Wi-Fi?`, 'critical');
    if (statusEl) {
      statusEl.className = 'text-xs p-2.5 rounded-lg font-mono bg-rose-950/80 text-rose-300 border border-rose-700 block';
      statusEl.innerText = `❌ Failed to connect: ${err.message}`;
    }
  }
}

export async function runLatencyTest() {
  const statusEl = document.getElementById('backend-test-status');
  if (statusEl) {
    statusEl.className = 'text-xs p-2.5 rounded-lg font-mono bg-cyan-950/80 text-cyan-300 border border-cyan-800 block';
    statusEl.innerText = '⏱️ Measuring response times to Local Wi-Fi & Render Cloud...';
  }

  const results = [];

  // Test Local Wi-Fi
  try {
    const t0 = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch('http://10.229.94.151:5000/api/health', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    const time = Math.round(performance.now() - t0);
    results.push(`📶 Local Wi-Fi: ${r.ok ? `<b>${time}ms</b> (Ultra Fast ⚡)` : 'Offline'}`);
  } catch {
    results.push('📶 Local Wi-Fi: Unreachable from this network');
  }

  // Test Render Cloud
  try {
    const t0 = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4500);
    const r = await fetch('https://design-thinking-7ne9.onrender.com/api/health', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    const time = Math.round(performance.now() - t0);
    results.push(`🌐 Render Cloud: ${r.ok ? `<b>${time}ms</b> (Online)` : 'Offline'}`);
  } catch {
    results.push('🌐 Render Cloud: Timed out / Sleeping');
  }

  if (statusEl) {
    statusEl.className = 'text-xs p-3 rounded-lg font-mono bg-slate-950 text-slate-200 border border-slate-700 block space-y-1';
    statusEl.innerHTML = `<div class="font-bold text-cyan-300 mb-1">📊 SPEED TEST RESULTS:</div>${results.map(r => `<div>${r}</div>`).join('')}`;
  }
}

export async function testAndSaveBackend() {
  const input = document.getElementById('custom-backend-url-input');
  const statusEl = document.getElementById('backend-test-status');
  const btn = document.getElementById('btn-test-save-backend');
  if (!input) return;

  let url = input.value.trim().replace(/\/+$/, '');
  if (!url) {
    showToast('Invalid URL', 'Please enter a valid HTTP or HTTPS server address.', 'warning');
    return;
  }

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
    input.value = url;
  }

  if (statusEl) {
    statusEl.className = 'text-xs p-2.5 rounded-lg font-mono bg-cyan-950/80 text-cyan-300 border border-cyan-800 block';
    statusEl.innerText = `⏳ Pinging ${url}/api/health ...`;
  }
  if (btn) btn.disabled = true;

  try {
    const start = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(`${url}/api/health`, { signal: controller.signal });
    clearTimeout(timeout);
    const ping = Math.round(performance.now() - start);

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      localStorage.setItem('cs_backend_url', url);
      API_BASE = url;

      if (statusEl) {
        statusEl.className = 'text-xs p-2.5 rounded-lg font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-700 block';
        statusEl.innerHTML = `✅ Connected in <b>${ping}ms</b>! DB: <b>${data.dbConnected ? 'Online' : 'Pending'}</b>. Reloading...`;
      }

      showToast('Connected! ✅', `Backend active at ${url} (${ping}ms). Applying changes...`, 'success');
      setTimeout(() => {
        window.location.reload();
      }, 1000);
      return;
    } else {
      throw new Error(`HTTP ${res.status}`);
    }
  } catch (err) {
    if (statusEl) {
      statusEl.className = 'text-xs p-2.5 rounded-lg font-mono bg-rose-950/80 text-rose-300 border border-rose-700 block';
      statusEl.innerHTML = `❌ Connection Failed: ${err.message}. Make sure server is running and phone has internet access.`;
    }
    showToast('Connection Failed', `Could not reach ${url}. Check Wi-Fi or server status.`, 'critical');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Global exposure
window.csApi = {
  api,
  getApiBase,
  updateBackendConnectionBadge,
  showBackendSettingsModal,
  testAndSaveBackend,
  quickSwitchBackend,
  runLatencyTest,
  showToast
};

// Global Toast Alert Helper
export function showToast(title, message, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  const typeStyles = {
    critical: 'border-red-300 bg-red-50 text-red-900',
    success: 'border-green-300 bg-green-50 text-green-900',
    warning: 'border-amber-300 bg-amber-50 text-amber-900',
    info: 'border-blue-300 bg-blue-50 text-blue-900'
  }[type] || 'border-slate-300 bg-white text-slate-900';

  toast.className = `toast-msg p-3.5 rounded-xl border ${typeStyles} shadow-lg flex items-start gap-3 w-80 max-w-full`;
  toast.innerHTML = `
    <div class="mt-0.5 text-base">
      ${type === 'critical' ? '🚨' : type === 'success' ? '✅' : type === 'warning' ? '⚠️' : 'ℹ️'}
    </div>
    <div class="flex-1 text-sm">
      <div class="font-bold text-slate-900 tracking-tight">${title}</div>
      <div class="text-xs text-slate-600 mt-0.5">${message}</div>
    </div>
    <button class="text-slate-400 hover:text-slate-700 text-xs font-bold px-1" onclick="this.parentElement.remove()">✕</button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentElement) toast.remove();
  }, 5000);
}

// Auto-detect fast Local Wi-Fi server or pre-warm Render
export async function autoDetectFastestBackend() {
  if (typeof window === 'undefined') return;

  // If user already saved a custom preference, ping that and display latency
  const saved = localStorage.getItem('cs_backend_url');
  if (saved) {
    try {
      const t0 = performance.now();
      const r = await fetch(`${saved}/api/health`, { cache: 'no-store' });
      if (r.ok) {
        updateBackendConnectionBadge(true, Math.round(performance.now() - t0));
        return;
      }
    } catch {}
    updateBackendConnectionBadge(false);
    return;
  }

  // Probe Local Wi-Fi IP (10.229.94.151:5000) with short 1000ms timeout
  try {
    const t0 = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1000);
    const r = await fetch('http://10.229.94.151:5000/api/health', { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (r.ok) {
      const ping = Math.round(performance.now() - t0);
      console.log(`[CampusShield] Fast Local Wi-Fi detected (${ping}ms)! Auto-connecting...`);
      API_BASE = 'http://10.229.94.151:5000';
      localStorage.setItem('cs_backend_url', API_BASE);
      updateBackendConnectionBadge(true, ping);
      showToast('Turbo Speed ⚡', `Connected to ultra-fast local Wi-Fi backend (${ping}ms)!`, 'success');
      return;
    }
  } catch {}

  // Fallback to Render Cloud
  try {
    const t0 = performance.now();
    const r = await fetch(`${API_BASE}/api/health`, { cache: 'no-store' });
    if (r.ok) {
      updateBackendConnectionBadge(true, Math.round(performance.now() - t0));
    } else {
      updateBackendConnectionBadge(false);
    }
  } catch {
    updateBackendConnectionBadge(false);
  }
}

// Background Keep-Alive & Auto-Discovery Engine
if (typeof window !== 'undefined') {
  // Run auto-discovery on startup
  autoDetectFastestBackend();

  // Periodic keep-alive heartbeat every 4 minutes
  setInterval(() => {
    if (navigator.onLine) {
      fetch(`${API_BASE}/api/health`, { method: 'GET', cache: 'no-store' })
        .then((r) => { if (r.ok) updateBackendConnectionBadge(true); })
        .catch(() => updateBackendConnectionBadge(false));
    }
  }, 4 * 60 * 1000);
}

