// CampusShield Administrator & System Health Controller
import { api, showToast } from './api.js';
import { initSocket, subscribe } from './socket.js';
import { getCurrentUser, initAuth, logout } from './auth.js';
import { initPushNotifications } from './pushNotification.js';

let allUsers = [];
let auditLogs = [];
let adminStats = null;

document.addEventListener('DOMContentLoaded', async () => {
  await initAuth('admin');
  await initSocket();
  await initPushNotifications();

  const user = getCurrentUser();
  if (!user || user.role !== 'admin') {
    showToast('Administrator Portal', 'You need an Administrator account to access administrative controls. Switch to Demo Admin.', 'warning');
  }

  const logoutBtn = document.getElementById('auth-logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      logout();
    });
  }

  subscribe('incident:created', () => {
    loadAdminDashboard();
    loadFalseAlarmStats();
  });

  subscribe('false_alarm:verified', () => {
    loadFalseAlarmStats();
    loadStudentSafetyRecords();
    loadAuditLogs();
  });

  subscribe('safety_status:updated', () => {
    loadFalseAlarmStats();
    loadStudentSafetyRecords();
  });

  subscribe('disciplinary_case:created', () => {
    loadFalseAlarmStats();
    loadDisciplinaryCases();
    loadStudentSafetyRecords();
  });

  subscribe('disciplinary_case:updated', () => {
    loadFalseAlarmStats();
    loadDisciplinaryCases();
    loadStudentSafetyRecords();
  });

  await Promise.all([
    loadAdminDashboard(),
    loadFalseAlarmStats(),
    loadStudentSafetyRecords(),
    loadDisciplinaryCases(),
    loadUsers(),
    loadAuditLogs(),
    loadEmergencyContactsAdmin()
  ]);
});

// Load Admin Dashboard Metrics & Trends
export async function loadAdminDashboard() {
  const cached = localStorage.getItem('cs_cached_admin_summary');
  if (cached && !adminStats) {
    try {
      adminStats = JSON.parse(cached);
      renderAdminMetricCards(adminStats);
    } catch {}
  }

  try {
    const [summaryRes, trendsRes, healthRes] = await Promise.all([
      api.get('/api/dashboard/summary'),
      api.get('/api/dashboard/incident-trends'),
      api.get('/api/health')
    ]);

    if (summaryRes.success && summaryRes.summary) {
      adminStats = summaryRes.summary;
      localStorage.setItem('cs_cached_admin_summary', JSON.stringify(adminStats));
      renderAdminMetricCards(adminStats);
    }

    if (trendsRes.success && trendsRes.trends) {
      renderCategoryDistribution(trendsRes.trends.categoryDistribution || []);
      renderSeverityDistribution(trendsRes.trends.severityDistribution || []);
    }

    if (healthRes) {
      const dbStatusEl = document.getElementById('admin-db-status');
      const uptimeEl = document.getElementById('admin-uptime-status');
      if (dbStatusEl) {
        dbStatusEl.innerHTML = healthRes.dbConnected
          ? '<span class="text-emerald-400 font-bold">ONLINE (MongoDB Connected)</span>'
          : '<span class="text-rose-400 font-bold">DISCONNECTED</span>';
      }
      if (uptimeEl) {
        const hrs = Math.floor(healthRes.uptimeSeconds / 3600);
        const mins = Math.floor((healthRes.uptimeSeconds % 3600) / 60);
        uptimeEl.innerText = `${hrs}h ${mins}m running`;
      }
    }
  } catch (err) {
    console.warn('[CampusShield Admin] Stats loading failed:', err.message);
  }
}

function renderAdminMetricCards(stats) {
  const elTotal = document.getElementById('admin-stat-total');
  const elActive = document.getElementById('admin-stat-active');
  const elCritical = document.getElementById('admin-stat-critical');
  const elResolved = document.getElementById('admin-stat-resolved');
  const elAvgResp = document.getElementById('admin-stat-avg-resp');
  const elUsers = document.getElementById('admin-stat-users');

  if (elTotal) elTotal.innerText = stats.totalIncidents;
  if (elActive) elActive.innerText = stats.activeIncidents;
  if (elCritical) elCritical.innerText = stats.criticalIncidents;
  if (elResolved) elResolved.innerText = stats.resolvedIncidents;
  if (elAvgResp) elAvgResp.innerText = `${stats.avgResponseTimeMinutes} min`;
  if (elUsers) elUsers.innerText = stats.totalUsers;
}

function renderCategoryDistribution(categories) {
  const container = document.getElementById('admin-category-chart-container');
  if (!container) return;

  if (categories.length === 0) {
    container.innerHTML = '<div class="text-xs text-slate-500 italic">No incident data yet.</div>';
    return;
  }

  const max = Math.max(...categories.map((c) => c.count), 1);

  container.innerHTML = categories.map((cat) => {
    const pct = Math.round((cat.count / max) * 100);
    return `
      <div class="space-y-1 text-xs">
        <div class="flex justify-between text-slate-700 font-medium">
          <span>${cat.category}</span>
          <span class="font-mono text-blue-700 font-bold">${cat.count}</span>
        </div>
        <div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
          <div class="h-full bg-blue-600 rounded-full transition-all duration-500" style="width: ${pct}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderSeverityDistribution(severities) {
  const container = document.getElementById('admin-severity-chart-container');
  if (!container) return;

  container.innerHTML = severities.map((s) => `
    <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center">
      <div class="text-xs uppercase font-semibold text-slate-500 mb-1">${s.severity}</div>
      <div class="text-lg font-bold text-slate-900 font-mono">${s.count}</div>
    </div>
  `).join('');
}

// User Management
export async function loadUsers() {
  const container = document.getElementById('admin-users-table-body');
  if (!container) return;

  try {
    const res = await api.get('/api/admin/users');
    if (res.success && res.users) {
      allUsers = res.users;
      renderUsersTable();
    }
  } catch (err) {
    console.warn('[CampusShield Admin] User loading error:', err.message);
  }
}

export function renderUsersTable() {
  const container = document.getElementById('admin-users-table-body');
  if (!container) return;

  const search = (document.getElementById('admin-user-search')?.value || '').toLowerCase();
  const roleFilter = document.getElementById('admin-user-role-filter')?.value || '';

  const filtered = allUsers.filter((u) => {
    if (roleFilter && u.role !== roleFilter) return false;
    if (search) {
      const matchName = u.name.toLowerCase().includes(search);
      const matchEmail = u.email.toLowerCase().includes(search);
      const matchId = (u.identifier || '').toLowerCase().includes(search);
      if (!matchName && !matchEmail && !matchId) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="5" class="p-6 text-center text-slate-500 text-xs">No matching users found.</td>
      </tr>
    `;
    return;
  }

  container.innerHTML = filtered.map((u) => `
    <tr class="border-b border-slate-200 hover:bg-slate-50 text-xs transition">
      <td class="p-3.5">
        <div class="font-bold text-slate-900">${u.name}</div>
        <div class="text-[11px] text-slate-500 font-mono">${u.email}</div>
      </td>
      <td class="p-3.5 font-mono text-slate-700">${u.identifier || '—'}</td>
      <td class="p-3.5">
        <select onchange="window.csAdmin.updateRole('${u._id}', this.value)" 
                class="bg-white border border-slate-300 rounded-lg px-2.5 py-1 text-xs text-slate-800 font-medium">
          <option value="student" ${u.role === 'student' ? 'selected' : ''}>Student</option>
          <option value="faculty" ${u.role === 'faculty' ? 'selected' : ''}>Faculty</option>
          <option value="security" ${u.role === 'security' ? 'selected' : ''}>Security</option>
          <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
      </td>
      <td class="p-3.5">
        <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${
          u.accountStatus === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'
        }">${u.accountStatus}</span>
      </td>
      <td class="p-3.5 text-right">
        <button onclick="window.csAdmin.toggleUserStatus('${u._id}', '${u.accountStatus}')" 
                class="px-2.5 py-1 text-xs border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-700 font-medium cursor-pointer transition">
          ${u.accountStatus === 'active' ? 'Suspend' : 'Activate'}
        </button>
      </td>
    </tr>
  `).join('');
}

export async function updateRole(userId, newRole) {
  try {
    const res = await api.patch(`/api/admin/users/${userId}/role`, { role: newRole });
    if (res.success) {
      showToast('Role Updated', res.message, 'success');
      await loadUsers();
    }
  } catch (err) {
    showToast('Update Failed', err.message, 'critical');
    loadUsers();
  }
}

export async function toggleUserStatus(userId, currentStatus) {
  const nextStatus = currentStatus === 'active' ? 'suspended' : 'active';
  try {
    const res = await api.patch(`/api/admin/users/${userId}/status`, { accountStatus: nextStatus });
    if (res.success) {
      showToast('Status Updated', `User account status set to ${nextStatus}.`, 'info');
      await loadUsers();
    }
// User Onboarding (Admin Only)
export function openAddUserModal() {
  const modal = document.getElementById('add-user-modal');
  const alertBox = document.getElementById('add-user-alert');
  if (alertBox) {
    alertBox.className = 'hidden';
    alertBox.innerHTML = '';
  }
  if (modal) modal.classList.remove('hidden');
}

export function closeAddUserModal() {
  const modal = document.getElementById('add-user-modal');
  if (modal) modal.classList.add('hidden');
}

export async function submitAddUser(e) {
  if (e) e.preventDefault();
  const alertBox = document.getElementById('add-user-alert');
  const submitBtn = document.getElementById('add-user-submit-btn');
  const btnText = document.getElementById('add-user-btn-text');
  const spinner = document.getElementById('add-user-spinner');

  const name = document.getElementById('new-user-name')?.value?.trim();
  const email = document.getElementById('new-user-email')?.value?.trim();
  const role = document.getElementById('new-user-role')?.value || 'student';
  const identifier = document.getElementById('new-user-identifier')?.value?.trim();
  const phone = document.getElementById('new-user-phone')?.value?.trim();
  const department = document.getElementById('new-user-dept')?.value?.trim();
  const password = document.getElementById('new-user-pwd')?.value;

  if (!name || !email || !password) {
    if (alertBox) {
      alertBox.className = 'p-2.5 rounded text-xs border border-amber-300 bg-amber-50 text-amber-900';
      alertBox.innerText = 'Name, email, and password are required.';
      alertBox.classList.remove('hidden');
    }
    return;
  }

  try {
    if (submitBtn) submitBtn.disabled = true;
    if (btnText) btnText.innerText = 'Saving...';
    if (spinner) spinner.classList.remove('hidden');
    if (alertBox) alertBox.classList.add('hidden');

    const res = await api.post('/api/admin/users', {
      name,
      email,
      role,
      identifier,
      phone,
      department,
      password
    });

    if (res.success) {
      showToast('User Created ✅', res.message || `User ${name} registered successfully.`, 'success');
      closeAddUserModal();
      document.getElementById('add-user-form')?.reset();
      const pwdInput = document.getElementById('new-user-pwd');
      if (pwdInput) pwdInput.value = 'Password@123';
      await loadUsers();
    }
  } catch (err) {
    if (alertBox) {
      alertBox.className = 'p-2.5 rounded text-xs border border-red-300 bg-red-50 text-red-900';
      alertBox.innerText = err.message || 'Failed to add user. Verify details.';
      alertBox.classList.remove('hidden');
    }
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (btnText) btnText.innerText = 'Save User';
    if (spinner) spinner.classList.add('hidden');
  }
}

// Audit Logs Viewer
export async function loadAuditLogs() {
  const container = document.getElementById('admin-audit-logs-container');
  if (!container) return;

  try {
    const res = await api.get('/api/admin/audit-logs');
    if (res.success && res.logs) {
      auditLogs = res.logs;
      if (auditLogs.length === 0) {
        container.innerHTML = '<div class="p-6 text-center text-slate-500 text-xs">No audit logs recorded yet.</div>';
        return;
      }

      container.innerHTML = auditLogs.map((log) => `
        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
          <div class="flex items-center justify-between text-[11px] text-slate-500">
            <span class="font-mono font-bold text-blue-700">${log.action}</span>
            <span class="font-mono text-slate-400">${new Date(log.timestamp).toLocaleString()}</span>
          </div>
          <div class="text-slate-700">
            Actor: <strong class="text-slate-900">${log.actorName || 'System'}</strong> (${log.actorRole}) • Target: <span class="text-amber-800 font-mono">${log.entityType} ${log.entityId}</span>
          </div>
          ${
            log.metadata && Object.keys(log.metadata).length > 0
              ? `<pre class="bg-white p-2 rounded border border-slate-200 text-[10px] text-slate-600 font-mono overflow-x-auto">${JSON.stringify(log.metadata, null, 2)}</pre>`
              : ''
          }
        </div>
      `).join('');
    }
  } catch (err) {
    console.warn('[CampusShield Admin] Audit logs loading error:', err.message);
  }
}

// Emergency Contacts Admin Management
export async function loadEmergencyContactsAdmin() {
  const container = document.getElementById('admin-contacts-list');
  if (!container) return;

  try {
    const res = await api.get('/api/admin/contacts');
    if (res.success && res.contacts) {
      container.innerHTML = res.contacts.map((c) => `
        <div class="p-3 bg-white rounded-xl border border-slate-200 flex items-center justify-between text-xs hover:border-slate-300 transition">
          <div>
            <div class="font-bold text-slate-900">${c.name}</div>
            <div class="text-[11px] text-blue-600">${c.role} • <span class="font-mono text-emerald-700 font-semibold">📞 ${c.phone}</span></div>
            <div class="text-[10px] text-slate-500">📍 ${c.location}</div>
          </div>
          <button onclick="window.csAdmin.deleteContact('${c._id}')" class="text-red-600 hover:text-red-700 text-xs font-semibold px-2 py-1 cursor-pointer">
            ✕ Delete
          </button>
        </div>
      `).join('');
    }
  } catch (err) {
    console.warn('[CampusShield Admin] Contacts error:', err.message);
  }
}

export async function addEmergencyContact() {
  const name = document.getElementById('new-contact-name')?.value.trim();
  const role = document.getElementById('new-contact-role')?.value.trim();
  const phone = document.getElementById('new-contact-phone')?.value.trim();
  const location = document.getElementById('new-contact-loc')?.value.trim() || 'Campus';

  if (!name || !role || !phone) {
    showToast('Input Required', 'Name, role, and phone are mandatory.', 'warning');
    return;
  }

  try {
    const res = await api.post('/api/admin/contacts', { name, role, phone, location });
    if (res.success) {
      showToast('Contact Added', 'New emergency directory contact registered.', 'success');
      loadEmergencyContactsAdmin();
      document.getElementById('new-contact-name').value = '';
      document.getElementById('new-contact-role').value = '';
      document.getElementById('new-contact-phone').value = '';
    }
  } catch (err) {
    showToast('Failed to add contact', err.message, 'critical');
  }
}

export async function deleteContact(id) {
  if (!confirm('Are you sure you want to remove this emergency contact?')) return;
  try {
    await api.delete(`/api/admin/contacts/${id}`);
    showToast('Contact Removed', 'Emergency directory updated.', 'info');
    loadEmergencyContactsAdmin();
  } catch (err) {
    showToast('Delete failed', err.message, 'critical');
  }
}

// =========================================================================
// FALSE ALARM MANAGEMENT & DISCIPLINARY GOVERNANCE MODULE
// =========================================================================

let studentSafetyRecords = [];
let disciplinaryCasesList = [];

/**
 * Load False Alarm Dashboard Stats & Threshold Setting
 */
export async function loadFalseAlarmStats() {
  try {
    const res = await api.get('/api/false-alarms/stats');
    if (res.success && res.stats) {
      const s = res.stats;
      const elTotal = document.getElementById('fa-stat-total');
      const elPending = document.getElementById('fa-stat-pending');
      const elConfirmed = document.getElementById('fa-stat-confirmed');
      const el2Plus = document.getElementById('fa-stat-students-2plus');
      const elSuspended = document.getElementById('fa-stat-suspended');
      const elCasesPending = document.getElementById('fa-stat-cases-pending');
      const elCasesResolved = document.getElementById('fa-stat-cases-resolved');
      const elThreshold = document.getElementById('admin-threshold-input');

      if (elTotal) elTotal.innerText = s.totalReportedFalseAlarms;
      if (elPending) elPending.innerText = s.pendingVerificationCases;
      if (elConfirmed) elConfirmed.innerText = s.confirmedIntentionalFalseAlarms;
      if (el2Plus) el2Plus.innerText = s.studentsWith2OrMoreCases;
      if (elSuspended) elSuspended.innerText = s.studentsSuspended;
      if (elCasesPending) elCasesPending.innerText = s.pendingDisciplinaryCases;
      if (elCasesResolved) elCasesResolved.innerText = s.resolvedDisciplinaryCases;
      if (elThreshold && s.threshold) elThreshold.value = s.threshold;
    }
  } catch (err) {
    console.warn('[CampusShield Admin] False alarm stats error:', err.message);
  }
}

/**
 * Update the configurable suspension threshold
 */
export async function updateThresholdSetting() {
  const input = document.getElementById('admin-threshold-input');
  const val = parseInt(input?.value, 10);

  if (isNaN(val) || val < 1 || val > 15) {
    showToast('Invalid Threshold', 'Please specify a threshold between 1 and 15.', 'warning');
    return;
  }

  try {
    const res = await api.patch('/api/false-alarms/config', { threshold: val });
    if (res.success) {
      showToast('Threshold Updated', `Suspension threshold set to ${res.threshold} confirmed alarms.`, 'success');
      await loadFalseAlarmStats();
      await loadStudentSafetyRecords();
    }
  } catch (err) {
    showToast('Update Failed', err.message, 'critical');
  }
}

/**
 * Load & Render Student Safety Records with Filtering
 */
export async function loadStudentSafetyRecords() {
  const tableBody = document.getElementById('fa-students-table-body');
  if (!tableBody) return;

  const search = document.getElementById('fa-student-search')?.value.trim() || '';
  const minCount = document.getElementById('fa-filter-min-count')?.value || '';
  const department = document.getElementById('fa-filter-dept')?.value || '';
  const sosStatus = document.getElementById('fa-filter-sos-status')?.value || '';
  const disciplinaryStatus = document.getElementById('fa-filter-disc-status')?.value || '';

  try {
    const res = await api.get('/api/false-alarms/students', {
      search,
      minCount,
      department,
      sosStatus,
      disciplinaryStatus
    });

    if (res.success && res.students) {
      studentSafetyRecords = res.students;
      renderStudentSafetyTable(studentSafetyRecords);
    }
  } catch (err) {
    console.warn('[CampusShield Admin] Failed loading students overview:', err.message);
  }
}

function renderStudentSafetyTable(records) {
  const tableBody = document.getElementById('fa-students-table-body');
  if (!tableBody) return;

  if (records.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" class="p-6 text-center text-slate-500 text-xs italic">
          No matching student safety records found.
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = records.map((s) => {
    const countBadge =
      s.confirmedFalseAlarms >= 4
        ? 'bg-red-50 text-red-700 border-red-300 font-bold'
        : s.confirmedFalseAlarms === 3
        ? 'bg-amber-50 text-amber-800 border-amber-300 font-bold'
        : s.confirmedFalseAlarms === 2
        ? 'bg-amber-50 text-amber-700 border-amber-200 font-semibold'
        : 'bg-slate-50 text-slate-700 border-slate-200';

    const sosBadge =
      s.sosAccessStatus === 'active'
        ? '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">Active</span>'
        : '<span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-50 text-red-700 border border-red-200">Suspended</span>';

    const discBadge =
      s.disciplinaryStatus === 'None'
        ? '<span class="text-slate-400 text-[11px]">—</span>'
        : s.disciplinaryStatus === 'Resolved'
        ? `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">${s.disciplinaryStatus}</span>`
        : `<span class="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">${s.disciplinaryStatus}</span>`;

    const lastDate = s.lastIncidentDate ? new Date(s.lastIncidentDate).toLocaleDateString() : 'None';

    return `
      <tr class="border-b border-slate-200 hover:bg-slate-50 text-xs transition">
        <td class="p-3.5">
          <div class="font-bold text-slate-900">${s.name}</div>
          <div class="text-[11px] text-slate-500 font-mono">${s.identifier} • ${s.email}</div>
        </td>
        <td class="p-3.5 text-slate-700">${s.department}</td>
        <td class="p-3.5">
          <span class="px-2.5 py-1 rounded-lg text-xs font-mono border ${countBadge}">
            ${s.confirmedFalseAlarms} Confirmed
          </span>
        </td>
        <td class="p-3.5">${sosBadge}</td>
        <td class="p-3.5">
          ${discBadge}
          ${s.disciplinaryCaseId ? `<div class="text-[10px] text-blue-600 font-mono mt-0.5">${s.disciplinaryCaseId}</div>` : ''}
        </td>
        <td class="p-3.5 text-slate-500 font-mono text-[11px]">${lastDate}</td>
        <td class="p-3.5 text-right space-x-1">
          <button onclick="window.csAdmin.openStudentDossierModal('${s._id}')" 
                  title="View full incident & evidence history"
                  class="px-2.5 py-1 text-xs border border-slate-200 rounded-lg hover:bg-slate-100 text-blue-700 font-medium cursor-pointer transition">
            Dossier
          </button>
          <button onclick="window.csAdmin.openAddAdminNoteModal('${s._id}', '${s.name.replace(/'/g, "\\'")}')" 
                  title="Record administrative proctorial note"
                  class="px-2.5 py-1 text-xs border border-slate-200 rounded-lg hover:bg-slate-100 text-slate-700 font-medium cursor-pointer transition">
            + Note
          </button>
          ${
            s.sosAccessStatus === 'restricted'
              ? `<button onclick="window.csAdmin.openRestoreSosModal('${s._id}', '${s.name.replace(/'/g, "\\'")}')" 
                         title="Restore SOS alert privileges"
                         class="px-2.5 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-xs cursor-pointer transition">
                   Restore SOS
                 </button>`
              : ''
          }
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Load Disciplinary Cases
 */
export async function loadDisciplinaryCases() {
  const tableBody = document.getElementById('disc-cases-table-body');
  if (!tableBody) return;

  const status = document.getElementById('disc-case-status-filter')?.value || '';

  try {
    const res = await api.get('/api/disciplinary-cases', { status });
    if (res.success && res.cases) {
      disciplinaryCasesList = res.cases;
      renderDisciplinaryCasesTable(disciplinaryCasesList);
    }
  } catch (err) {
    console.warn('[CampusShield Admin] Failed loading disciplinary cases:', err.message);
  }
}

function renderDisciplinaryCasesTable(cases) {
  const tableBody = document.getElementById('disc-cases-table-body');
  if (!tableBody) return;

  if (cases.length === 0) {
    tableBody.innerHTML = `
      <tr>
        <td colspan="7" class="p-6 text-center text-slate-500 text-xs">
          No disciplinary committee cases recorded under current filter.
        </td>
      </tr>
    `;
    return;
  }

  tableBody.innerHTML = cases.map((c) => {
    const isResolved = c.caseStatus === 'Resolved';
    const studentName = c.studentId ? c.studentId.name : 'Unknown Student';
    const studentIdStr = c.studentId ? c.studentId.identifier : 'N/A';
    const meetingStr = c.meetingDate ? new Date(c.meetingDate).toLocaleString() : 'Not Scheduled';

    const statusBadgeColor = isResolved
      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : 'bg-purple-50 text-purple-700 border-purple-200';

    return `
      <tr class="border-b border-slate-200 hover:bg-slate-50 text-xs transition">
        <td class="p-3.5 font-mono font-bold text-slate-900">${c.caseId}</td>
        <td class="p-3.5">
          <div class="font-bold text-slate-900">${studentName}</div>
          <div class="text-[11px] text-slate-500 font-mono">${studentIdStr}</div>
        </td>
        <td class="p-3.5">
          <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${statusBadgeColor}">
            ${c.caseStatus}
          </span>
        </td>
        <td class="p-3.5 text-slate-700 text-[11px]">
          <div class="font-semibold">${meetingStr}</div>
          <div class="text-[10px] text-slate-500 truncate max-w-[150px]">${c.meetingLocation || 'Committee Chamber'}</div>
        </td>
        <td class="p-3.5 max-w-xs text-slate-700">
          ${c.studentResponse ? `<span class="italic text-slate-800">"${c.studentResponse}"</span>` : '<span class="text-slate-400 italic">No representation submitted</span>'}
        </td>
        <td class="p-3.5 max-w-xs">
          ${
            c.finalDecision
              ? `<div class="font-bold text-emerald-800">${c.finalDecision}</div>
                 <div class="text-[10px] text-slate-500">By ${c.deciderName || 'Committee'}</div>`
              : '<span class="text-amber-700 italic font-mono text-[11px]">Hearing Pending</span>'
          }
        </td>
        <td class="p-3.5 text-right space-x-1">
          <button onclick="window.csAdmin.openUpdateCaseModal('${c.caseId}')" 
                  class="px-2.5 py-1 text-xs border border-slate-200 rounded-lg hover:bg-blue-50 text-blue-700 font-medium cursor-pointer transition">
            Schedule / Status
          </button>
          <button onclick="window.csAdmin.openRecordDecisionModal('${c.caseId}')" 
                  class="px-2.5 py-1 text-xs bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-xs cursor-pointer transition">
            Record Decision
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

/**
 * Modal: Restore SOS Access Override (Mandatory Reason Required)
 */
export function openRestoreSosModal(studentId, studentName) {
  let modal = document.getElementById('admin-action-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'admin-action-modal';
    modal.className = 'fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-xl relative my-auto">
      <div class="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
        <div class="flex items-center gap-2.5">
          <span class="text-2xl">🔓</span>
          <div>
            <h3 class="text-sm font-bold text-slate-900 uppercase tracking-wider">Restore SOS Alert Access</h3>
            <p class="text-xs text-slate-500 font-mono">${studentName}</p>
          </div>
        </div>
        <button onclick="document.getElementById('admin-action-modal').remove()" class="text-slate-400 hover:text-slate-600 text-lg cursor-pointer">✕</button>
      </div>

      <div class="space-y-3 text-xs mb-4">
        <p class="text-slate-600 leading-relaxed">
          Restoring SOS privileges will re-enable the student's ability to trigger campus emergency alerts. A mandatory administrative justification must be recorded in the audit trail.
        </p>

        <div>
          <label class="block font-bold text-slate-700 mb-1">
            Administrative Override Justification <span class="text-red-600">*</span>
          </label>
          <textarea id="restore-reason-input" rows="3" 
                    placeholder="e.g. Student completed mandatory awareness counseling; proctor recommendation approved..."
                    class="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-500"></textarea>
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button onclick="document.getElementById('admin-action-modal').remove()" class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer">
          Cancel
        </button>
        <button onclick="window.csAdmin.submitRestoreSos('${studentId}')" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer">
          Confirm & Restore Access
        </button>
      </div>
    </div>
  `;
}

export async function submitRestoreSos(studentId) {
  const reason = document.getElementById('restore-reason-input')?.value.trim();

  if (!reason) {
    showToast('Reason Required', 'You must provide a detailed justification to restore restricted SOS access.', 'critical');
    return;
  }

  try {
    const res = await api.post(`/api/false-alarms/restore-sos/${studentId}`, { reason });
    if (res.success) {
      document.getElementById('admin-action-modal')?.remove();
      showToast('SOS Access Restored', res.message, 'success');
      await loadStudentSafetyRecords();
      await loadFalseAlarmStats();
      await loadAuditLogs();
    }
  } catch (err) {
    showToast('Restoration Failed', err.message, 'critical');
  }
}

/**
 * Modal: Add Administrative Note to Student Safety Record
 */
export function openAddAdminNoteModal(studentId, studentName) {
  let modal = document.getElementById('admin-action-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'admin-action-modal';
    modal.className = 'fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="bg-white border border-slate-200 rounded-2xl w-full max-w-md p-6 shadow-xl relative my-auto">
      <div class="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
        <div class="flex items-center gap-2.5">
          <span class="text-2xl">📝</span>
          <div>
            <h3 class="text-sm font-bold text-slate-900 uppercase tracking-wider">Record Administrative Note</h3>
            <p class="text-xs text-slate-500 font-mono">${studentName}</p>
          </div>
        </div>
        <button onclick="document.getElementById('admin-action-modal').remove()" class="text-slate-400 hover:text-slate-600 text-lg cursor-pointer">✕</button>
      </div>

      <div class="space-y-3 text-xs mb-4">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Administrative / Proctorial Note</label>
          <textarea id="admin-note-input" rows="3" placeholder="Enter notes from student consultation or counseling..."
                    class="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-500"></textarea>
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button onclick="document.getElementById('admin-action-modal').remove()" class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer">
          Cancel
        </button>
        <button onclick="window.csAdmin.submitAdminNote('${studentId}')" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer">
          Save Note
        </button>
      </div>
    </div>
  `;
}

export async function submitAdminNote(studentId) {
  const text = document.getElementById('admin-note-input')?.value.trim();
  if (!text) {
    showToast('Empty Note', 'Note text cannot be empty.', 'warning');
    return;
  }

  try {
    const res = await api.post(`/api/false-alarms/notes/${studentId}`, { text });
    if (res.success) {
      document.getElementById('admin-action-modal')?.remove();
      showToast('Note Recorded', res.message, 'success');
      await loadAuditLogs();
    }
  } catch (err) {
    showToast('Failed to save note', err.message, 'critical');
  }
}

/**
 * Modal: Full Student Safety Dossier Inspector
 */
export async function openStudentDossierModal(studentId) {
  let modal = document.getElementById('admin-action-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'admin-action-modal';
    modal.className = 'fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl p-6 shadow-xl relative my-auto">
      <div class="text-center py-8 text-xs text-slate-500">Loading student dossier...</div>
    </div>
  `;

  try {
    const res = await api.get(`/api/false-alarms/student/${studentId}`);
    if (res.success) {
      const { student, records, safetyStatus, disciplinaryCases } = res;

      modal.innerHTML = `
        <div class="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl p-6 shadow-xl relative my-auto max-h-[90vh] overflow-y-auto space-y-4">
          <div class="flex items-center justify-between pb-3 border-b border-slate-200">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-xl text-blue-700">
                👤
              </div>
              <div>
                <h3 class="text-base font-bold text-slate-900">${student.name}</h3>
                <p class="text-xs text-slate-500 font-mono">${student.identifier} • ${student.department} • ${student.email}</p>
              </div>
            </div>
            <button onclick="document.getElementById('admin-action-modal').remove()" class="text-slate-400 hover:text-slate-600 text-lg cursor-pointer">✕</button>
          </div>

          <!-- Status Overview -->
          <div class="grid grid-cols-3 gap-3 text-xs bg-slate-50 p-3 rounded-xl border border-slate-200">
            <div>
              <span class="text-slate-500 block">Confirmed Alarms:</span>
              <strong class="text-red-700 text-sm font-mono">${safetyStatus.confirmedIntentionalFalseAlarmCount}</strong>
            </div>
            <div>
              <span class="text-slate-500 block">Warning Tier:</span>
              <strong class="text-amber-700 text-sm font-mono">${safetyStatus.warningLevel}</strong>
            </div>
            <div>
              <span class="text-slate-500 block">SOS Privilege:</span>
              <strong class="${safetyStatus.sosAccessStatus === 'active' ? 'text-emerald-700' : 'text-red-700 font-bold'} text-sm font-mono">${safetyStatus.sosAccessStatus.toUpperCase()}</strong>
            </div>
          </div>

          <!-- Verified Incident History -->
          <div class="space-y-2">
            <div class="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Verified False Alarm Records (${records.length})
            </div>
            ${
              records.length === 0
                ? '<div class="text-xs text-slate-500 italic p-3 bg-slate-50 rounded-lg border border-slate-200">No false alarm records.</div>'
                : records
                    .map(
                      (r) => `
                <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
                  <div class="flex justify-between items-center text-[11px]">
                    <span class="font-mono font-bold text-slate-900">${r.incidentId}</span>
                    <span class="font-bold px-2 py-0.5 rounded ${
                      r.classification === 'False Alarm — Intentional' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-white text-slate-700 border border-slate-200'
                    }">${r.classification}</span>
                  </div>
                  <p class="text-slate-700">${r.investigationNotes || 'No notes logged.'}</p>
                  ${r.evidenceReferences ? `<div class="text-[10px] text-slate-500">Evidence: ${r.evidenceReferences}</div>` : ''}
                  <div class="text-[10px] text-slate-400">Verified by: ${r.verifierName || 'Security'} • ${new Date(r.verifiedAt).toLocaleDateString()}</div>
                </div>
              `
                    )
                    .join('')
            }
          </div>

          <!-- Disciplinary Cases -->
          <div class="space-y-2 pt-2 border-t border-slate-200">
            <div class="text-xs font-bold text-slate-900 uppercase tracking-wider">
              Disciplinary Committee Proceedings (${disciplinaryCases.length})
            </div>
            ${
              disciplinaryCases.length === 0
                ? '<div class="text-xs text-slate-500 italic p-3 bg-slate-50 rounded-lg border border-slate-200">No disciplinary cases filed.</div>'
                : disciplinaryCases
                    .map(
                      (c) => `
                <div class="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
                  <div class="flex justify-between">
                    <span class="font-mono font-bold text-slate-900">${c.caseId}</span>
                    <span class="text-blue-700 font-semibold">${c.caseStatus}</span>
                  </div>
                  ${c.studentResponse ? `<div class="bg-white p-2 rounded border border-slate-200 text-[11px] text-slate-700"><strong>Student Appeal:</strong> "${c.studentResponse}"</div>` : ''}
                  ${c.finalDecision ? `<div class="bg-emerald-50 p-2 rounded border border-emerald-200 text-emerald-800"><strong>Outcome:</strong> ${c.finalDecision}</div>` : ''}
                </div>
              `
                    )
                    .join('')
            }
          </div>

          <div class="flex justify-end pt-3 border-t border-slate-200">
            <button onclick="document.getElementById('admin-action-modal').remove()" class="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl text-xs cursor-pointer transition">
              Close Dossier
            </button>
          </div>
        </div>
      `;
    }
  } catch (err) {
    showToast('Failed to load dossier', err.message, 'critical');
  }
}

/**
 * Modal: Schedule Hearing or Advance Case Status
 */
export function openUpdateCaseModal(caseId) {
  const c = disciplinaryCasesList.find((item) => item.caseId === caseId);
  if (!c) return;

  let modal = document.getElementById('admin-action-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'admin-action-modal';
    modal.className = 'fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto';
    document.body.appendChild(modal);
  }

  const dateVal = c.meetingDate ? new Date(c.meetingDate).toISOString().slice(0, 16) : '';

  modal.innerHTML = `
    <div class="bg-white border border-slate-200 rounded-2xl w-full max-w-lg p-6 shadow-xl relative my-auto">
      <div class="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
        <div class="flex items-center gap-2.5">
          <span class="text-2xl">🏛️</span>
          <div>
            <h3 class="text-sm font-bold text-slate-900 uppercase tracking-wider">Update Disciplinary Case</h3>
            <p class="text-xs text-slate-500 font-mono">${caseId}</p>
          </div>
        </div>
        <button onclick="document.getElementById('admin-action-modal').remove()" class="text-slate-400 hover:text-slate-600 text-lg cursor-pointer">✕</button>
      </div>

      <div class="space-y-3 text-xs mb-4">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Advance Status Lifecycle</label>
          <select id="update-case-status-select" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800">
            <option value="Case Created" ${c.caseStatus === 'Case Created' ? 'selected' : ''}>1. Case Created</option>
            <option value="Awaiting Committee Review" ${c.caseStatus === 'Awaiting Committee Review' ? 'selected' : ''}>2. Awaiting Committee Review</option>
            <option value="Meeting Scheduled" ${c.caseStatus === 'Meeting Scheduled' ? 'selected' : ''}>3. Meeting Scheduled</option>
            <option value="Student Notified" ${c.caseStatus === 'Student Notified' ? 'selected' : ''}>4. Student Notified</option>
            <option value="Hearing Completed" ${c.caseStatus === 'Hearing Completed' ? 'selected' : ''}>5. Hearing Completed</option>
            <option value="Decision Pending" ${c.caseStatus === 'Decision Pending' ? 'selected' : ''}>6. Decision Pending</option>
            <option value="Resolved" ${c.caseStatus === 'Resolved' ? 'selected' : ''}>7. Resolved</option>
          </select>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Scheduled Hearing Date & Time</label>
          <input type="datetime-local" id="update-case-date-input" value="${dateVal}"
                 class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800" />
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Hearing Location</label>
          <input type="text" id="update-case-loc-input" value="${c.meetingLocation || 'Campus Disciplinary Committee Chamber (Admin Block 204)'}"
                 class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800" />
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Committee Notes</label>
          <textarea id="update-case-notes-input" rows="2.5" placeholder="Hearing findings, committee members present..."
                    class="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800">${c.committeeNotes || ''}</textarea>
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button onclick="document.getElementById('admin-action-modal').remove()" class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer">
          Cancel
        </button>
        <button onclick="window.csAdmin.submitUpdateCase('${caseId}')" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer">
          Update Case
        </button>
      </div>
    </div>
  `;
}

export async function submitUpdateCase(caseId) {
  const caseStatus = document.getElementById('update-case-status-select')?.value;
  const meetingDate = document.getElementById('update-case-date-input')?.value;
  const meetingLocation = document.getElementById('update-case-loc-input')?.value;
  const committeeNotes = document.getElementById('update-case-notes-input')?.value;

  try {
    const res = await api.patch(`/api/disciplinary-cases/${caseId}`, {
      caseStatus,
      meetingDate: meetingDate || null,
      meetingLocation,
      committeeNotes
    });

    if (res.success) {
      document.getElementById('admin-action-modal')?.remove();
      showToast('Case Updated', `Case [${caseId}] advanced to status: ${caseStatus}.`, 'success');
      await loadDisciplinaryCases();
      await loadStudentSafetyRecords();
      await loadFalseAlarmStats();
      await loadAuditLogs();
    }
  } catch (err) {
    showToast('Update Failed', err.message, 'critical');
  }
}

/**
 * Modal: Record Final Decision on Disciplinary Case
 */
export function openRecordDecisionModal(caseId) {
  let modal = document.getElementById('admin-action-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'admin-action-modal';
    modal.className = 'fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="bg-white border border-slate-200 rounded-2xl w-full max-w-lg p-6 shadow-xl relative my-auto">
      <div class="flex items-center justify-between pb-3 border-b border-slate-200 mb-4">
        <div class="flex items-center gap-2.5">
          <span class="text-2xl">📋</span>
          <div>
            <h3 class="text-sm font-bold text-slate-900 uppercase tracking-wider">Record Final Committee Decision</h3>
            <p class="text-xs text-slate-500 font-mono">${caseId}</p>
          </div>
        </div>
        <button onclick="document.getElementById('admin-action-modal').remove()" class="text-slate-400 hover:text-slate-600 text-lg cursor-pointer">✕</button>
      </div>

      <div class="space-y-3 text-xs mb-4">
        <div>
          <label class="block font-bold text-slate-700 mb-1">Standard Outcome Category</label>
          <select id="decision-outcome-select" class="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-800">
            <option value="Formal warning">Formal warning</option>
            <option value="Mandatory awareness session">Mandatory awareness session</option>
            <option value="Probation or institution-approved disciplinary action">Probation or institution-approved disciplinary action</option>
            <option value="Restoration of SOS privileges">Restoration of SOS privileges</option>
            <option value="Continued SOS restriction">Continued SOS restriction</option>
            <option value="No further action">No further action</option>
          </select>
        </div>

        <div>
          <label class="block font-bold text-slate-700 mb-1">Official Decision Notes & Directives</label>
          <textarea id="decision-notes-input" rows="3" placeholder="Explain the committee's deliberation, hearing findings, and any conditions for privilege reinstatement..."
                    class="w-full bg-slate-50 border border-slate-200 rounded-xl p-2.5 text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-blue-500"></textarea>
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button onclick="document.getElementById('admin-action-modal').remove()" class="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 cursor-pointer">
          Cancel
        </button>
        <button onclick="window.csAdmin.submitRecordDecision('${caseId}')" class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-xl shadow-xs transition cursor-pointer">
          Finalize & Execute Decision
        </button>
      </div>
    </div>
  `;
}

export async function submitRecordDecision(caseId) {
  const outcomeCat = document.getElementById('decision-outcome-select')?.value || 'Formal warning';
  const customNotes = document.getElementById('decision-notes-input')?.value.trim();

  const finalDecision = customNotes ? `${outcomeCat} — ${customNotes}` : outcomeCat;

  try {
    const res = await api.patch(`/api/disciplinary-cases/${caseId}`, {
      caseStatus: 'Resolved',
      finalDecision
    });

    if (res.success) {
      document.getElementById('admin-action-modal')?.remove();
      showToast('Decision Finalized', `Case [${caseId}] resolved with outcome: ${outcomeCat}.`, 'success');
      await loadDisciplinaryCases();
      await loadStudentSafetyRecords();
      await loadFalseAlarmStats();
      await loadAuditLogs();
    }
  } catch (err) {
    showToast('Decision Recording Failed', err.message, 'critical');
  }
}

/**
 * Export False Alarm Records as CSV
 */
export function exportFalseAlarmCsv() {
  const url = `${api.getBaseUrl()}/api/false-alarms/export?format=csv`;
  window.open(url, '_blank');
}

// Window Global Export
window.csAdmin = {
  loadAdminDashboard,
  loadUsers,
  renderUsersTable,
  updateRole,
  toggleUserStatus,
  openAddUserModal,
  closeAddUserModal,
  submitAddUser,
  addEmergencyContact,
  deleteContact,
  loadFalseAlarmStats,
  updateThresholdSetting,
  loadStudentSafetyRecords,
  loadDisciplinaryCases,
  openRestoreSosModal,
  submitRestoreSos,
  openAddAdminNoteModal,
  submitAdminNote,
  openStudentDossierModal,
  openUpdateCaseModal,
  submitUpdateCase,
  openRecordDecisionModal,
  submitRecordDecision,
  exportFalseAlarmCsv,
  logout
};
