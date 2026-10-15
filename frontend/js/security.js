// CampusShield Security Personnel Command Center Controller
import { api, showToast } from './api.js';
import { initSocket, subscribe } from './socket.js';
import { getCurrentUser, initAuth, logout } from './auth.js';
import { initPushNotifications } from './pushNotification.js';

let incidents = [];
let selectedIncident = null;
let responders = [];
let currentFilter = 'ALL';

// DOM Initializer
document.addEventListener('DOMContentLoaded', async () => {
  await initAuth('security');
  await initSocket();
  await initPushNotifications();

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
      const existingFA = incidents[idx].falseAlarmRecord;
      incidents[idx] = { ...incidents[idx], ...updatedInc };
      if (!incidents[idx].falseAlarmRecord && existingFA) {
        incidents[idx].falseAlarmRecord = existingFA;
      }
    } else {
      incidents.unshift(updatedInc);
    }
    renderIncidentQueue();
    updateDashboardMetrics();
    renderCampusTacticalMap();
    if (selectedIncident && (selectedIncident.incidentId === updatedInc.incidentId || selectedIncident._id === updatedInc._id)) {
      const existingFA = selectedIncident.falseAlarmRecord;
      selectedIncident = { ...selectedIncident, ...updatedInc };
      if (!selectedIncident.falseAlarmRecord && existingFA) {
        selectedIncident.falseAlarmRecord = existingFA;
      }
      renderEmergencyDossier();
    }
  });

  subscribe('false_alarm:verified', (data) => {
    console.log('[CampusShield Security] Real-time false_alarm:verified:', data);
    if (!data) return;
    const targetId = data.incidentId || data.record?.incidentId;
    const record = data.record;

    const idx = incidents.findIndex((i) => i.incidentId === targetId || i._id === targetId);
    if (idx !== -1) {
      incidents[idx].falseAlarmRecord = record;
      if (['Genuine Emergency', 'False Alarm — Accidental', 'False Alarm — Intentional'].includes(record?.classification)) {
        incidents[idx].status = 'Resolved';
      }
    }

    if (selectedIncident && (selectedIncident.incidentId === targetId || selectedIncident._id === targetId)) {
      selectedIncident.falseAlarmRecord = record;
      if (['Genuine Emergency', 'False Alarm — Accidental', 'False Alarm — Intentional'].includes(record?.classification)) {
        selectedIncident.status = 'Resolved';
      }
      renderEmergencyDossier();
    }

    renderIncidentQueue();
    updateDashboardMetrics();
    loadDashboardSummary();
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

  // Stale-while-revalidate: Render cached queue immediately
  const cached = localStorage.getItem('cs_cached_all_incidents');
  if (cached && (!incidents || incidents.length === 0)) {
    try {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length > 0) {
        incidents = parsed;
        renderIncidentQueue();
        const stillSelected = selectedIncident && incidents.find(i => (i._id === selectedIncident._id || i.incidentId === selectedIncident.incidentId));
        if (stillSelected) {
          selectIncident(stillSelected._id || stillSelected.incidentId);
        } else {
          selectIncident(incidents[0]._id);
        }
      }
    } catch {}
  }

  try {
    const res = await api.get('/api/incidents');
    if (res.success && res.incidents) {
      incidents = res.incidents;
      localStorage.setItem('cs_cached_all_incidents', JSON.stringify(incidents));
      renderIncidentQueue();
      if (incidents.length > 0) {
        const stillSelected = selectedIncident && incidents.find(i => (i._id === selectedIncident._id || i.incidentId === selectedIncident.incidentId));
        if (stillSelected) {
          selectIncident(stillSelected._id || stillSelected.incidentId);
        } else {
          selectIncident(incidents[0]._id);
        }
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
    const timeAgo = formatTimeAgo(inc.reportedAt);

    const severityColor = {
      critical: 'text-red-700 bg-red-50 border-red-200',
      high: 'text-amber-800 bg-amber-50 border-amber-200',
      medium: 'text-amber-700 bg-amber-50 border-amber-200',
      low: 'text-emerald-700 bg-emerald-50 border-emerald-200'
    }[inc.severity] || 'text-blue-700 bg-blue-50 border-blue-200';

    const statusBadgeColor = {
      Submitted: 'text-red-700 bg-red-50 border-red-200 font-bold',
      Acknowledged: 'text-amber-700 bg-amber-50 border-amber-200',
      Assigned: 'text-blue-700 bg-blue-50 border-blue-200',
      Dispatched: 'text-indigo-700 bg-indigo-50 border-indigo-200',
      'On Scene': 'text-purple-700 bg-purple-50 border-purple-200',
      Resolved: 'text-emerald-700 bg-emerald-50 border-emerald-200',
      Cancelled: 'text-slate-600 bg-slate-100 border-slate-200'
    }[inc.status] || 'text-slate-600 bg-slate-100 border-slate-200';

    return `
      <div onclick="window.csSecurity.selectIncident('${inc._id}')" 
           class="p-3.5 rounded-xl border cursor-pointer transition-all ${
             isSelected
               ? 'bg-blue-50/70 border-blue-500 shadow-xs ring-1 ring-blue-500/30'
               : 'bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300'
           }">
        <div class="flex items-center justify-between gap-2 mb-1.5">
          <div class="flex items-center gap-1.5">
            <span class="font-mono text-xs font-bold text-slate-900">${inc.incidentId}</span>
            <span class="px-1.5 py-0.5 text-[10px] uppercase font-bold rounded border ${severityColor}">${inc.severity}</span>
          </div>
          <div class="flex items-center gap-1">
            ${
              inc.falseAlarmRecord
                ? `<span class="px-1.5 py-0.5 text-[9px] font-bold rounded border ${
                    inc.falseAlarmRecord.classification === 'Genuine Emergency'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : inc.falseAlarmRecord.classification === 'False Alarm — Accidental'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : inc.falseAlarmRecord.classification === 'False Alarm — Intentional'
                      ? 'bg-red-50 text-red-700 border-red-200'
                      : 'bg-blue-50 text-blue-700 border-blue-200'
                  }">⚖️ ${inc.falseAlarmRecord.classification.replace('False Alarm — ', 'FA: ')}</span>`
                : ''
            }
            <span class="px-2 py-0.5 text-[10px] font-bold rounded-full border ${statusBadgeColor}">${inc.status}</span>
          </div>
        </div>

        <div class="text-xs font-bold text-slate-900 line-clamp-1 mb-1">
          ${getCategoryIcon(inc.category)} ${inc.category}
        </div>

        <div class="flex items-center gap-1 text-xs text-slate-600 mb-2">
          <span class="text-blue-600 text-xs">📍</span>
          <span class="truncate">${inc.location?.campusLocation || 'Main Campus'}</span>
        </div>

        <div class="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100">
          <span>Reporter: <strong class="text-slate-800">${inc.reporter?.name || 'Anonymous'}</strong></span>
          <span class="font-mono text-slate-400">${timeAgo}</span>
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

  if (selectedIncident) {
    const coords = getIncidentCoordinates(selectedIncident);
    if (tacticalMap) tacticalMap.panTo(coords);
    if (fullMap) fullMap.panTo(coords);
  }

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
    <div class="p-5 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col gap-4">
      <!-- Dossier Header -->
      <div class="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs font-mono font-bold text-blue-700 px-2 py-0.5 rounded bg-blue-50 border border-blue-200">
              REPORT ${inc.incidentId}
            </span>
            <span class="text-xs uppercase font-bold px-2 py-0.5 rounded ${
              inc.severity === 'critical' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
            }">
              ${inc.severity} Priority
            </span>
            <span class="text-xs font-bold px-2 py-0.5 rounded-full ${
              inc.status === 'Resolved' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-blue-50 text-blue-700 border border-blue-200'
            }">
              Status: ${inc.status}
            </span>
          </div>
          <h2 class="text-lg font-bold text-slate-900 mt-2 flex items-center gap-2">
            ${getCategoryIcon(inc.category)} ${inc.category}
          </h2>
          <p class="text-xs text-slate-500 mt-0.5">Reported: ${timeFormatted}</p>
        </div>

        <!-- Primary Action Buttons -->
        <div class="flex flex-wrap items-center gap-2">
          ${
            inc.status === 'Submitted'
              ? `<button onclick="window.csSecurity.acknowledgeAlert('${inc.incidentId}')" class="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer">
                  ⚡ Acknowledge Alert
                </button>`
              : ''
          }
          ${
            inc.status !== 'Resolved'
              ? `<button onclick="window.csSecurity.openAssignModal('${inc.incidentId}')" class="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer">
                  🚔 Assign / Dispatch Unit
                </button>`
              : ''
          }
          ${
            ['Dispatched', 'Assigned'].includes(inc.status)
              ? `<button onclick="window.csSecurity.markOnScene('${inc.incidentId}')" class="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer">
                  📍 Mark On Scene
                </button>`
              : ''
          }
          ${
            inc.status !== 'Resolved'
              ? `<button onclick="window.csSecurity.openResolveModal('${inc.incidentId}')" class="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer">
                  ✅ Resolve Incident
                </button>`
              : ''
          }
          <button onclick="window.csSecurity.openVerifyModal('${inc.incidentId}')" class="px-3.5 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 font-bold text-xs rounded-xl border border-slate-300 transition flex items-center gap-1.5 cursor-pointer">
            ⚖️ Verify False Alarm
          </button>
        </div>
      </div>

      <!-- Lifecycle Progression Stepper -->
      <div class="p-3.5 bg-slate-50 rounded-xl border border-slate-200">
        <div class="text-[11px] uppercase tracking-wider text-slate-500 mb-2.5 flex items-center justify-between font-semibold">
          <span>Response Progression</span>
          <span class="text-blue-700 font-bold">${inc.status}</span>
        </div>
        <div class="grid grid-cols-5 gap-2">
          ${lifecycleSteps
            .map(
              (s, i) => `
            <div class="flex flex-col items-center text-center">
              <div class="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mb-1 border ${
                s.done
                  ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                  : 'bg-white text-slate-400 border-slate-300'
              }">
                ${s.done ? '✓' : i + 1}
              </div>
              <span class="text-[10px] font-medium ${s.done ? 'text-slate-900 font-bold' : 'text-slate-500'}">${s.name}</span>
            </div>
          `
            )
            .join('')}
        </div>
      </div>

      <!-- Reporter and Location Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <!-- Reporter Info Card -->
        <div class="p-3.5 bg-slate-50/70 rounded-xl border border-slate-200">
          <div class="text-xs font-bold uppercase text-slate-600 mb-2.5 flex items-center gap-1.5">
            <span>👤</span> Reporter Information
          </div>
          <div class="space-y-1.5 text-xs">
            <div class="flex justify-between">
              <span class="text-slate-500">Name:</span>
              <span class="font-bold text-slate-900">${inc.reporter?.name || 'Anonymous Student'}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Roll/Emp ID:</span>
              <span class="font-mono text-slate-800 font-semibold">${inc.reporter?.identifier || 'N/A'}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Phone:</span>
              <a href="tel:${inc.reporter?.phone}" class="font-mono text-blue-700 hover:underline font-bold">${inc.reporter?.phone || 'Not Provided'}</a>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Department:</span>
              <span class="text-slate-700">${inc.reporter?.department || 'Information Technology'}</span>
            </div>
          </div>
        </div>

        <!-- Location & Responder Card -->
        <div class="p-3.5 bg-slate-50/70 rounded-xl border border-slate-200">
          <div class="text-xs font-bold uppercase text-slate-600 mb-2.5 flex items-center gap-1.5">
            <span>📍</span> Location & Patrol Assignment
          </div>
          <div class="space-y-1.5 text-xs">
            <div class="flex justify-between">
              <span class="text-slate-500">Campus Location:</span>
              <span class="font-bold text-slate-900 text-right max-w-[200px]">${inc.location?.campusLocation || 'Main Campus'}</span>
            </div>
            ${inc.locationDetails ? `
            <div class="p-2 rounded-lg bg-white border border-slate-200 text-[11px] text-slate-700">
              <span class="text-slate-500 text-[10px] block uppercase font-semibold">Location Notes:</span>
              ${inc.locationDetails}
            </div>` : ''}
            <div class="flex items-center justify-between">
              <span class="text-slate-500">GPS Coordinates:</span>
              <div class="text-right">
                <span class="font-mono text-slate-800 font-semibold block text-[11px]">
                  ${
                    inc.location?.latitude && inc.location?.longitude
                      ? `${inc.location.latitude.toFixed(5)}, ${inc.location.longitude.toFixed(5)}`
                      : 'Manual Landmark'
                  }
                </span>
                ${
                  inc.location?.latitude && inc.location?.longitude
                    ? `<a href="https://www.google.com/maps?q=${inc.location.latitude},${inc.location.longitude}" target="_blank" rel="noopener noreferrer" class="text-[10px] text-blue-600 hover:underline flex items-center gap-1 justify-end font-medium">
                        Open in Google Maps ↗
                       </a>`
                    : ''
                }
              </div>
            </div>
            <div class="flex justify-between">
              <span class="text-slate-500">Assigned Unit:</span>
              <span class="font-bold text-blue-700">${assignedUnit}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Incident Description & Assistance Requirements -->
      <div class="p-3.5 bg-slate-50/50 rounded-xl border border-slate-200 space-y-2.5">
        <div>
          <div class="text-xs font-semibold uppercase text-slate-500 mb-1">Description:</div>
          <p class="text-xs text-slate-800 leading-relaxed">${inc.description || 'No additional narrative provided during emergency report.'}</p>
        </div>

        ${inc.requirements && inc.requirements.length > 0 ? `
          <div class="pt-2 border-t border-slate-200">
            <div class="text-xs uppercase text-slate-600 mb-1.5 font-bold flex items-center gap-1.5">
              <span>⚠️</span> Requested Assistance:
            </div>
            <div class="flex flex-wrap gap-1.5">
              ${inc.requirements.map(req => `
                <span class="px-2.5 py-0.5 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center gap-1">
                  <span>🚨</span> ${req}
                </span>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${
          inc.resolutionNotes
            ? `<div class="mt-2 pt-2 border-t border-slate-200 text-xs">
                <span class="text-emerald-700 font-bold">Resolution Notes: </span>
                <span class="text-slate-700">${inc.resolutionNotes}</span>
               </div>`
            : ''
        }
      </div>

      <!-- False Alarm Classification Card -->
      <div class="p-3.5 bg-slate-50/70 rounded-xl border border-slate-200">
        <div class="flex items-center justify-between mb-2">
          <div class="text-xs font-bold uppercase text-slate-700 flex items-center gap-1.5">
            <span>⚖️</span> False Alarm Verification Status
          </div>
          <button onclick="window.csSecurity.openVerifyModal('${inc.incidentId}')" class="text-xs font-bold text-blue-600 hover:underline cursor-pointer">
            ${inc.falseAlarmRecord ? 'Update Classification' : '+ Classify Incident'}
          </button>
        </div>
        ${
          inc.falseAlarmRecord
            ? `
            <div class="space-y-2 text-xs">
              <div class="flex flex-wrap items-center gap-2">
                <span class="px-2.5 py-0.5 rounded-full font-bold text-xs border ${
                  inc.falseAlarmRecord.classification === 'Genuine Emergency'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : inc.falseAlarmRecord.classification === 'False Alarm — Accidental'
                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                    : inc.falseAlarmRecord.classification === 'False Alarm — Intentional'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-blue-50 text-blue-700 border-blue-200'
                }">
                  ${inc.falseAlarmRecord.classification}
                </span>
                <span class="text-slate-500 text-[11px]">
                  Verified by: <strong class="text-slate-700">${inc.falseAlarmRecord.verifierName || 'Campus Security'}</strong>
                  • ${new Date(inc.falseAlarmRecord.verifiedAt || inc.falseAlarmRecord.createdAt).toLocaleDateString()}
                </span>
              </div>
              ${
                inc.falseAlarmRecord.investigationNotes
                  ? `<div class="bg-white p-2.5 rounded-lg border border-slate-200">
                      <span class="text-slate-500 font-semibold block text-[11px] mb-0.5">Investigation Findings:</span>
                      <p class="text-slate-800">${inc.falseAlarmRecord.investigationNotes}</p>
                    </div>`
                  : ''
              }
            </div>
            `
            : `
            <div class="p-2.5 bg-white rounded-lg border border-slate-200 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
              <div class="flex items-center gap-1.5">
                <span class="text-amber-600">⚠️</span>
                <span>Investigation classification pending (Genuine, Accidental, or Intentional False Alarm).</span>
              </div>
              <button onclick="window.csSecurity.openVerifyModal('${inc.incidentId}')" class="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-xs shadow-xs cursor-pointer">
                Classify Now
              </button>
            </div>
            `
        }
      </div>

      <!-- Dispatch Notes & Communication Trail -->
      <div class="space-y-2">
        <div class="flex items-center justify-between text-xs uppercase text-slate-500 font-bold">
          <span>Dispatch & Operational Notes (${inc.notes?.length || 0})</span>
        </div>
        
        <div class="max-h-36 overflow-y-auto space-y-2 pr-1">
          ${
            inc.notes && inc.notes.length > 0
              ? inc.notes
                  .map(
                    (n) => `
                <div class="p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                  <div class="flex items-center justify-between text-[10px] text-slate-500 mb-1">
                    <span class="font-bold text-slate-900">${n.authorName || 'Dispatcher'}</span>
                    <span class="font-mono">${new Date(n.createdAt).toLocaleTimeString()}</span>
                  </div>
                  <p class="text-slate-700">${n.text}</p>
                </div>
              `
                  )
                  .join('')
              : '<div class="text-xs text-slate-400 italic">No dispatch notes logged yet.</div>'
          }
        </div>

        <!-- Add Note Input -->
        <div class="flex gap-2 pt-1">
          <input type="text" id="dispatch-note-input" placeholder="Type dispatch note or responder update..." 
                 class="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-500" />
          <button onclick="window.csSecurity.addDispatchNote('${inc.incidentId}')" class="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl border border-slate-300 transition cursor-pointer">
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
    <div class="p-12 bg-white rounded-2xl border border-slate-200 text-center text-slate-500 shadow-xs">
      <div class="text-4xl mb-3">🛡️</div>
      <h3 class="text-base font-bold text-slate-800">No Incident Selected</h3>
      <p class="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
        Select an incident from the queue on the left to view reporter details, inspect coordinates, dispatch patrol units, or log notes.
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
      available: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      dispatched: 'bg-blue-50 text-blue-700 border-blue-200',
      busy: 'bg-amber-50 text-amber-700 border-amber-200',
      off_duty: 'bg-slate-100 text-slate-500 border-slate-200'
    }[r.availabilityStatus] || 'bg-slate-100 text-slate-600 border-slate-200';

    return `
      <div class="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between text-xs hover:border-slate-300 transition">
        <div>
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-slate-900 font-mono">${r.callSign}</span>
            <span class="text-[10px] text-slate-400">(${r.badgeNumber})</span>
          </div>
          <div class="text-[11px] text-slate-500 mt-0.5">${r.team}</div>
          <div class="text-[10px] text-blue-600 mt-0.5 font-medium">📍 ${r.lastKnownLocation?.campusZone || 'Patrol Unit'}</div>
        </div>

        <div class="flex flex-col items-end gap-1.5">
          <span class="px-2 py-0.5 text-[10px] font-bold rounded-full border ${statusColor} uppercase">${r.availabilityStatus}</span>
          <button onclick="window.csSecurity.toggleResponderStatus('${r._id}', '${r.availabilityStatus}')" 
                  class="text-[10px] text-blue-600 hover:text-blue-800 underline cursor-pointer font-medium">
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
    modal.className = 'fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4';
    document.body.appendChild(modal);
  }

  const availableUnits = responders.filter((r) => r.availabilityStatus !== 'off_duty');

  modal.innerHTML = `
    <div class="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-xl">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-base font-bold text-slate-900 flex items-center gap-2">
          🚔 Dispatch Security Unit
        </h3>
        <button onclick="document.getElementById('assign-responder-modal').remove()" class="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">✕</button>
      </div>

      <p class="text-xs text-slate-500 mb-4">
        Select an active patrol unit to dispatch to Incident <strong class="text-slate-800">${incidentId}</strong>:
      </p>

      <div class="space-y-2 max-h-60 overflow-y-auto mb-4">
        ${
          availableUnits.length > 0
            ? availableUnits
                .map(
                  (r) => `
              <label class="flex items-center justify-between p-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 cursor-pointer text-xs transition">
                <div>
                  <div class="font-bold text-slate-900 font-mono">${r.callSign} (${r.badgeNumber})</div>
                  <div class="text-[11px] text-slate-500">${r.team} • Active: ${r.activeIncidentCount || 0}</div>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-[10px] px-2 py-0.5 rounded-full border ${
                    r.availabilityStatus === 'available' ? 'bg-emerald-50 border-emerald-200 text-emerald-700 font-semibold' : 'bg-amber-50 border-amber-200 text-amber-700 font-semibold'
                  }">${r.availabilityStatus}</span>
                  <input type="radio" name="selected_responder" value="${r._id}" ${r.availabilityStatus === 'available' ? 'checked' : ''} />
                </div>
              </label>
            `
                )
                .join('')
            : '<p class="text-xs text-amber-700 bg-amber-50 p-3 rounded-lg border border-amber-200">No active response units currently on shift.</p>'
        }
      </div>

      <div class="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button onclick="document.getElementById('assign-responder-modal').remove()" class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer">
          Cancel
        </button>
        <button onclick="window.csSecurity.confirmDispatch('${incidentId}')" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer">
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
    modal.className = 'fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-xl">
      <div class="flex justify-between items-center mb-4">
        <h3 class="text-base font-bold text-slate-900 flex items-center gap-2">
          ✅ Resolve Emergency Incident
        </h3>
        <button onclick="document.getElementById('resolve-incident-modal').remove()" class="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">✕</button>
      </div>

      <p class="text-xs text-slate-500 mb-3">
        Record resolution summary and operational notes for Incident <strong class="text-slate-800">${incidentId}</strong>:
      </p>

      <textarea id="resolution-notes-input" rows="3" placeholder="Explain how the emergency was resolved (medical aid rendered, student escorted, situation normalized, etc.)..." 
                class="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-emerald-500 mb-4"></textarea>

      <div class="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button onclick="document.getElementById('resolve-incident-modal').remove()" class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer">
          Cancel
        </button>
        <button onclick="window.csSecurity.confirmResolve('${incidentId}')" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer">
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
    modal.className = 'fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto';
    document.body.appendChild(modal);
  }

  const currentUser = getCurrentUser() || { name: 'Officer Raman', identifier: 'SEC-01' };

  modal.innerHTML = `
    <div class="bg-white border border-slate-200 rounded-2xl w-full max-w-xl p-6 shadow-xl relative my-auto">
      <div class="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 flex items-center justify-center text-xl text-amber-700">
            ⚖️
          </div>
          <div>
            <h3 class="text-sm font-bold text-slate-900 uppercase tracking-wider">
              Security Incident & False Alarm Classification
            </h3>
            <p class="text-xs text-slate-500 font-mono">
              ${inc.incidentId} • Reporter: ${inc.reporter?.name || 'Student'} (${inc.reporter?.identifier || 'N/A'})
            </p>
          </div>
        </div>
        <button onclick="document.getElementById('verify-false-alarm-modal').remove()" class="text-slate-400 hover:text-slate-600 p-1 rounded-lg text-sm cursor-pointer">
          ✕
        </button>
      </div>

      <!-- Policy Callout -->
      <div class="p-3 bg-blue-50 rounded-xl border border-blue-200 mb-4 text-xs text-blue-900">
        <div class="font-bold flex items-center gap-1.5 text-blue-800 mb-1">
          <span>🛡️</span> Institutional Policy Rules:
        </div>
        <p class="text-[11px] text-blue-800/90 leading-relaxed">
          Only incidents marked <strong>Verified Intentional False Alarm</strong> will increase the student's false alarm count. Genuine emergencies and accidental triggers will <strong>never</strong> increase this count.
        </p>
      </div>

      <!-- 4 Classification Options -->
      <div class="space-y-2 mb-4">
        <label class="block text-xs font-bold text-slate-700">Select Verified Outcome:</label>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          
          <button type="button" onclick="window.csSecurity.selectVerifyOption('Genuine Emergency', this)"
                  class="verify-opt-btn p-3 rounded-xl border text-left transition flex flex-col gap-1 cursor-pointer ${
                    selectedVerifyClassification === 'Genuine Emergency'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-950 shadow-xs ring-1 ring-emerald-500/30'
                      : 'bg-slate-50 border-slate-200 hover:border-slate-300 text-slate-700'
                  }">
            <div class="flex items-center gap-1.5 font-bold text-xs text-emerald-700">
              <span>🟢</span> Genuine Emergency
            </div>
            <p class="text-[10px] text-slate-500">The emergency was legitimate. Aid rendered or situation stabilized.</p>
          </button>

          <button type="button" onclick="window.csSecurity.selectVerifyOption('False Alarm — Accidental', this)"
                  class="verify-opt-btn p-3 rounded-xl border text-left transition flex flex-col gap-1 cursor-pointer ${
                    selectedVerifyClassification === 'False Alarm — Accidental'
                      ? 'bg-amber-50 border-amber-500 text-amber-950 shadow-xs ring-1 ring-amber-500/30'
                      : 'bg-slate-50 border-slate-200 hover:border-slate-300 text-slate-700'
                  }">
            <div class="flex items-center gap-1.5 font-bold text-xs text-amber-700">
              <span>🟡</span> False Alarm — Accidental
            </div>
            <p class="text-[10px] text-slate-500">SOS was triggered unintentionally (pocket press, accidental tap).</p>
          </button>

          <button type="button" onclick="window.csSecurity.selectVerifyOption('False Alarm — Intentional', this)"
                  class="verify-opt-btn p-3 rounded-xl border text-left transition flex flex-col gap-1 cursor-pointer ${
                    selectedVerifyClassification === 'False Alarm — Intentional'
                      ? 'bg-red-50 border-red-500 text-red-950 shadow-xs ring-1 ring-red-500/30'
                      : 'bg-slate-50 border-slate-200 hover:border-slate-300 text-slate-700'
                  }">
            <div class="flex items-center gap-1.5 font-bold text-xs text-red-700">
              <span>🔴</span> False Alarm — Intentional
            </div>
            <p class="text-[10px] text-slate-500">Deliberately submitted a false emergency alert (prank, distraction).</p>
          </button>

          <button type="button" onclick="window.csSecurity.selectVerifyOption('Under Investigation', this)"
                  class="verify-opt-btn p-3 rounded-xl border text-left transition flex flex-col gap-1 cursor-pointer ${
                    selectedVerifyClassification === 'Under Investigation'
                      ? 'bg-blue-50 border-blue-500 text-blue-950 shadow-xs ring-1 ring-blue-500/30'
                      : 'bg-slate-50 border-slate-200 hover:border-slate-300 text-slate-700'
                  }">
            <div class="flex items-center gap-1.5 font-bold text-xs text-blue-700">
              <span>🔵</span> Under Investigation
            </div>
            <p class="text-[10px] text-slate-500">Pending further review, witness statements, or incident inquiry.</p>
          </button>

        </div>
      </div>

      <!-- Investigation Details Form -->
      <div class="space-y-3 mb-4">
        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1" id="investigation-notes-label">
            Investigation Notes <span id="notes-required-asterisk" class="${selectedVerifyClassification === 'False Alarm — Intentional' ? 'text-red-600 font-bold' : 'text-slate-400'}">*</span>
          </label>
          <textarea id="verify-notes-input" rows="3" 
                    placeholder="Provide detailed findings explaining why this incident is classified as such (facts observed, statements, etc.)..."
                    class="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-500">${inc.falseAlarmRecord?.investigationNotes || ''}</textarea>
        </div>

        <div>
          <label class="block text-xs font-bold text-slate-700 mb-1">
            Supporting Evidence References (Optional)
          </label>
          <input type="text" id="verify-evidence-input" 
                 placeholder="e.g. Duty log #204, CCTV clip ref, proctor memo..." 
                 value="${inc.falseAlarmRecord?.evidenceReferences || ''}"
                 class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-500" />
        </div>

        <!-- Verification Metadata -->
        <div class="grid grid-cols-2 gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-500">
          <div>
            <span class="block">Security Officer:</span>
            <strong class="text-slate-800">${currentUser.name}</strong> (${currentUser.identifier || 'SEC-OFFICER'})
          </div>
          <div>
            <span class="block">Timestamp:</span>
            <span class="font-mono text-slate-700">${new Date().toLocaleTimeString()} (Active Session)</span>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button onclick="document.getElementById('verify-false-alarm-modal').remove()" class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer">
          Cancel
        </button>
        <button onclick="window.csSecurity.confirmVerifyModal('${incidentId}')" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer">
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
    b.className = 'verify-opt-btn p-3 rounded-xl border text-left transition flex flex-col gap-1 cursor-pointer bg-slate-50 border-slate-200 hover:border-slate-300 text-slate-700';
  });

  const asterisk = document.getElementById('notes-required-asterisk');
  if (asterisk) {
    asterisk.className = classification === 'False Alarm — Intentional' ? 'text-red-600 font-bold' : 'text-slate-400';
  }

  if (btnElement) {
    const colorMap = {
      'Genuine Emergency': 'bg-emerald-50 border-emerald-500 text-emerald-950 shadow-xs ring-1 ring-emerald-500/30',
      'False Alarm — Accidental': 'bg-amber-50 border-amber-500 text-amber-950 shadow-xs ring-1 ring-amber-500/30',
      'False Alarm — Intentional': 'bg-red-50 border-red-500 text-red-950 shadow-xs ring-1 ring-red-500/30',
      'Under Investigation': 'bg-blue-50 border-blue-500 text-blue-950 shadow-xs ring-1 ring-blue-500/30'
    };
    btnElement.className = `verify-opt-btn p-3 rounded-xl border text-left transition flex flex-col gap-1 cursor-pointer ${colorMap[classification] || ''}`;
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

      // Immediately patch local state
      const target = incidents.find(i => i._id === incidentId || i.incidentId === incidentId);
      if (target) {
        target.falseAlarmRecord = res.record;
        if (['Genuine Emergency', 'False Alarm — Accidental', 'False Alarm — Intentional'].includes(selectedVerifyClassification)) {
          target.status = 'Resolved';
        }
      }
      if (selectedIncident && (selectedIncident._id === incidentId || selectedIncident.incidentId === incidentId)) {
        selectedIncident.falseAlarmRecord = res.record;
        if (['Genuine Emergency', 'False Alarm — Accidental', 'False Alarm — Intentional'].includes(selectedVerifyClassification)) {
          selectedIncident.status = 'Resolved';
        }
        renderEmergencyDossier();
      }
      renderIncidentQueue();

      await selectIncident(incidentId);
      await loadIncidents();
      await loadDashboardSummary();
    }
  } catch (err) {
    showToast('Verification Failed', err.message, 'critical');
  }
}

// =========================================================
// REAL TACTICAL CAMPUS MAP & FULL SITUATIONAL MAP ENGINE
// =========================================================

const KEC_CENTER = [11.2742, 77.6070];
const KEC_LANDMARKS = {
  'Admin Block': [11.2738, 77.6062],
  'IT Park / CSE': [11.2751, 77.6083],
  'Mechanical Science': [11.2745, 77.6095],
  'Central Library': [11.2735, 77.6078],
  'Food Court & Amenities': [11.2728, 77.6085],
  'Hostel Blocks (A/B/C)': [11.2762, 77.6055],
  'Main Gate & Circle': [11.2720, 77.6035],
  'Sports Complex': [11.2755, 77.6105]
};

// Mapbox Configuration for Security Command Center (Self-healing token)
const DEFAULT_MAPBOX_TOKEN = atob('cGsuZXlKMUlqb2ljM1Z0WVc1MGFEQXdOeUlzSW1FaU9pSmpiWFk0YVRWamNqY3dNMnh3TW5keloycHpiRE0yTlRKcUluMC5reVRJV1otY2luMXRUN3lodnJWa3ZR');

let securityMapboxToken = DEFAULT_MAPBOX_TOKEN;

async function getSecurityMapboxToken() {
  if (securityMapboxToken && securityMapboxToken !== '') return securityMapboxToken;
  try {
    const res = await fetch('/api/config/mapbox');
    if (res.ok) {
      const data = await res.json();
      if (data && data.token) {
        securityMapboxToken = data.token;
        return securityMapboxToken;
      }
    }
  } catch (e) {
    // fallback
  }
  return DEFAULT_MAPBOX_TOKEN;
}

export function getSecurityTileUrl(style = 'satellite') {
  // Ultra-reliable public map tiles (Never block Android WebViews, zero rate limits)
  if (style === 'satellite') {
    return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  }
  if (style === 'dark') {
    return 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
  }
  return 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
}

let tacticalMap = null;
let fullMap = null;
let tacticalTileLayer = null;
let fullTileLayer = null;
let currentTileStyle = 'satellite'; // 'satellite' | 'dark' | 'street'
let tacticalMarkers = [];
let fullMarkers = [];
let responderMapMarkers = [];

// Determine Exact Coordinates for Incident (GPS or Landmark)
function getIncidentCoordinates(inc) {
  if (inc.location && inc.location.latitude && inc.location.longitude) {
    return [parseFloat(inc.location.latitude), parseFloat(inc.location.longitude)];
  }

  // Check if campusLocation matches any predefined landmark
  const locName = inc.location?.campusLocation || '';
  for (const [key, coords] of Object.entries(KEC_LANDMARKS)) {
    if (locName.toLowerCase().includes(key.toLowerCase())) {
      return coords;
    }
  }

  // Stable pseudo-random distribution around KEC for uncoordinated alerts
  const idStr = inc.incidentId || inc._id || '0';
  const hash = idStr.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const offsetLat = ((hash % 100) - 50) * 0.00004;
  const offsetLng = (((hash * 7) % 100) - 50) * 0.00004;
  return [KEC_CENTER[0] + offsetLat, KEC_CENTER[1] + offsetLng];
}

// Initialize Leaflet Map Instances
async function initTacticalMaps() {
  if (typeof L === 'undefined') return;
  const token = await getSecurityMapboxToken();

  // 1. Right-Column Map in 3-Column Operations Console
  const tacticalContainer = document.getElementById('tactical-campus-map');
  if (tacticalContainer && !tacticalMap) {
    tacticalMap = L.map('tactical-campus-map', {
      center: KEC_CENTER,
      zoom: 17,
      zoomControl: true,
      attributionControl: false
    });

    tacticalTileLayer = L.tileLayer(getSecurityTileUrl(currentTileStyle), {
      maxZoom: 19,
      tileSize: 256,
      attribution: '© Esri © OpenStreetMap'
    }).addTo(tacticalMap);

    tacticalTileLayer.on('tileerror', function() {
      tacticalTileLayer.setUrl('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    });

    addCampusLandmarksToMap(tacticalMap);

    setTimeout(() => { if (tacticalMap) tacticalMap.invalidateSize(); }, 200);
    setTimeout(() => { if (tacticalMap) tacticalMap.invalidateSize(); }, 600);
  }

  // 2. Full Tactical Map Structure Command Deck
  const fullContainer = document.getElementById('full-tactical-campus-map');
  if (fullContainer && !fullMap) {
    fullMap = L.map('full-tactical-campus-map', {
      center: KEC_CENTER,
      zoom: 17,
      zoomControl: true,
      attributionControl: false
    });

    fullTileLayer = L.tileLayer(getSecurityTileUrl(currentTileStyle), {
      maxZoom: 19,
      tileSize: 256,
      attribution: '© Esri © OpenStreetMap'
    }).addTo(fullMap);

    fullTileLayer.on('tileerror', function() {
      fullTileLayer.setUrl('https://tile.openstreetmap.org/{z}/{x}/{y}.png');
    });

    addCampusLandmarksToMap(fullMap);

    setTimeout(() => { if (fullMap) fullMap.invalidateSize(); }, 200);
    setTimeout(() => { if (fullMap) fullMap.invalidateSize(); }, 600);
  }
}

// Add subtle circular zones for Campus Landmarks
function addCampusLandmarksToMap(mapInstance) {
  if (!mapInstance) return;

  Object.entries(KEC_LANDMARKS).forEach(([name, coords]) => {
    L.circle(coords, {
      radius: 40,
      color: '#06b6d4',
      weight: 1,
      fillColor: '#1e3a5f',
      fillOpacity: 0.15
    }).addTo(mapInstance);
  });
}

// Render Real Tactical Pins & Live Telemetry
export function renderCampusTacticalMap() {
  initTacticalMaps();

  // Clear previous markers
  tacticalMarkers.forEach((m) => m.remove());
  fullMarkers.forEach((m) => m.remove());
  responderMapMarkers.forEach((m) => m.remove());
  tacticalMarkers = [];
  fullMarkers = [];
  responderMapMarkers = [];

  const activeIncidents = incidents.filter((i) =>
    ['Submitted', 'Acknowledged', 'Assigned', 'Dispatched', 'On Scene'].includes(i.status)
  );

  // Update Full Map Incident Drawer Counters
  const countBadge = document.getElementById('fullmap-incident-count');
  if (countBadge) {
    countBadge.innerText = `${activeIncidents.length} ACTIVE`;
  }

  const listContainer = document.getElementById('fullmap-incidents-list');
  if (listContainer) {
    if (activeIncidents.length === 0) {
      listContainer.innerHTML = `
        <div class="p-4 text-center text-xs text-slate-500 font-mono">
          <span class="text-emerald-400">● ALL ZONES CLEAR</span>
          <p class="mt-1 text-[11px]">No active emergency distress signals on campus.</p>
        </div>
      `;
    } else {
      listContainer.innerHTML = activeIncidents
        .map((inc) => {
          const coords = getIncidentCoordinates(inc);
          const icon = getCategoryIcon(inc.category);
          const isCritical = inc.severity === 'critical' || inc.status === 'Submitted';
          const isSelected = selectedIncident && (selectedIncident._id === inc._id || selectedIncident.incidentId === inc.incidentId);

          return `
            <div onclick="window.csSecurity.flyToIncident('${inc._id}')" 
                 class="tactical-card p-2.5 rounded-xl border ${isSelected ? 'border-cyan-500 bg-cyan-950/40' : isCritical ? 'border-rose-900/80 bg-rose-950/20' : 'border-slate-800 bg-slate-900/60'} hover:border-cyan-500 cursor-pointer transition">
              <div class="flex items-center justify-between">
                <span class="text-xs font-mono font-bold ${isCritical ? 'text-rose-400' : 'text-amber-400'} flex items-center gap-1">
                  <span>${icon}</span> ${inc.incidentId}
                </span>
                <span class="text-[10px] font-mono px-1.5 py-0.5 rounded ${isCritical ? 'bg-rose-900/60 text-rose-300' : 'bg-amber-900/60 text-amber-300'} font-bold">
                  ${inc.status}
                </span>
              </div>
              <div class="text-xs font-semibold text-white mt-1 truncate">
                ${inc.category}
              </div>
              <div class="text-[11px] text-slate-400 truncate flex items-center gap-1 mt-0.5 font-mono">
                <span>📍</span> ${inc.location?.campusLocation || 'Kongu Campus'}
              </div>
              <div class="flex items-center justify-between text-[10px] text-slate-500 font-mono mt-1.5 pt-1.5 border-t border-slate-800/80">
                <span>${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}</span>
                <span class="text-cyan-400">Fly to Pin →</span>
              </div>
            </div>
          `;
        })
        .join('');
    }
  }

  // Plot Active Incidents on both Maps
  activeIncidents.forEach((inc) => {
    const coords = getIncidentCoordinates(inc);
    const icon = getCategoryIcon(inc.category);
    const isCritical = inc.severity === 'critical' || inc.status === 'Submitted';
    const isSelected = selectedIncident && (selectedIncident._id === inc._id || selectedIncident.incidentId === inc.incidentId);

    // Custom Tactical DivIcon
    const pinHtml = `
      <div class="custom-tactical-pin">
        <div class="absolute w-10 h-10 -top-2 -left-2 rounded-full ${isCritical ? 'bg-rose-600/50' : 'bg-amber-500/40'} ${isCritical ? 'radar-ping-fast' : 'radar-ping'} pointer-events-none"></div>
        <div class="w-8 h-8 rounded-full ${isCritical ? 'bg-rose-600 border-2 border-white' : 'bg-amber-500 border-2 border-amber-200'} flex items-center justify-center text-sm shadow-xl font-bold ${isSelected ? 'scale-125 ring-4 ring-cyan-400' : ''} transition">
          ${icon}
        </div>
      </div>
    `;

    const markerIcon = L.divIcon({
      className: 'custom-tactical-pin-wrapper',
      html: pinHtml,
      iconSize: [32, 32],
      iconAnchor: [16, 16]
    });

    const studentName = inc.reporter?.name || 'Anonymous Student';
    const studentPhone = inc.reporter?.phone || '';
    const phoneLink = studentPhone ? `<a href="tel:${studentPhone}" class="text-cyan-400 underline font-mono font-bold">${studentPhone}</a>` : '<span class="text-slate-500">Unspecified</span>';
    const mapsUrl = `https://www.google.com/maps?q=${coords[0]},${coords[1]}`;

    const popupHtml = `
      <div class="p-3 font-sans min-w-[240px] max-w-[300px]">
        <div class="flex items-center justify-between pb-2 border-b border-slate-700/80 mb-2">
          <span class="text-xs font-mono font-bold ${isCritical ? 'text-rose-400' : 'text-amber-400'} flex items-center gap-1">
            <span>${icon}</span> ${inc.incidentId}
          </span>
          <span class="text-[10px] font-mono px-2 py-0.5 rounded font-bold uppercase ${isCritical ? 'bg-rose-950 text-rose-300 border border-rose-800' : 'bg-amber-950 text-amber-300 border border-amber-800'}">
            ${inc.status}
          </span>
        </div>
        <div class="text-xs font-bold text-white mb-1">${inc.category}</div>
        <div class="text-[11px] text-slate-300 space-y-1 font-mono mb-3">
          <div>👤 Reporter: <strong class="text-white">${studentName}</strong></div>
          <div>📞 Contact: ${phoneLink}</div>
          <div>📍 Location: <strong class="text-cyan-300">${inc.location?.campusLocation || 'Kongu Campus'}</strong></div>
          <div>🛰️ GPS: <span class="text-slate-400">${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}</span></div>
          <div>⏱️ Reported: <span class="text-slate-400">${formatTimeAgo(inc.reportedAt)}</span></div>
        </div>
        <div class="flex items-center gap-2 pt-2 border-t border-slate-800">
          <button onclick="window.csSecurity.selectIncident('${inc._id}')" class="flex-1 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-bold text-center cursor-pointer transition">
            📋 Dossier
          </button>
          <a href="${mapsUrl}" target="_blank" class="py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-cyan-300 rounded-lg text-xs font-mono font-bold text-center transition flex items-center gap-1">
            <span>🧭</span> Nav
          </a>
        </div>
      </div>
    `;

    // Add to Tactical Map
    if (tacticalMap) {
      const tm = L.marker(coords, { icon: markerIcon }).addTo(tacticalMap);
      tm.bindPopup(popupHtml, { className: 'tactical-popup' });
      tacticalMarkers.push(tm);
      if (isSelected) {
        tm.openPopup();
      }
    }

    // Add to Full Tactical Map
    if (fullMap) {
      const fm = L.marker(coords, { icon: markerIcon }).addTo(fullMap);
      fm.bindPopup(popupHtml, { className: 'tactical-popup' });
      fullMarkers.push(fm);
      if (isSelected) {
        fm.openPopup();
      }
    }
  });

  // Plot Responders on Maps
  const fleetMiniList = document.getElementById('fullmap-fleet-mini-list');
  if (fleetMiniList) {
    fleetMiniList.innerHTML = responders
      .map(
        (r) => `
        <div class="flex items-center justify-between py-0.5 border-b border-slate-800/60 last:border-0">
          <span class="text-white font-bold flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full ${r.availabilityStatus === 'available' ? 'bg-emerald-400' : 'bg-cyan-400'}"></span>
            ${r.callSign}
          </span>
          <span class="text-[10px] uppercase font-mono ${r.availabilityStatus === 'available' ? 'text-emerald-400' : 'text-cyan-400'}">
            ${r.availabilityStatus}
          </span>
        </div>
      `
      )
      .join('');
  }

  responders.forEach((r, idx) => {
    // Generate deterministic patrol locations around campus
    const pLat = KEC_CENTER[0] + (idx % 2 === 0 ? 0.0012 : -0.001) + idx * 0.0003;
    const pLng = KEC_CENTER[1] + (idx % 2 === 1 ? 0.0015 : -0.0012) + idx * 0.0002;

    const responderIcon = L.divIcon({
      className: 'custom-responder-pin',
      html: `
        <div class="flex flex-col items-center">
          <div class="w-6 h-6 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center text-xs shadow-md font-bold text-black">
            🚔
          </div>
          <span class="bg-black/90 text-emerald-300 font-mono text-[9px] px-1 rounded border border-emerald-800 font-bold mt-0.5 whitespace-nowrap">
            ${r.callSign}
          </span>
        </div>
      `,
      iconSize: [40, 36],
      iconAnchor: [20, 18]
    });

    const rPopup = `
      <div class="p-2.5 font-sans min-w-[180px]">
        <div class="text-xs font-mono font-bold text-emerald-400 flex items-center gap-1">
          <span>🚔</span> ${r.callSign}
        </div>
        <div class="text-[11px] text-white font-bold mt-0.5">${r.name}</div>
        <div class="text-[10px] text-slate-400 font-mono mt-1">Status: <strong class="text-emerald-300 uppercase">${r.availabilityStatus}</strong></div>
      </div>
    `;

    if (tacticalMap) {
      const rm = L.marker([pLat, pLng], { icon: responderIcon }).addTo(tacticalMap);
      rm.bindPopup(rPopup, { className: 'tactical-popup' });
      responderMapMarkers.push(rm);
    }

    if (fullMap) {
      const rm = L.marker([pLat, pLng], { icon: responderIcon }).addTo(fullMap);
      rm.bindPopup(rPopup, { className: 'tactical-popup' });
      responderMapMarkers.push(rm);
    }
  });
}

// Switch between 3-Column Operations Console and Full Tactical Map View
export function switchView(viewName) {
  const opsView = document.getElementById('operations-center-view');
  const fullMapView = document.getElementById('full-map-view-container');
  const tabOps = document.getElementById('view-tab-operations');
  const tabFull = document.getElementById('view-tab-fullmap');

  if (viewName === 'fullmap') {
    if (opsView) opsView.classList.add('hidden');
    if (fullMapView) fullMapView.classList.remove('hidden');

    if (tabOps) {
      tabOps.className = 'px-4 py-2 text-xs font-semibold rounded-lg text-slate-600 hover:text-slate-900 hover:bg-white/60 flex items-center gap-2 transition cursor-pointer';
    }
    if (tabFull) {
      tabFull.className = 'px-4 py-2 text-xs font-bold rounded-lg bg-white text-blue-700 shadow-xs border border-slate-200/80 flex items-center gap-2 transition cursor-pointer';
    }

    initTacticalMaps();
    setTimeout(() => {
      fullMap?.invalidateSize();
      renderCampusTacticalMap();
    }, 150);
  } else {
    if (fullMapView) fullMapView.classList.add('hidden');
    if (opsView) opsView.classList.remove('hidden');

    if (tabOps) {
      tabOps.className = 'px-4 py-2 text-xs font-bold rounded-lg bg-white text-blue-700 shadow-xs border border-slate-200/80 flex items-center gap-2 transition cursor-pointer';
    }
    if (tabFull) {
      tabFull.className = 'px-4 py-2 text-xs font-semibold rounded-lg text-slate-600 hover:text-slate-900 hover:bg-white/60 flex items-center gap-2 transition cursor-pointer';
    }

    setTimeout(() => {
      tacticalMap?.invalidateSize();
      renderCampusTacticalMap();
    }, 150);
  }
}

// Recenter Map Controls
export function recenterMap() {
  if (tacticalMap) {
    tacticalMap.flyTo(KEC_CENTER, 17, { duration: 1 });
  }
}

export function recenterFullMap() {
  if (fullMap) {
    fullMap.flyTo(KEC_CENTER, 17, { duration: 1 });
  }
}

// Focus Highest Priority Active Emergency
export function focusActiveEmergency() {
  const active = incidents.find((i) =>
    ['Submitted', 'Acknowledged', 'Assigned'].includes(i.status)
  );
  if (active && tacticalMap) {
    const coords = getIncidentCoordinates(active);
    tacticalMap.flyTo(coords, 18, { duration: 1 });
    selectIncident(active._id || active.incidentId);
  } else {
    showToast('Notice', 'No active emergency in queue to focus.', 'info');
  }
}

export function focusActiveEmergencyFull() {
  const active = incidents.find((i) =>
    ['Submitted', 'Acknowledged', 'Assigned'].includes(i.status)
  );
  if (active && fullMap) {
    const coords = getIncidentCoordinates(active);
    fullMap.flyTo(coords, 18, { duration: 1 });
    selectIncident(active._id || active.incidentId);
  } else {
    showToast('Notice', 'No active emergency in queue to focus.', 'info');
  }
}

// Fly to specific incident pin from HUD drawer or list
export function flyToIncident(id) {
  const inc = incidents.find((i) => i._id === id || i.incidentId === id);
  if (!inc) return;

  const coords = getIncidentCoordinates(inc);
  if (fullMap) {
    fullMap.flyTo(coords, 18, { duration: 1.2 });
  }
  if (tacticalMap) {
    tacticalMap.flyTo(coords, 18, { duration: 1.2 });
  }
  selectIncident(inc._id || inc.incidentId);
}

// Toggle Mapbox Satellite HD vs Tactical Dark vs Street Map
export async function toggleMapTileLayer() {
  const styles = ['satellite', 'dark', 'street'];
  const nextIdx = (styles.indexOf(currentTileStyle) + 1) % styles.length;
  currentTileStyle = styles[nextIdx];

  const token = await getSecurityMapboxToken();
  if (tacticalTileLayer) {
    tacticalTileLayer.setUrl(getSecurityTileUrl(currentTileStyle, token));
  }
  if (fullTileLayer) {
    fullTileLayer.setUrl(getSecurityTileUrl(currentTileStyle, token));
  }

  const btn = document.getElementById('tile-toggle-btn');
  if (btn) {
    if (currentTileStyle === 'satellite') {
      btn.innerHTML = '<span>🛰️</span> Satellite HD';
    } else if (currentTileStyle === 'dark') {
      btn.innerHTML = '<span>🌙</span> Night Mode';
    } else {
      btn.innerHTML = '<span>🗺️</span> Street Map';
    }
  }
  showToast('Map Layer', `Map Layer: ${currentTileStyle.toUpperCase()}`, 'info');
}

// Filter helpers
export function setQueueFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.queue-filter-btn').forEach((btn) => {
    btn.classList.toggle('bg-blue-600', btn.dataset.filter === filter);
    btn.classList.toggle('text-white', btn.dataset.filter === filter);
    btn.classList.toggle('shadow-xs', btn.dataset.filter === filter);
    btn.classList.toggle('bg-slate-100', btn.dataset.filter !== filter);
    btn.classList.toggle('text-slate-600', btn.dataset.filter !== filter);
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
  setQueueFilter,
  renderCampusTacticalMap,
  switchView,
  recenterMap,
  recenterFullMap,
  focusActiveEmergency,
  focusActiveEmergencyFull,
  flyToIncident,
  toggleMapTileLayer,
  logout
};
