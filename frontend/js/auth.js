// CampusShield Authentication & Persona Management
import { api, showToast } from './api.js';

let currentUser = null;

export const DEMO_PERSONAS = {
  student: {
    role: 'student',
    label: 'Sumanth (Student - Clean)',
    email: 'sumanth@kongu.edu',
    identifier: '25ITR146',
    password: 'Password@123'
  },
  student_warning: {
    role: 'student',
    label: 'Sangavi (Student - 2 Alarms)',
    email: 'sangavi@kongu.edu',
    identifier: '25ITR125',
    password: 'Password@123'
  },
  student_restricted: {
    role: 'student',
    label: 'Karthik (Student - 4 Alarms / Restricted SOS)',
    email: 'karthik@kongu.edu',
    identifier: '25CSR042',
    password: 'Password@123'
  },
  security: {
    role: 'security',
    label: 'Officer Raman (Security)',
    email: 'security.raman@campusshield.kec.edu',
    identifier: 'SEC-KEC-001',
    password: 'Password@123'
  },
  admin: {
    role: 'admin',
    label: 'Dr. Karthi (Chief Safety Director)',
    email: 'admin@campusshield.kec.edu',
    identifier: 'ADMIN-KEC-01',
    password: 'Password@123'
  },
  faculty: {
    role: 'faculty',
    label: 'Dr. V. Priya (Disciplinary Committee Head)',
    email: 'priya.faculty@kongu.edu',
    identifier: 'FAC-DC-001',
    password: 'Password@123'
  },
  security_medical: {
    role: 'security',
    label: 'Nurse P. Deepa (Campus Health Center)',
    email: 'nurse.deepa@campusshield.kec.edu',
    identifier: 'MED-KEC-005',
    password: 'Password@123'
  }
};

export function getDashboardUrl(role) {
  const currentPath = window.location.pathname.toLowerCase();
  const isHtmlDirect = currentPath.endsWith('.html') || currentPath.includes('/frontend/');
  const isCustomPortOrFile = window.location.protocol === 'file:' || (window.location.port && window.location.port !== '5000');

  if (isHtmlDirect || isCustomPortOrFile) {
    if (role === 'admin' || role === 'faculty') return 'admin.html';
    if (role === 'security') return 'security.html';
    return 'student.html';
  }

  if (role === 'admin' || role === 'faculty') return '/admin';
  if (role === 'security') return '/security';
  return '/student';
}

/**
 * Checks authentication status and enforces role-based access control.
 * @param {string|string[]|null} requiredRole - Role(s) permitted on this page
 * @returns {Promise<Object|null>} Authenticated user or redirects
 */
export async function initAuth(requiredRole = null) {
  const currentPath = window.location.pathname.toLowerCase();
  const isLoginPage = currentPath === '/' || currentPath === '/login' || currentPath.endsWith('index.html') || currentPath.endsWith('login.html');

  const token = api.getToken();

  if (token) {
    try {
      const res = await api.get('/api/auth/me');
      if (res.success && res.user) {
        currentUser = res.user;
        localStorage.setItem('cs_user', JSON.stringify(currentUser));
        updateAuthUI(currentUser);

        // If authenticated user visits the login page, redirect directly to their dashboard
        if (isLoginPage) {
          const redirectUrl = getQueryParam('redirect') || getDashboardUrl(currentUser.role);
          window.location.replace(redirectUrl);
          return currentUser;
        }

        // On protected pages, enforce role-based access control
        if (requiredRole) {
          const allowedRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
          if (!allowedRoles.includes(currentUser.role) && currentUser.role !== 'admin') {
            console.warn(`[CampusShield RBAC] Unauthorized role: ${currentUser.role} accessed ${currentPath}`);
            alert(`Access Restricted: Your account (${currentUser.name} - ${currentUser.role.toUpperCase()}) does not have permission to access this portal.`);
            window.location.replace(getDashboardUrl(currentUser.role));
            return null;
          }
        }

        return currentUser;
      }
    } catch (err) {
      console.warn('[CampusShield Auth] Token validation failed:', err.message);
      api.setToken(null);
      localStorage.removeItem('cs_user');
      currentUser = null;
    }
  }

  // Not authenticated
  if (!isLoginPage) {
    console.warn('[CampusShield Auth] Unauthenticated session. Redirecting to login.');
    const redirectParam = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(`/login?redirect=${redirectParam}`);
    return null;
  }

  return null;
}

export function getCurrentUser() {
  if (currentUser) return currentUser;
  const stored = localStorage.getItem('cs_user');
  if (stored) {
    try {
      currentUser = JSON.parse(stored);
      return currentUser;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Signs in user with institutional credentials (email or ID) and password.
 */
export async function login(loginId, password, requestedRole = null) {
  const payload = {
    loginId: loginId.trim(),
    password
  };
  if (requestedRole) {
    payload.role = requestedRole;
  }

  const res = await api.post('/api/auth/login', payload);
  if (res.success && res.token) {
    api.setToken(res.token);
    currentUser = res.user;
    localStorage.setItem('cs_user', JSON.stringify(currentUser));
    updateAuthUI(currentUser);
    
    // Determine target destination
    const redirectParam = getQueryParam('redirect');
    let targetUrl = getDashboardUrl(currentUser.role);
    
    if (redirectParam) {
      // Validate redirect is permissible for this role
      const lowerRedirect = redirectParam.toLowerCase();
      const isAdminRoute = lowerRedirect.includes('/admin');
      const isSecurityRoute = lowerRedirect.includes('/security');
      
      if (isAdminRoute && currentUser.role === 'admin') {
        targetUrl = redirectParam;
      } else if (isSecurityRoute && (currentUser.role === 'security' || currentUser.role === 'admin')) {
        targetUrl = redirectParam;
      } else if (!isAdminRoute && !isSecurityRoute) {
        targetUrl = redirectParam;
      }
    }

    return { user: currentUser, redirectUrl: targetUrl };
  }
  throw new Error(res.message || 'Authentication failed');
}

/**
 * Requests a password reset token
 */
export async function forgotPassword(credential) {
  const res = await api.post('/api/auth/forgot-password', {
    loginId: credential.trim()
  });
  return res;
}

/**
 * Submits a new password with reset token
 */
export async function resetPassword(token, newPassword) {
  const res = await api.post('/api/auth/reset-password', {
    token: token.trim(),
    newPassword
  });
  return res;
}

export async function logout() {
  try {
    await api.post('/api/auth/logout');
  } catch (err) {
    console.warn('Logout notification error:', err.message);
  }
  api.setToken(null);
  currentUser = null;
  localStorage.removeItem('cs_token');
  localStorage.removeItem('cs_user');
  sessionStorage.clear();

  const currentPath = window.location.pathname.toLowerCase();
  const isHtmlDirect = currentPath.endsWith('.html') || currentPath.includes('/frontend/');
  const isCustomPortOrFile = window.location.protocol === 'file:' || (window.location.port && window.location.port !== '5000');

  if (isHtmlDirect || isCustomPortOrFile) {
    window.location.replace('index.html');
  } else {
    window.location.replace('/login');
  }
}

export function updateAuthUI(user) {
  const nameEl = document.getElementById('user-display-name');
  const roleEl = document.getElementById('user-display-role');
  const avatarEl = document.getElementById('user-avatar-initials');

  if (user) {
    if (nameEl) nameEl.innerText = user.name;
    if (roleEl) roleEl.innerText = user.role.toUpperCase();
    if (avatarEl) {
      const initials = user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
      avatarEl.innerText = initials || 'CS';
    }
  }
}

function getQueryParam(name) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(name);
}

// Global window exposure
window.logout = logout;
window.csAuth = {
  login,
  forgotPassword,
  resetPassword,
  logout,
  initAuth,
  getCurrentUser,
  getDashboardUrl,
  DEMO_PERSONAS
};

