/* ===== WebAuthn Biometric Auth + Role-Based Access ===== */

// Roles: 'admin' (full), 'viewer' (read-only), 'entry' (journal entry only)
let currentUser = null;
let authEnabled = false;

const ROLE_PERMISSIONS = {
  admin: { tabs: ['dashboard', 'accounts', 'journal', 'import', 'reports', 'settings', 'capture'], canEdit: true, canDelete: true, canImport: true, canSettings: true },
  viewer: { tabs: ['dashboard', 'accounts', 'journal', 'reports'], canEdit: false, canDelete: false, canImport: false, canSettings: false },
  entry: { tabs: ['dashboard', 'journal', 'capture'], canEdit: true, canDelete: false, canImport: false, canSettings: false }
};

async function getUsers() {
  return await dbGetAll('users') || [];
}

async function initAuth() {
  const users = await getUsers();
  authEnabled = users.length > 0;
  if (!authEnabled) {
    currentUser = { username: 'admin', role: 'admin' };
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-main').style.display = '';
    updateUserUI();
    return true;
  }
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-main').style.display = 'none';
  renderLoginUserList(users);
  return false;
}

function renderLoginUserList(users) {
  const list = document.getElementById('login-user-list');
  list.innerHTML = '';
  for (const u of users) {
    const div = document.createElement('div');
    div.className = 'login-user-card';
    div.innerHTML = `
      <div class="login-user-avatar">${u.username.charAt(0).toUpperCase()}</div>
      <div class="login-user-name">${u.username}</div>
      <div class="login-user-role">${t('role' + u.role.charAt(0).toUpperCase() + u.role.slice(1))}</div>
    `;
    div.addEventListener('click', () => authenticateUser(u));
    list.appendChild(div);
  }
}

async function authenticateUser(user) {
  if (user.credentialId) {
    try {
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)),
          rpId: location.hostname || 'localhost',
          allowCredentials: [{
            id: base64ToBuffer(user.credentialId),
            type: 'public-key',
            transports: ['internal']
          }],
          userVerification: 'required',
          timeout: 60000
        }
      });
      if (credential) {
        loginUser(user);
      }
    } catch (e) {
      toast(t('biometricFailed'), 'error');
    }
  } else {
    // No biometric registered, allow login with confirmation
    loginUser(user);
  }
}

function loginUser(user) {
  currentUser = user;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-main').style.display = '';
  updateUserUI();
  applyRolePermissions();
  switchTab('dashboard');
}

function logoutUser() {
  currentUser = null;
  initAuth();
}

function updateUserUI() {
  const el = document.getElementById('current-user-display');
  if (!el) return;
  if (currentUser) {
    el.innerHTML = `<span class="user-badge">${currentUser.username} (${t('role' + currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1))})</span>
      ${authEnabled ? `<button class="btn btn-sm" onclick="logoutUser()" data-i18n="logout">${t('logout')}</button>` : ''}`;
  } else {
    el.innerHTML = '';
  }
}

function applyRolePermissions() {
  if (!currentUser) return;
  const perms = ROLE_PERMISSIONS[currentUser.role] || ROLE_PERMISSIONS.viewer;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    const tab = btn.dataset.tab;
    if (perms.tabs.includes(tab)) {
      btn.style.display = '';
    } else {
      btn.style.display = 'none';
    }
  });
  // Hide action buttons for viewer
  document.querySelectorAll('.role-edit').forEach(el => {
    el.style.display = perms.canEdit ? '' : 'none';
  });
  document.querySelectorAll('.role-delete').forEach(el => {
    el.style.display = perms.canDelete ? '' : 'none';
  });
  document.querySelectorAll('.role-import').forEach(el => {
    el.style.display = perms.canImport ? '' : 'none';
  });
  document.querySelectorAll('.role-admin').forEach(el => {
    el.style.display = currentUser.role === 'admin' ? '' : 'none';
  });
}

function checkPermission(action) {
  if (!currentUser) return false;
  const perms = ROLE_PERMISSIONS[currentUser.role];
  if (!perms) return false;
  switch (action) {
    case 'edit': return perms.canEdit;
    case 'delete': return perms.canDelete;
    case 'import': return perms.canImport;
    case 'settings': return perms.canSettings;
    default: return true;
  }
}

// ===== User Management (in Settings) =====
async function loadUserManagement() {
  const users = await getUsers();
  const tbody = document.getElementById('user-list');
  if (!tbody) return;
  tbody.innerHTML = '';
  for (const u of users) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${u.username}</td>
      <td>${t('role' + u.role.charAt(0).toUpperCase() + u.role.slice(1))}</td>
      <td>${u.credentialId ? '&#10003;' : '&#10007;'}</td>
      <td>
        <button class="btn btn-sm" onclick="registerUserBiometric(${u.id})">${t('registerBiometric')}</button>
        <button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id})">&times;</button>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

async function addNewUser() {
  const username = document.getElementById('new-username').value.trim();
  const role = document.getElementById('new-role').value;
  if (!username) return;
  await dbAdd('users', { username, role, credentialId: null, publicKey: null });
  document.getElementById('new-username').value = '';
  toast(t('userCreated'), 'success');
  loadUserManagement();
}

async function deleteUser(id) {
  if (!confirm(t('confirmDeleteUser'))) return;
  await dbDelete('users', id);
  toast(t('userDeleted'));
  loadUserManagement();
}

async function registerUserBiometric(userId) {
  const user = await dbGet('users', userId);
  if (!user) return;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: 'Razao Geral', id: location.hostname || 'localhost' },
        user: {
          id: new TextEncoder().encode(user.username),
          name: user.username,
          displayName: user.username
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' },   // ES256
          { alg: -257, type: 'public-key' }  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required'
        },
        timeout: 60000
      }
    });
    if (credential) {
      user.credentialId = bufferToBase64(credential.rawId);
      user.publicKey = bufferToBase64(credential.response.getPublicKey?.() || new ArrayBuffer(0));
      await dbPut('users', user);
      toast(t('biometricRegistered'), 'success');
      loadUserManagement();
    }
  } catch (e) {
    toast(t('biometricFailed') + ' ' + e.message, 'error');
  }
}

// ===== Buffer helpers =====
function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
