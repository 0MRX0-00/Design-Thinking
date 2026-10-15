// CampusShield System Push Notifications & Emergency Audio Engine
import { showToast } from './api.js';

let swRegistration = null;
let audioCtx = null;

/**
 * Initializes Service Worker and checks System Push Notification permission.
 */
export async function initPushNotifications() {
  // Register Service Worker for PWA & Background Push
  if ('serviceWorker' in navigator) {
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      console.log('[CampusShield Push] Service Worker registered with scope:', swRegistration.scope);
    } catch (err) {
      console.warn('[CampusShield Push] Service Worker registration failed:', err.message);
    }
  }

  // Update Notification permission UI button across headers
  updateNotificationUiBadge();
}

/**
 * Requests native system notification permission from the user.
 */
export async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    showToast('Not Supported', 'This browser or device does not support system push notifications.', 'warning');
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    updateNotificationUiBadge();

    if (permission === 'granted') {
      showToast('Notifications Active ✅', 'You will receive instant system push alerts for emergencies!', 'success');
      // Trigger a small confirmation notification
      triggerEmergencyPushNotification({
        title: '🛡️ CampusShield Notifications Enabled',
        body: 'Emergency alerts and dispatch updates will now push directly to this device.',
        sound: false,
        vibrate: false
      });
      return true;
    } else {
      showToast('Permission Denied', 'Please enable notifications in your browser/app settings to receive urgent SOS alerts.', 'warning');
      return false;
    }
  } catch (err) {
    console.error('[CampusShield Push] Error requesting permission:', err);
    return false;
  }
}

/**
 * Dispatches a native System Push Notification to the user's phone / desktop.
 */
export async function triggerEmergencyPushNotification({
  title = '🚨 CRITICAL CAMPUS EMERGENCY',
  body = 'An emergency distress alert requires immediate attention!',
  incident = null,
  sound = true,
  vibrate = true
}) {
  // 1. Play Emergency Acoustic Siren
  if (sound) {
    playEmergencyAlarm();
  }

  // 2. Hardware Vibration for mobile devices
  if (vibrate && 'vibrate' in navigator) {
    try {
      navigator.vibrate([500, 150, 500, 150, 800]);
    } catch {}
  }

  // 3. System Push Notification
  if ('Notification' in window && Notification.permission === 'granted') {
    const options = {
      body,
      icon: '/icons/icon.svg',
      badge: '/icons/icon.svg',
      tag: incident?.incidentId || 'campusshield-emergency',
      requireInteraction: true,
      renotify: true,
      vibrate: [500, 150, 500, 150, 800],
      data: {
        url: incident?.role === 'security' ? '/security' : '/student',
        incidentId: incident?.incidentId
      }
    };

    try {
      if (swRegistration && swRegistration.showNotification) {
        await swRegistration.showNotification(title, options);
      } else {
        const notif = new Notification(title, options);
        notif.onclick = () => {
          window.focus();
          notif.close();
        };
      }
    } catch (err) {
      console.warn('[CampusShield Push] Notification trigger error:', err.message);
    }
  }
}

/**
 * Web Audio API Acoustic Siren
 * Generates an unmistakable emergency dispatch tone without relying on external MP3 files.
 */
export function playEmergencyAlarm() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;

    if (!audioCtx) {
      audioCtx = new AudioContext();
    }

    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sawtooth';
    const now = audioCtx.currentTime;

    // Siren frequency sweep: 880Hz (A5) to 587Hz (D5) back and forth
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.linearRampToValueAtTime(587, now + 0.35);
    osc.frequency.linearRampToValueAtTime(880, now + 0.7);
    osc.frequency.linearRampToValueAtTime(587, now + 1.05);
    osc.frequency.linearRampToValueAtTime(880, now + 1.4);
    osc.frequency.linearRampToValueAtTime(587, now + 1.75);
    osc.frequency.linearRampToValueAtTime(880, now + 2.1);

    // Gain envelope
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 2.3);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(now);
    osc.stop(now + 2.3);
  } catch (err) {
    console.warn('[CampusShield Push] Audio synth warning:', err.message);
  }
}

/**
 * Renders / Updates the "Enable Push" badge on UI headers
 */
export function updateNotificationUiBadge() {
  const badge = document.getElementById('push-notification-badge');
  if (!badge) return;

  if (!('Notification' in window)) {
    badge.classList.add('hidden');
    return;
  }

  if (Notification.permission === 'granted') {
    badge.innerHTML = `
      <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
      <span class="text-emerald-300 font-mono text-[11px] font-bold">PUSH ACTIVE</span>
    `;
    badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-700/60 text-xs cursor-pointer';
    badge.title = 'Push notifications are enabled on this device';
    badge.onclick = () => {
      showToast('Notifications Active', 'This device receives immediate push notifications for emergencies.', 'success');
      playEmergencyAlarm();
    };
  } else if (Notification.permission === 'denied') {
    badge.innerHTML = `
      <span class="w-2 h-2 rounded-full bg-rose-500"></span>
      <span class="text-rose-300 font-mono text-[11px] font-bold">PUSH BLOCKED</span>
    `;
    badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-950/80 border border-rose-600 text-xs cursor-pointer';
    badge.title = 'Click to see how to enable notifications in browser settings';
    badge.onclick = () => {
      showToast('Push Blocked', 'Notifications are blocked. Please click the lock icon in your address bar and allow notifications.', 'critical');
    };
  } else {
    // Default prompt state
    badge.innerHTML = `
      <span class="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
      <span class="text-cyan-300 font-mono text-[11px] font-bold">🔔 ENABLE APP PUSH</span>
    `;
    badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-950/80 border border-cyan-500/80 text-xs cursor-pointer animate-pulse';
    badge.title = 'Click to enable real-time emergency push notifications on this device';
    badge.onclick = () => requestNotificationPermission();
  }
}

// Global exposure
window.csPush = {
  initPushNotifications,
  requestNotificationPermission,
  triggerEmergencyPushNotification,
  playEmergencyAlarm,
  updateNotificationUiBadge
};
