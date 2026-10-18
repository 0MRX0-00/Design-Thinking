// CampusShield Centralized API Client
export const RENDER_BACKEND_URL = 'https://design-thinking-7ne9.onrender.com';

export const getApiBase = () => {
  if (typeof window === 'undefined') return RENDER_BACKEND_URL;

  // 1. Explicit local development override (e.g. localStorage.setItem('cs_backend_url', 'http://localhost:5000'))
  const custom = localStorage.getItem('cs_backend_url');
  if (custom && custom.trim()) {
    return custom.trim().replace(/\/+$/, '');
  }

  // 2. Global window configuration if injected
  if (window.__CAMPUSSHIELD_API_URL__) {
    return window.__CAMPUSSHIELD_API_URL__.trim().replace(/\/+$/, '');
  }

  // 3. If running directly on a deployed Render host
  if (window.location.hostname && window.location.hostname.includes('onrender.com')) {
    return window.location.origin;
  }

  // 4. Default: All deployed and local frontend instances connect to the Render cloud backend
  return RENDER_BACKEND_URL;
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
    const isGet = !options.method || options.method === 'GET';
    let warmupTimer = null;

    if (API_BASE.includes('onrender.com')) {
      warmupTimer = setTimeout(() => {
        showToast('Connecting', 'Connecting to server...', 'info');
      }, 4000);
    }

    try {
      const result = await this._executeFetch(API_BASE, endpoint, options, 20000);
      this.isBackendOnline = true;
      return result;
    } catch (err) {
      // Automatic single retry for idempotent GET requests on transient network or cold-start spin-ups
      if (isGet && !err.status && !err.isOffline) {
        try {
          await new Promise((r) => setTimeout(r, 1200));
          const retryResult = await this._executeFetch(API_BASE, endpoint, options, 20000);
          this.isBackendOnline = true;
          return retryResult;
        } catch {}
      }

      this.isBackendOnline = false;
      if (err.status) {
        throw err;
      }
      const networkErr = new Error(err.message || 'Unable to connect to CampusShield server. Please check your internet connection.');
      networkErr.isOffline = !window.navigator.onLine;
      throw networkErr;
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
  // Never show technical connection badges on the student portal
  if (typeof window !== 'undefined' && window.location.pathname.includes('student')) {
    const badge = document.getElementById('backend-status-badge');
    if (badge) badge.classList.add('hidden');
    return;
  }

  const badge = document.getElementById('backend-status-badge');
  if (badge) {
    if (isOnline) {
      badge.classList.add('hidden');
    } else {
      badge.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-rose-500"></span>
        <span class="text-xs text-rose-700">Connection Offline</span>
      `;
      badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded bg-rose-50 border border-rose-200 text-xs';
    }
  }

  // Update login card server display if on index.html
  updateLoginCardDisplay(isOnline, latencyMs);
}

export function updateLoginCardDisplay(isOnline, latencyMs = null) {
  const nameEl = document.getElementById('login-server-name');
  const dotEl = document.getElementById('login-server-dot');
  if (nameEl) {
    const isLocal = API_BASE.includes('localhost') || API_BASE.includes('127.0.0.1');
    const latStr = latencyMs ? ` (${latencyMs}ms)` : '';
    if (isOnline) {
      if (isLocal) {
        nameEl.innerHTML = `<span class="text-slate-700 font-semibold">Local Server${latStr}</span>`;
        if (dotEl) dotEl.className = 'w-2 h-2 rounded-full bg-emerald-500 shrink-0';
      } else {
        nameEl.innerHTML = `<span class="text-slate-700 font-semibold">Render Server${latStr}</span>`;
        if (dotEl) dotEl.className = 'w-2 h-2 rounded-full bg-blue-500 shrink-0';
      }
    } else {
      nameEl.innerHTML = `<span class="text-slate-500">Connecting to server...</span>`;
      if (dotEl) dotEl.className = 'w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0';
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
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop';
  modal.innerHTML = `
    <div class="bg-white max-w-md w-full p-5 rounded-lg border border-slate-200 shadow-md text-slate-900 space-y-4">
      <div class="flex items-center justify-between border-b border-slate-100 pb-2.5">
        <h3 class="font-bold text-slate-900 text-sm">Server Settings</h3>
        <button onclick="document.getElementById('backend-settings-modal').remove()" 
                class="text-slate-400 hover:text-slate-600 text-sm">✕</button>
      </div>

      <p class="text-xs text-slate-500">
        Configure the backend API server address for local development or deployed instances.
      </p>

      <div class="space-y-2">
        <div class="text-[11px] font-semibold text-slate-600">Preset Server URLs:</div>
        <div class="grid grid-cols-1 gap-1.5 text-xs">
          
          <button type="button" 
                  onclick="window.csApi?.quickSwitchBackend('https://design-thinking-7ne9.onrender.com')"
                  class="p-2.5 text-left ${API_BASE.includes('onrender.com') ? 'bg-blue-50 border-blue-300' : 'bg-slate-50 hover:bg-slate-100 border-slate-200'} border rounded flex items-center justify-between transition cursor-pointer">
            <div>
              <div class="font-semibold text-slate-800">Render Cloud Backend (Default)</div>
              <div class="text-[11px] text-slate-500 font-mono">https://design-thinking-7ne9.onrender.com</div>
            </div>
            <span class="text-xs font-semibold text-blue-600">${API_BASE.includes('onrender.com') ? 'Active' : 'Select'}</span>
          </button>

          <button type="button" 
                  onclick="window.csApi?.quickSwitchBackend('http://localhost:5000')"
                  class="p-2.5 text-left ${API_BASE.includes('localhost') ? 'bg-blue-50 border-blue-300' : 'bg-slate-50 hover:bg-slate-100 border-slate-200'} border rounded flex items-center justify-between transition cursor-pointer">
            <div>
              <div class="font-semibold text-slate-800">Local Development Server</div>
              <div class="text-[11px] text-slate-500 font-mono">http://localhost:5000</div>
            </div>
            <span class="text-xs font-semibold text-blue-600">${API_BASE.includes('localhost') ? 'Active' : 'Select'}</span>
          </button>

        </div>
      </div>

      <div class="space-y-1">
        <label class="block text-[11px] font-semibold text-slate-700">Custom Server URL</label>
        <div class="flex gap-2">
          <input type="text" 
                 id="custom-backend-url-input" 
                 value="${currentUrl}" 
                 placeholder="http://localhost:5000"
                 class="flex-1 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded font-mono text-xs text-slate-900 focus:outline-none focus:border-[#1E3A5F]" />
          <button type="button" 
                  id="btn-test-save-backend"
                  onclick="window.csApi?.testAndSaveBackend()"
                  class="px-3 py-1.5 bg-[#1E3A5F] hover:bg-[#152843] text-white font-semibold rounded text-xs transition cursor-pointer">
            Save
          </button>
        </div>
      </div>

      <div id="backend-test-status" class="hidden text-xs p-2 rounded border font-mono"></div>

      <!-- Actions -->
      <div class="pt-2 flex items-center justify-between border-t border-slate-100 text-xs">
        <button type="button"
                onclick="window.csApi?.runLatencyTest()"
                class="px-2.5 py-1 text-slate-700 hover:bg-slate-100 rounded text-xs transition cursor-pointer">
          Check Connection
        </button>
        <button type="button"
                onclick="localStorage.removeItem('cs_backend_url'); window.location.reload();"
                class="px-2.5 py-1 text-slate-500 hover:text-slate-800 rounded text-xs transition cursor-pointer">
          Reset to Default
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
    statusEl.className = 'text-xs p-2 rounded font-mono bg-slate-100 text-slate-700 border border-slate-300 block';
    statusEl.innerText = 'Testing connection latency...';
  }

  const results = [];

  // Test Configured Backend
  try {
    const t0 = performance.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`${API_BASE}/api/health`, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(timer);
    const time = Math.round(performance.now() - t0);
    results.push(`Active Server (${API_BASE}): ${r.ok ? `${time}ms (Online)` : 'HTTP error'}`);
  } catch {
    results.push(`Active Server (${API_BASE}): Offline or timeout`);
  }

  // Test Render Cloud (if not already active)
  if (API_BASE !== RENDER_BACKEND_URL) {
    try {
      const t0 = performance.now();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(`${RENDER_BACKEND_URL}/api/health`, { signal: ctrl.signal, cache: 'no-store' });
      clearTimeout(timer);
      const time = Math.round(performance.now() - t0);
      results.push(`Render Cloud: ${r.ok ? `${time}ms (Online)` : 'Offline'}`);
    } catch {
      results.push('Render Cloud: Timed out or sleeping');
    }
  }

  if (statusEl) {
    statusEl.className = 'text-xs p-2 rounded font-mono bg-slate-50 text-slate-800 border border-slate-200 block space-y-1';
    statusEl.innerHTML = `<div class="font-bold text-slate-900 mb-1">Connection Test Results:</div>${results.map(r => `<div>${r}</div>`).join('')}`;
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

// Pre-warm and check configured backend health
export async function autoDetectFastestBackend() {
  if (typeof window === 'undefined') return;

  try {
    const t0 = performance.now();
    const r = await fetch(`${API_BASE}/api/health`, { cache: 'no-store' });
    if (r.ok) {
      api.isBackendOnline = true;
      updateBackendConnectionBadge(true, Math.round(performance.now() - t0));
    } else {
      api.isBackendOnline = false;
      updateBackendConnectionBadge(false);
    }
  } catch {
    api.isBackendOnline = false;
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

