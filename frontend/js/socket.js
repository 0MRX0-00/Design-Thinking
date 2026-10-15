// CampusShield Socket.IO Real-Time Client Integration
import { api, showToast } from './api.js';
import { triggerEmergencyPushNotification, isCommandCentreContext } from './pushNotification.js';

let socket = null;
const listeners = new Map();

export async function initSocket() {
  // Ensure Socket.IO client library is loaded
  if (typeof io === 'undefined') {
    console.log('[CampusShield Socket] Loading Socket.IO from CDN fallback...');
    await loadSocketIoScript();
  }

  if (typeof io === 'undefined') {
    console.warn('[CampusShield Socket] Socket.IO library unavailable.');
    const label = document.getElementById('socket-status-text');
    if (label) label.innerText = 'POLLING ACTIVE';
    return null;
  }

  if (socket && socket.connected) return socket;

  const token = api.getToken();
  const socketBase = api.getBaseUrl();

  try {
    socket = io(socketBase, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 1500,
      timeout: 5000
    });

    socket.on('connect', () => {
      console.log('[CampusShield Socket] Connected to real-time incident bus. Socket ID:', socket.id);
      const indicator = document.getElementById('socket-status-dot');
      if (indicator) {
        indicator.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse';
        const label = document.getElementById('socket-status-text');
        if (label) label.innerText = 'ONLINE (REAL-TIME)';
      }
    });

    socket.on('disconnect', () => {
      console.warn('[CampusShield Socket] Disconnected from server.');
      const indicator = document.getElementById('socket-status-dot');
      if (indicator) {
        indicator.className = 'w-2.5 h-2.5 rounded-full bg-amber-500';
        const label = document.getElementById('socket-status-text');
        if (label) label.innerText = 'RECONNECTING...';
      }
    });

    socket.on('connect_error', (err) => {
      console.warn('[CampusShield Socket] Connection error:', err.message);
      const indicator = document.getElementById('socket-status-dot');
      if (indicator) {
        indicator.className = 'w-2.5 h-2.5 rounded-full bg-slate-500';
        const label = document.getElementById('socket-status-text');
        if (label) label.innerText = 'OFFLINE';
      }
    });

    // Global event broadcasts
    socket.on('incident:created', (incident) => {
      console.log('[CampusShield RealTime] New incident received:', incident);
      showToast(
        '🚨 EMERGENCY ALERT SUBMITTED',
        `[${incident.incidentId}] ${incident.category} at ${incident.location?.campusLocation || 'Campus Zone'}`,
        incident.severity === 'critical' ? 'critical' : 'warning'
      );

      // Trigger native System Push Notification (Audible for Command Centre, Silent for Student)
      const isCmd = isCommandCentreContext();
      triggerEmergencyPushNotification({
        title: `🚨 ${incident.severity === 'critical' ? 'CRITICAL EMERGENCY' : 'CAMPUS ALERT'} - ${incident.category}`,
        body: `Location: ${incident.location?.campusLocation || 'Kongu Campus'}. Immediate response mobilized.`,
        incident,
        sound: isCmd,
        vibrate: true
      });

      notifySubscribers('incident:created', incident);
    });

    socket.on('incident:updated', (incident) => {
      console.log('[CampusShield RealTime] Incident updated:', incident);
      notifySubscribers('incident:updated', incident);
    });

    socket.on('responder:status_changed', (responder) => {
      notifySubscribers('responder:status_changed', responder);
    });

    socket.on('notification:new', (notif) => {
      showToast(notif.title || 'Notification', notif.message, 'info');

      // If notification indicates emergency / dispatch / responder update, trigger push
      if (notif.priority === 'urgent' || notif.title?.includes('Emergency') || notif.title?.includes('Dispatched') || notif.title?.includes('SOS')) {
        const isCmd = isCommandCentreContext();
        triggerEmergencyPushNotification({
          title: notif.title || '🚨 CampusShield Emergency Update',
          body: notif.message,
          sound: isCmd,
          vibrate: true
        });
      }

      notifySubscribers('notification:new', notif);
    });

    socket.on('false_alarm:verified', (data) => {
      console.log('[CampusShield RealTime] False alarm verified event received:', data);
      notifySubscribers('false_alarm:verified', data);
    });

    socket.on('safety_status:updated', (data) => {
      console.log('[CampusShield RealTime] Safety status updated event received:', data);
      notifySubscribers('safety_status:updated', data);
    });

    socket.on('disciplinary_case:created', (data) => {
      console.log('[CampusShield RealTime] Disciplinary case created:', data);
      notifySubscribers('disciplinary_case:created', data);
    });

    socket.on('disciplinary_case:updated', (data) => {
      console.log('[CampusShield RealTime] Disciplinary case updated:', data);
      notifySubscribers('disciplinary_case:updated', data);
    });

    return socket;
  } catch (err) {
    console.warn('[CampusShield Socket Error]:', err.message);
    return null;
  }
}

function loadSocketIoScript() {
  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = './js/socket.io.min.js';
    script.onload = () => resolve(true);
    script.onerror = () => {
      const fallbackScript = document.createElement('script');
      fallbackScript.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
      fallbackScript.onload = () => resolve(true);
      fallbackScript.onerror = () => resolve(false);
      document.head.appendChild(fallbackScript);
    };
    document.head.appendChild(script);
  });
}

export function subscribe(event, callback) {
  if (!listeners.has(event)) {
    listeners.set(event, []);
  }
  listeners.get(event).push(callback);
}

function notifySubscribers(event, data) {
  if (listeners.has(event)) {
    listeners.get(event).forEach((cb) => {
      try {
        cb(data);
      } catch (err) {
        console.error(`[CampusShield RealTime Error in listener for ${event}]:`, err);
      }
    });
  }
}
