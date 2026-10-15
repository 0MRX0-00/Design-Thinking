// CampusShield System Push Notifications & Native Mobile Engine
import { showToast } from './api.js';

let swRegistration = null;
let audioCtx = null;
let isChannelCreated = false;

/**
 * Determines whether the current view / session is Security Command Centre / Admin.
 * Returns true strictly for Command Centre (security.html, admin.html, or role 'security'/'admin').
 * Returns false for the Student Section (student.html, index.html, or role 'student').
 */
export function isCommandCentreContext() {
  if (typeof window === 'undefined') return false;

  const pathname = (window.location.pathname || '').toLowerCase();
  // Student section URL patterns MUST NOT be treated as Command Centre
  if (pathname.includes('student.html') || pathname.endsWith('/student')) {
    return false;
  }

  // Explicit Command Centre / Admin URL patterns
  if (
    pathname.includes('security.html') ||
    pathname.includes('admin.html') ||
    pathname.endsWith('/security') ||
    pathname.endsWith('/admin')
  ) {
    return true;
  }

  // Check authenticated user role stored in localStorage
  try {
    const raw = localStorage.getItem('cs_user');
    if (raw) {
      const user = JSON.parse(raw);
      if (user.role === 'student') return false;
      if (user.role === 'security' || user.role === 'admin' || user.role === 'dispatcher') {
        return true;
      }
    }
  } catch {}

  return false;
}

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

      // Create High-Priority Audible Notification Channel for Security Command Centre
      await localNotif.createChannel({
        id: 'campusshield_emergency',
        name: 'CampusShield Command Centre Siren',
        description: 'Critical distress alerts & audible dispatch siren for Security Command Centre',
        importance: 5, // IMPORTANCE_HIGH (Shows heads-up banner and plays sound)
        visibility: 1, // VISIBILITY_PUBLIC (Shows on lockscreen)
        sound: 'beep.wav',
        vibration: true,
        lights: true,
        lightColor: '#e11d48'
      });

      // Create Silent Notification Channel for Student Section (Visual banner & buzz only, NO SOUND)
      await localNotif.createChannel({
        id: 'campusshield_student_silent',
        name: 'CampusShield Student Alerts (Silent)',
        description: 'Safety alerts, responder arrival updates, and advisories for students (no loud siren)',
        importance: 4, // IMPORTANCE_HIGH (Shows heads-up banner, silent)
        visibility: 1,
        sound: undefined,
        vibration: true,
        lights: true,
        lightColor: '#0ea5e9'
      });

      isChannelCreated = true;
      console.log('[CampusShield Push] Android notification channels registered (Audible for Command Centre, Silent for Student).');
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
  const isCommandCentre = isCommandCentreContext();

  // 1. Android Native Flow
  if (localNotif) {
    try {
      const res = await localNotif.requestPermissions();
      updateNotificationUiBadge();

      if (res.display === 'granted') {
        showToast('Notifications Active ✅', 'Native Android push alerts enabled!', 'success');
        triggerEmergencyPushNotification({
          title: isCommandCentre ? '🛡️ Command Centre Push Active' : '🛡️ Student Safety Alerts Active',
          body: isCommandCentre
            ? 'Emergency distress dispatch and sirens will sound on this terminal.'
            : 'Safety updates and responder status will pop up on your mobile.',
          sound: false, // Initial confirmation is gentle
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
      showToast('Notifications Active ✅', 'System push alerts enabled!', 'success');
      triggerEmergencyPushNotification({
        title: isCommandCentre ? '🛡️ Command Centre Push Active' : '🛡️ Student Safety Alerts Active',
        body: isCommandCentre
          ? 'Emergency alerts and sirens will sound on this device.'
          : 'Safety advisories and responder updates will push to this device.',
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
 * Audible siren plays strictly for Command Centre. Student Section receives silent heads-up alerts.
 */
export async function triggerEmergencyPushNotification({
  title = '🚨 CRITICAL CAMPUS EMERGENCY',
  body = 'An emergency distress alert requires immediate attention!',
  incident = null,
  sound = true,
  vibrate = true
}) {
  const isCommandCentre = isCommandCentreContext();
  // Notification sound is strictly enabled ONLY for Command Centre, never for Student Section
  const shouldPlaySound = isCommandCentre && sound !== false;

  console.log(`[CampusShield Push] Triggering notification popup [Context: ${isCommandCentre ? 'COMMAND_CENTRE (Sound: ON)' : 'STUDENT_SECTION (Sound: OFF)'}]:`, title);

  // 1. Play Emergency Acoustic Siren (Command Centre only)
  if (shouldPlaySound) {
    playEmergencyAlarm(true);
  }

  // 2. Mobile vibration (gentle pulse for student, siren pulse for command centre)
  if (vibrate && 'vibrate' in navigator) {
    try {
      if (isCommandCentre) {
        navigator.vibrate([500, 150, 500, 150, 800]);
      } else {
        navigator.vibrate([250, 100, 250]);
      }
    } catch {}
  }

  // 3. NATIVE ANDROID NOTIFICATION (Capacitor) — Heads-Up Popup
  const localNotif = getCapacitorLocalNotifications();
  if (localNotif) {
    try {
      const notifId = Math.floor(Math.random() * 900000) + 100000;
      const channelId = shouldPlaySound ? 'campusshield_emergency' : 'campusshield_student_silent';
      const notificationConfig = {
        title: title || (isCommandCentre ? '🚨 CampusShield Emergency Alert' : '🛡️ CampusShield Safety Update'),
        body: body || 'Immediate campus safety alert requires your attention.',
        id: notifId,
        channelId: channelId,
        schedule: { at: new Date(Date.now() + 50) }, // Instant (50ms)
        actionTypeId: '',
        extra: {
          incidentId: incident?.incidentId || null,
          isCommandCentre
        }
      };

      if (shouldPlaySound) {
        notificationConfig.sound = 'beep.wav';
      }

      await localNotif.schedule({
        notifications: [notificationConfig]
      });
      console.log(`[CampusShield Push] Native Android popup scheduled (${channelId}):`, title);
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
      requireInteraction: isCommandCentre,
      renotify: true,
      silent: !shouldPlaySound,
      vibrate: isCommandCentre ? [500, 150, 500, 150, 800] : [250, 100, 250],
      data: {
        url: isCommandCentre ? '/security.html' : '/student.html',
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
 * GUARANTEED: Will NEVER play sound in the Student Section unless force=true is explicitly passed.
 */
export function playEmergencyAlarm(force = false) {
  // CRITICAL REQUIREMENT: Sound siren must NOT sound from the student section!
  if (!force && !isCommandCentreContext()) {
    console.log('[CampusShield Audio] Siren sound suppressed: Active section is Student Portal.');
    return;
  }

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
  const isCommandCentre = isCommandCentreContext();

  // 1. Check Native Android Permission first
  if (localNotif) {
    try {
      const status = await localNotif.checkPermissions();
      if (status.display === 'granted') {
        badge.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span class="text-emerald-300 font-mono text-[11px] font-bold">PUSH ACTIVE 🔔</span>
        `;
        badge.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-700/60 text-xs cursor-pointer';
        badge.title = isCommandCentre
          ? 'Command Centre push & siren active'
          : 'Student safety notifications active (silent alerts)';
        badge.onclick = () => {
          showToast(
            'Notifications Active',
            isCommandCentre
              ? 'Command Centre emergency siren and dispatch alerts are active.'
              : 'Student safety notifications are active (silent alerts).',
            'success'
          );
          triggerEmergencyPushNotification({
            title: isCommandCentre ? '🚨 Command Centre Alert Test' : '🛡️ Student Safety Notification',
            body: isCommandCentre
              ? 'Command Centre audible siren and alert notifications are working!'
              : 'Student silent alert banners are working perfectly on this device!',
            sound: isCommandCentre,
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

  // 2. Web Browser Fallback
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
    badge.title = isCommandCentre
      ? 'Push notifications and siren enabled on this device'
      : 'Push notifications enabled on this device (silent alerts)';
    badge.onclick = () => {
      showToast(
        'Notifications Active',
        isCommandCentre
          ? 'Command Centre receives audible emergency push alerts.'
          : 'Student section receives silent safety push notifications.',
        'success'
      );
      if (isCommandCentre) {
        playEmergencyAlarm(true);
      }
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
  isCommandCentreContext,
  updateNotificationUiBadge
};
