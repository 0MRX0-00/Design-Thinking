// CampusShield Student Safety Portal Controller
import { api, showToast } from './api.js';
import { initSocket, subscribe } from './socket.js';
import { getCurrentUser, initAuth, logout } from './auth.js';
import { initPushNotifications } from './pushNotification.js';

let userGps = { latitude: null, longitude: null, accuracy: null, status: 'prompt' };
let activeIncident = null;
let myIncidents = [];
let activeSafeWalk = null;
let myFalseAlarmRecords = [];
let mySafetyStatus = null;
let myDisciplinaryCases = [];

document.addEventListener('DOMContentLoaded', async () => {
  await initAuth('student');
  await initSocket();
  await initPushNotifications();

  // If user is not logged in, prompt or offer student demo
  const user = getCurrentUser();
  if (!user) {
    showToast('Student Portal', 'You are browsing as guest. Log in or select Demo Student to submit alerts.', 'info');
  }

  const logoutBtn = document.getElementById('auth-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  }

  // Subscribe to real-time incident updates
  subscribe('incident:updated', (incident) => {
    // If it is our incident, update active tracker
    if (activeIncident && (activeIncident._id === incident._id || activeIncident.incidentId === incident.incidentId)) {
      activeIncident = incident;
      renderActiveIncidentTracker();
    }
    loadMyIncidents();
  });

  subscribe('notification:new', () => {
    loadNotifications();
    loadFalseAlarmStatusAndHistory();
  });

  subscribe('safety_status:updated', (status) => {
    if (status) {
      mySafetyStatus = status.safetyStatus || status;
      renderSafetyBanner();
      renderFalseAlarmHistoryTable();
    }
    loadFalseAlarmStatusAndHistory();
  });

  subscribe('false_alarm:verified', (data) => {
    if (data && data.safetyStatus) {
      mySafetyStatus = data.safetyStatus;
      renderSafetyBanner();
      renderFalseAlarmHistoryTable();
    }
    loadFalseAlarmStatusAndHistory();
    loadMyIncidents();
  });

  subscribe('disciplinary_case:created', () => {
    loadFalseAlarmStatusAndHistory();
  });

  subscribe('disciplinary_case:updated', () => {
    loadFalseAlarmStatusAndHistory();
  });

  // Request browser geolocation with consent
  initGeolocation();

  // Load initial data
  await Promise.all([
    loadMyIncidents(),
    loadEmergencyContacts(),
    loadNotifications(),
    loadSafeWalkSession(),
    loadFalseAlarmStatusAndHistory()
  ]);
});

// Mapbox Configuration & Dynamic Tile Engine (Self-healing token)
const DEFAULT_MAPBOX_TOKEN = atob('cGsuZXlKMUlqb2ljM1Z0WVc1MGFEQXdOeUlzSW1FaU9pSmpiWFk0YVRWamNqY3dNMnh3TW5keloycHpiRE0yTlRKcUluMC5reVRJV1otY2luMXRUN3lodnJWa3ZR');

export let MAPBOX_ACCESS_TOKEN = DEFAULT_MAPBOX_TOKEN;

export async function fetchMapboxConfig() {
  return DEFAULT_MAPBOX_TOKEN;
}

export function getTileUrl(style = 'satellite') {
  // Ultra-reliable public map tiles (Never block Android WebViews, zero rate limits, crystal-clear satellite imagery)
  if (style === 'satellite') {
    return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  }
  if (style === 'dark') {
    return 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
  }
  return 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
}

let currentStudentMapStyle = 'satellite';
let studentTileLayer = null;

// Live Reverse Geocoding API — Mapbox Places API with Nominatim Fallback
export async function fetchLiveAddress(lat, lng) {
  const token = await fetchMapboxConfig();
  if (token) {
    try {
      const mapboxUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${token}&types=poi,address,neighborhood,place`;
      const mbRes = await fetch(mapboxUrl);
      if (mbRes.ok) {
        const mbData = await mbRes.json();
        if (mbData && mbData.features && mbData.features.length > 0) {
          const topFeature = mbData.features[0];
          const placeName = topFeature.place_name || topFeature.text;
          const shortAddr = topFeature.text || placeName.split(',')[0];
          return {
            shortAddress: shortAddr,
            fullAddress: placeName
          };
        }
      }
    } catch (mbErr) {
      console.warn('[CampusShield Mapbox Geocode] Falling back to Nominatim:', mbErr.message);
    }
  }

  // 2. Fallback to OpenStreetMap Nominatim
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
      {
        headers: {
          'Accept': 'application/json',
          'Accept-Language': 'en'
        }
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data && (data.address || data.display_name)) {
      const addr = data.address || {};
      const primary = addr.amenity || addr.building || addr.road || addr.suburb || addr.neighbourhood;
      const secondary = addr.city || addr.town || addr.village || addr.county;
      const state = addr.state;
      const parts = [primary, secondary, state].filter(Boolean);
      const shortAddr = parts.length > 0 ? parts.join(', ') : (data.display_name?.split(',').slice(0, 3).join(', ') || 'Campus Area');

      return {
        shortAddress: shortAddr,
        fullAddress: data.display_name || shortAddr
      };
    }
  } catch (err) {
    console.warn('[CampusShield Geocode] Reverse geocoding notice:', err.message);
  }
  return null;
}

// Toggle Student Map Style (Satellite HD / Tactical Dark / Street)
export async function toggleStudentMapTileLayer() {
  const styles = ['satellite', 'dark', 'streets'];
  const nextIdx = (styles.indexOf(currentStudentMapStyle) + 1) % styles.length;
  currentStudentMapStyle = styles[nextIdx];

  const token = await fetchMapboxConfig();
  if (studentTileLayer) {
    studentTileLayer.setUrl(getTileUrl(currentStudentMapStyle, token));
  }

  const btn = document.getElementById('student-tile-toggle-btn');
  if (btn) {
    if (currentStudentMapStyle === 'satellite') {
      btn.innerHTML = '<span>🛰️</span> Satellite HD';
    } else if (currentStudentMapStyle === 'dark') {
      btn.innerHTML = '<span>🌙</span> Tactical Dark';
    } else {
      btn.innerHTML = '<span>🗺️</span> Street Map';
    }
  }
  showToast('Map Layer', `Map Layer: ${currentStudentMapStyle.toUpperCase()}`, 'info');
}

// =========================================================
// KONGU CAMPUS GEOFENCE & AUTOMATED LOCKDOWN SYSTEM
// =========================================================
export const KEC_GEOFENCE = {
  centerLat: 11.2742,
  centerLng: 77.6070,
  radiusMeters: 1800, // 1.8km boundary covers entire 167-acre KEC campus, hostels & grounds
  name: 'Kongu Engineering College'
};

let isGeofenceLocked = false;
let isDemoSimulationActive = false;
let studentGeofenceCircle = null;

export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) return Infinity;
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

export function evaluateCampusGeofence(lat, lng) {
  if (isDemoSimulationActive) {
    dismissGeofenceLock();
    dismissGpsDisabledLock();
    updateGeofenceUIBadge(true, 120, true);
    return { inside: true, distanceMeters: 120, simulated: true };
  }

  if (!lat || !lng) {
    showGpsDisabledLock('Active GPS coordinates are required to verify campus presence.');
    return { inside: false, distanceMeters: Infinity, simulated: false };
  }

  const distanceMeters = calculateDistanceMeters(lat, lng, KEC_GEOFENCE.centerLat, KEC_GEOFENCE.centerLng);
  const inside = distanceMeters <= KEC_GEOFENCE.radiusMeters;
  userGps.geofenceDistance = distanceMeters;

  if (!inside) {
    if (!window._offCampusAcknowledged) {
      isGeofenceLocked = true;
      showGeofenceLock(distanceMeters, lat, lng);
    }
  } else {
    isGeofenceLocked = false;
    dismissGeofenceLock();
  }

  updateGeofenceUIBadge(inside, distanceMeters, false);
  return { inside, distanceMeters, simulated: false };
}

export function updateGeofenceUIBadge(inside, distanceMeters, isSimulated) {
  const badge = document.getElementById('campus-geofence-status-badge');
  const simBtn = document.getElementById('demo-simulation-indicator-btn');

  if (badge) {
    if (isSimulated) {
      badge.className = 'px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-700 flex items-center gap-1';
      badge.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-400"></span> DEMO IN-CAMPUS SIMULATED';
    } else if (inside) {
      const distLabel = distanceMeters > 0 ? ` (${distanceMeters}m)` : '';
      badge.className = 'px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-700 flex items-center gap-1';
      badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> IN CAMPUS ZONE${distLabel}`;
    } else {
      const km = (distanceMeters / 1000).toFixed(1);
      badge.className = 'px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-rose-950 text-rose-300 border border-rose-700 animate-pulse flex items-center gap-1';
      badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span> OUT OF CAMPUS (+${km}km)`;
    }
  }

  if (simBtn) {
    simBtn.classList.toggle('hidden', !isSimulated && inside);
  }
}

/**
 * Returns the native Capacitor Geolocation plugin if available.
 */
export function getCapacitorGeolocation() {
  if (typeof window !== 'undefined' && window.Capacitor?.Plugins?.Geolocation) {
    return window.Capacitor.Plugins.Geolocation;
  }
  return null;
}

/**
 * Primary GPS Unlock Handler
 * Directly checks device GPS / satellite fix and unlocks the Student Portal.
 */
export async function unlockStudentWithGps(userInitiated = true) {
  console.log('[CampusShield GPS] Unlocking student portal via GPS request...');
  const btn = document.getElementById('btn-unlock-gps');
  const subtextEl = document.getElementById('gps-lock-subtext');

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `
      <span class="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin inline-block mr-2"></span>
      <span>Connecting Satellite GPS...</span>
    `;
    btn.classList.add('opacity-80', 'cursor-wait');
  }

  showToast('Connecting GPS 📡', 'Checking device satellite & location sensors...', 'info');

  const capGeo = getCapacitorGeolocation();

  // Helper when coordinates are acquired
  const onLocationSuccess = (coords) => {
    console.log('[CampusShield GPS] Satellite lock acquired successfully:', coords);
    window._offCampusAcknowledged = true; // prevent trapping student off-campus
    dismissGpsDisabledLock();
    dismissGeofenceLock();

    userGps.latitude = parseFloat(coords.latitude.toFixed(6));
    userGps.longitude = parseFloat(coords.longitude.toFixed(6));
    userGps.accuracy = Math.round(coords.accuracy || 10);
    userGps.status = 'locked';
    userGps.timestamp = new Date();

    updateGpsUI();

    if (studentPinpointMap && studentPinMarker) {
      studentPinMarker.setLatLng([userGps.latitude, userGps.longitude]);
      studentPinpointMap.flyTo([userGps.latitude, userGps.longitude], 17);
    }

    // Evaluate geofence
    evaluateCampusGeofence(userGps.latitude, userGps.longitude);

    fetchLiveAddress(userGps.latitude, userGps.longitude).then((addr) => {
      if (addr) {
        userGps.address = addr.shortAddress;
        userGps.fullAddress = addr.fullAddress;
        updateGpsUI();
      }
    });

    showToast(
      '📍 GPS Connected ✅',
      `Live coordinates locked: ${userGps.latitude}° N, ${userGps.longitude}° E. Welcome to Student Portal!`,
      'success'
    );
  };

  // Helper when location check fails or times out
  const onLocationError = (errMsg) => {
    console.warn('[CampusShield GPS] Failed to acquire GPS lock:', errMsg);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<span>⚡ Turn On GPS & Unlock Portal</span>`;
      btn.classList.remove('opacity-80', 'cursor-wait');
    }
    if (subtextEl) {
      subtextEl.innerHTML = `
        <div class="p-3 bg-amber-950/80 border border-amber-600 rounded-xl text-amber-200 text-xs text-left space-y-1.5 animate-fade-in">
          <div class="font-bold text-amber-400 flex items-center gap-1.5">
            <span>⚠️</span> Location is still OFF on your phone:
          </div>
          <div class="text-[11px] text-slate-300">
            1. Swipe down from the top of your phone screen to open Quick Settings.<br/>
            2. Tap and turn <strong>ON Location / GPS</strong>.<br/>
            3. Tap <strong>⚡ Turn On GPS & Unlock Portal</strong> again above.
          </div>
        </div>
      `;
    }
    showToast('GPS Required ⚠️', 'Please enable Location in your phone status bar, then tap to unlock.', 'warning');
  };

  // 1. Try Native Android Capacitor Geolocation first
  if (capGeo) {
    try {
      console.log('[CampusShield GPS] Requesting native Android location permission...');
      try {
        await capGeo.requestPermissions();
      } catch (permErr) {
        console.warn('[CampusShield GPS] Native permission warning:', permErr.message);
      }

      const pos = await capGeo.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      });

      if (pos && pos.coords && pos.coords.latitude) {
        onLocationSuccess(pos.coords);
        return;
      }
    } catch (capErr) {
      console.warn('[CampusShield GPS] Native Capacitor Geolocation error:', capErr.message);
    }
  }

  // 2. Web / Browser Geolocation Fallback
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        onLocationSuccess(pos.coords);
      },
      (err) => {
        onLocationError(err.message || 'GPS location is disabled or permission was denied.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  } else {
    onLocationError('Geolocation is unsupported on this device.');
  }
}

export function showGpsDisabledLock(reason = 'Location services are disabled on this device.') {
  if (isDemoSimulationActive) return;

  // If we already have locked GPS coordinates, do not show lock
  if (userGps.status === 'locked' && userGps.latitude && userGps.longitude) {
    return;
  }

  let lockModal = document.getElementById('campus-gps-required-lock-screen');
  if (!lockModal) {
    lockModal = document.createElement('div');
    lockModal.id = 'campus-gps-required-lock-screen';
    lockModal.className = 'fixed inset-0 z-[99999] bg-slate-950/95 backdrop-blur-2xl flex items-center justify-center p-4 overflow-y-auto';
    document.body.appendChild(lockModal);
  }

  lockModal.innerHTML = `
    <div class="max-w-lg w-full bg-slate-900 border-2 border-amber-500 rounded-3xl p-6 sm:p-8 shadow-2xl relative text-center space-y-6 animate-fade-in my-auto">
      
      <!-- Pulsing Radar GPS Icon -->
      <div class="relative w-20 h-20 mx-auto flex items-center justify-center">
        <div class="absolute inset-0 rounded-full bg-amber-500/20 animate-ping pointer-events-none"></div>
        <div class="w-16 h-16 rounded-full bg-amber-950 border-2 border-amber-500 flex items-center justify-center text-3xl shadow-xl">
          📡
        </div>
      </div>

      <div class="space-y-2">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-950/80 border border-amber-700 text-amber-300 font-mono text-xs font-bold uppercase tracking-wider">
          <span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span> GPS Telemetry Mandatory
        </div>
        <h2 class="text-2xl sm:text-3xl font-black text-white tracking-tight">GPS REQUIRED TO USE APP</h2>
        <p class="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-md mx-auto">
          The <strong>Student Safety Portal</strong> is restricted and will not function unless GPS location is enabled on your phone.
        </p>
      </div>

      <div id="gps-lock-subtext"></div>

      <!-- Mandatory Security Policy Rules -->
      <div class="bg-black/60 rounded-2xl p-4 border border-slate-800 text-left space-y-2.5 text-xs">
        <div class="flex items-start gap-2.5 text-slate-300">
          <span class="text-amber-400 text-base leading-none">📍</span>
          <div>
            <div class="font-bold text-white">Campus Boundary Verification</div>
            <div class="text-[11px] text-slate-400">Verifies you are physically within the 167-acre Kongu Engineering College safe perimeter.</div>
          </div>
        </div>
        <div class="flex items-start gap-2.5 text-slate-300 pt-2 border-t border-slate-800/80">
          <span class="text-rose-400 text-base leading-none">🚨</span>
          <div>
            <div class="font-bold text-white">Rapid Emergency Dispatch</div>
            <div class="text-[11px] text-slate-400">Security quick-reaction patrol units require exact satellite coordinates to reach you in distress.</div>
          </div>
        </div>
        <div class="flex items-start gap-2.5 text-slate-300 pt-2 border-t border-slate-800/80">
          <span class="text-cyan-400 text-base leading-none">🛡️</span>
          <div>
            <div class="font-bold text-white">SafeWalk & Anti-Spoofing Protocol</div>
            <div class="text-[11px] text-slate-400">Live coordinate breadcrumbs verify your journey across campus without false alerts.</div>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="pt-1 flex flex-col gap-2.5">
        <button id="btn-unlock-gps"
                class="w-full py-3.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-black rounded-xl text-xs uppercase tracking-wider transition flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-amber-950/50">
          <span>⚡ Turn On GPS & Unlock Portal</span>
        </button>

        <button id="btn-simulate-gps"
                class="w-full py-2.5 bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white font-mono text-[11px] rounded-xl border border-slate-700 transition flex items-center justify-center gap-1.5 cursor-pointer">
          <span>🧪</span> Demo Testing: Simulate Campus GPS
        </button>
      </div>

      <!-- Emergency Helpline Fallback -->
      <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
        <span>Need urgent help without GPS?</span>
        <a href="tel:112" class="font-mono font-bold text-rose-400 hover:underline">Call 112 (Police)</a>
      </div>

    </div>
  `;

  // Attach direct event listeners for maximum reliability
  const btnUnlock = document.getElementById('btn-unlock-gps');
  if (btnUnlock) {
    btnUnlock.onclick = (e) => {
      e.preventDefault();
      unlockStudentWithGps(true);
    };
  }

  const btnSim = document.getElementById('btn-simulate-gps');
  if (btnSim) {
    btnSim.onclick = (e) => {
      e.preventDefault();
      simulateCampusLocation();
    };
  }
}

export function dismissGpsDisabledLock() {
  const lockModal = document.getElementById('campus-gps-required-lock-screen');
  if (lockModal) {
    lockModal.remove();
  }
}

export function showGeofenceLock(distanceMeters = 5000, lat = 11.0, lng = 76.9) {
  let lockModal = document.getElementById('campus-geofence-lock-screen');
  const kmOutside = (distanceMeters / 1000).toFixed(1);

  if (!lockModal) {
    lockModal = document.createElement('div');
    lockModal.id = 'campus-geofence-lock-screen';
    lockModal.className = 'fixed inset-0 z-[9999] bg-slate-950/95 backdrop-blur-2xl flex items-center justify-center p-4 overflow-y-auto';
    document.body.appendChild(lockModal);
  }

  lockModal.innerHTML = `
    <div class="max-w-lg w-full bg-slate-900 border-2 border-rose-600 rounded-3xl p-6 sm:p-8 shadow-2xl relative text-center space-y-6 my-auto animate-fade-in">
      
      <!-- Pulsing Lock Shield Icon -->
      <div class="relative w-20 h-20 mx-auto flex items-center justify-center">
        <div class="absolute inset-0 rounded-full bg-rose-600/30 radar-ping pointer-events-none"></div>
        <div class="w-18 h-18 rounded-full bg-rose-950 border-2 border-rose-500 flex items-center justify-center text-3xl shadow-2xl">
          🔒
        </div>
      </div>

      <div class="space-y-2">
        <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-rose-950 border border-rose-800 text-rose-300 font-mono text-xs font-bold uppercase tracking-wider">
          <span class="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span> Campus Boundary Enforced
        </div>
        <h2 class="text-2xl sm:text-3xl font-black text-white tracking-tight">OUT OF CAMPUS — APP LOCKED</h2>
        <p class="text-xs sm:text-sm text-slate-300 leading-relaxed max-w-md mx-auto">
          CampusShield emergency dispatch, SafeWalk, and in-app reporting are strictly restricted to 
          <strong class="text-white">Kongu Engineering College (KEC)</strong> campus grounds.
        </p>
      </div>

      <!-- Distance and Coordinates Inspection Card -->
      <div class="bg-black/70 rounded-2xl p-4 border border-slate-800 text-left space-y-2 text-xs font-mono">
        <div class="flex justify-between items-center py-1 border-b border-slate-800">
          <span class="text-slate-400">Current GPS Fix:</span>
          <span class="text-slate-200 font-bold">${typeof lat === 'number' ? lat.toFixed(5) : lat}° N, ${typeof lng === 'number' ? lng.toFixed(5) : lng}° E</span>
        </div>
        <div class="flex justify-between items-center py-1 border-b border-slate-800">
          <span class="text-slate-400">Distance to KEC Campus:</span>
          <span class="text-rose-400 font-bold">~${kmOutside} km outside boundary</span>
        </div>
        <div class="flex justify-between items-center py-1">
          <span class="text-slate-400">Authorized Campus Radius:</span>
          <span class="text-cyan-400 font-bold">1.8 km (167-Acre Campus)</span>
        </div>
      </div>

      <!-- Emergency Helplines (Available Off-Campus) -->
      <div class="space-y-2 text-left">
        <div class="text-[11px] font-mono text-slate-400 uppercase tracking-wider font-bold">
          🚨 Off-Campus Emergency Helplines:
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <a href="tel:112" class="p-3 bg-rose-950/70 hover:bg-rose-900 border border-rose-800 rounded-xl flex items-center justify-between text-xs transition">
            <div>
              <div class="font-bold text-white">National Emergency</div>
              <div class="text-[10px] text-rose-300">Police / Fire / Medical</div>
            </div>
            <span class="font-mono text-lg font-black text-white">112</span>
          </a>
          <a href="tel:1091" class="p-3 bg-amber-950/70 hover:bg-amber-900 border border-amber-800 rounded-xl flex items-center justify-between text-xs transition">
            <div>
              <div class="font-bold text-white">Women Safety</div>
              <div class="text-[10px] text-amber-300">24/7 Helpline</div>
            </div>
            <span class="font-mono text-lg font-black text-white">1091</span>
          </a>
          <a href="tel:04294220233" class="p-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl flex items-center justify-between text-xs transition col-span-1 sm:col-span-2">
            <div>
              <div class="font-bold text-white">Perundurai Police Station</div>
              <div class="text-[10px] text-slate-400">Local Jurisdictional Police</div>
            </div>
            <span class="font-mono text-xs font-bold text-cyan-300">04294-220233</span>
          </a>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="pt-2 flex flex-col gap-2.5">
        <button id="btn-geofence-recheck"
                class="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-lg">
          <span>🔄</span> Re-Check Live Satellite GPS
        </button>

        <button id="btn-geofence-simulate"
                class="w-full py-2.5 bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white font-mono text-[11px] rounded-xl border border-slate-700 transition flex items-center justify-center gap-1.5 cursor-pointer">
          <span>🧪</span> Demo Override: Simulate Inside KEC Campus
        </button>

        <button id="btn-geofence-proceed"
                class="w-full py-2.5 bg-slate-800/90 hover:bg-slate-700 text-slate-200 hover:text-white font-bold text-xs rounded-xl border border-slate-600 transition flex items-center justify-center gap-1.5 cursor-pointer">
          <span>📱 Proceed to Student Portal (Off-Campus Mode)</span>
        </button>
      </div>

    </div>
  `;

  const btnRecheck = document.getElementById('btn-geofence-recheck');
  if (btnRecheck) {
    btnRecheck.onclick = (e) => {
      e.preventDefault();
      unlockStudentWithGps(true);
    };
  }

  const btnSim = document.getElementById('btn-geofence-simulate');
  if (btnSim) {
    btnSim.onclick = (e) => {
      e.preventDefault();
      simulateCampusLocation();
    };
  }

  const btnProceed = document.getElementById('btn-geofence-proceed');
  if (btnProceed) {
    btnProceed.onclick = (e) => {
      e.preventDefault();
      dismissGeofenceLock();
      showToast('Off-Campus Mode', 'Student portal is accessible in off-campus safety mode.', 'info');
    };
  }
}

export function dismissGeofenceLock() {
  window._offCampusAcknowledged = true;
  const lockModal = document.getElementById('campus-geofence-lock-screen');
  if (lockModal) {
    lockModal.remove();
  }
}

export function simulateCampusLocation() {
  isDemoSimulationActive = true;
  isGeofenceLocked = false;
  dismissGeofenceLock();
  dismissGpsDisabledLock();

  // Pin student inside KEC IT Park / CSE Block
  userGps.latitude = 11.2751;
  userGps.longitude = 77.6083;
  userGps.accuracy = 5;
  userGps.status = 'pinpointed';
  userGps.address = 'IT Park / CSE Block';
  userGps.fullAddress = 'IT Park / Computer Science Block, Kongu Engineering College';

  updateGpsUI();

  if (studentPinpointMap && studentPinMarker) {
    studentPinMarker.setLatLng([userGps.latitude, userGps.longitude]);
    studentPinpointMap.flyTo([userGps.latitude, userGps.longitude], 17);
  }

  showToast('🧪 Demo Mode Active', 'Location simulated inside KEC Campus. App unlocked for demonstration!', 'success');
}

export function toggleDemoSimulation() {
  if (isDemoSimulationActive) {
    isDemoSimulationActive = false;
    showToast('Demo Mode Off', 'Re-evaluating real satellite GPS...', 'info');
    requestRealGps(true);
  } else {
    simulateCampusLocation();
  }
}

// Kongu Engineering College Landmarks Reference
export const CAMPUS_LANDMARKS = {
  'Admin Block': { lat: 11.2738, lng: 77.6062, name: 'Admin Block, Kongu Engineering College' },
  'IT Park / CSE': { lat: 11.2751, lng: 77.6083, name: 'IT Park / Computer Science Block, KEC' },
  'Mechanical Science': { lat: 11.2745, lng: 77.6095, name: 'Mechanical Science Block, KEC' },
  'Central Library': { lat: 11.2735, lng: 77.6078, name: 'Central Library, Kongu Engineering College' },
  'Food Court & Amenities': { lat: 11.2728, lng: 77.6085, name: 'Food Court & Student Amenities, KEC' },
  'Hostel Blocks (A/B/C)': { lat: 11.2762, lng: 77.6055, name: 'Hostel Blocks (A/B/C), Kongu Engineering College' },
  'Main Gate & Circle': { lat: 11.2720, lng: 77.6035, name: 'Main Entrance Gate & Circle, KEC' }
};

let studentPinpointMap = null;
let studentPinMarker = null;

// Initialize Interactive Student Pinpoint Map
export async function initStudentPinpointMap() {
  const mapEl = document.getElementById('student-pinpoint-map');
  if (!mapEl || typeof L === 'undefined') return;

  const lat = userGps.latitude || 11.2742;
  const lng = userGps.longitude || 77.6070;
  const token = await fetchMapboxConfig();

  if (!studentPinpointMap) {
    studentPinpointMap = L.map('student-pinpoint-map', {
      center: [lat, lng],
      zoom: 17,
      zoomControl: true,
      attributionControl: false
    });

    studentTileLayer = L.tileLayer(getTileUrl(currentStudentMapStyle), {
      maxZoom: 19,
      tileSize: 256,
      attribution: '© Esri © OpenStreetMap'
    }).addTo(studentPinpointMap);

    studentTileLayer.on('tileerror', function() {
      studentTileLayer.setUrl('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    });

    setTimeout(() => { if (studentPinpointMap) studentPinpointMap.invalidateSize(); }, 150);
    setTimeout(() => { if (studentPinpointMap) studentPinpointMap.invalidateSize(); }, 500);
    setTimeout(() => { if (studentPinpointMap) studentPinpointMap.invalidateSize(); }, 1200);

    // Custom Draggable Pin Icon
    const pinIcon = L.divIcon({
      className: 'custom-student-pin',
      html: `
        <div class="relative flex items-center justify-center cursor-grab active:cursor-grabbing">
          <div class="absolute w-8 h-8 rounded-full bg-cyan-400/40 radar-ping pointer-events-none"></div>
          <div class="w-7 h-7 rounded-full bg-cyan-500 border-2 border-white flex items-center justify-center text-xs shadow-xl font-bold text-black">
            📍
          </div>
        </div>
      `,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    studentPinMarker = L.marker([lat, lng], {
      icon: pinIcon,
      draggable: true
    }).addTo(studentPinpointMap);

    // Draw KEC Campus Boundary Circle (1.8km operational zone)
    if (!studentGeofenceCircle) {
      studentGeofenceCircle = L.circle([KEC_GEOFENCE.centerLat, KEC_GEOFENCE.centerLng], {
        radius: KEC_GEOFENCE.radiusMeters,
        color: '#06b6d4',
        weight: 1.5,
        dashArray: '6, 8',
        fillColor: '#06b6d4',
        fillOpacity: 0.05
      }).addTo(studentPinpointMap);

      studentGeofenceCircle.bindTooltip('🛡️ Kongu Campus Boundary (Operational Zone)', {
        permanent: false,
        direction: 'top'
      });
    }

    // Draggable Pin Event
    studentPinMarker.on('dragend', () => {
      const pos = studentPinMarker.getLatLng();
      applyManualPinpoint(pos.lat, pos.lng);
    });

    // Click anywhere on Map to Pin
    studentPinpointMap.on('click', (e) => {
      studentPinMarker.setLatLng(e.latlng);
      applyManualPinpoint(e.latlng.lat, e.latlng.lng);
    });
  } else {
    studentPinMarker.setLatLng([lat, lng]);
    studentPinpointMap.setView([lat, lng], 17);
  }
}

// Apply manual pinpoint coordinates from map or building click
export function applyManualPinpoint(lat, lng, buildingName = null) {
  userGps.latitude = parseFloat(lat.toFixed(6));
  userGps.longitude = parseFloat(lng.toFixed(6));
  userGps.accuracy = 5; // Pinpointed with precision
  userGps.status = 'pinpointed';
  userGps.timestamp = new Date();

  if (buildingName) {
    userGps.address = buildingName;
    userGps.fullAddress = `${buildingName}, Kongu Engineering College, Perundurai, Erode, Tamil Nadu 638052`;
    updateGpsUI();
    showToast('📍 Exact Spot Locked', `Pinned: ${buildingName}`, 'success');
  } else {
    updateGpsUI();
    fetchLiveAddress(userGps.latitude, userGps.longitude).then((addr) => {
      if (addr) {
        userGps.address = addr.shortAddress;
        userGps.fullAddress = addr.fullAddress;
        updateGpsUI();
        showToast('📍 Exact Spot Locked', userGps.address, 'success');
      }
    });
  }
}

// 1-Tap Landmark Button Pinpoint
export function pinpointCampusLandmark(landmarkName) {
  const lm = CAMPUS_LANDMARKS[landmarkName];
  if (!lm) return;

  if (studentPinpointMap && studentPinMarker) {
    studentPinMarker.setLatLng([lm.lat, lm.lng]);
    studentPinpointMap.flyTo([lm.lat, lm.lng], 18, { duration: 1 });
  }

  applyManualPinpoint(lm.lat, lm.lng, lm.name);
}

// Geolocation Handling — High Accuracy Real GPS & Watch
export function initGeolocation() {
  requestRealGps(false);
  setTimeout(initStudentPinpointMap, 200);
}

export function requestRealGps(userInitiated = false) {
  const statusEl = document.getElementById('gps-status-indicator');
  if (statusEl) {
    statusEl.innerHTML = `
      <span class="w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping"></span>
      <span class="text-slate-400 font-mono">Acquiring live GPS satellite lock...</span>
    `;
  }

  if (!navigator.geolocation) {
    userGps.status = 'disabled';
    userGps.latitude = null;
    userGps.longitude = null;
    updateGpsUI();
    if (statusEl) {
      statusEl.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-rose-500"></span>
        <span class="text-rose-300 font-mono">GPS: Browser unsupported</span>
      `;
    }
    showGpsDisabledLock('Browser geolocation is unavailable or unsupported on this device.');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      dismissGpsDisabledLock();
      userGps.latitude = parseFloat(pos.coords.latitude.toFixed(6));
      userGps.longitude = parseFloat(pos.coords.longitude.toFixed(6));
      userGps.accuracy = Math.round(pos.coords.accuracy);
      userGps.status = 'locked';
      userGps.timestamp = new Date();

      updateGpsUI();

      if (studentPinpointMap && studentPinMarker) {
        studentPinMarker.setLatLng([userGps.latitude, userGps.longitude]);
        studentPinpointMap.flyTo([userGps.latitude, userGps.longitude], 17);
      }

      // Check campus boundary
      evaluateCampusGeofence(userGps.latitude, userGps.longitude);

      // Trigger Live Reverse Geocoding API
      fetchLiveAddress(userGps.latitude, userGps.longitude).then((addr) => {
        if (addr) {
          userGps.address = addr.shortAddress;
          userGps.fullAddress = addr.fullAddress;
          updateGpsUI();
          if (userInitiated) {
            showToast('📍 Address Located', userGps.address, 'success');
          }
        }
      });

      if (userInitiated) {
        showToast(
          '📍 GPS Locked',
          `Coordinates: ${userGps.latitude}° N, ${userGps.longitude}° E (±${userGps.accuracy}m)`,
          'success'
        );
      }
    },
    (err) => {
      console.warn('[CampusShield GPS] Geolocation error:', err.code, err.message);
      userGps.latitude = null;
      userGps.longitude = null;
      userGps.status = 'disabled';

      if (statusEl) {
        statusEl.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-rose-500 animate-ping"></span>
          <span class="text-rose-300 font-mono">📍 GPS Disabled / Access Denied</span>
        `;
      }

      updateGpsUI();

      // STRICT ENFORCEMENT: If GPS is disabled, lock the student portal immediately!
      if (!isDemoSimulationActive) {
        showGpsDisabledLock(err.message || 'GPS location is disabled or permission was denied.');
      }
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );

  // Setup continuous watch if not already started
  if (!window._campusShieldGpsWatch && navigator.geolocation.watchPosition) {
    window._campusShieldGpsWatch = navigator.geolocation.watchPosition(
      (pos) => {
        dismissGpsDisabledLock();
        if (userGps.status !== 'pinpointed') {
          userGps.latitude = parseFloat(pos.coords.latitude.toFixed(6));
          userGps.longitude = parseFloat(pos.coords.longitude.toFixed(6));
          userGps.accuracy = Math.round(pos.coords.accuracy);
          userGps.status = 'locked';
          userGps.timestamp = new Date();
          updateGpsUI();

          if (studentPinpointMap && studentPinMarker) {
            studentPinMarker.setLatLng([userGps.latitude, userGps.longitude]);
          }

          evaluateCampusGeofence(userGps.latitude, userGps.longitude);
        }
      },
      (err) => {
        console.warn('[CampusShield GPS Watch] Signal warning:', err.code, err.message);
        // Only re-lock if location permission was explicitly denied or GPS disabled in system (code 1)
        if (err.code === 1 && !isDemoSimulationActive) {
          userGps.status = 'disabled';
          userGps.latitude = null;
          userGps.longitude = null;
          updateGpsUI();
          showGpsDisabledLock('GPS location was turned off or permission was revoked.');
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }
}

export function updateGpsUI() {
  const statusEl = document.getElementById('gps-status-indicator');
  const addressDisplay = document.getElementById('student-current-address-display');
  const accBadge = document.getElementById('student-accuracy-badge');

  if (userGps.latitude) {
    const latStr = userGps.latitude.toFixed(5);
    const lngStr = userGps.longitude.toFixed(5);

    if (statusEl) {
      const addressLabel = userGps.address ? ` • <strong class="text-white">${userGps.address}</strong>` : '';
      statusEl.innerHTML = `
        <span class="w-2.5 h-2.5 rounded-full ${userGps.status === 'pinpointed' ? 'bg-cyan-400' : 'bg-emerald-400'} animate-pulse"></span>
        <span class="text-emerald-300 font-mono font-bold">📍 GPS: ${latStr}° N, ${lngStr}° E (±${userGps.accuracy}m)${addressLabel}</span>
      `;
    }

    if (addressDisplay) {
      addressDisplay.innerText = userGps.address 
        ? `${userGps.address} (${latStr}, ${lngStr})` 
        : `Kongu Campus Coordinates: ${latStr}, ${lngStr}`;
    }

    if (accBadge) {
      if (userGps.status === 'pinpointed') {
        accBadge.className = 'px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-cyan-950 text-cyan-300 border border-cyan-700';
        accBadge.innerText = '● PINPOINT EXACT (±5m)';
      } else if (userGps.accuracy <= 25) {
        accBadge.className = 'px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-950 text-emerald-300 border border-emerald-700';
        accBadge.innerText = `● HIGH ACCURACY (±${userGps.accuracy}m)`;
      } else {
        accBadge.className = 'px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-950 text-amber-300 border border-amber-800';
        accBadge.innerText = `⚠️ WI-FI ESTIMATE (±${userGps.accuracy}m)`;
      }
    }
  }

  if (userGps.latitude && userGps.longitude) {
    evaluateCampusGeofence(userGps.latitude, userGps.longitude);
  }

  updateModalGpsDisplay();
}

function updateModalGpsDisplay() {
  const modalGpsLat = document.getElementById('modal-gps-lat');
  const modalGpsLng = document.getElementById('modal-gps-lng');
  const modalGpsAcc = document.getElementById('modal-gps-acc');
  const modalGpsAddress = document.getElementById('modal-gps-address');
  const modalGpsMap = document.getElementById('modal-gps-map-link');
  const modalGpsBadge = document.getElementById('modal-gps-badge');

  if (modalGpsLat && userGps.latitude) {
    modalGpsLat.innerText = `${userGps.latitude.toFixed(5)}°`;
    modalGpsLng.innerText = `${userGps.longitude.toFixed(5)}°`;
    modalGpsAcc.innerText = `±${userGps.accuracy || 10}m`;
    if (modalGpsAddress) {
      if (userGps.address) {
        modalGpsAddress.innerText = `📍 ${userGps.address}`;
        modalGpsAddress.classList.remove('hidden');
      }
    }
    if (modalGpsMap) {
      modalGpsMap.href = `https://www.google.com/maps?q=${userGps.latitude},${userGps.longitude}`;
      modalGpsMap.classList.remove('hidden');
    }
    if (modalGpsBadge) {
      modalGpsBadge.className = 'text-[10px] font-mono px-2 py-0.5 rounded-full font-bold bg-emerald-950 text-emerald-300 border border-emerald-700';
      modalGpsBadge.innerText = '● LIVE SATELLITE FIX';
    }
  }
}

let selectedCategory = 'Medical emergency';
let selectedRequirements = new Set();

export const EMERGENCY_REQUIREMENTS = [
  { id: 'Ambulance / First Aid', label: 'Ambulance & First Aid', icon: '🚑', desc: 'Medical kit, paramedic support, hospital transport' },
  { id: 'Security Patrol Escort', label: 'Security Patrol Escort', icon: '🚔', desc: 'Uniformed patrol presence & immediate escort' },
  { id: 'Fire Safety Support', label: 'Fire Extinguisher & Tender', icon: '🚒', desc: 'Flames, electrical smoke, chemical containment' },
  { id: 'Female Security Officer', label: 'Female Security Guard', icon: '👩‍🦰', desc: 'Sensitive situations & women safety assistance' },
  { id: 'Wheelchair / Stretcher', label: 'Wheelchair / Stretcher', icon: '♿', desc: 'Physical injury, mobility aid or stretcher carry' },
  { id: 'Silent / Discreet Response', label: 'Silent / Discreet Alert', icon: '🤫', desc: 'Approach discreetly without sirens or flashing strobes' }
];

export function setQuickCategory(catId) {
  selectedCategory = catId;
  const badge = document.getElementById('quick-selected-category-badge');
  if (badge) {
    const iconMap = {
      'Medical emergency': '🚑 Medical emergency',
      'Harassment or personal safety concern': '✋ Harassment / Safety concern',
      'Accident': '⚠️ Accident & injury',
      'Fire': '🔥 Fire / smoke hazard',
      'Theft': '🔒 Theft / security breach',
      'Suspicious activity': '👁️ Suspicious activity',
      'Other': '❓ Other crisis'
    };
    badge.innerText = iconMap[catId] || catId;
  }

  // Highlight active pill on home screen
  const pillBtns = document.querySelectorAll('.quick-cat-btn');
  pillBtns.forEach((btn) => {
    const onclickStr = btn.getAttribute('onclick') || '';
    if (onclickStr.includes(catId)) {
      btn.className = 'quick-cat-btn active-cat p-2 rounded-xl border border-rose-500 bg-rose-950/80 text-white flex flex-col items-center justify-center gap-1 transition text-xs cursor-pointer shadow-md ring-1 ring-rose-500';
    } else {
      btn.className = 'quick-cat-btn p-2 rounded-xl border border-slate-800 bg-slate-900/80 text-slate-300 hover:border-slate-700 flex flex-col items-center justify-center gap-1 transition text-xs cursor-pointer';
    }
  });

  // Automatically adjust recommended requirements
  applyCategoryDefaultRequirements(catId);
}

function applyCategoryDefaultRequirements(catId) {
  selectedRequirements.clear();
  if (catId === 'Medical emergency') {
    selectedRequirements.add('Ambulance / First Aid');
  } else if (catId === 'Fire') {
    selectedRequirements.add('Fire Safety Support');
  } else if (catId === 'Harassment or personal safety concern') {
    selectedRequirements.add('Female Security Officer');
    selectedRequirements.add('Security Patrol Escort');
  } else if (catId === 'Accident') {
    selectedRequirements.add('Ambulance / First Aid');
    selectedRequirements.add('Wheelchair / Stretcher');
  } else if (catId === 'Theft' || catId === 'Suspicious activity') {
    selectedRequirements.add('Security Patrol Escort');
  }
}

// One-Tap SOS Flow — Opens the Simple Emergency Chooser Modal
export function openSosModal(initialCategory = null) {
  if (initialCategory) {
    selectedCategory = initialCategory;
  }

  // If student's SOS privileges are restricted, block and display alternative emergency contacts
  if (mySafetyStatus && mySafetyStatus.sosAccessStatus === 'restricted') {
    showRestrictedSosModal({
      reason: mySafetyStatus.restrictionReason,
      restrictedAt: mySafetyStatus.restrictedAt
    });
    return;
  }

  // STRICT GPS ENFORCEMENT: If GPS is disabled or not locked, block the action!
  if ((!userGps.latitude || !userGps.longitude || userGps.status === 'disabled') && !isDemoSimulationActive) {
    showToast('GPS Disabled', 'GPS must be enabled to transmit emergency dispatch.', 'critical');
    showGpsDisabledLock('Active GPS is required to transmit emergency coordinates.');
    return;
  }

  // Enforce Geofence Limitation Check
  if (isGeofenceLocked && !isDemoSimulationActive) {
    showToast('Boundary Locked', 'You are outside Kongu campus boundary. App is locked.', 'critical');
    showGeofenceLock(userGps.geofenceDistance || 5000, userGps.latitude, userGps.longitude);
    return;
  }

  // Trigger quick fresh GPS lock
  requestRealGps(false);

  let modal = document.getElementById('sos-report-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'sos-report-modal';
    document.body.appendChild(modal);
  }
  modal.className = 'fixed inset-0 modal-backdrop z-50 flex items-center justify-center p-4 overflow-y-auto';
  modal.innerHTML = `
    <div class="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-xl relative my-auto space-y-4">
      
      <!-- Close Button -->
      <button onclick="document.getElementById('sos-report-modal').remove()" 
              class="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-2 rounded-lg hover:bg-slate-100 transition text-sm cursor-pointer z-10">
        ✕
      </button>

      <!-- Modal Header -->
      <div class="text-center space-y-1">
        <div class="w-12 h-12 mx-auto rounded-xl bg-red-50 border border-red-200 flex items-center justify-center text-2xl">
          🚨
        </div>
        <h3 class="text-lg font-bold text-slate-900 tracking-tight">
          Report an Emergency
        </h3>
        <p class="text-xs text-slate-500">
          Select incident type to dispatch campus emergency responders immediately
        </p>
        <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-50 border border-slate-200 text-[11px] font-mono text-emerald-700 mt-1">
          <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>📍 GPS: ${currentLat}, ${currentLng} (${currentAcc})</span>
        </div>
        <div id="modal-gps-address" class="text-xs text-slate-600 font-medium ${userGps.address ? '' : 'hidden'}">
          📍 ${userGps.address || ''}
        </div>
      </div>

      <!-- Emergency Buttons -->
      <div class="grid grid-cols-2 gap-2.5 pt-2">
        <button type="button" 
                onclick="window.csStudent.instantSos('Medical emergency')"
                class="p-3.5 rounded-xl border border-slate-200 hover:border-red-300 bg-slate-50 hover:bg-red-50/60 text-left transition flex flex-col items-start gap-1 group cursor-pointer shadow-xs">
          <span class="text-2xl group-hover:scale-105 transition">🚑</span>
          <span class="text-xs font-bold text-slate-900 mt-1">Medical</span>
          <span class="text-[10px] text-slate-500 leading-tight">First aid, fainting, injury</span>
        </button>

        <button type="button" 
                onclick="window.csStudent.instantSos('Harassment or personal safety concern')"
                class="p-3.5 rounded-xl border border-slate-200 hover:border-red-300 bg-slate-50 hover:bg-red-50/60 text-left transition flex flex-col items-start gap-1 group cursor-pointer shadow-xs">
          <span class="text-2xl group-hover:scale-105 transition">🛡️</span>
          <span class="text-xs font-bold text-slate-900 mt-1">Harassment</span>
          <span class="text-[10px] text-slate-500 leading-tight">Threat, stalking, safety</span>
        </button>

        <button type="button" 
                onclick="window.csStudent.instantSos('Accident')"
                class="p-3.5 rounded-xl border border-slate-200 hover:border-red-300 bg-slate-50 hover:bg-red-50/60 text-left transition flex flex-col items-start gap-1 group cursor-pointer shadow-xs">
          <span class="text-2xl group-hover:scale-105 transition">⚠️</span>
          <span class="text-xs font-bold text-slate-900 mt-1">Accident</span>
          <span class="text-[10px] text-slate-500 leading-tight">Crash, fall, injury</span>
        </button>

        <button type="button" 
                onclick="window.csStudent.instantSos('Fire')"
                class="p-3.5 rounded-xl border border-slate-200 hover:border-red-300 bg-slate-50 hover:bg-red-50/60 text-left transition flex flex-col items-start gap-1 group cursor-pointer shadow-xs">
          <span class="text-2xl group-hover:scale-105 transition">🔥</span>
          <span class="text-xs font-bold text-slate-900 mt-1">Fire Hazard</span>
          <span class="text-[10px] text-slate-500 leading-tight">Flames, smoke, gas</span>
        </button>

        <button type="button" 
                onclick="window.csStudent.instantSos('Theft')"
                class="p-3.5 rounded-xl border border-slate-200 hover:border-red-300 bg-slate-50 hover:bg-red-50/60 text-left transition flex flex-col items-start gap-1 group cursor-pointer shadow-xs">
          <span class="text-2xl group-hover:scale-105 transition">🔒</span>
          <span class="text-xs font-bold text-slate-900 mt-1">Theft</span>
          <span class="text-[10px] text-slate-500 leading-tight">Break-in, stolen gear</span>
        </button>

        <button type="button" 
                onclick="window.csStudent.instantSos('Other')"
                class="p-3.5 rounded-xl border border-red-300 bg-red-50/80 hover:bg-red-100/80 text-left transition flex flex-col items-start gap-1 group cursor-pointer shadow-xs">
          <span class="text-2xl group-hover:scale-105 transition">🚨</span>
          <span class="text-xs font-bold text-red-900 mt-1">General SOS</span>
          <span class="text-[10px] text-red-700 leading-tight">Immediate general alert</span>
        </button>
      </div>

      <!-- Cancel Footer -->
      <div class="pt-2 text-center">
        <button onclick="document.getElementById('sos-report-modal').remove()" 
                class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition cursor-pointer">
          Cancel (Accidental Press)
        </button>
      </div>

    </div>
  `;
}

// 1-Tap Instant SOS Dispatch
export async function instantSos(category = 'Medical emergency') {
  document.getElementById('sos-report-modal')?.remove();

  // If student's SOS privileges are restricted, block and display alternative emergency contacts
  if (mySafetyStatus && mySafetyStatus.sosAccessStatus === 'restricted') {
    showRestrictedSosModal({
      reason: mySafetyStatus.restrictionReason,
      restrictedAt: mySafetyStatus.restrictedAt
    });
    return;
  }

  // STRICT GPS ENFORCEMENT: If GPS is disabled or not locked, block the action!
  if ((!userGps.latitude || !userGps.longitude || userGps.status === 'disabled') && !isDemoSimulationActive) {
    showToast('GPS Disabled', 'GPS must be enabled to transmit emergency dispatch.', 'critical');
    showGpsDisabledLock('Active GPS is required to transmit emergency coordinates.');
    return;
  }

  // Ensure high-accuracy GPS
  if (!userGps.latitude && navigator.geolocation) {
    try {
      await new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            userGps.latitude = pos.coords.latitude;
            userGps.longitude = pos.coords.longitude;
            userGps.accuracy = Math.round(pos.coords.accuracy);
            userGps.status = 'locked';
            resolve();
          },
          () => resolve(),
          { enableHighAccuracy: true, timeout: 2000 }
        );
      });
    } catch (_) {}
  }

  if ((!userGps.latitude || !userGps.longitude || userGps.status === 'disabled') && !isDemoSimulationActive) {
    showToast('GPS Signal Missing', 'Could not acquire active GPS coordinates.', 'critical');
    showGpsDisabledLock('Active GPS coordinates could not be acquired.');
    return;
  }

  const reqs = Array.from(selectedRequirements.size ? selectedRequirements : [category]);

  const campusLoc = userGps.address || 'Kongu Engineering College Campus';
  const fullDetails = userGps.fullAddress ? `Live Address: ${userGps.fullAddress}` : '';

  await executeSosSubmission(
    category,
    campusLoc,
    `Urgent 1-Tap SOS triggered by student. Category: ${category}. ${fullDetails}`,
    {
      requirements: reqs,
      locationDetails: fullDetails,
      peopleInvolved: '1 person',
      silentAlert: false
    }
  );
}

export function selectCategory(catId) {
  instantSos(catId);
}

export function toggleRequirement(reqId) {
  if (selectedRequirements.has(reqId)) {
    selectedRequirements.delete(reqId);
  } else {
    selectedRequirements.add(reqId);
  }
}

export function updateRequirementsUI() {}

export async function submitSosFromModal() {
  instantSos(selectedCategory || 'Medical emergency');
}

export async function executeSosSubmission(
  category = 'Medical emergency',
  campusLoc = 'Main Campus Quad',
  description = 'One-tap SOS emergency alert triggered by student.',
  extra = {}
) {
  document.getElementById('sos-report-modal')?.remove();
  document.getElementById('sos-confirm-modal')?.remove();

  try {
    showToast('Broadcasting Alert', 'Transmitting emergency SOS to campus security...', 'warning');

    const res = await api.post('/api/incidents', {
      category,
      campusLocation: campusLoc,
      locationDetails: extra.locationDetails || '',
      requirements: extra.requirements !== undefined ? extra.requirements : Array.from(selectedRequirements),
      peopleInvolved: extra.peopleInvolved || '1 person',
      silentAlert: Boolean(extra.silentAlert),
      description,
      severity: 'critical',
      latitude: userGps.latitude,
      longitude: userGps.longitude,
      accuracy: userGps.accuracy,
      isDemoSimulated: Boolean(isDemoSimulationActive)
    });

    if (res.success && res.incident) {
      activeIncident = res.incident;
      renderActiveIncidentTracker();
      await loadMyIncidents();

      showToast(
        'EMERGENCY SOS LOGGED',
        `Incident ${res.incident.incidentId} confirmed! Security team has been notified.`,
        'critical'
      );

      // Scroll to active tracker
      document.getElementById('active-tracker-container')?.scrollIntoView({ behavior: 'smooth' });
    }
  } catch (err) {
    if (err.status === 403 && err.data?.restricted) {
      showRestrictedSosModal(err.data);
    } else {
      showToast('SOS Transmission Failed', err.message || 'Server cannot be reached. Please call security helpline directly.', 'critical');
    }
  }
}

// Render Active Incident Live Tracker
export function renderActiveIncidentTracker() {
  const container = document.getElementById('active-tracker-container');
  if (!container) return;

  if (!activeIncident || activeIncident.status === 'Resolved') {
    container.innerHTML = '';
    return;
  }

  // Automatically ensure user is on the SOS tab where the active tracker is displayed
  switchTab('sos');

  const inc = activeIncident;
  const statusStep = {
    Submitted: 1,
    Acknowledged: 2,
    Assigned: 3,
    Dispatched: 3,
    'On Scene': 4,
    Resolved: 5
  }[inc.status] || 1;

  container.innerHTML = `
    <div class="p-5 bg-white border-2 border-red-500 rounded-2xl shadow-sm relative overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-red-50 border border-red-200 flex items-center justify-center text-xl animate-pulse">
            🚨
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono font-bold text-slate-800 px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
                ${inc.incidentId}
              </span>
              <span class="text-xs font-bold text-red-600 uppercase tracking-wide">
                Live Emergency Active
              </span>
            </div>
            <h3 class="text-base font-bold text-slate-900 mt-0.5">${inc.category}</h3>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span class="px-3 py-1 rounded-full text-xs font-bold bg-blue-50 text-blue-700 border border-blue-200">
            Current Status: ${inc.status}
          </span>
          ${
            inc.status === 'Submitted'
              ? `<button onclick="window.csStudent.cancelMyIncident('${inc.incidentId}')" class="px-2.5 py-1 text-xs text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-50">
                  Cancel
                </button>`
              : ''
          }
        </div>
      </div>

      <!-- Live Stepper -->
      <div class="my-4">
        <div class="grid grid-cols-4 gap-2 text-center text-xs">
          <div class="flex flex-col items-center">
            <div class="w-7 h-7 rounded-full flex items-center justify-center font-bold mb-1 border ${
              statusStep >= 1 ? 'bg-red-600 text-white border-red-600' : 'bg-slate-100 text-slate-400 border-slate-200'
            }">1</div>
            <span class="text-[11px] ${statusStep >= 1 ? 'text-slate-900 font-bold' : 'text-slate-400'}">Alert Sent</span>
          </div>
          <div class="flex flex-col items-center">
            <div class="w-7 h-7 rounded-full flex items-center justify-center font-bold mb-1 border ${
              statusStep >= 2 ? 'bg-amber-600 text-white border-amber-600' : 'bg-slate-100 text-slate-400 border-slate-200'
            }">2</div>
            <span class="text-[11px] ${statusStep >= 2 ? 'text-slate-900 font-bold' : 'text-slate-400'}">Acknowledged</span>
          </div>
          <div class="flex flex-col items-center">
            <div class="w-7 h-7 rounded-full flex items-center justify-center font-bold mb-1 border ${
              statusStep >= 3 ? 'bg-blue-600 text-white border-blue-600' : 'bg-slate-100 text-slate-400 border-slate-200'
            }">3</div>
            <span class="text-[11px] ${statusStep >= 3 ? 'text-slate-900 font-bold' : 'text-slate-400'}">Patrol Dispatched</span>
          </div>
          <div class="flex flex-col items-center">
            <div class="w-7 h-7 rounded-full flex items-center justify-center font-bold mb-1 border ${
              statusStep >= 4 ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-slate-100 text-slate-400 border-slate-200'
            }">4</div>
            <span class="text-[11px] ${statusStep >= 4 ? 'text-slate-900 font-bold' : 'text-slate-400'}">On Scene</span>
          </div>
        </div>
      </div>

      <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-2">
        <div class="flex justify-between items-center">
          <div>
            <span class="text-slate-500">Assigned Patrol Unit: </span>
            <span class="font-bold text-slate-800">${inc.assignedResponder?.callSign || 'Dispatching patrol unit...'}</span>
          </div>
          <div class="text-right">
            <span class="text-slate-500">Location: </span>
            <span class="text-slate-800 font-bold">${inc.location?.campusLocation || 'Main Campus'}</span>
          </div>
        </div>

        ${inc.locationDetails || inc.peopleInvolved || inc.silentAlert ? `
          <div class="flex flex-wrap items-center gap-3 text-[11px] pt-2 border-t border-slate-200 text-slate-600">
            ${inc.locationDetails ? `<span>📍 Specific: <strong class="text-slate-800">${inc.locationDetails}</strong></span>` : ''}
            ${inc.peopleInvolved ? `<span>👥 Involved: <strong class="text-slate-800">${inc.peopleInvolved}</strong></span>` : ''}
            ${inc.silentAlert ? `<span class="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 font-bold">🤫 Silent Alert</span>` : ''}
          </div>
        ` : ''}

        ${inc.requirements && inc.requirements.length > 0 ? `
          <div class="pt-2 border-t border-slate-200">
            <div class="text-[10px] uppercase font-bold text-slate-500 mb-1">Assistance Requirements:</div>
            <div class="flex flex-wrap gap-1.5">
              ${inc.requirements.map(req => `<span class="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-semibold">${req}</span>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

export async function cancelMyIncident(incidentId) {
  if (!confirm('Are you sure you want to cancel this emergency alert?')) return;
  try {
    const res = await api.patch(`/api/incidents/${incidentId}/status`, {
      status: 'Cancelled',
      note: 'Cancelled by reporter.'
    });
    if (res.success) {
      showToast('Alert Cancelled', 'Your emergency alert has been cancelled.', 'info');
      activeIncident = null;
      renderActiveIncidentTracker();
      loadMyIncidents();
    }
  } catch (err) {
    showToast('Failed to cancel', err.message, 'critical');
  }
}

// Load Personal Incident History
export async function loadMyIncidents() {
  const container = document.getElementById('my-incident-history-list');
  if (!container) return;

  // Stale-while-revalidate: Render cached incidents immediately if available
  const cachedStr = localStorage.getItem('cs_cached_my_incidents');
  if (cachedStr && (!myIncidents || myIncidents.length === 0)) {
    try {
      const cached = JSON.parse(cachedStr);
      if (Array.isArray(cached) && cached.length > 0) {
        myIncidents = cached;
        renderIncidentsList(container, myIncidents);
      }
    } catch {}
  }

  try {
    const res = await api.get('/api/incidents/my');
    if (res.success && res.incidents) {
      myIncidents = res.incidents;
      localStorage.setItem('cs_cached_my_incidents', JSON.stringify(myIncidents));
      renderIncidentsList(container, myIncidents);
    }
  } catch (err) {
    console.warn('[CampusShield Student] Could not load my incidents:', err.message);
  }
}

function renderIncidentsList(container, incidents) {
  const pending = incidents.find((i) => ['Submitted', 'Acknowledged', 'Assigned', 'Dispatched', 'On Scene'].includes(i.status));
  if (pending && !activeIncident) {
    activeIncident = pending;
    renderActiveIncidentTracker();
  }

  if (incidents.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-slate-500 text-xs">
        No past incidents reported. Stay safe!
      </div>
    `;
    return;
  }

  container.innerHTML = incidents.map((i) => `
    <div class="p-3.5 bg-white rounded-xl border border-slate-200 text-xs flex items-center justify-between shadow-xs hover:border-slate-300 transition">
      <div>
        <div class="flex items-center gap-2 mb-1">
          <span class="font-mono font-bold text-slate-800">${i.incidentId}</span>
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
            i.status === 'Resolved' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
          }">${i.status}</span>
        </div>
        <div class="text-slate-900 font-semibold">${i.category}</div>
        <div class="text-[11px] text-slate-500">📍 ${i.location?.campusLocation || 'Kongu Campus'} • ${new Date(i.reportedAt).toLocaleDateString()}</div>
      </div>
      <button onclick="window.csStudent.viewIncidentDetails('${i._id}')" class="px-3 py-1.5 text-xs text-blue-600 hover:text-blue-800 font-semibold border border-slate-200 rounded-lg hover:bg-slate-50 transition cursor-pointer">
        Details
      </button>
    </div>
  `).join('');
}

export function viewIncidentDetails(id) {
  const found = myIncidents.find((i) => i._id === id);
  if (found) {
    activeIncident = found;
    renderActiveIncidentTracker();
    document.getElementById('active-tracker-container')?.scrollIntoView({ behavior: 'smooth' });
  }
}

// Campus Safe Walk Workflow
export async function loadSafeWalkSession() {
  try {
    const res = await api.get('/api/safewalk/my');
    if (res.success && res.activeSession) {
      activeSafeWalk = res.activeSession;
      renderSafeWalkUI();
    }
  } catch (err) {
    console.warn('[CampusShield SafeWalk] Error loading session:', err.message);
  }
}

export async function startSafeWalkSession() {
  if ((!userGps.latitude || !userGps.longitude || userGps.status === 'disabled') && !isDemoSimulationActive) {
    showToast('GPS Disabled', 'GPS must be enabled to activate SafeWalk tracking.', 'critical');
    showGpsDisabledLock('Active GPS is required to activate SafeWalk telemetry.');
    return;
  }

  if (isGeofenceLocked && !isDemoSimulationActive) {
    showToast('Boundary Locked', 'SafeWalk companion service is only available inside Kongu campus.', 'critical');
    showGeofenceLock(userGps.geofenceDistance || 5000, userGps.latitude, userGps.longitude);
    return;
  }

  const origin = document.getElementById('safewalk-origin')?.value.trim();
  const dest = document.getElementById('safewalk-destination')?.value.trim();

  if (!origin || !dest) {
    showToast('Input Required', 'Please enter both current location and destination for Safe Walk.', 'warning');
    return;
  }

  try {
    const res = await api.post('/api/safewalk/start', {
      startLocation: origin,
      destination: dest
    });

    if (res.success && res.session) {
      activeSafeWalk = res.session;
      renderSafeWalkUI();
      showToast('Safe Walk Active', `Safe Walk session started towards ${dest}.`, 'success');
    }
  } catch (err) {
    showToast('Could not start Safe Walk', err.message, 'critical');
  }
}

export async function endSafeWalkSession() {
  if (!activeSafeWalk) return;
  try {
    const res = await api.patch(`/api/safewalk/${activeSafeWalk._id}/end`);
    if (res.success) {
      showToast('Safe Walk Completed', 'You have arrived safely at your destination.', 'success');
      activeSafeWalk = null;
      renderSafeWalkUI();
    }
  } catch (err) {
    showToast('Failed to end session', err.message, 'critical');
  }
}

export async function triggerSafeWalkEmergency() {
  if (!activeSafeWalk) return;
  try {
    const res = await api.post(`/api/safewalk/${activeSafeWalk._id}/emergency`);
    if (res.success) {
      showToast('EMERGENCY SOS DISPATCHED', 'Patrol unit alerted to your Safe Walk route!', 'critical');
      activeSafeWalk = null;
      activeIncident = res.incident;
      renderActiveIncidentTracker();
      renderSafeWalkUI();
    }
  } catch (err) {
    showToast('Failed to trigger emergency', err.message, 'critical');
  }
}

export function renderSafeWalkUI() {
  const container = document.getElementById('safewalk-card-body');
  if (!container) return;

  if (activeSafeWalk) {
    container.innerHTML = `
      <div class="p-4 bg-emerald-50 rounded-xl border border-emerald-200">
        <div class="flex items-center justify-between mb-3">
          <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white">
            SAFE WALK ACTIVE
          </span>
          <span class="text-xs text-slate-600">Started: ${new Date(activeSafeWalk.startedAt).toLocaleTimeString()}</span>
        </div>

        <div class="text-xs space-y-1 mb-4 text-slate-700">
          <div>From: <strong class="text-slate-900">${activeSafeWalk.startLocation}</strong></div>
          <div>To: <strong class="text-emerald-800">${activeSafeWalk.destination}</strong></div>
        </div>

        <div class="flex gap-2">
          <button onclick="window.csStudent.triggerSafeWalkEmergency()" class="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer">
            🚨 Panic SOS
          </button>
          <button onclick="window.csStudent.endSafeWalkSession()" class="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer">
            ✓ Arrived Safely
          </button>
        </div>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="space-y-3">
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Starting Point</label>
          <input type="text" id="safewalk-origin" placeholder="e.g. Central Library" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:bg-white focus:border-blue-500" />
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Destination</label>
          <input type="text" id="safewalk-destination" placeholder="e.g. Hostel Block B" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:bg-white focus:border-blue-500" />
        </div>
        <button onclick="window.csStudent.startSafeWalkSession()" class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer">
          Start Safe Walk
        </button>
      </div>
    `;
  }
}

// Emergency Contacts Directory
export async function loadEmergencyContacts() {
  const container = document.getElementById('emergency-contacts-list');
  if (!container) return;

  try {
    const res = await api.get('/api/admin/contacts');
    if (res.success && res.contacts) {
      container.innerHTML = res.contacts.map((c) => `
        <div class="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between text-xs hover:border-slate-300 transition">
          <div>
            <div class="font-bold text-slate-900">${c.name}</div>
            <div class="text-[11px] text-blue-600 font-medium">${c.role}</div>
            <div class="text-[10px] text-slate-500">📍 ${c.location}</div>
          </div>
          <a href="tel:${c.phone}" class="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold font-mono rounded-lg border border-emerald-200 flex items-center gap-1">
            📞 ${c.phone}
          </a>
        </div>
      `).join('');
    }
  } catch (err) {
    console.warn('[CampusShield Student] Could not load emergency contacts:', err.message);
  }
}

// Notifications Drawer
export async function loadNotifications() {
  try {
    const res = await api.get('/api/notifications');
    const badge = document.getElementById('notif-unread-count');
    if (res.success && badge) {
      const unread = (res.notifications || []).filter(n => !n.read).length;
      badge.innerText = unread;
      badge.classList.toggle('hidden', unread === 0);
    }
  } catch (err) {
    console.warn('[CampusShield Student] Failed loading notifications:', err.message);
  }
}

// Load False Alarm Status, History, and Disciplinary Cases
export async function loadFalseAlarmStatusAndHistory() {
  try {
    const [faRes, casesRes] = await Promise.all([
      api.get('/api/false-alarms/my'),
      api.get('/api/disciplinary-cases/my')
    ]);

    if (faRes.success) {
      myFalseAlarmRecords = faRes.records || [];
      mySafetyStatus = faRes.safetyStatus || null;
      renderSafetyBanner();
      renderFalseAlarmHistoryTable();
    }

    if (casesRes.success) {
      myDisciplinaryCases = casesRes.cases || [];
      renderDisciplinaryCases();
    }
  } catch (err) {
    console.warn('[CampusShield Student] Failed loading false alarm status:', err.message);
  }
}

// Render Safety Banner (Warning 1, Final Warning, or Restricted)
export function renderSafetyBanner() {
  const container = document.getElementById('student-safety-banner-container');
  const sosBtn = document.getElementById('sos-primary-btn');
  if (!container) return;

  if (!mySafetyStatus) {
    container.innerHTML = '';
    return;
  }

  const { warningLevel, sosAccessStatus, confirmedIntentionalFalseAlarmCount, restrictionReason } = mySafetyStatus;

  // Update SOS button appearance if restricted
  if (sosBtn) {
    if (sosAccessStatus === 'restricted') {
      sosBtn.className = 'w-44 h-44 rounded-full bg-slate-200 text-slate-600 font-bold text-xl shadow-md border-4 border-slate-300 flex flex-col items-center justify-center gap-1 cursor-not-allowed';
      sosBtn.innerHTML = `
        <span class="text-3xl">🔒</span>
        <span class="text-base font-bold text-slate-700">RESTRICTED</span>
        <span class="text-[9px] uppercase text-slate-500 font-bold">HOTLINES ONLY</span>
      `;
    } else {
      sosBtn.className = 'w-44 h-44 rounded-full bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold text-2xl tracking-wide shadow-lg border-4 border-red-500/80 transition-all flex flex-col items-center justify-center gap-1 cursor-pointer';
      sosBtn.innerHTML = `
        <span class="text-3xl">🚨</span>
        <span>SOS</span>
        <span class="text-[10px] uppercase opacity-90 font-bold">TAP TO REPORT</span>
      `;
    }
  }

  if (sosAccessStatus === 'restricted') {
    container.innerHTML = `
      <div class="p-4 rounded-xl bg-red-50 border border-red-300 text-red-900 shadow-sm space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-red-100 text-red-700 flex items-center justify-center text-xl font-bold">
              🛑
            </div>
            <div>
              <h4 class="text-xs font-bold text-red-900 uppercase tracking-wider">
                SOS Privileges Restricted — Safety Policy Enforcement
              </h4>
              <p class="text-xs text-red-700">
                ${restrictionReason || 'Your emergency alert privileges have been suspended after accumulating confirmed false alarms.'}
              </p>
            </div>
          </div>
          <button onclick="window.csStudent.showRestrictedSosModal()" 
                  class="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-lg shadow-xs transition flex items-center gap-1.5 cursor-pointer">
            <span>📞</span> Emergency Helplines
          </button>
        </div>

        <div class="pt-2 border-t border-red-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div class="text-red-800">
            Confirmed Intentional False Alarms: <strong class="font-mono font-bold">${confirmedIntentionalFalseAlarmCount}</strong>
          </div>
          <a href="#disciplinary-cases-section" class="text-red-700 font-semibold underline hover:text-red-900">
            View Disciplinary Hearing Details →
          </a>
        </div>
      </div>
    `;
  } else if (warningLevel === 'final_warning') {
    container.innerHTML = `
      <div class="p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 shadow-sm space-y-2">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-lg">
            🚨
          </div>
          <div>
            <h4 class="text-xs font-bold text-amber-900 uppercase tracking-wider">
              Critical Notice: Final Warning (3 Confirmed False Alarms)
            </h4>
            <p class="text-xs text-amber-700">
              Your account has been flagged. Any further verified false alarm will trigger automatic termination of SOS alert privileges.
            </p>
          </div>
        </div>
      </div>
    `;
  } else if (warningLevel === 'warning_level_1') {
    container.innerHTML = `
      <div class="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 shadow-sm space-y-2">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center text-lg">
            ⚠️
          </div>
          <div>
            <h4 class="text-xs font-bold text-amber-900 uppercase tracking-wider">
              Formal Safety Notice (2 Confirmed False Alarms)
            </h4>
            <p class="text-xs text-amber-700">
              Emergency SOS triggers are strictly reserved for genuine life safety incidents. Reaching 3 confirmed false alarms leads to restricted access.
            </p>
          </div>
        </div>
      </div>
    `;
  } else {
    container.innerHTML = '';
  }
}

// Render False Alarm History Table & Status Cards
export function renderFalseAlarmHistoryTable() {
  const countEl = document.getElementById('student-confirmed-false-alarms');
  const warnEl = document.getElementById('student-warning-level-text');
  const sosPrivEl = document.getElementById('student-sos-privilege-text');
  const tableBody = document.getElementById('student-false-alarm-table-body');
  const badgeContainer = document.getElementById('student-status-badge-container');

  if (mySafetyStatus) {
    if (countEl) countEl.innerText = mySafetyStatus.confirmedIntentionalFalseAlarmCount;

    if (warnEl) {
      const warnMap = {
        none: '<span class="text-emerald-700 font-semibold">Normal (0-1)</span>',
        warning_level_1: '<span class="text-amber-700 font-semibold">Formal Warning 1</span>',
        final_warning: '<span class="text-amber-800 font-bold">Final Warning</span>',
        restricted: '<span class="text-red-700 font-bold">Threshold Exceeded</span>'
      };
      warnEl.innerHTML = warnMap[mySafetyStatus.warningLevel] || 'Normal';
    }

    if (sosPrivEl) {
      sosPrivEl.innerHTML = mySafetyStatus.sosAccessStatus === 'active'
        ? '<span class="text-emerald-700 font-semibold">Active</span>'
        : '<span class="text-red-700 font-bold">Suspended</span>';
    }

    if (badgeContainer) {
      badgeContainer.innerHTML = mySafetyStatus.sosAccessStatus === 'active'
        ? '<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">✓ Privileges Active</span>'
        : '<span class="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200">🛑 Privileges Suspended</span>';
    }
  }

  if (!tableBody) return;

  if (myFalseAlarmRecords.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="5" class="p-6 text-center text-slate-500 text-xs">
          No false alarm records on file. Thank you for using emergency services responsibly.
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = myFalseAlarmRecords.map((r) => {
    const classBadgeColor =
      r.classification === 'Genuine Emergency'
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
        : r.classification === 'False Alarm — Accidental'
        ? 'bg-amber-50 text-amber-700 border-amber-200'
        : r.classification === 'False Alarm — Intentional'
        ? 'bg-red-50 text-red-700 border-red-200'
        : 'bg-blue-50 text-blue-700 border-blue-200';

    return `
      <tr class="border-b border-slate-200 hover:bg-slate-50 text-xs">
        <td class="p-3.5 font-mono text-slate-900 font-bold">${r.incidentId}</td>
        <td class="p-3.5">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold border ${classBadgeColor}">
            ${r.classification}
          </span>
        </td>
        <td class="p-3.5 text-slate-700 max-w-xs">${r.investigationNotes || 'No notes logged.'}</td>
        <td class="p-3.5 text-slate-600">${r.verifierName || 'Security Team'}</td>
        <td class="p-3.5 text-right font-mono text-slate-500 text-[11px]">
          ${new Date(r.verifiedAt || r.createdAt).toLocaleDateString()}
        </td>
      </tr>
    `;
  }).join('');
}

// Render Disciplinary Cases & Student Appeal Section
export function renderDisciplinaryCases() {
  const container = document.getElementById('student-disciplinary-cases-container');
  const statusEl = document.getElementById('student-disciplinary-status-text');
  if (!container) return;

  if (myDisciplinaryCases.length === 0) {
    if (statusEl) statusEl.innerText = 'None';
    container.innerHTML = `
      <div class="p-6 text-center text-slate-500 text-xs bg-slate-50 rounded-xl border border-slate-200">
        No active or pending disciplinary committee cases.
      </div>
    `;
    return;
  }

  if (statusEl) {
    statusEl.innerHTML = `<span class="text-red-700 font-bold">${myDisciplinaryCases[0].caseStatus}</span>`;
  }

  container.innerHTML = myDisciplinaryCases.map((c) => {
    const isResolved = c.caseStatus === 'Resolved';
    const hasResponse = !!(c.studentResponse && c.studentResponse.trim());

    return `
      <div class="p-4 bg-white rounded-xl border border-slate-200 space-y-3 text-xs shadow-xs">
        <div class="flex flex-wrap items-center justify-between gap-3 pb-2.5 border-b border-slate-200">
          <div class="flex items-center gap-2">
            <span class="font-mono font-bold text-slate-900 text-sm">${c.caseId}</span>
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
              isResolved ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
            }">
              ${c.caseStatus}
            </span>
          </div>
          <span class="text-[11px] font-mono text-slate-500">Initiated: ${new Date(c.createdAt).toLocaleDateString()}</span>
        </div>

        <!-- Meeting & Location -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200">
          <div>
            <span class="text-slate-500 block text-[10px] uppercase font-mono">Scheduled Hearing:</span>
            <strong class="text-slate-900">${c.meetingDate ? new Date(c.meetingDate).toLocaleString() : 'Awaiting Schedule'}</strong>
          </div>
          <div>
            <span class="text-slate-500 block text-[10px] uppercase font-mono">Location:</span>
            <span class="text-slate-800">${c.meetingLocation || 'Campus Committee Room'}</span>
          </div>
        </div>

        ${
          c.committeeNotes
            ? `<div>
                <span class="text-slate-600 font-semibold block text-[11px] mb-1">Committee Case Notes:</span>
                <p class="text-slate-800 bg-slate-50 p-2.5 rounded-lg border border-slate-200">${c.committeeNotes}</p>
               </div>`
            : ''
        }

        <!-- Linked Incidents -->
        <div class="text-[11px] text-slate-600">
          <strong>Linked False Alarm Incidents: </strong>
          <span class="font-mono text-slate-900 font-semibold">${(c.linkedIncidentIds || []).join(', ') || 'N/A'}</span>
        </div>

        ${
          isResolved && c.finalDecision
            ? `
            <div class="p-3 bg-emerald-50 rounded-lg border border-emerald-200 text-emerald-800 space-y-1">
              <span class="font-bold text-xs flex items-center gap-1.5 text-emerald-900">
                <span>⚖️</span> Official Committee Decision:
              </span>
              <p class="text-xs font-semibold text-emerald-950">${c.finalDecision}</p>
              <div class="text-[10px] text-emerald-700 pt-1">
                Decided by: ${c.deciderName || 'Committee Board'} • ${c.decisionDate ? new Date(c.decisionDate).toLocaleDateString() : ''}
              </div>
            </div>
            `
            : ''
        }

        <!-- Student Representation / Appeal Box -->
        <div class="pt-2 border-t border-slate-200 space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-semibold text-slate-700 text-[11px]">Your Explanation & Appeal Representation:</span>
            <span class="text-[10px] text-slate-500">${hasResponse ? 'Submitted' : 'Pending Submission'}</span>
          </div>
          ${
            hasResponse
              ? `
              <div class="p-3 bg-slate-50 rounded-lg border border-slate-200 text-slate-800 text-xs">
                "${c.studentResponse}"
                <div class="text-[10px] text-slate-500 mt-1 font-mono">Submitted: ${new Date(c.studentResponseSubmittedAt || c.updatedAt).toLocaleString()}</div>
              </div>
              `
              : `
              <div class="space-y-2">
                <textarea id="appeal-input-${c.caseId}" rows="3" placeholder="Explain circumstances, mitigating factors, or submit written appeal for committee review..." 
                          class="w-full bg-slate-50 border border-slate-200 rounded-lg p-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-500"></textarea>
                <div class="flex justify-end">
                  <button onclick="window.csStudent.submitStudentAppeal('${c.caseId}')" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg shadow-xs transition cursor-pointer">
                    Submit Representation
                  </button>
                </div>
              </div>
              `
          }
        </div>
      </div>
    `;
  }).join('');
}

// Student Submit Appeal / Explanation
export async function submitStudentAppeal(caseId) {
  const input = document.getElementById(`appeal-input-${caseId}`);
  const explanation = input?.value.trim();

  if (!explanation) {
    showToast('Explanation Required', 'Please enter your written explanation before submitting.', 'warning');
    return;
  }

  try {
    const res = await api.post(`/api/disciplinary-cases/${caseId}/appeal`, { explanation });
    if (res.success) {
      showToast('Representation Submitted', 'Your explanation has been submitted for committee review.', 'success');
      await loadFalseAlarmStatusAndHistory();
    }
  } catch (err) {
    showToast('Submission Failed', err.message, 'critical');
  }
}

// Safety Requirement: Emergency Modal for Restricted Students
export function showRestrictedSosModal(extraData = {}) {
  let modal = document.getElementById('restricted-sos-safety-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'restricted-sos-safety-modal';
    modal.className = 'fixed inset-0 bg-slate-950/90 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto';
    document.body.appendChild(modal);
  }

  const contacts = extraData.alternativeEmergencyContacts || [
    { name: 'Campus Security Main Control Room', phone: '+91 4294 226500', role: '24/7 Control Room' },
    { name: 'Chief Security Officer (Emergency)', phone: '+91 98422 44556', role: 'Security Head' },
    { name: 'Campus Health & Medical Clinic', phone: '+91 4294 226501', role: 'Medical First Aid' },
    { name: 'Perundurai Police Station', phone: '+91 4294 220233', role: 'Local Police (100)' }
  ];

  modal.innerHTML = `
    <div class="bg-slate-900 border-2 border-rose-600 rounded-3xl w-full max-w-lg p-6 shadow-2xl relative my-auto space-y-4">
      <div class="flex items-center justify-between pb-3 border-b border-slate-800">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 rounded-2xl bg-rose-600/20 border border-rose-500 flex items-center justify-center text-2xl">
            🛑
          </div>
          <div>
            <h3 class="text-base font-black text-white uppercase tracking-wider">
              SOS Alert Access Restricted
            </h3>
            <p class="text-xs text-rose-300 font-medium">
              Policy Safety Safeguard Notice
            </p>
          </div>
        </div>
        <button onclick="document.getElementById('restricted-sos-safety-modal').remove()" class="text-slate-400 hover:text-white p-1 rounded-xl text-lg">
          ✕
        </button>
      </div>

      <div class="p-3.5 bg-rose-950/60 rounded-xl border border-rose-800 text-xs text-rose-200 leading-relaxed">
        <strong>Why is SOS disabled?</strong> Your account has accumulated confirmed intentional false alarms exceeding campus safety policy thresholds. Automated alert privileges are restricted pending Disciplinary Committee resolution.
      </div>

      <!-- Vital Safety Assurance: Alternative Helplines are NEVER blocked -->
      <div class="space-y-2 pt-1">
        <div class="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
          <span>📞</span> Immediate Emergency Helplines (Direct Calling Active):
        </div>
        <p class="text-[11px] text-slate-400">
          In an actual life safety crisis, you can call security and emergency personnel directly using the verified campus hotlines below:
        </p>

        <div class="space-y-2 pt-2">
          ${contacts
            .map(
              (c) => `
            <a href="tel:${c.phone}" 
               class="p-3 bg-slate-950 border border-slate-800 hover:border-emerald-500/80 rounded-xl flex items-center justify-between transition group">
              <div>
                <div class="text-xs font-bold text-white group-hover:text-emerald-300">${c.name}</div>
                <div class="text-[10px] text-slate-400">${c.role || 'Helpline'}</div>
              </div>
              <div class="flex items-center gap-2">
                <span class="font-mono text-emerald-400 text-xs font-bold">${c.phone}</span>
                <span class="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black text-[10px] rounded-lg">
                  CALL
                </span>
              </div>
            </a>
          `
            )
            .join('')}
        </div>
      </div>

      <div class="pt-3 border-t border-slate-800 flex justify-between items-center text-xs">
        <a href="#disciplinary-cases-section" onclick="document.getElementById('restricted-sos-safety-modal').remove()" class="text-cyan-400 underline font-semibold">
          View Disciplinary Case & Appeal →
        </a>
        <button onclick="document.getElementById('restricted-sos-safety-modal').remove()" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold rounded-xl text-xs">
          Dismiss
        </button>
      </div>
    </div>
  `;
}

// Tab switching handler for simple & clean mobile experience
export function switchTab(tabName) {
  const tabs = ['sos', 'safewalk', 'hotlines', 'status'];
  tabs.forEach(t => {
    const panel = document.getElementById(`tab-panel-${t}`);
    const deskBtn = document.getElementById(`tab-btn-${t}`);
    const mobBtn = document.getElementById(`mobile-tab-btn-${t}`);
    if (panel) {
      if (t === tabName) {
        panel.classList.remove('hidden');
      } else {
        panel.classList.add('hidden');
      }
    }
    if (deskBtn) {
      if (t === tabName) {
        deskBtn.className = 'student-tab-btn flex-1 py-2 rounded-md bg-[#1E3A5F] text-white shadow-xs transition flex items-center justify-center gap-1.5 cursor-pointer font-bold text-xs';
      } else {
        deskBtn.className = 'student-tab-btn flex-1 py-2 rounded-md text-slate-600 hover:text-slate-900 transition flex items-center justify-center gap-1.5 cursor-pointer font-semibold text-xs';
      }
    }
    if (mobBtn) {
      if (t === tabName) {
        mobBtn.className = 'mobile-tab-btn flex-1 py-1 flex flex-col items-center justify-center ' + (t === 'sos' ? 'text-red-600' : 'text-[#1E3A5F]') + ' font-bold text-[10px] cursor-pointer';
      } else {
        mobBtn.className = 'mobile-tab-btn flex-1 py-1 flex flex-col items-center justify-center text-slate-500 hover:text-slate-800 transition font-medium text-[10px] cursor-pointer';
      }
    }
  });

  if (tabName === 'sos') {
    if (studentPinpointMap) {
      setTimeout(() => studentPinpointMap.invalidateSize(), 60);
      setTimeout(() => studentPinpointMap.invalidateSize(), 300);
    }
  }
}

// Toggle collapsible map
export function toggleMapVisibility() {
  const container = document.getElementById('student-map-collapsible');
  const arrow = document.getElementById('student-map-toggle-arrow');
  if (!container) return;
  const isHidden = container.classList.contains('hidden');
  if (isHidden) {
    container.classList.remove('hidden');
    if (arrow) arrow.innerText = '▲';
    if (studentPinpointMap) {
      setTimeout(() => studentPinpointMap.invalidateSize(), 60);
      setTimeout(() => studentPinpointMap.invalidateSize(), 300);
    }
  } else {
    container.classList.add('hidden');
    if (arrow) arrow.innerText = '▼';
  }
}

export function refreshMapSize() {
  if (studentPinpointMap) {
    setTimeout(() => studentPinpointMap.invalidateSize(), 60);
    setTimeout(() => studentPinpointMap.invalidateSize(), 300);
  }
}

// Window Global Direct Functions for Inline HTML Handlers
window.unlockStudentWithGps = unlockStudentWithGps;
window.simulateCampusLocation = simulateCampusLocation;
window.dismissGpsDisabledLock = dismissGpsDisabledLock;
window.dismissGeofenceLock = dismissGeofenceLock;
window.requestRealGps = requestRealGps;
window.switchStudentTab = switchTab;
window.switchTab = switchTab;
window.toggleMapVisibility = toggleMapVisibility;

// Window Global Export Object
window.csStudent = {
  unlockStudentWithGps,
  openSosModal,
  openSosConfirmation: openSosModal,
  setQuickCategory,
  requestRealGps,
  initStudentPinpointMap,
  pinpointCampusLandmark,
  applyManualPinpoint,
  instantSos,
  selectCategory,
  toggleRequirement,
  updateRequirementsUI,
  submitSosFromModal,
  executeSosSubmission,
  cancelMyIncident,
  viewIncidentDetails,
  startSafeWalkSession,
  endSafeWalkSession,
  triggerSafeWalkEmergency,
  loadFalseAlarmStatusAndHistory,
  showRestrictedSosModal,
  submitStudentAppeal,
  toggleStudentMapTileLayer,
  simulateCampusLocation,
  toggleDemoSimulation,
  dismissGeofenceLock,
  showGpsDisabledLock,
  dismissGpsDisabledLock,
  switchTab,
  toggleMapVisibility,
  refreshMapSize,
  logout
};
