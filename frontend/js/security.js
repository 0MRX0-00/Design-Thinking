// CampusShield Security Personnel Command Center Controller
import { api, showToast } from './api.js';
import { initSocket, subscribe } from './socket.js';
import { getCurrentUser, initAuth, logout } from './auth.js';

let incidents = [];
let selectedIncident = null;
let responders = [];
let currentFilter = 'ALL';
let activeCamera = 'CAM-01';

// DOM Initializer
document.addEventListener('DOMContentLoaded', async () => {
  await initAuth('security');
  await initSocket();

  const logoutBtn = document.getElementById('auth-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  }

  // Setup real-time event listeners
  subscribe('incident:created', (newInc) => {
    // Add to incidents list and refresh UI
    incidents.unshift(newInc);
    renderIncidentQueue();
    updateDashboardMetrics();
    renderCampusTacticalMap();
    if (!selectedIncident) {
      selectIncident(newInc._id || newInc.incidentId);
    }
  });

  subscribe('incident:updated', (updatedInc) => {
    const idx = incidents.findIndex((i) => i.incidentId === updatedInc.incidentId || i._id === updatedInc._id);
    if (idx !== -1) {
      incidents[idx] = updatedInc;
    } else {
      incidents.unshift(updatedInc);
    }
    renderIncidentQueue();
    updateDashboardMetrics();
    renderCampusTacticalMap();
    if (selectedIncident && (selectedIncident.incidentId === updatedInc.incidentId || selectedIncident._id === updatedInc._id)) {
      selectIncident(updatedInc._id || updatedInc.incidentId);
    }
  });

  subscribe('responder:status_changed', (responder) => {
    loadResponders();
    updateDashboardMetrics();
  });

  // Load Initial Data
  await Promise.all([
    loadDashboardSummary(),
    loadIncidents(),
    loadResponders()
  ]);

  initCctvFeed();
  renderCampusTacticalMap();

  // Periodic polling fallback
  setInterval(loadDashboardSummary, 20000);
});

// Load Dashboard Metrics
export async function loadDashboardSummary() {
  try {
    const res = await api.get('/api/dashboard/summary');
    if (res.success && res.summary) {
      const { activeIncidents, criticalIncidents, avgResponseTimeMinutes, fleet } = res.summary;
      
      const elActive = document.getElementById('stat-active-incidents');
      const elCritical = document.getElementById('stat-critical-alarms');
      const elResponse = document.getElementById('stat-avg-response');
      const elFleet = document.getElementById('stat-fleet-readiness');

      if (elActive) elActive.innerText = activeIncidents;
      if (elCritical) elCritical.innerText = criticalIncidents;
      if (elResponse) elResponse.innerText = `${avgResponseTimeMinutes}m`;
      if (elFleet) elFleet.innerText = `${fleet.available}/${fleet.total}`;
    }
  } catch (err) {
    console.warn('[CampusShield Command Center] Could not load dashboard stats:', err.message);
  }
}

export function updateDashboardMetrics() {
  const activeCount = incidents.filter((i) => ['Submitted', 'Acknowledged', 'Assigned', 'Dispatched', 'On Scene'].includes(i.status)).length;
  const criticalCount = incidents.filter((i) => i.severity === 'critical' && i.status !== 'Resolved').length;

  const elActive = document.getElementById('stat-active-incidents');
  const elCritical = document.getElementById('stat-critical-alarms');
  if (elActive) elActive.innerText = activeCount;
  if (elCritical) elCritical.innerText = criticalCount;
}

// Load Incidents Queue
export async function loadIncidents() {
  const queueContainer = document.getElementById('incident-queue-list');
  if (queueContainer) {
    queueContainer.innerHTML = `
      <div class="flex items-center justify-center p-8 text-slate-400 text-sm">
        <div class="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mr-3"></div>
        Connecting to Emergency Feed...
      </div>
    `;
  }

  try {
    const res = await api.get('/api/incidents');
    if (res.success && res.incidents) {
      incidents = res.incidents;
      renderIncidentQueue();
      if (incidents.length > 0) {
        selectIncident(incidents[0]._id);
      } else {
        renderEmptyDossier();
      }
    }
  } catch (err) {
    if (queueContainer) {
      queueContainer.innerHTML = `
        <div class="p-6 text-center text-rose-400 text-sm">
          <p>⚠️ ${err.message || 'Unable to load incident queue.'}</p>
          <button onclick="window.csSecurity.loadIncidents()" class="mt-3 px-3 py-1 bg-rose-900/60 hover:bg-rose-800 text-rose-200 rounded text-xs border border-rose-700">
            Retry Connection
          </button>
        </div>
      `;
    }
  }
}

// Render Incident Queue
export function renderIncidentQueue() {
  const container = document.getElementById('incident-queue-list');
  if (!container) return;

  const searchQuery = (document.getElementById('queue-search-input')?.value || '').toLowerCase();
  
  const filtered = incidents.filter((inc) => {
    if (currentFilter !== 'ALL') {
      if (currentFilter === 'ACTIVE') {
        if (!['Submitted', 'Acknowledged', 'Assigned', 'Dispatched', 'On Scene'].includes(inc.status)) return false;
      } else if (inc.status.toUpperCase() !== currentFilter) {
        return false;
      }
    }

    if (searchQuery) {
      const matchId = (inc.incidentId || '').toLowerCase().includes(searchQuery);
      const matchCat = (inc.category || '').toLowerCase().includes(searchQuery);
      const matchLoc = (inc.location?.campusLocation || '').toLowerCase().includes(searchQuery);
      const matchDesc = (inc.description || '').toLowerCase().includes(searchQuery);
      if (!matchId && !matchCat && !matchLoc && !matchDesc) return false;
    }

    return true;
  });

  const countBadge = document.getElementById('queue-count-badge');
  if (countBadge) countBadge.innerText = `${filtered.length} INCIDENTS`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="p-8 text-center text-slate-500 text-sm">
        <p class="text-2xl mb-2">🛡️</p>
        <p class="font-bold text-slate-400">No Incidents in Queue</p>
        <p class="text-xs text-slate-600 mt-1">All clear for current filter.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((inc) => {
    const isSelected = selectedIncident && (selectedIncident._id === inc._id || selectedIncident.incidentId === inc.incidentId);
    const isCritical = inc.severity === 'critical';
    const isResolved = inc.status === 'Resolved';
    const timeAgo = formatTimeAgo(inc.reportedAt);

    const severityColor = {
      critical: 'text-rose-400 bg-rose-950/70 border-rose-700/60',
      high: 'text-amber-400 bg-amber-950/70 border-amber-700/60',
      medium: 'text-yellow-400 bg-yellow-950/70 border-yellow-700/60',
      low: 'text-emerald-400 bg-emerald-950/70 border-emerald-700/60'
    }[inc.severity] || 'text-cyan-400 bg-cyan-950/70 border-cyan-700/60';

    const statusBadgeColor = {
      Submitted: 'text-rose-400 bg-rose-500/10 border-rose-500/40 animate-pulse',
      Acknowledged: 'text-amber-400 bg-amber-500/10 border-amber-500/40',
      Assigned: 'text-blue-400 bg-blue-500/10 border-blue-500/40',
      Dispatched: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/40',
      'On Scene': 'text-purple-400 bg-purple-500/10 border-purple-500/40',
      Resolved: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/40',
      Cancelled: 'text-slate-400 bg-slate-500/10 border-slate-500/40'
    }[inc.status] || 'text-slate-400 bg-slate-800';

    return `
      <div onclick="window.csSecurity.selectIncident('${inc._id}')" 
           class="p-3.5 rounded-xl border tactical-card cursor-pointer transition-all ${
             isSelected
               ? 'bg-cyan-950/40 border-cyan-500/80 shadow-lg shadow-cyan-950/30'
               : 'bg-slate-900/60 border-slate-800/80 hover:bg-slate-800/50 hover:border-slate-700'
           }">
        <div class="flex items-center justify-between gap-2 mb-2">
          <div class="flex items-center gap-2">
            <span class="font-mono text-xs font-bold text-white tracking-wider">${inc.incidentId}</span>
            <span class="px-1.5 py-0.5 text-[10px] uppercase font-bold rounded border ${severityColor}">${inc.severity}</span>
          </div>
          <span class="px-2 py-0.5 text-[10px] font-bold rounded-full border ${statusBadgeColor}">${inc.status}</span>
        </div>

        <div class="text-sm font-semibold text-slate-100 line-clamp-1 mb-1">
          ${getCategoryIcon(inc.category)} ${inc.category}
        </div>

        <div class="flex items-center gap-1.5 text-xs text-slate-400 mb-2">
          <span class="text-cyan-400 text-xs">📍</span>
          <span class="truncate">${inc.location?.campusLocation || 'Main Campus'}</span>
        </div>

        <div class="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-800/60">
          <span>Reporter: <strong class="text-slate-300">${inc.reporter?.name || 'Anonymous'}</strong></span>
          <span class="font-mono">${timeAgo}</span>
        </div>
      </div>
    `;
  }).join('');
}

// Select Incident in Dossier
export async function selectIncident(id) {
  selectedIncident = incidents.find((i) => i._id === id || i.incidentId === id) || null;
  renderIncidentQueue();
  renderEmergencyDossier();
  renderCampusTacticalMap();

  if (selectedIncident) {
    try {
      const res = await api.get(`/api/incidents/${selectedIncident.incidentId || selectedIncident._id}`);
      if (res.success && res.incident) {
        selectedIncident = { ...res.incident, falseAlarmRecord: res.falseAlarmRecord };
        renderEmergencyDossier();
      }
    } catch (err) {
      // ignore
    }
  }
}

// Render Emergency Dossier
export function renderEmergencyDossier() {
  const container = document.getElementById('emergency-dossier-panel');
  if (!container) return;

  if (!selectedIncident) {
    renderEmptyDossier();
    return;
  }

  const inc = selectedIncident;
  const timeFormatted = new Date(inc.reportedAt).toLocaleString();

  const lifecycleSteps = [
    { name: 'Submitted', done: true },
    { name: 'Acknowledged', done: ['Acknowledged', 'Assigned', 'Dispatched', 'On Scene', 'Resolved'].includes(inc.status) },
    { name: 'Dispatched', done: ['Dispatched', 'On Scene', 'Resolved'].includes(inc.status) },
    { name: 'On Scene', done: ['On Scene', 'Resolved'].includes(inc.status) },
    { name: 'Resolved', done: inc.status === 'Resolved' }
  ];

  const assignedUnit = inc.assignedResponder?.callSign
    ? `${inc.assignedResponder.callSign} (${inc.assignedResponder.team || 'Security Fleet'})`
    : 'None Assigned';

  container.innerHTML = `
    <div class="p-5 tactical-glass rounded-2xl border border-slate-800 flex flex-col gap-5">
      <!-- Dossier Header -->
      <div class="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-800">
        <div>
          <div class="flex items-center gap-2.5">
            <span class="text-xs font-mono font-bold text-cyan-400 px-2 py-0.5 rounded bg-cyan-950/60 border border-cyan-800/60">
              DOSSIER: ${inc.incidentId}
            </span>
            <span class="text-xs uppercase font-bold px-2 py-0.5 rounded ${
              inc.severity === 'critical' ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-amber-950 text-amber-300 border border-amber-800'
            }">
              ${inc.severity} Priority
            </span>
            <span class="text-xs font-bold px-2 py-0.5 rounded-full ${
              inc.status === 'Resolved' ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' : 'bg-cyan-950 text-cyan-300 border border-cyan-700'
            }">
              Status: ${inc.status}
            </span>
          </div>
          <h2 class="text-xl font-black text-white mt-2 flex items-center gap-2">
            ${getCategoryIcon(inc.category)} ${inc.category}
          </h2>
          <p class="text-xs text-slate-400 mt-0.5">Reported: ${timeFormatted}</p>
        </div>

        <!-- Primary Action Buttons -->
        <div class="flex flex-wrap items-center gap-2">
          ${
            inc.status === 'Submitted'
              ? `<button onclick="window.csSecurity.acknowledgeAlert('${inc.incidentId}')" class="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-lg transition flex items-center gap-1.5">
                  ⚡ Acknowledge Alert
                </button>`
              : ''
          }
          ${
            inc.status !== 'Resolved'
              ? `<button onclick="window.csSecurity.openAssignModal('${inc.incidentId}')" class="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-lg transition flex items-center gap-1.5">
                  🚔 Assign / Dispatch Unit
                </button>`
              : ''
          }
          ${
            ['Dispatched', 'Assigned'].includes(inc.status)
              ? `<button onclick="window.csSecurity.markOnScene('${inc.incidentId}')" class="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl shadow-lg transition flex items-center gap-1.5">
                  📍 Mark On Scene
                </button>`
              : ''
          }
          ${
            inc.status !== 'Resolved'
              ? `<button onclick="window.csSecurity.openResolveModal('${inc.incidentId}')" class="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg transition flex items-center gap-1.5">
                  ✅ Resolve Incident
                </button>`
              : ''
          }
          <button onclick="window.csSecurity.openVerifyModal('${inc.incidentId}')" class="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl shadow-lg transition flex items-center gap-1.5 border border-amber-500/50">
            ⚖️ Verify / Classify False Alarm
          </button>
        </div>
      </div>

      <!-- Lifecycle Progression Stepper -->
      <div class="p-4 bg-slate-950/60 rounded-xl border border-slate-800/80">
        <div class="text-[11px] font-mono uppercase tracking-wider text-slate-400 mb-3 flex items-center justify-between">
          <span>Lifecycle Response Timeline</span>
          <span class="text-cyan-400 font-bold">${inc.status}</span>
        </div>
        <div class="grid grid-cols-5 gap-2">
          ${lifecycleSteps
            .map(
              (s, i) => `
            <div class="flex flex-col items-center text-center">
              <div class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mb-1 border ${
                s.done
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400 shadow-sm shadow-cyan-500/50'
                  : 'bg-slate-900 text-slate-600 border-slate-800'
              }">
                ${s.done ? '✓' : i + 1}
              </div>
              <span class="text-[10px] font-semibold ${s.done ? 'text-slate-200' : 'text-slate-600'}">${s.name}</span>
            </div>
          `
            )
            .join('')}
        </div>
      </div>

      <!-- Reporter and Location Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- Reporter Info Card -->
        <div class="p-4 bg-slate-900/60 rounded-xl border border-slate-800">
          <div class="text-xs font-mono font-bold uppercase text-slate-400 mb-3 flex items-center gap-2">
            <span>👤</span> Reporter Identification
          </div>
          <div class="space-y-2 text-xs">
            <div class="flex justify-between">
              <span class="text-slate-400">Name:</span>
              <span class="font-bold text-white">${inc.reporter?.name || 'Anonymous Student'}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Roll/Emp ID:</span>
              <span class="font-mono text-cyan-300">${inc.reporter?.identifier || 'N/A'}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Phone:</span>
              <a href="tel:${inc.reporter?.phone}" class="font-mono text-emerald-400 hover:underline">${inc.reporter?.phone || 'Not Provided'}</a>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Department:</span>
              <span class="text-slate-300">${inc.reporter?.department || 'Information Technology'}</span>
            </div>
          </div>
        </div>

        <!-- Location & Responder Card -->
        <div class="p-4 bg-slate-900/60 rounded-xl border border-slate-800">
          <div class="text-xs font-mono font-bold uppercase text-slate-400 mb-3 flex items-center gap-2">
            <span>📍</span> Location & Fleet Unit
          </div>
          <div class="space-y-2 text-xs">
            <div class="flex justify-between">
              <span class="text-slate-400">Campus Location:</span>
              <span class="font-bold text-white">${inc.location?.campusLocation || 'Main Campus'}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">GPS Coordinates:</span>
              <span class="font-mono text-cyan-300">
                ${
                  inc.location?.latitude && inc.location?.longitude
                    ? `${inc.location.latitude.toFixed(4)}, ${inc.location.longitude.toFixed(4)} (±${inc.location.accuracy || 10}m)`
                    : 'Manual Landmark'
                }
              </span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Assigned Unit:</span>
              <span class="font-bold text-blue-300">${assignedUnit}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-400">Resolved At:</span>
              <span class="text-slate-300">${inc.resolvedAt ? new Date(inc.resolvedAt).toLocaleTimeString() : 'Pending'}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Incident Description & Requirements -->
      <div class="p-4 bg-slate-900/40 rounded-xl border border-slate-800 space-y-3">
        <div>
          <div class="text-xs font-mono uppercase text-slate-400 mb-1 font-bold">Emergency Description:</div>
          <p class="text-xs text-slate-200 leading-relaxed">${inc.description || 'No additional narrative provided during emergency SOS.'}</p>
        </div>

        ${inc.requirements && inc.requirements.length > 0 ? `
          <div class="pt-2 border-t border-slate-800/80">
            <div class="text-xs font-mono uppercase text-rose-400 mb-1.5 font-bold flex items-center gap-1.5">
              <span>⚠️</span> Requested Assistance Requirements:
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${inc.requirements.map(req => `
                <span class="px-2.5 py-1 rounded-lg bg-rose-950/80 border border-rose-700 text-rose-200 text-xs font-bold flex items-center gap-1">
                  <span>🚨</span> ${req}
                </span>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${inc.locationDetails || inc.peopleInvolved || inc.silentAlert ? `
          <div class="pt-2 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            ${inc.locationDetails ? `<div><span class="text-slate-400">Room / Landmark:</span> <span class="font-bold text-white">${inc.locationDetails}</span></div>` : ''}
            ${inc.peopleInvolved ? `<div><span class="text-slate-400">People Involved:</span> <span class="font-bold text-white">${inc.peopleInvolved}</span></div>` : ''}
            ${inc.silentAlert ? `<div><span class="px-2 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-800 font-bold">🤫 Silent Alert</span></div>` : ''}
          </div>
        ` : ''}

        ${
          inc.resolutionNotes
            ? `<div class="mt-3 pt-3 border-t border-slate-800 text-xs">
                <span class="text-emerald-400 font-bold">Resolution Notes: </span>
                <span class="text-slate-300">${inc.resolutionNotes}</span>
               </div>`
            : ''
        }
      </div>

      <!-- False Alarm Investigation Dossier Card -->
      <div class="p-4 bg-slate-900/70 rounded-xl border border-slate-800">
        <div class="flex items-center justify-between mb-3">
          <div class="text-xs font-mono font-bold uppercase text-slate-300 flex items-center gap-2">
            <span>⚖️</span> False Alarm Verification Status
          </div>
          <button onclick="window.csSecurity.openVerifyModal('${inc.incidentId}')" class="text-xs font-bold text-cyan-400 hover:underline">
            ${inc.falseAlarmRecord ? 'Update Classification' : '+ Classify Incident'}
          </button>
        </div>
        ${
          inc.falseAlarmRecord
            ? `
            <div class="space-y-2.5 text-xs">
              <div class="flex flex-wrap items-center gap-2">
                <span class="px-2.5 py-1 rounded-lg font-bold text-xs ${
                  inc.falseAlarmRecord.classification === 'Genuine Emergency'
                    ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                    : inc.falseAlarmRecord.classification === 'False Alarm — Accidental'
                    ? 'bg-amber-950 text-amber-300 border border-amber-700'
                    : inc.falseAlarmRecord.classification === 'False Alarm — Intentional'
                    ? 'bg-rose-950 text-rose-300 border border-rose-700 animate-pulse'
                    : 'bg-blue-950 text-blue-300 border border-blue-700'
                }">
                  ${inc.falseAlarmRecord.classification}
                </span>
                <span class="text-slate-400 text-[11px]">
                  Verified by: <strong class="text-slate-200">${inc.falseAlarmRecord.verifierName || 'Campus Security'}</strong>
                  • ${new Date(inc.falseAlarmRecord.verifiedAt || inc.falseAlarmRecord.createdAt).toLocaleString()}
                </span>
              </div>
              ${
                inc.falseAlarmRecord.investigationNotes
                  ? `<div class="bg-slate-950/80 p-2.5 rounded-lg border border-slate-800/80">
                      <span class="text-slate-400 font-semibold block text-[11px] mb-0.5">Investigation Findings:</span>
                      <p class="text-slate-200">${inc.falseAlarmRecord.investigationNotes}</p>
                    </div>`
                  : ''
              }
              ${
                inc.falseAlarmRecord.evidenceReferences
                  ? `<div class="text-[11px] text-slate-400 font-mono">
                      <span>Evidence / Reference: </span><span class="text-cyan-300">${inc.falseAlarmRecord.evidenceReferences}</span>
                    </div>`
                  : ''
              }
            </div>
            `
            : `
            <div class="p-3 bg-slate-950/60 rounded-lg border border-slate-800/80 text-xs text-slate-400 flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <span class="text-amber-400">⚠️</span>
                <span>Incident pending security investigation classification (Genuine, Accidental, or Intentional False Alarm).</span>
              </div>
              <button onclick="window.csSecurity.openVerifyModal('${inc.incidentId}')" class="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-bold text-xs shadow">
                Classify Now
              </button>
            </div>
            `
        }
      </div>

      <!-- Dispatch Notes & Communication Trail -->
      <div class="space-y-2">
        <div class="flex items-center justify-between text-xs font-mono uppercase text-slate-400 font-bold">
          <span>Dispatch & Response Notes (${inc.notes?.length || 0})</span>
        </div>
        
        <div class="max-h-36 overflow-y-auto space-y-2 pr-1">
          ${
            inc.notes && inc.notes.length > 0
              ? inc.notes
                  .map(
                    (n) => `
                <div class="p-2.5 bg-slate-950/80 rounded-lg border border-slate-800/80 text-xs">
                  <div class="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                    <span class="font-bold text-cyan-400">${n.authorName || 'Dispatcher'}</span>
                    <span class="font-mono">${new Date(n.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <p class="text-slate-200">${n.text}</p>
                </div>
              `
                  )
                  .join('')
              : '<div class="text-xs text-slate-600 italic">No dispatch notes logged yet.</div>'
          }
        </div>

        <!-- Add Note Input -->
        <div class="flex gap-2 pt-2">
          <input type="text" id="dispatch-note-input" placeholder="Type dispatch note or responder update..." 
                 class="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500" />
          <button onclick="window.csSecurity.addDispatchNote('${inc.incidentId}')" class="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 font-bold text-xs rounded-xl border border-slate-700">
            Log Note
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderEmptyDossier() {
  const container = document.getElementById('emergency-dossier-panel');
  if (!container) return;
  container.innerHTML = `
    <div class="p-12 tactical-glass rounded-2xl border border-slate-800 text-center text-slate-500">
      <div class="text-4xl mb-3">🛡️</div>
      <h3 class="text-base font-bold text-slate-300">No Incident Selected</h3>
      <p class="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
        Select an emergency from the queue to inspect tactical coordinates, dispatch security patrol, and view incident history.
      </p>
    </div>
  `;
}

// Action Handlers
export async function acknowledgeAlert(incidentId) {
  try {
    const res = await api.patch(`/api/incidents/${incidentId}/status`, {
      status: 'Acknowledged',
      note: 'Alert acknowledged by Security Command Center.'
    });
    if (res.success) {
      showToast('Incident Acknowledged', `Incident ${incidentId} marked as acknowledged.`, 'success');
      selectedIncident = res.incident;
      renderIncidentQueue();
      renderEmergencyDossier();
    }
  } catch (err) {
    showToast('Action Failed', err.message, 'critical');
  }
}

export async function markOnScene(incidentId) {
  try {
    const res = await api.patch(`/api/incidents/${incidentId}/status`, {
      status: 'On Scene',
      note: 'Responder arrived at location.'
    });
    if (res.success) {
      showToast('Responder On Scene', `Unit arrived at emergency scene for ${incidentId}.`, 'success');
      selectedIncident = res.incident;
      renderIncidentQueue();
      renderEmergencyDossier();
    }
  } catch (err) {
    showToast('Action Failed', err.message, 'critical');
  }
}

export async function addDispatchNote(incidentId) {
  const input = document.getElementById('dispatch-note-input');
  if (!input || !input.value.trim()) return;

  const noteText = input.value.trim();
  try {
    const res = await api.post(`/api/incidents/${incidentId}/notes`, { text: noteText });
    if (res.success) {
      input.value = '';
      if (selectedIncident) {
        selectedIncident.notes = res.notes;
        renderEmergencyDossier();
      }
      showToast('Note Logged', 'Dispatch note recorded to audit log.', 'info');
    }
  } catch (err) {
    showToast('Failed to add note', err.message, 'critical');
  }
}

// Responders Management
export async function loadResponders() {
  try {
    const res = await api.get('/api/responders');
    if (res.success && res.responders) {
      responders = res.responders;
      renderFleetStatus();
    }
  } catch (err) {
    console.warn('[CampusShield Command Center] Could not load responders:', err.message);
  }
}

export function renderFleetStatus() {
  const container = document.getElementById('fleet-status-list');
  if (!container) return;

  container.innerHTML = responders.map((r) => {
    const statusColor = {
      available: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/40',
      dispatched: 'bg-blue-500/10 text-blue-400 border-blue-500/40',
      busy: 'bg-amber-500/10 text-amber-400 border-amber-500/40',
      off_duty: 'bg-slate-500/10 text-slate-400 border-slate-500/40'
    }[r.availabilityStatus] || 'bg-slate-800 text-slate-400';

    return `
      <div class="p-3 bg-slate-900/60 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs">
        <div>
          <div class="flex items-center gap-2">
            <span class="font-bold text-white font-mono">${r.callSign}</span>
            <span class="text-[10px] text-slate-400">(${r.badgeNumber})</span>
          </div>
          <div class="text-[11px] text-slate-400 mt-0.5">${r.team}</div>
          <div class="text-[10px] text-cyan-400 mt-0.5">📍 ${r.lastKnownLocation?.campusZone || 'Patrol Unit'}</div>
        </div>

        <div class="flex flex-col items-end gap-1.5">
          <span class="px-2 py-0.5 text-[10px] font-bold rounded border ${statusColor} uppercase">${r.availabilityStatus}</span>
          <button onclick="window.csSecurity.toggleResponderStatus('${r._id}', '${r.availabilityStatus}')" 
                  class="text-[10px] text-cyan-400 hover:text-cyan-300 underline font-mono">
            Toggle Status
          </button>
        </div>
      </div>
    `;
  }).join('');
}

export async function toggleResponderStatus(responderId, currentStatus) {
  const nextStatus = currentStatus === 'available' ? 'busy' : currentStatus === 'busy' ? 'off_duty' : 'available';
  try {
    const res = await api.patch(`/api/responders/${responderId}/status`, { availabilityStatus: nextStatus });
    if (res.success) {
      showToast('Fleet Status Updated', `Unit status changed to ${nextStatus}.`, 'info');
      await loadResponders();
      await loadDashboardSummary();
    }
  } catch (err) {
    showToast('Failed to change status', err.message, 'critical');
  }
}

// Modal Handlers
export function openAssignModal(incidentId) {
  let modal = document.getElementById('assign-responder-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'assign-responder-modal';
    modal.className = 'fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4';
    document.body.appendChild(modal);
  }

  const availableUnits = responders.filter((r) => r.availabilityStatus !== 'off_duty');

  modal.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-base font-bold text-white flex items-center gap-2">
          🚔 Dispatch Security Unit
        </h3>
        <button onclick="document.getElementById('assign-responder-modal').remove()" class="text-slate-400 hover:text-white">✕</button>
      </div>

      <p class="text-xs text-slate-400 mb-4">
        Select a security response unit to assign to Incident <strong class="text-cyan-400">${incidentId}</strong>:
      </p>

      <div class="space-y-2 max-h-60 overflow-y-auto mb-4">
        ${
          availableUnits.length > 0
            ? availableUnits
                .map(
                  (r) => `
              <label class="flex items-center justify-between p-3 rounded-xl border border-slate-800 bg-slate-950 hover:bg-slate-800/80 cursor-pointer text-xs">
                <div>
                  <div class="font-bold text-white font-mono">${r.callSign} (${r.badgeNumber})</div>
                  <div class="text-[11px] text-slate-400">${r.team} • Active: ${r.activeIncidentCount || 0}</div>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-[10px] px-2 py-0.5 rounded border ${
                    r.availabilityStatus === 'available' ? 'border-emerald-600 text-emerald-300' : 'border-amber-600 text-amber-300'
                  }">${r.availabilityStatus}</span>
                  <input type="radio" name="selected_responder" value="${r._id}" ${r.availabilityStatus === 'available' ? 'checked' : ''} />
                </div>
              </label>
            `
                )
                .join('')
            : '<p class="text-xs text-amber-400">No active response units on shift.</p>'
        }
      </div>

      <div class="flex justify-end gap-2">
        <button onclick="document.getElementById('assign-responder-modal').remove()" class="px-4 py-2 text-xs text-slate-400 hover:text-white">
          Cancel
        </button>
        <button onclick="window.csSecurity.confirmDispatch('${incidentId}')" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-lg">
          Confirm Dispatch
        </button>
      </div>
    </div>
  `;
}

export async function confirmDispatch(incidentId) {
  const selectedRadio = document.querySelector('input[name="selected_responder"]:checked');
  if (!selectedRadio) {
    showToast('Selection Required', 'Please select a responder unit.', 'warning');
    return;
  }

  const responderId = selectedRadio.value;
  try {
    const res = await api.patch(`/api/incidents/${incidentId}/assign`, {
      responderId,
      dispatchImmediately: true
    });
    if (res.success) {
      showToast('Responder Dispatched', `Unit successfully assigned and en route.`, 'success');
      document.getElementById('assign-responder-modal')?.remove();
      selectedIncident = res.incident;
      renderIncidentQueue();
      renderEmergencyDossier();
      loadResponders();
    }
  } catch (err) {
    showToast('Dispatch Failed', err.message, 'critical');
  }
}

export function openResolveModal(incidentId) {
  let modal = document.getElementById('resolve-incident-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'resolve-incident-modal';
    modal.className = 'fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md p-6 shadow-2xl">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-base font-bold text-white flex items-center gap-2">
          ✅ Resolve Emergency Incident
        </h3>
        <button onclick="document.getElementById('resolve-incident-modal').remove()" class="text-slate-400 hover:text-white">✕</button>
      </div>

      <p class="text-xs text-slate-400 mb-3">
        Record resolution summary and operational notes for Incident <strong class="text-cyan-400">${incidentId}</strong>:
      </p>

      <textarea id="resolution-notes-input" rows="3" placeholder="Explain how the emergency was resolved (medical aid rendered, student escorted, situation normalized, etc.)..." 
                class="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500 mb-4"></textarea>

      <div class="flex justify-end gap-2">
        <button onclick="document.getElementById('resolve-incident-modal').remove()" class="px-4 py-2 text-xs text-slate-400 hover:text-white">
          Cancel
        </button>
        <button onclick="window.csSecurity.confirmResolve('${incidentId}')" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg">
          Confirm Resolution
        </button>
      </div>
    </div>
  `;
}

export async function confirmResolve(incidentId) {
  const notes = document.getElementById('resolution-notes-input')?.value.trim() || 'Situation resolved by security team.';
  try {
    const res = await api.patch(`/api/incidents/${incidentId}/status`, {
      status: 'Resolved',
      resolutionNotes: notes
    });
    if (res.success) {
      showToast('Incident Resolved', `Incident ${incidentId} marked as resolved.`, 'success');
      document.getElementById('resolve-incident-modal')?.remove();
      selectedIncident = res.incident;
      renderIncidentQueue();
      renderEmergencyDossier();
      loadDashboardSummary();
      loadResponders();
    }
  } catch (err) {
    showToast('Resolution Failed', err.message, 'critical');
  }
}

let selectedVerifyClassification = 'Genuine Emergency';

// False Alarm Verification Modal
export function openVerifyModal(incidentId) {
  const inc = incidents.find((i) => i.incidentId === incidentId || i._id === incidentId) || selectedIncident;
  if (!inc) return;

  const currentClassification = inc.falseAlarmRecord?.classification || 'Genuine Emergency';
  selectedVerifyClassification = currentClassification;

  let modal = document.getElementById('verify-false-alarm-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'verify-false-alarm-modal';
    modal.className = 'fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4 overflow-y-auto';
    document.body.appendChild(modal);
  }

  const currentUser = getCurrentUser() || { name: 'Officer Raman', identifier: 'SEC-01' };

  modal.innerHTML = `
    <div class="bg-slate-900 border border-amber-500/50 rounded-2xl w-full max-w-xl p-6 shadow-2xl relative my-auto">
      <div class="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-amber-600/20 border border-amber-500 flex items-center justify-center text-xl">
            ⚖️
          </div>
          <div>
            <h3 class="text-sm font-black text-white uppercase tracking-wider">
              Security Incident & False Alarm Verification
            </h3>
            <p class="text-xs text-slate-400 font-mono">
              ${inc.incidentId} • Reporter: ${inc.reporter?.name || 'Student'} (${inc.reporter?.identifier || 'N/A'})
            </p>
          </div>
        </div>
        <button onclick="document.getElementById('verify-false-alarm-modal').remove()" class="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 text-sm">
          ✕
        </button>
      </div>

      <!-- Legal & Policy Safeguard Callout -->
      <div class="p-3 bg-blue-950/40 rounded-xl border border-blue-800/60 mb-4 text-xs text-blue-200">
        <div class="font-bold flex items-center gap-1.5 text-blue-300 mb-1">
          <span>🛡️</span> Institutional Policy Rules:
        </div>
        <p class="text-[11px] text-blue-200/90 leading-relaxed">
          Only incidents marked <strong>Verified Intentional False Alarm</strong> will increase the student's false alarm count. Genuine emergencies, accidental triggers, unresolved incidents, and unverified reports will <strong>never</strong> increase this count.
        </p>
      </div>

      <!-- 4 Classification Options -->
      <div class="space-y-2 mb-4">
        <label class="block text-xs font-bold text-slate-300">Select Verified Outcome:</label>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          
          <button type="button" onclick="window.csSecurity.selectVerifyOption('Genuine Emergency', this)"
                  class="verify-opt-btn p-3 rounded-xl border text-left transition flex flex-col gap-1 ${
                    selectedVerifyClassification === 'Genuine Emergency'
                      ? 'bg-emerald-950/80 border-emerald-500 text-white shadow-lg shadow-emerald-950/50'
                      : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                  }">
            <div class="flex items-center gap-2 font-bold text-xs text-emerald-400">
              <span>🟢</span> Genuine Emergency
            </div>
            <p class="text-[10px] text-slate-400">The emergency was legitimate. Aid rendered or situation stabilized.</p>
          </button>

          <button type="button" onclick="window.csSecurity.selectVerifyOption('False Alarm — Accidental', this)"
                  class="verify-opt-btn p-3 rounded-xl border text-left transition flex flex-col gap-1 ${
                    selectedVerifyClassification === 'False Alarm — Accidental'
                      ? 'bg-amber-950/80 border-amber-500 text-white shadow-lg shadow-amber-950/50'
                      : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                  }">
            <div class="flex items-center gap-2 font-bold text-xs text-amber-400">
              <span>🟡</span> False Alarm — Accidental
            </div>
            <p class="text-[10px] text-slate-400">SOS was triggered unintentionally (pocket press, misdial, device drop).</p>
          </button>

          <button type="button" onclick="window.csSecurity.selectVerifyOption('False Alarm — Intentional', this)"
                  class="verify-opt-btn p-3 rounded-xl border text-left transition flex flex-col gap-1 ${
                    selectedVerifyClassification === 'False Alarm — Intentional'
                      ? 'bg-rose-950/80 border-rose-500 text-white shadow-lg shadow-rose-950/50'
                      : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                  }">
            <div class="flex items-center gap-2 font-bold text-xs text-rose-400">
              <span>🔴</span> False Alarm — Intentional
            </div>
            <p class="text-[10px] text-slate-400">Student deliberately submitted a false emergency alert (prank, distraction).</p>
          </button>

          <button type="button" onclick="window.csSecurity.selectVerifyOption('Under Investigation', this)"
                  class="verify-opt-btn p-3 rounded-xl border text-left transition flex flex-col gap-1 ${
                    selectedVerifyClassification === 'Under Investigation'
                      ? 'bg-blue-950/80 border-blue-500 text-white shadow-lg shadow-blue-950/50'
                      : 'bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300'
                  }">
            <div class="flex items-center gap-2 font-bold text-xs text-blue-400">
              <span>🔵</span> Under Investigation
            </div>
            <p class="text-[10px] text-slate-400">Investigation pending CCTV review, witness statements, or interview.</p>
          </button>

        </div>
      </div>

      <!-- Investigation Details Form -->
      <div class="space-y-3 mb-4">
        <div>
          <label class="block text-xs font-bold text-slate-300 mb-1" id="investigation-notes-label">
            Investigation Notes <span id="notes-required-asterisk" class="${selectedVerifyClassification === 'False Alarm — Intentional' ? 'text-rose-400 font-bold' : 'text-slate-500'}">*</span>
          </label>
          <textarea id="verify-notes-input" rows="3" 
                    placeholder="Provide detailed findings explaining why this incident is classified as such (facts observed, statements, CCTV review)..."
                    class="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500">${inc.falseAlarmRecord?.investigationNotes || ''}</textarea>
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-300 mb-1">
            Supporting Evidence / Attachment References (Optional)
          </label>
          <input type="text" id="verify-evidence-input" 
                 placeholder="e.g. CCTV CAM-04 clip 14:22, Proctor signed memo #204, photo ref..." 
                 value="${inc.falseAlarmRecord?.evidenceReferences || ''}"
                 class="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500" />
        </div>

        <!-- Verification Metadata Footnote -->
        <div class="grid grid-cols-2 gap-2 p-3 bg-slate-950/60 rounded-xl border border-slate-800/80 text-[11px] text-slate-400">
          <div>
            <span class="text-slate-500 block">Security Personnel:</span>
            <strong class="text-slate-200">${currentUser.name}</strong> (${currentUser.identifier || 'SEC-OFFICER'})
          </div>
          <div>
            <span class="text-slate-500 block">Timestamp:</span>
            <span class="font-mono text-cyan-300">${new Date().toLocaleTimeString()} (Active Session)</span>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex justify-end gap-2 pt-2 border-t border-slate-800">
        <button onclick="document.getElementById('verify-false-alarm-modal').remove()" class="px-4 py-2 text-xs text-slate-400 hover:text-white">
          Cancel
        </button>
        <button onclick="window.csSecurity.confirmVerifyModal('${incidentId}')" class="px-5 py-2 bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-slate-950 font-black text-xs rounded-xl shadow-lg transition">
          Confirm Classification
        </button>
      </div>
    </div>
  `;
}

export function selectVerifyOption(classification, btnElement) {
  selectedVerifyClassification = classification;
  const allBtns = document.querySelectorAll('.verify-opt-btn');
  allBtns.forEach((b) => {
    b.className = 'verify-opt-btn p-3 rounded-xl border text-left transition flex flex-col gap-1 bg-slate-950 border-slate-800 hover:border-slate-700 text-slate-300';
  });

  const asterisk = document.getElementById('notes-required-asterisk');
  if (asterisk) {
    asterisk.className = classification === 'False Alarm — Intentional' ? 'text-rose-400 font-bold' : 'text-slate-500';
  }

  if (btnElement) {
    const colorMap = {
      'Genuine Emergency': 'bg-emerald-950/80 border-emerald-500 text-white shadow-lg shadow-emerald-950/50',
      'False Alarm — Accidental': 'bg-amber-950/80 border-amber-500 text-white shadow-lg shadow-amber-950/50',
      'False Alarm — Intentional': 'bg-rose-950/80 border-rose-500 text-white shadow-lg shadow-rose-950/50',
      'Under Investigation': 'bg-blue-950/80 border-blue-500 text-white shadow-lg shadow-blue-950/50'
    };
    btnElement.className = `verify-opt-btn p-3 rounded-xl border text-left transition flex flex-col gap-1 ${colorMap[classification] || ''}`;
  }
}

export async function confirmVerifyModal(incidentId) {
  const notes = document.getElementById('verify-notes-input')?.value.trim() || '';
  const evidence = document.getElementById('verify-evidence-input')?.value.trim() || '';

  if (selectedVerifyClassification === 'False Alarm — Intentional' && !notes) {
    showToast('Investigation Notes Required', 'You must provide detailed investigation notes explaining why this incident is an intentional false alarm.', 'critical');
    return;
  }

  try {
    const res = await api.post('/api/false-alarms/verify', {
      incidentId,
      classification: selectedVerifyClassification,
      investigationNotes: notes,
      evidenceReferences: evidence
    });

    if (res.success) {
      document.getElementById('verify-false-alarm-modal')?.remove();
      showToast(
        'Classification Recorded',
        `Incident [${incidentId}] verified as "${selectedVerifyClassification}".`,
        'success'
      );

      if (res.safetyStatus && res.safetyStatus.warningLevel === 'restricted') {
        showToast(
          'Automated Suspension Triggered',
          `Student has exceeded the false alarm threshold. SOS privileges automatically restricted and disciplinary case created.`,
          'critical'
        );
      } else if (res.safetyStatus && res.safetyStatus.warningLevel === 'final_warning') {
        showToast('Final Warning Issued', 'Student reached 3 confirmed false alarms. Account flagged for review.', 'warning');
      }

      await selectIncident(incidentId);
      await loadIncidents();
      await loadDashboardSummary();
    }
  } catch (err) {
    showToast('Verification Failed', err.message, 'critical');
  }
}

// Tactical Campus Map Interactive Visualization
export function renderCampusTacticalMap() {
  const canvas = document.getElementById('tactical-campus-map-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const w = (canvas.width = canvas.parentElement.clientWidth || 600);
  const h = (canvas.height = 360);

  // Background Tactical Grid
  ctx.fillStyle = '#070b14';
  ctx.fillRect(0, 0, w, h);

  // Draw grid lines
  ctx.strokeStyle = '#121c33';
  ctx.lineWidth = 1;
  const gridSize = 30;
  for (let x = 0; x < w; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y < h; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // Draw Campus Zones (Kongu Engineering College Landmarks)
  const zones = [
    { name: 'Admin Block', x: w * 0.18, y: h * 0.35, r: 40, color: '#1e3a5f' },
    { name: 'IT Park / CSE', x: w * 0.45, y: h * 0.3, r: 48, color: '#0f4c5c' },
    { name: 'Mechanical Science', x: w * 0.75, y: h * 0.28, r: 44, color: '#1e3a5f' },
    { name: 'Central Library', x: w * 0.32, y: h * 0.65, r: 42, color: '#2b3a4a' },
    { name: 'Food Court & Amenities', x: w * 0.58, y: h * 0.65, r: 38, color: '#2b3a4a' },
    { name: 'Hostel Blocks (A/B/C)', x: w * 0.82, y: h * 0.72, r: 45, color: '#1e293b' },
    { name: 'Main Gate & Circle', x: w * 0.12, y: h * 0.78, r: 35, color: '#334155' }
  ];

  // Draw Zone Polygons / Circles
  zones.forEach((z) => {
    ctx.beginPath();
    ctx.fillStyle = z.color;
    ctx.strokeStyle = '#2c4270';
    ctx.arc(z.x, z.y, z.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(z.name, z.x, z.y + 4);
  });

  // Plot Responders (Green Markers)
  responders.forEach((r, idx) => {
    const rx = w * (0.2 + (idx * 0.22) % 0.65);
    const ry = h * (0.25 + (idx * 0.18) % 0.55);

    ctx.beginPath();
    ctx.fillStyle = r.availabilityStatus === 'available' ? '#10b981' : '#3b82f6';
    ctx.arc(rx, ry, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillText(r.callSign, rx, ry - 10);
  });

  // Plot Active Incidents (Pulsing Red / Amber Markers)
  incidents
    .filter((i) => ['Submitted', 'Acknowledged', 'Assigned', 'Dispatched', 'On Scene'].includes(i.status))
    .forEach((inc, idx) => {
      // Map coordinates or distribute by zone
      const isSelected = selectedIncident && selectedIncident._id === inc._id;
      const ix = w * (0.3 + (idx * 0.28) % 0.5);
      const iy = h * (0.4 + (idx * 0.22) % 0.4);

      // Radar pulse ring
      ctx.beginPath();
      ctx.strokeStyle = inc.severity === 'critical' ? 'rgba(244, 63, 94, 0.6)' : 'rgba(245, 158, 11, 0.6)';
      ctx.lineWidth = 2;
      ctx.arc(ix, iy, isSelected ? 18 : 12, 0, Math.PI * 2);
      ctx.stroke();

      // Center dot
      ctx.beginPath();
      ctx.fillStyle = inc.severity === 'critical' ? '#f43f5e' : '#f59e0b';
      ctx.arc(ix, iy, 6, 0, Math.PI * 2);
      ctx.fill();

      // Label
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px "JetBrains Mono", monospace';
      ctx.fillText(`🚨 ${inc.incidentId}`, ix, iy + 18);
    });
}

// CCTV Surveillance Simulation Engine
export function initCctvFeed() {
  const timeEl = document.getElementById('cctv-hud-timestamp');
  const fpsEl = document.getElementById('cctv-hud-fps');
  
  setInterval(() => {
    if (timeEl) {
      timeEl.innerText = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    }
    if (fpsEl) {
      fpsEl.innerText = `${(29.8 + Math.random() * 0.4).toFixed(1)} FPS`;
    }
  }, 1000);
}

export function switchCctvCamera(camId) {
  activeCamera = camId;
  const label = document.getElementById('cctv-camera-name');
  if (label) {
    const camNames = {
      'CAM-01': 'CAM-01: Main Gate & Circle [PTZ OPTICAL]',
      'CAM-04': 'CAM-04: Admin Plaza / Quad [FIXED 4K]',
      'CAM-07': 'CAM-07: Hostel Block C Walkway [IR NIGHT VISION]',
      'CAM-12': 'CAM-12: Central Library Lawn [PTZ PANORAMA]'
    };
    label.innerText = camNames[camId] || camId;
  }
  showToast('CCTV Switched', `Active surveillance camera changed to ${camId}`, 'info');
}

// Filter helpers
export function setQueueFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.queue-filter-btn').forEach((btn) => {
    btn.classList.toggle('bg-cyan-600', btn.dataset.filter === filter);
    btn.classList.toggle('text-white', btn.dataset.filter === filter);
    btn.classList.toggle('bg-slate-800', btn.dataset.filter !== filter);
    btn.classList.toggle('text-slate-400', btn.dataset.filter !== filter);
  });
  renderIncidentQueue();
}

function getCategoryIcon(cat) {
  const map = {
    'Medical emergency': '🚑',
    'Harassment or personal safety concern': '⚠️',
    Theft: '💼',
    Accident: '💥',
    'Suspicious activity': '👁️',
    Fire: '🔥',
    Other: '🔔'
  };
  return map[cat] || '🚨';
}

function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// Window Global Export
window.csSecurity = {
  loadIncidents,
  loadDashboardSummary,
  selectIncident,
  acknowledgeAlert,
  openAssignModal,
  confirmDispatch,
  markOnScene,
  openResolveModal,
  confirmResolve,
  openVerifyModal,
  selectVerifyOption,
  confirmVerifyModal,
  addDispatchNote,
  toggleResponderStatus,
  switchCctvCamera,
  setQueueFilter,
  logout
};
