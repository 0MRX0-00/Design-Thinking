// CampusShield System Push Notifications & Native Mobile Engine
import { showToast } from './api.js';

let swRegistration = null;
let audioCtx = null;
let isChannelCreated = false;

/**
 * Returns the native Capacitor LocalNotifications plugin if available.
 */
function getCapacitorLocalNotifications() {
  if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.LocalNotifications) {
    return window.Capacitor.Plugins.LocalNotifications;
  }
  return null;
}

/**
 * Initializes Service Worker and Native Android Notification Channels.
 */
export async function initPushNotifications() {
  const localNotif = getCapacitorLocalNotifications();

  // 1. Android Native Push Setup via Capacitor
  if (localNotif) {
    try {
      console.log('[CampusShield Push] Initializing Android native notifications...');
      // Request native permission on app load
      const perm = await localNotif.requestPermissions();
      console.log('[CampusShield Push] Native permission status:', perm.display);

      // Create High-Priority Heads-Up Notification Channel for Android
      await localNotif.createChannel({
        id: 'campusshield_emergency',
        name: 'CampusShield Emergency Alerts',
        description: 'Critical distress alerts, security broadcasts, and responder arrival notifications',
        importance: 5, // IMPORTANCE_HIGH (Shows heads-up banner and plays sound)
        visibility: 1, // VISIBILITY_PUBLIC (Shows on lockscreen)
        sound: 'beep.wav',
        vibration: true,
        lights: true,
        lightColor: '#e11d48'
      });
      isChannelCreated = true;
      console.log('[CampusShield Push] Android emergency heads-up channel registered.');
    } catch (err) {
      console.warn('[CampusShield Push] Android native channel setup error:', err.message);
    }
  }

  // 2. Web Service Worker for Desktop/Browser Fallback
  if ('serviceWorker' in navigator) {
    try {
      swRegistration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      console.log('[CampusShield Push] Service Worker registered with scope:', swRegistration.scope);
    } catch (err) {
      console.warn('[CampusShield Push] Service Worker registration failed:', err.message);
    }
  }

  // Update UI Badge across header
  updateNotificationUiBadge();
}

/**
 * Requests native system notification permission from the user.
 */
export async function requestNotificationPermission() {
  const localNotif = getCapacitorLocalNotifications();

  // 1. Android Native Flow
  if (localNotif) {
    try {
      const res = await localNotif.requestPermissions();
      updateNotificationUiBadge();

      if (res.display === 'granted') {
        showToast('Notifications Active ✅', 'Native Android push alerts enabled!', 'success');
        triggerEmergencyPushNotification({
          title: '🛡️ CampusShield Notifications Active',
          body: 'Emergency alerts and quick responder updates will pop up on your mobile.',
          sound: false,
          vibrate: true
        });
        return true;
      } else {
        showToast('Permission Needed', 'Please allow notifications in Android settings to receive urgent alerts.', 'warning');
        return false;
      }
    } catch (err) {
      console.warn('[CampusShield Push] Native permission error:', err.message);
    }
  }

  // 2. Browser Flow
  if (!('Notification' in window)) {
    showToast('Not Supported', 'This browser does not support system push notifications.', 'warning');
    return false;
  }

  try {
    const permission = await Notification.requestPermission();
    updateNotificationUiBadge();

    if (permission === 'granted') {
      showToast('Notifications Active ✅', 'You will receive instant system push alerts for emergencies!', 'success');
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
 * Pops up as an Android heads-up notification banner with sound and vibration!
 */
export async function triggerEmergencyPushNotification({
  title = '🚨 CRITICAL CAMPUS EMERGENCY',
  body = 'An emergency distress alert requires immediate attention!',
  incident = null,
  sound = true,
  vibrate = true
}) {
  console.log('[CampusShield Push] Triggering notification popup:', title);

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

  // 3. NATIVE ANDROID NOTIFICATION (Capacitor) — Heads-Up Popup
  const localNotif = getCapacitorLocalNotifications();
  if (localNotif) {
    try {
      const notifId = Math.floor(Math.random() * 900000) + 100000;
      await localNotif.schedule({
        notifications: [
          {
            title: title || '🚨 CampusShield Emergency Alert',
            body: body || 'Immediate campus safety alert requires your attention.',
            id: notifId,
            channelId: 'campusshield_emergency',
            schedule: { at: new Date(Date.now() + 50) }, // Instant (50ms)
            sound: 'beep.wav',
            actionTypeId: '',
            extra: {
              incidentId: incident?.incidentId || null
            }
          }
        ]
      });
      console.log('[CampusShield Push] Native Android popup scheduled successfully!');
      return;
    } catch (capErr) {
      console.warn('[CampusShield Push] Native Android local-notification error:', capErr.message);
    }
  }

  // 4. Web Push Notification Fallback (Desktop / PWA)
  if ('Notification' in window && Notification.permission === 'granted') {
    const options = {
      body,
      icon: './icons/icon.svg',
      badge: './icons/icon.svg',
      tag: incident?.incidentId || 'campusshield-emergency',
      requireInteraction: true,
      renotify: true,
      vibrate: [500, 150, 500, 150, 800],
      data: {
        url: incident?.role === 'security' ? '/security.html' : '/student.html',
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
      console.warn('[CampusShield Push] Web Notification trigger error:', err.message);
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
    gain.gain.setValueAtTime(0.35, now);
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
export async function updateNotificationUiBadge() {
  const badge = document.getElementById('push-notification-badge');
  if (!badge) return;

  const localNotif = getCapacitorLocalNotifications();

  // If inside Android App
  if (localNotif) {
    try {
      const perm = await localNotif.checkPermissions();
      if (perm.display === 'granted') {
        badge.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span class="text-emerald-300 font-mono text-[11px] font-bold">PUSH ACTIVE 🔔</span>
        `;
        badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-700/60 text-xs cursor-pointer';
        badge.title = 'Native push notifications are active on your mobile';
        badge.onclick = () => {
          showToast('Notifications Active', 'Mobile push alerts are active. Sending test notification...', 'success');
          triggerEmergencyPushNotification({
            title: '🔔 CampusShield Alert Test',
            body: 'Native mobile notifications are working perfectly on this device!',
            sound: true,
            vibrate: true
          });
        };
        return;
      } else {
        badge.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
          <span class="text-cyan-300 font-mono text-[11px] font-bold">🔔 ENABLE APP PUSH</span>
        `;
        badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-cyan-950/80 border border-cyan-500/80 text-xs cursor-pointer animate-pulse';
        badge.title = 'Tap to allow notifications on your phone';
        badge.onclick = () => requestNotificationPermission();
        return;
      }
    } catch {}
  }

  // Web Browser fallback
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
      showToast('Push Blocked', 'Notifications are blocked. Please allow notifications in device settings.', 'critical');
    };
  } else {
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
