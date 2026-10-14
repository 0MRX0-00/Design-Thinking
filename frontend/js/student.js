// CampusShield Student Safety Portal Controller
import { api, showToast } from './api.js';
import { initSocket, subscribe } from './socket.js';
import { getCurrentUser, initAuth, logout } from './auth.js';

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
    loadFalseAlarmStatusAndHistory();
  });

  subscribe('false_alarm:verified', () => {
    loadFalseAlarmStatusAndHistory();
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

// Geolocation Handling
export function initGeolocation() {
  const statusEl = document.getElementById('gps-status-indicator');
  if (!navigator.geolocation) {
    userGps.status = 'unsupported';
    if (statusEl) {
      statusEl.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-slate-500"></span>
        <span class="text-slate-400">GPS: Browser unsupported (Use manual location)</span>
      `;
    }
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userGps.latitude = pos.coords.latitude;
      userGps.longitude = pos.coords.longitude;
      userGps.accuracy = Math.round(pos.coords.accuracy);
      userGps.status = 'locked';

      if (statusEl) {
        statusEl.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span class="text-emerald-300 font-mono">GPS Locked: ${userGps.latitude.toFixed(4)}, ${userGps.longitude.toFixed(4)} (±${userGps.accuracy}m)</span>
        `;
      }
    },
    (err) => {
      userGps.status = 'denied';
      if (statusEl) {
        statusEl.innerHTML = `
          <span class="w-2 h-2 rounded-full bg-amber-400"></span>
          <span class="text-amber-300">GPS Permission Denied / Unavailable (Manual location active)</span>
        `;
      }
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
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

// One-Tap SOS Flow — Opens the Report Specific Incident modal
export function openSosModal(initialCategory = 'Medical emergency') {
  // If student's SOS privileges are restricted, block and display alternative emergency contacts
  if (mySafetyStatus && mySafetyStatus.sosAccessStatus === 'restricted') {
    showRestrictedSosModal({
      reason: mySafetyStatus.restrictionReason,
      restrictedAt: mySafetyStatus.restrictedAt
    });
    return;
  }

  selectedCategory = initialCategory;
  // Initialize requirements: default to relevant based on category if empty
  if (selectedRequirements.size === 0) {
    if (selectedCategory === 'Medical emergency') {
      selectedRequirements.add('Ambulance / First Aid');
    } else if (selectedCategory === 'Fire') {
      selectedRequirements.add('Fire Safety Support');
    } else if (selectedCategory === 'Harassment or personal safety concern') {
      selectedRequirements.add('Female Security Officer');
    }
  }

  let modal = document.getElementById('sos-report-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'sos-report-modal';
    modal.className = 'fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto';
    document.body.appendChild(modal);
  }

  const categories = [
    { id: 'Medical emergency', name: 'Medical', icon: '🚑', desc: 'First aid, injury, illness' },
    { id: 'Harassment or personal safety concern', name: 'Harassment', icon: '✋', desc: 'Threat, stalking, personal safety' },
    { id: 'Accident', name: 'Accident', icon: '⚠️', desc: 'Vehicle collision, physical injury' },
    { id: 'Theft', name: 'Theft', icon: '🔒', desc: 'Break-in, stolen gear, robbery' },
    { id: 'Fire', name: 'Fire Hazard', icon: '🔥', desc: 'Smoke, electrical fire, flames' },
    { id: 'Suspicious activity', name: 'Suspicious', icon: '👁️', desc: 'Trespasser, hazard, unusual activity' },
    { id: 'Other', name: 'Other', icon: '❓', desc: 'Campus safety threat or concern' }
  ];

  modal.innerHTML = `
    <div class="bg-slate-900 border-2 border-rose-600 rounded-3xl w-full max-w-xl p-5 sm:p-6 shadow-2xl relative my-auto max-h-[92vh] overflow-y-auto space-y-4">
      
      <!-- Close Button -->
      <button onclick="document.getElementById('sos-report-modal').remove()" 
              class="absolute top-4 right-4 text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition text-sm cursor-pointer z-10">
        ✕
      </button>

      <!-- Modal Header -->
      <div class="flex items-center gap-3 pb-3 border-b border-slate-800">
        <div class="w-11 h-11 rounded-2xl bg-rose-600/20 border border-rose-500 flex items-center justify-center text-2xl animate-pulse">
          🚨
        </div>
        <div>
          <h3 class="text-base sm:text-lg font-black text-white tracking-wide">
            REPORT EMERGENCY INCIDENT
          </h3>
          <p class="text-xs text-rose-300 font-medium">
            Select emergency category & assistance requirements to dispatch security.
          </p>
        </div>
      </div>

      <div class="space-y-4">
        
        <!-- Step 1: Emergency Type -->
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="block text-xs font-bold text-slate-200 uppercase tracking-wider">
              1. Emergency Category <span class="text-rose-400">*</span>
            </label>
            <span class="text-[10px] text-slate-400 font-mono">Tap to select</span>
          </div>
          <div class="grid grid-cols-2 gap-2" id="modal-category-list">
            ${categories.map((c) => {
              const isSelected = selectedCategory === c.id;
              return `
              <button type="button" 
                      data-category="${c.id}"
                      onclick="window.csStudent.selectCategory('${c.id}')"
                      class="category-btn p-2.5 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                        isSelected 
                          ? 'bg-rose-950/80 border-rose-500 shadow-lg shadow-rose-950/50 ring-1 ring-rose-500/50' 
                          : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                      }">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-lg">${c.icon}</span>
                  <div class="min-w-0">
                    <div class="text-xs font-bold ${isSelected ? 'text-white' : 'text-slate-200'} truncate">${c.name}</div>
                    <div class="text-[10px] text-slate-500 truncate">${c.desc}</div>
                  </div>
                </div>
                <div class="category-radio-indicator ml-1 flex-shrink-0">
                  ${isSelected ? '<span class="text-rose-400 font-bold text-xs">●</span>' : '<span class="text-slate-600 font-bold text-xs">○</span>'}
                </div>
              </button>
            `;
            }).join('')}
          </div>
        </div>

        <!-- Step 2: Emergency Requirements & Assistance Needed -->
        <div class="p-3.5 bg-slate-950/70 rounded-2xl border border-slate-800 space-y-2">
          <div class="flex items-center justify-between">
            <label class="block text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <span>🧰</span> 2. Assistance Requirements Needed
            </label>
            <span class="text-[10px] text-cyan-400 font-mono font-bold">Select all that apply</span>
          </div>
          <p class="text-[11px] text-slate-400 leading-tight">
            Tap to specify required response teams, equipment, or special safeguards:
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1" id="modal-requirements-list">
            ${EMERGENCY_REQUIREMENTS.map((req) => {
              const isReqActive = selectedRequirements.has(req.id);
              return `
              <button type="button"
                      data-requirement="${req.id}"
                      onclick="window.csStudent.toggleRequirement('${req.id}')"
                      class="requirement-toggle-btn p-2.5 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
                        isReqActive
                          ? 'bg-emerald-950/60 border-emerald-500 text-white shadow-md shadow-emerald-950/50 ring-1 ring-emerald-500/40'
                          : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:border-slate-700'
                      }">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="text-base">${req.icon}</span>
                  <div class="min-w-0">
                    <div class="text-xs font-bold ${isReqActive ? 'text-white' : 'text-slate-300'} truncate">${req.label}</div>
                    <div class="text-[10px] text-slate-500 truncate">${req.desc}</div>
                  </div>
                </div>
                <span class="req-status-badge text-[10px] font-bold px-2 py-0.5 rounded-full ml-1.5 flex-shrink-0 ${
                  isReqActive ? 'bg-emerald-600 text-slate-950 font-black' : 'bg-slate-800 text-slate-400'
                }">
                  ${isReqActive ? '✓ ACTIVE' : '+ ADD'}
                </span>
              </button>
            `;
            }).join('')}
          </div>

          <div id="selected-requirements-summary" class="text-[11px] text-cyan-400 font-mono pt-1">
            ${selectedRequirements.size > 0 
              ? `Active (${selectedRequirements.size}): <span class="text-white">${Array.from(selectedRequirements).join(', ')}</span>`
              : '<span class="text-slate-500">No specific requirements selected (Standard patrol will respond)</span>'}
          </div>
        </div>

        <!-- Step 3: Campus Location -->
        <div>
          <div class="flex items-center justify-between mb-1.5">
            <label class="block text-xs font-bold text-slate-200 uppercase tracking-wider">3. Campus Landmark / Location</label>
            <span class="text-[10px] font-mono ${userGps.status === 'locked' ? 'text-emerald-400' : 'text-amber-400'}">
              ${userGps.status === 'locked' ? `📍 GPS Locked (±${userGps.accuracy}m)` : '📍 Landmark Active'}
            </span>
          </div>
          <select id="modal-campus-location" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-rose-500">
            <option value="Main Campus Quad">Main Campus Quad</option>
            <option value="IT Park / Computer Block">IT Park / Computer Block</option>
            <option value="Central Library & Knowledge Hub">Central Library & Knowledge Hub</option>
            <option value="Mechanical Sciences Block">Mechanical Sciences Block</option>
            <option value="Science & Humanities Block">Science & Humanities Block</option>
            <option value="Food Court & Student Canteen">Food Court & Student Canteen</option>
            <option value="Boys Hostel Block B">Boys Hostel Block B</option>
            <option value="Girls Hostel Dhandapani Block">Girls Hostel Dhandapani Block</option>
            <option value="Sports Complex & Athletic Ground">Sports Complex & Athletic Ground</option>
            <option value="Maharaja Auditorium Ground">Maharaja Auditorium Ground</option>
            <option value="Main Gate / Security Checkpost">Main Gate / Security Checkpost</option>
          </select>
        </div>

        <!-- Step 4: Specific Location Details & People Involved -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-bold text-slate-200 mb-1">Room No. / Floor (Optional)</label>
            <input type="text" id="modal-location-details" placeholder="e.g. Room 304, 3rd Floor, West Wing" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500" />
          </div>
          <div>
            <label class="block text-xs font-bold text-slate-200 mb-1">People Involved / Affected</label>
            <select id="modal-people-involved" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-rose-500">
              <option value="1 person">1 Person (Self / Individual)</option>
              <option value="2-3 people">2-3 People</option>
              <option value="4+ people (Group)">4+ People (Group / Crowd)</option>
            </select>
          </div>
        </div>

        <!-- Step 5: Details (Optional) -->
        <div>
          <label class="block text-xs font-bold text-slate-200 mb-1">5. Incident Details & Symptoms (Optional)</label>
          <textarea id="modal-incident-desc" rows="2" placeholder="Symptoms, suspect description, hazards, landmarks, urgency..." class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-rose-500"></textarea>
        </div>

      </div>

      <!-- Footer Actions -->
      <div class="pt-3 border-t border-slate-800/80 flex gap-3">
        <button onclick="document.getElementById('sos-report-modal').remove()" 
                class="flex-1 py-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl border border-slate-700 transition cursor-pointer">
          Cancel (False Alarm)
        </button>
        <button onclick="window.csStudent.submitSosFromModal()" 
                class="flex-1 py-3 bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 text-white font-extrabold text-xs sm:text-sm rounded-xl shadow-lg shadow-rose-900/50 border border-rose-500 transition flex items-center justify-center gap-2 cursor-pointer active:scale-98">
          <span>🚨</span> SEND EMERGENCY SOS
        </button>
      </div>

    </div>
  `;
}

export function selectCategory(catId) {
  selectedCategory = catId;
  const allBtns = document.querySelectorAll('.category-btn');
  allBtns.forEach((b) => {
    const isCur = b.getAttribute('data-category') === catId;
    b.className = `category-btn p-2.5 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
      isCur
        ? 'bg-rose-950/80 border-rose-500 shadow-lg shadow-rose-950/50 ring-1 ring-rose-500/50'
        : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
    }`;
    const indicator = b.querySelector('.category-radio-indicator');
    if (indicator) {
      indicator.innerHTML = isCur
        ? '<span class="text-rose-400 font-bold text-xs">●</span>'
        : '<span class="text-slate-600 font-bold text-xs">○</span>';
    }
  });

  // Automatically suggest relevant requirement based on selected emergency category
  if (catId === 'Medical emergency' && !selectedRequirements.has('Ambulance / First Aid')) {
    selectedRequirements.add('Ambulance / First Aid');
    updateRequirementsUI();
  } else if (catId === 'Fire' && !selectedRequirements.has('Fire Safety Support')) {
    selectedRequirements.add('Fire Safety Support');
    updateRequirementsUI();
  } else if (catId === 'Harassment or personal safety concern' && !selectedRequirements.has('Female Security Officer')) {
    selectedRequirements.add('Female Security Officer');
    selectedRequirements.add('Security Patrol Escort');
    updateRequirementsUI();
  }
}

export function toggleRequirement(reqId) {
  if (selectedRequirements.has(reqId)) {
    selectedRequirements.delete(reqId);
  } else {
    selectedRequirements.add(reqId);
  }
  updateRequirementsUI();
}

export function updateRequirementsUI() {
  const allReqBtns = document.querySelectorAll('.requirement-toggle-btn');
  allReqBtns.forEach((b) => {
    const reqId = b.getAttribute('data-requirement');
    const isSelected = selectedRequirements.has(reqId);
    b.className = `requirement-toggle-btn p-2.5 rounded-xl border text-left transition flex items-center justify-between cursor-pointer ${
      isSelected
        ? 'bg-emerald-950/60 border-emerald-500 text-white shadow-md shadow-emerald-950/50 ring-1 ring-emerald-500/40'
        : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:border-slate-700'
    }`;
    const badge = b.querySelector('.req-status-badge');
    if (badge) {
      badge.className = `req-status-badge text-[10px] font-bold px-2 py-0.5 rounded-full ml-1.5 flex-shrink-0 ${
        isSelected ? 'bg-emerald-600 text-slate-950 font-black' : 'bg-slate-800 text-slate-400'
      }`;
      badge.innerText = isSelected ? '✓ ACTIVE' : '+ ADD';
    }
  });

  const summary = document.getElementById('selected-requirements-summary');
  if (summary) {
    if (selectedRequirements.size > 0) {
      summary.innerHTML = `Active (${selectedRequirements.size}): <span class="text-white">${Array.from(selectedRequirements).join(', ')}</span>`;
    } else {
      summary.innerHTML = '<span class="text-slate-500">No specific requirements selected (Standard patrol will respond)</span>';
    }
  }
}

export async function submitSosFromModal() {
  const campusLoc = document.getElementById('modal-campus-location')?.value || 'Main Campus Quad';
  const locationDetails = document.getElementById('modal-location-details')?.value.trim() || '';
  const peopleInvolved = document.getElementById('modal-people-involved')?.value || '1 person';
  const description = document.getElementById('modal-incident-desc')?.value.trim() || `Emergency alert reported by student via SOS modal. Category: ${selectedCategory}.`;
  const reqs = Array.from(selectedRequirements);
  const silentAlert = selectedRequirements.has('Silent / Discreet Response');

  document.getElementById('sos-report-modal')?.remove();
  await executeSosSubmission(selectedCategory, campusLoc, description, {
    requirements: reqs,
    locationDetails,
    peopleInvolved,
    silentAlert
  });
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
      accuracy: userGps.accuracy
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
    <div class="p-5 tactical-glass border-2 border-rose-600 rounded-3xl shadow-2xl relative overflow-hidden">
      <div class="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-full bg-rose-600/20 border border-rose-500 flex items-center justify-center text-xl animate-pulse">
            🚨
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono font-bold text-white px-2 py-0.5 rounded bg-slate-900 border border-slate-700">
                ${inc.incidentId}
              </span>
              <span class="text-xs font-bold text-rose-400 uppercase tracking-wide">
                Live Emergency Active
              </span>
            </div>
            <h3 class="text-base font-bold text-white mt-1">${inc.category}</h3>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <span class="px-3 py-1 rounded-full text-xs font-bold bg-cyan-950 text-cyan-300 border border-cyan-700">
            Current Status: ${inc.status}
          </span>
          ${
            inc.status === 'Submitted'
              ? `<button onclick="window.csStudent.cancelMyIncident('${inc.incidentId}')" class="px-2.5 py-1 text-xs text-slate-400 hover:text-white border border-slate-700 rounded-lg">
                  Cancel
                </button>`
              : ''
          }
        </div>
      </div>

      <!-- Live Stepper -->
      <div class="my-5">
        <div class="grid grid-cols-4 gap-2 text-center text-xs">
          <div class="flex flex-col items-center">
            <div class="w-8 h-8 rounded-full flex items-center justify-center font-bold mb-1 border ${
              statusStep >= 1 ? 'bg-rose-600 text-white border-rose-500' : 'bg-slate-900 text-slate-600 border-slate-800'
            }">1</div>
            <span class="text-[11px] ${statusStep >= 1 ? 'text-white font-bold' : 'text-slate-600'}">Alert Sent</span>
          </div>
          <div class="flex flex-col items-center">
            <div class="w-8 h-8 rounded-full flex items-center justify-center font-bold mb-1 border ${
              statusStep >= 2 ? 'bg-amber-500 text-slate-950 border-amber-400' : 'bg-slate-900 text-slate-600 border-slate-800'
            }">2</div>
            <span class="text-[11px] ${statusStep >= 2 ? 'text-white font-bold' : 'text-slate-600'}">Acknowledged</span>
          </div>
          <div class="flex flex-col items-center">
            <div class="w-8 h-8 rounded-full flex items-center justify-center font-bold mb-1 border ${
              statusStep >= 3 ? 'bg-blue-600 text-white border-blue-500' : 'bg-slate-900 text-slate-600 border-slate-800'
            }">3</div>
            <span class="text-[11px] ${statusStep >= 3 ? 'text-white font-bold' : 'text-slate-600'}">Patrol Dispatched</span>
          </div>
          <div class="flex flex-col items-center">
            <div class="w-8 h-8 rounded-full flex items-center justify-center font-bold mb-1 border ${
              statusStep >= 4 ? 'bg-purple-600 text-white border-purple-500' : 'bg-slate-900 text-slate-600 border-slate-800'
            }">4</div>
            <span class="text-[11px] ${statusStep >= 4 ? 'text-white font-bold' : 'text-slate-600'}">On Scene</span>
          </div>
        </div>
      </div>

      <div class="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 text-xs space-y-2.5">
        <div class="flex justify-between items-center">
          <div>
            <span class="text-slate-400">Assigned Unit: </span>
            <span class="font-bold text-white">${inc.assignedResponder?.callSign || 'Dispatching patrol...'}</span>
          </div>
          <div class="text-right">
            <span class="text-slate-400">Location: </span>
            <span class="text-cyan-300 font-bold">${inc.location?.campusLocation || 'Main Campus'}</span>
          </div>
        </div>

        ${inc.locationDetails || inc.peopleInvolved || inc.silentAlert ? `
          <div class="flex flex-wrap items-center gap-3 text-[11px] pt-2 border-t border-slate-800/80 text-slate-300">
            ${inc.locationDetails ? `<span>📍 Specific: <strong class="text-white">${inc.locationDetails}</strong></span>` : ''}
            ${inc.peopleInvolved ? `<span>👥 Involved: <strong class="text-white">${inc.peopleInvolved}</strong></span>` : ''}
            ${inc.silentAlert ? `<span class="px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-bold">🤫 Silent Dispatch</span>` : ''}
          </div>
        ` : ''}

        ${inc.requirements && inc.requirements.length > 0 ? `
          <div class="pt-2 border-t border-slate-800/80">
            <div class="text-[10px] uppercase font-mono text-rose-400 font-bold mb-1 flex items-center gap-1">
              <span>⚠️</span> Assistance Requirements Dispatched:
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${inc.requirements.map(req => `<span class="px-2 py-0.5 rounded-lg bg-rose-950/80 text-rose-200 border border-rose-800 text-[10px] font-bold">🚨 ${req}</span>`).join('')}
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

  try {
    const res = await api.get('/api/incidents/my');
    if (res.success && res.incidents) {
      myIncidents = res.incidents;
      
      // Auto-set active incident if one is pending
      const pending = myIncidents.find((i) => ['Submitted', 'Acknowledged', 'Assigned', 'Dispatched', 'On Scene'].includes(i.status));
      if (pending && !activeIncident) {
        activeIncident = pending;
        renderActiveIncidentTracker();
      }

      if (myIncidents.length === 0) {
        container.innerHTML = `
          <div class="p-8 text-center text-slate-500 text-xs">
            No past incidents reported. Stay safe!
          </div>
        `;
        return;
      }

      container.innerHTML = myIncidents.map((i) => `
        <div class="p-3.5 bg-slate-900/60 rounded-xl border border-slate-800 text-xs flex items-center justify-between">
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span class="font-mono font-bold text-white">${i.incidentId}</span>
              <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
                i.status === 'Resolved' ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' : 'bg-cyan-950 text-cyan-300 border border-cyan-700'
              }">${i.status}</span>
            </div>
            <div class="text-slate-300 font-semibold">${i.category}</div>
            <div class="text-[11px] text-slate-500">📍 ${i.location?.campusLocation} • ${new Date(i.reportedAt).toLocaleDateString()}</div>
          </div>
          <button onclick="window.csStudent.viewIncidentDetails('${i._id}')" class="px-2.5 py-1 text-xs text-cyan-400 hover:text-white border border-slate-700 rounded-lg">
            Details
          </button>
        </div>
      `).join('');
    }
  } catch (err) {
    console.warn('[CampusShield Student] Could not load my incidents:', err.message);
  }
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

function renderSafeWalkUI() {
  const container = document.getElementById('safewalk-card-container');
  if (!container) return;

  if (activeSafeWalk) {
    container.innerHTML = `
      <div class="p-4 bg-emerald-950/40 rounded-2xl border border-emerald-600">
        <div class="flex items-center justify-between mb-3">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500 animate-pulse">
            WALK SESSION ACTIVE
          </span>
          <span class="text-xs text-slate-400">Started: ${new Date(activeSafeWalk.startedAt).toLocaleTimeString()}</span>
        </div>

        <div class="text-xs space-y-1 mb-4 text-slate-200">
          <div>From: <strong class="text-white">${activeSafeWalk.startLocation}</strong></div>
          <div>To: <strong class="text-cyan-300">${activeSafeWalk.destination}</strong></div>
        </div>

        <div class="flex gap-2">
          <button onclick="window.csStudent.triggerSafeWalkEmergency()" class="flex-1 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs rounded-xl shadow-lg animate-pulse">
            🚨 Panic SOS
          </button>
          <button onclick="window.csStudent.endSafeWalkSession()" class="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg">
            ✓ Arrived Safely
          </button>
        </div>
      </div>
    `;
  } else {
    container.innerHTML = `
      <div class="space-y-3">
        <div>
          <label class="block text-[11px] text-slate-400 mb-1">Starting Point</label>
          <input type="text" id="safewalk-origin" placeholder="e.g. Central Library" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white" />
        </div>
        <div>
          <label class="block text-[11px] text-slate-400 mb-1">Destination</label>
          <input type="text" id="safewalk-destination" placeholder="e.g. Hostel Block B" class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white" />
        </div>
        <button onclick="window.csStudent.startSafeWalkSession()" class="w-full py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs rounded-xl shadow-lg transition">
          Start Safe Walk Session
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
        <div class="p-3 bg-slate-900/60 rounded-xl border border-slate-800 flex items-center justify-between text-xs">
          <div>
            <div class="font-bold text-white">${c.name}</div>
            <div class="text-[11px] text-cyan-400">${c.role}</div>
            <div class="text-[10px] text-slate-500">📍 ${c.location}</div>
          </div>
          <a href="tel:${c.phone}" class="px-3 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 font-bold font-mono rounded-lg border border-emerald-500/40 flex items-center gap-1">
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
  const badge = document.getElementById('notif-unread-count');
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
      sosBtn.className = 'relative w-48 h-48 rounded-full bg-gradient-to-tr from-slate-800 via-slate-700 to-slate-600 text-white font-black text-2xl tracking-widest shadow-2xl border-4 border-rose-500 flex flex-col items-center justify-center gap-1 cursor-not-allowed opacity-90';
      sosBtn.innerHTML = `
        <span class="text-3xl">🔒</span>
        <span class="text-lg font-black text-rose-300">RESTRICTED</span>
        <span class="text-[9px] font-mono uppercase tracking-normal text-slate-300 font-bold">HOTLINES ONLY</span>
      `;
    } else {
      sosBtn.className = 'relative w-48 h-48 rounded-full bg-gradient-to-tr from-rose-700 via-rose-600 to-red-500 text-white font-black text-3xl tracking-widest shadow-2xl shadow-rose-900/90 border-4 border-rose-400 hover:scale-105 active:scale-95 transition-all duration-300 flex flex-col items-center justify-center gap-1 group cursor-pointer';
      sosBtn.innerHTML = `
        <span class="text-4xl group-hover:scale-110 transition">🚨</span>
        <span>SOS</span>
        <span class="text-[10px] font-mono uppercase tracking-normal opacity-90 font-bold">TAP TO REPORT</span>
      `;
    }
  }

  if (sosAccessStatus === 'restricted') {
    container.innerHTML = `
      <div class="p-5 rounded-2xl bg-rose-950/70 border-2 border-rose-600 text-white shadow-2xl animate-pulse space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-rose-600 flex items-center justify-center text-2xl">
              🛑
            </div>
            <div>
              <h4 class="text-sm font-black text-rose-100 uppercase tracking-wider">
                SOS PRIVILEGES RESTRICTED — SAFETY POLICY ENFORCEMENT
              </h4>
              <p class="text-xs text-rose-200/90 font-medium">
                ${restrictionReason || 'Your emergency alert privileges have been suspended after accumulating confirmed false alarms.'}
              </p>
            </div>
          </div>
          <button onclick="window.csStudent.showRestrictedSosModal()" 
                  class="px-4 py-2 bg-white text-rose-950 font-black text-xs rounded-xl shadow hover:bg-rose-100 transition flex items-center gap-2">
            <span>📞</span> Emergency Helplines
          </button>
        </div>

        <div class="pt-3 border-t border-rose-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div class="text-rose-200">
            Confirmed Intentional False Alarms: <strong class="text-white font-mono font-bold">${confirmedIntentionalFalseAlarmCount}</strong>
          </div>
          <a href="#disciplinary-cases-section" class="text-rose-300 font-bold underline hover:text-white">
            View Disciplinary Hearing & Appeal Details →
          </a>
        </div>
      </div>
    `;
  } else if (warningLevel === 'final_warning') {
    container.innerHTML = `
      <div class="p-4 rounded-2xl bg-amber-950/80 border-2 border-amber-500 text-white shadow-xl space-y-2">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-amber-600 flex items-center justify-center text-xl">
            🚨
          </div>
          <div>
            <h4 class="text-xs font-black text-amber-200 uppercase tracking-wider">
              CRITICAL NOTICE: FINAL WARNING (3 Confirmed Intentional False Alarms)
            </h4>
            <p class="text-[11px] text-amber-100/90">
              Your account has been flagged for administrative review. Any further verified false alarm will trigger immediate, automatic termination of your SOS alert privileges and referral to the Institution Disciplinary Committee.
            </p>
          </div>
        </div>
      </div>
    `;
  } else if (warningLevel === 'warning_level_1') {
    container.innerHTML = `
      <div class="p-4 rounded-2xl bg-yellow-950/70 border border-yellow-600/80 text-white shadow-lg space-y-2">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-yellow-600 flex items-center justify-center text-xl">
            ⚠️
          </div>
          <div>
            <h4 class="text-xs font-black text-yellow-200 uppercase tracking-wider">
              FORMAL SAFETY WARNING (2 Confirmed Intentional False Alarms)
            </h4>
            <p class="text-[11px] text-yellow-100/90">
              Campus emergency SOS triggers are strictly reserved for genuine life safety incidents. Reaching more than 3 confirmed false alarms will result in automatic privilege restriction and disciplinary proceedings.
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
        none: '<span class="text-emerald-400">Normal (0-1)</span>',
        warning_level_1: '<span class="text-yellow-400 font-bold">Formal Warning 1</span>',
        final_warning: '<span class="text-amber-400 font-bold">Final Warning</span>',
        restricted: '<span class="text-rose-400 font-bold">Threshold Exceeded</span>'
      };
      warnEl.innerHTML = warnMap[mySafetyStatus.warningLevel] || 'Normal';
    }

    if (sosPrivEl) {
      sosPrivEl.innerHTML = mySafetyStatus.sosAccessStatus === 'active'
        ? '<span class="text-emerald-400">Active</span>'
        : '<span class="text-rose-400 font-bold">Suspended</span>';
    }

    if (badgeContainer) {
      badgeContainer.innerHTML = mySafetyStatus.sosAccessStatus === 'active'
        ? '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-950 text-emerald-300 border border-emerald-700">✓ Privileges Active</span>'
        : '<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-950 text-rose-300 border border-rose-600 animate-pulse">🛑 Privileges Suspended</span>';
    }
  }

  if (!tableBody) return;

  if (myFalseAlarmRecords.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="5" class="p-6 text-center text-slate-500 text-xs italic">
          No false alarm records on file. Thank you for using emergency services responsibly.
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = myFalseAlarmRecords.map((r) => {
    const classBadgeColor =
      r.classification === 'Genuine Emergency'
        ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
        : r.classification === 'False Alarm — Accidental'
        ? 'bg-amber-950 text-amber-300 border-amber-700'
        : r.classification === 'False Alarm — Intentional'
        ? 'bg-rose-950 text-rose-300 border-rose-700'
        : 'bg-blue-950 text-blue-300 border-blue-700';

    return `
      <tr class="border-b border-slate-800/80 hover:bg-slate-800/30 text-xs">
        <td class="p-3.5 font-mono text-cyan-300 font-bold">${r.incidentId}</td>
        <td class="p-3.5">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold border ${classBadgeColor}">
            ${r.classification}
          </span>
        </td>
        <td class="p-3.5 text-slate-300 max-w-xs">${r.investigationNotes || 'No notes logged.'}</td>
        <td class="p-3.5 text-slate-400">${r.verifierName || 'Security Team'}</td>
        <td class="p-3.5 text-right font-mono text-slate-400 text-[11px]">
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
      <div class="p-6 text-center text-slate-500 text-xs italic bg-slate-950/40 rounded-2xl border border-slate-800">
        No active or pending disciplinary committee cases.
      </div>
    `;
    return;
  }

  if (statusEl) {
    statusEl.innerHTML = `<span class="text-rose-400 font-bold">${myDisciplinaryCases[0].caseStatus}</span>`;
  }

  container.innerHTML = myDisciplinaryCases.map((c) => {
    const isResolved = c.caseStatus === 'Resolved';
    const hasResponse = !!(c.studentResponse && c.studentResponse.trim());

    return `
      <div class="p-5 bg-slate-950/80 rounded-2xl border border-slate-800 space-y-4 text-xs">
        <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div class="flex items-center gap-2">
            <span class="font-mono font-bold text-rose-400 text-sm">${c.caseId}</span>
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
              isResolved ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' : 'bg-amber-950 text-amber-300 border border-amber-700'
            }">
              ${c.caseStatus}
            </span>
          </div>
          <span class="text-[11px] font-mono text-slate-500">Initiated: ${new Date(c.createdAt).toLocaleDateString()}</span>
        </div>

        <!-- Meeting & Location -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-300 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
          <div>
            <span class="text-slate-500 block text-[10px] uppercase font-mono">SCHEDULED HEARING:</span>
            <strong class="text-white">${c.meetingDate ? new Date(c.meetingDate).toLocaleString() : 'Awaiting Schedule'}</strong>
          </div>
          <div>
            <span class="text-slate-500 block text-[10px] uppercase font-mono">LOCATION:</span>
            <span class="text-slate-200">${c.meetingLocation || 'Campus Committee Room'}</span>
          </div>
        </div>

        ${
          c.committeeNotes
            ? `<div>
                <span class="text-slate-400 font-bold block text-[11px] mb-1">Committee Case Notes:</span>
                <p class="text-slate-300 bg-slate-900/40 p-2.5 rounded-lg border border-slate-800">${c.committeeNotes}</p>
               </div>`
            : ''
        }

        <!-- Linked Incidents -->
        <div class="text-[11px] text-slate-400">
          <strong>Linked False Alarm Incidents: </strong>
          <span class="font-mono text-cyan-300">${(c.linkedIncidentIds || []).join(', ') || 'N/A'}</span>
        </div>

        ${
          isResolved && c.finalDecision
            ? `
            <div class="p-3.5 bg-emerald-950/60 rounded-xl border border-emerald-600/80 text-emerald-200 space-y-1">
              <span class="font-bold text-xs flex items-center gap-1.5 text-emerald-300">
                <span>⚖️</span> Official Committee Decision:
              </span>
              <p class="text-xs font-semibold text-white">${c.finalDecision}</p>
              <div class="text-[10px] text-emerald-400/80 pt-1">
                Decided by: ${c.deciderName || 'Committee Board'} • ${c.decisionDate ? new Date(c.decisionDate).toLocaleDateString() : ''}
              </div>
            </div>
            `
            : ''
        }

        <!-- Student Representation / Appeal Box -->
        <div class="pt-2 border-t border-slate-800 space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-bold text-slate-300 text-[11px]">Your Explanation & Appeal Representation:</span>
            <span class="text-[10px] text-slate-500">${hasResponse ? 'Submitted' : 'Pending Submission'}</span>
          </div>
          ${
            hasResponse
              ? `
              <div class="p-3 bg-slate-900 rounded-xl border border-slate-800 text-slate-200 text-xs">
                "${c.studentResponse}"
                <div class="text-[10px] text-slate-500 mt-1 font-mono">Submitted: ${new Date(c.studentResponseSubmittedAt || c.updatedAt).toLocaleString()}</div>
              </div>
              `
              : `
              <div class="space-y-2">
                <textarea id="appeal-input-${c.caseId}" rows="3" placeholder="Explain circumstances, mitigating factors, or submit written appeal for committee review..." 
                          class="w-full bg-slate-900 border border-slate-800 rounded-xl p-2.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"></textarea>
                <div class="flex justify-end">
                  <button onclick="window.csStudent.submitStudentAppeal('${c.caseId}')" class="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl shadow transition">
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

// Window Global Export
window.csStudent = {
  openSosModal,
  openSosConfirmation: openSosModal,
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
  logout
};
