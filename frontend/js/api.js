// CampusShield Centralized API Client
export const getApiBase = () => {
  if (typeof window === 'undefined') return 'http://localhost:5000';

  // 1. User manual override (configured in app settings modal)
  const custom = localStorage.getItem('cs_backend_url');
  if (custom && custom.trim()) {
    return custom.trim().replace(/\/+$/, '');
  }

  const { protocol, hostname, port, origin } = window.location;
  if (protocol === 'file:') return 'http://10.229.94.151:5000';

  // 2. Native Android / Capacitor app detection
  // Inside APK, window.location.hostname is localhost, but localhost on phone has no backend!
  const isCapacitor = Boolean(window.Capacitor) || protocol === 'capacitor:' || (hostname === 'localhost' && (!port || port === '80'));
  if (isCapacitor) {
    return 'http://10.229.94.151:5000';
  }

  // 3. If hosted on production / cloud domain (Render, Vercel, etc.)
  if (hostname && !['localhost', '127.0.0.1'].includes(hostname) && !hostname.startsWith('192.168.') && !hostname.startsWith('10.')) {
    return origin;
  }

  // 4. If accessing directly on port 5000 (localhost or LAN IP:5000)
  if (port === '5000') return origin;

  // 5. If running via Live Server (5500, etc.), point to local backend on 5000
  return `http://${hostname || 'localhost'}:5000`;
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

  async request(endpoint, options = {}) {
    const url = new URL(`${API_BASE}${endpoint}`);
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

    try {
      const response = await fetch(url.toString(), {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined
      });

      this.isBackendOnline = true;
      updateBackendConnectionBadge(true);

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
    } catch (err) {
      if (!window.navigator.onLine) {
        err.isOffline = true;
        err.message = 'Network offline. Check your internet connection.';
      } else if (err.name === 'TypeError' && err.message.includes('fetch')) {
        this.isBackendOnline = false;
        updateBackendConnectionBadge(false);
        err.message = `Cannot connect to CampusShield Backend at ${API_BASE}. Ensure the server is running (npm start / start.bat).`;
      }
      throw err;
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
export function updateBackendConnectionBadge(isOnline) {
  const badge = document.getElementById('backend-status-badge');
  if (badge) {
    if (isOnline) {
      badge.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
        <span class="text-emerald-300 font-mono text-[11px] font-bold">BACKEND CONNECTED</span>
        <span class="text-[10px] text-emerald-400 opacity-70">⚙️</span>
      `;
      badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-700/60 text-xs cursor-pointer';
      badge.title = `Connected to ${API_BASE}. Click to change backend URL.`;
      badge.onclick = () => showBackendSettingsModal();
    } else {
      badge.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
        <span class="text-rose-300 font-mono text-[11px] font-bold">BACKEND DISCONNECTED</span>
        <span class="text-[10px] text-rose-300 underline font-bold ml-1">Configure</span>
      `;
      badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-950/80 border border-rose-600 text-xs cursor-pointer';
      badge.title = `Cannot connect to ${API_BASE}. Click to configure server URL.`;
      badge.onclick = () => showBackendSettingsModal();
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
          <span class="text-xl">🌐</span>
          <h3 class="font-bold text-white text-base">Backend Server Configuration</h3>
        </div>
        <button onclick="document.getElementById('backend-settings-modal').remove()" 
                class="text-slate-400 hover:text-white font-mono text-sm px-2 py-1 rounded bg-slate-800">✕</button>
      </div>

      <p class="text-xs text-slate-400 leading-relaxed">
        If running as an installed Android app or on a mobile phone, connect to your live cloud server or your computer's local Wi-Fi IP address:
      </p>

      <div class="space-y-1.5">
        <label class="block text-[11px] font-mono font-bold text-cyan-300">ACTIVE SERVER URL</label>
        <input type="text" 
               id="custom-backend-url-input" 
               value="${currentUrl}" 
               placeholder="https://your-service.onrender.com or http://10.229.94.151:5000"
               class="w-full px-3 py-2.5 bg-slate-950 border border-slate-700 rounded-xl font-mono text-xs text-white focus:outline-none focus:border-cyan-400" />
      </div>

      <!-- Quick Preset Buttons -->
      <div class="space-y-1.5">
        <div class="text-[10px] font-mono text-slate-400 uppercase font-bold">QUICK PRESETS</div>
        <div class="grid grid-cols-1 gap-1.5 text-xs">
          <button type="button" 
                  onclick="document.getElementById('custom-backend-url-input').value='http://10.229.94.151:5000'"
                  class="p-2 text-left bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded-lg flex items-center justify-between text-slate-300 hover:text-white transition cursor-pointer">
            <span class="font-mono text-[11px]">📶 Local Wi-Fi (10.229.94.151:5000)</span>
            <span class="text-[10px] text-cyan-400 font-bold">Select</span>
          </button>
          <button type="button" 
                  onclick="document.getElementById('custom-backend-url-input').value='https://design-thinking-0mrx0-00.onrender.com'"
                  class="p-2 text-left bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded-lg flex items-center justify-between text-slate-300 hover:text-white transition cursor-pointer">
            <span class="font-mono text-[11px]">🌐 Render Cloud Service</span>
            <span class="text-[10px] text-cyan-400 font-bold">Select</span>
          </button>
          <button type="button" 
                  onclick="document.getElementById('custom-backend-url-input').value='http://localhost:5000'"
                  class="p-2 text-left bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded-lg flex items-center justify-between text-slate-300 hover:text-white transition cursor-pointer">
            <span class="font-mono text-[11px]">💻 Localhost (127.0.0.1:5000)</span>
            <span class="text-[10px] text-cyan-400 font-bold">Select</span>
          </button>
        </div>
      </div>

      <div id="backend-test-status" class="hidden text-xs p-2.5 rounded-lg font-mono"></div>

      <!-- Actions -->
      <div class="pt-2 flex items-center gap-2">
        <button type="button" 
                id="btn-test-save-backend"
                onclick="window.csApi?.testAndSaveBackend()"
                class="flex-1 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl text-xs transition cursor-pointer shadow-lg shadow-cyan-900/40">
          ⚡ Test Connection & Save
        </button>
        <button type="button"
                onclick="localStorage.removeItem('cs_backend_url'); window.location.reload();"
                class="px-3 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-xl text-xs font-mono transition cursor-pointer">
          Reset
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const res = await fetch(`${url}/api/health`, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      localStorage.setItem('cs_backend_url', url);
      API_BASE = url;

      if (statusEl) {
        statusEl.className = 'text-xs p-2.5 rounded-lg font-mono bg-emerald-950/80 text-emerald-300 border border-emerald-700 block';
        statusEl.innerHTML = `✅ Connected Successfully! DB: <b>${data.dbConnected ? 'Online' : 'Pending'}</b>. Reloading...`;
      }

      showToast('Connected! ✅', `Backend active at ${url}. Applying changes...`, 'success');
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
    critical: 'border-rose-500 bg-rose-950/90 text-rose-100',
    success: 'border-emerald-500 bg-emerald-950/90 text-emerald-100',
    warning: 'border-amber-500 bg-amber-950/90 text-amber-100',
    info: 'border-cyan-500 bg-slate-900/95 text-cyan-100'
  }[type] || 'border-cyan-500 bg-slate-900/95 text-cyan-100';

  toast.className = `toast-msg p-4 rounded-xl border ${typeStyles} shadow-2xl flex items-start gap-3 w-80 max-w-full backdrop-blur-md`;
  toast.innerHTML = `
    <div class="mt-0.5 text-lg">
      ${type === 'critical' ? '🚨' : type === 'success' ? '✅' : type === 'warning' ? '⚠️' : '🔔'}
    </div>
    <div class="flex-1 text-sm">
      <div class="font-bold text-white tracking-wide">${title}</div>
      <div class="text-xs opacity-90 mt-0.5">${message}</div>
    </div>
    <button class="text-white/60 hover:text-white text-xs font-bold px-1" onclick="this.parentElement.remove()">✕</button>
  `;

  container.appendChild(toast);
  setTimeout(() => {
    if (toast.parentElement) toast.remove();
  }, 5000);
}
