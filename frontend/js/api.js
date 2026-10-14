// CampusShield Centralized API Client
const getApiBase = () => {
  if (typeof window === 'undefined') return 'http://localhost:5000';
  const { protocol, hostname, port, origin } = window.location;
  if (protocol === 'file:') return 'http://localhost:5000';
  if (port === '5000') return origin;
  // If running via Live Server (5500, etc.) or another port, point to backend on 5000
  return `http://${hostname || 'localhost'}:5000`;
};

const API_BASE = getApiBase();

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
      `;
      badge.className = 'flex items-center gap-2 px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-700/60 text-xs';
    } else {
      badge.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
        <span class="text-rose-300 font-mono text-[11px] font-bold">BACKEND DISCONNECTED</span>
      `;
      badge.className = 'flex items-center gap-2 px-2.5 py-1 rounded-lg bg-rose-950/80 border border-rose-600 text-xs cursor-pointer';
      badge.onclick = () => {
        showToast('Connection Help', `Backend not responding at ${API_BASE}. Double-click start.bat in d:\\DTLAB or run "npm start".`, 'critical');
      };
    }
  }
}

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
