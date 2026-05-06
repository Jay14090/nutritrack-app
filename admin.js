/* ═══════════════════════════════════════════════════
   NutriTrack Admin — Panel Logic
   ═══════════════════════════════════════════════════ */

const ADMIN_ID = 'admin';
const ADMIN_PASS = 'adminjay';

let db;
try {
  db = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
} catch (e) { console.error('Supabase init failed:', e); }

let currentEditProvider = 'openai';
let currentNewProvider = 'openai';

// ─── HELPERS ───
async function hashPassword(pw) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(pw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 3000);
}

// ─── ADMIN AUTH ───
function adminLogin() {
  const id = document.getElementById('adminIdInput').value.trim();
  const pw = document.getElementById('adminPassInput').value.trim();
  const err = document.getElementById('adminLoginError');
  if (id === ADMIN_ID && pw === ADMIN_PASS) {
    err.textContent = '';
    sessionStorage.setItem('nutritrack_admin', 'true');
    showDashboard();
  } else {
    err.textContent = 'Invalid admin credentials';
  }
}

function adminLogout() {
  sessionStorage.removeItem('nutritrack_admin');
  document.getElementById('adminDashboard').style.display = 'none';
  document.getElementById('adminLoginOverlay').style.display = 'flex';
}

function showDashboard() {
  document.getElementById('adminLoginOverlay').style.display = 'none';
  document.getElementById('adminDashboard').style.display = 'block';
  loadUsers();
}

// ─── LOAD USERS ───
async function loadUsers() {
  const { data: users, error } = await db
    .from('app_users')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error('Load users error:', error); return; }

  // Load settings for all users
  const { data: settings } = await db.from('user_settings').select('*');
  const settingsMap = {};
  (settings || []).forEach(s => { settingsMap[s.user_id] = s; });

  // Update stats
  const total = users ? users.length : 0;
  const active = users ? users.filter(u => u.is_active).length : 0;
  document.getElementById('statTotalUsers').textContent = total;
  document.getElementById('statActiveUsers').textContent = active;
  document.getElementById('statInactiveUsers').textContent = total - active;

  // Render user cards
  const wrapper = document.getElementById('userTableWrapper');
  if (!users || !users.length) {
    wrapper.innerHTML = '<div class="user-empty"><div class="user-empty-icon">👤</div><div>No users yet.</div></div>';
    return;
  }

  wrapper.innerHTML = users.map(u => {
    const s = settingsMap[u.id] || {};
    const prov = s.ai_provider || 'openai';
    const hasKey = s.api_key && s.api_key.length > 0;
    const statusCls = u.is_active ? 'active' : 'inactive';
    const statusLabel = u.is_active ? 'Active' : 'Revoked';
    const toggleIcon = u.is_active ? '🚫' : '✅';
    const toggleTitle = u.is_active ? 'Revoke access' : 'Grant access';

    return `<div class="user-card">
      <div class="user-card-info">
        <div class="user-card-name">
          <span class="status-dot ${statusCls}"></span>
          ${u.display_name || u.username} <span style="color:var(--text-muted);font-weight:400;font-size:0.75rem;">@${u.username}</span>
        </div>
        <div class="user-card-meta">
          <span>${statusLabel}</span>
          <span class="provider">${prov.toUpperCase()}</span>
          <span class="${hasKey ? 'has-key' : 'no-key'}">${hasKey ? '🔑 Key set' : '⚠️ No key'}</span>
          <span>${s.calorie_goal || 2200} kcal</span>
        </div>
      </div>
      <div class="user-card-actions">
        <button class="user-action-btn" onclick="openEditUser('${u.id}')" title="Edit">✏️</button>
        <button class="user-action-btn toggle-active" onclick="toggleUserAccess('${u.id}', ${u.is_active})" title="${toggleTitle}">${toggleIcon}</button>
        <button class="user-action-btn danger" onclick="confirmDeleteUser('${u.id}','${u.username}')" title="Delete">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

// ─── CREATE USER ───
function openCreateModal() {
  document.getElementById('newUsername').value = '';
  document.getElementById('newDisplayName').value = '';
  document.getElementById('newPassword').value = '';
  document.getElementById('newCalGoal').value = '2200';
  document.getElementById('newProGoal').value = '180';
  document.getElementById('newFatGoal').value = '70';
  document.getElementById('newCarbsGoal').value = '220';
  document.getElementById('newApiKey').value = '';
  currentNewProvider = 'openai';
  updateProviderBtns('new', 'openai');
  document.getElementById('createUserModal').classList.add('visible');
}

async function createUser() {
  const username = document.getElementById('newUsername').value.trim().toLowerCase();
  const displayName = document.getElementById('newDisplayName').value.trim();
  const password = document.getElementById('newPassword').value.trim();

  if (!username || !password) {
    showToast('❌ Username and password required');
    return;
  }

  const hash = await hashPassword(password);

  // Insert user
  const { data: user, error } = await db
    .from('app_users')
    .insert([{ username, password_hash: hash, display_name: displayName || username }])
    .select()
    .single();

  if (error) {
    if (error.code === '23505') showToast('❌ Username already exists');
    else showToast('❌ Error: ' + error.message);
    return;
  }

  // Insert settings
  const { error: sErr } = await db.from('user_settings').insert([{
    user_id: user.id,
    calorie_goal: parseInt(document.getElementById('newCalGoal').value) || 2200,
    protein_goal: parseInt(document.getElementById('newProGoal').value) || 180,
    fat_goal: parseInt(document.getElementById('newFatGoal').value) || 70,
    carbs_goal: parseInt(document.getElementById('newCarbsGoal').value) || 220,
    ai_provider: currentNewProvider,
    api_key: document.getElementById('newApiKey').value.trim(),
  }]);

  if (sErr) console.error('Settings insert error:', sErr);

  document.getElementById('createUserModal').classList.remove('visible');
  showToast('✅ User created: ' + username);
  loadUsers();
}

// ─── EDIT USER ───
async function openEditUser(userId) {
  const { data: user } = await db.from('app_users').select('*').eq('id', userId).single();
  const { data: settings } = await db.from('user_settings').select('*').eq('user_id', userId).single();

  if (!user) { showToast('❌ User not found'); return; }

  document.getElementById('editUserId').value = userId;
  document.getElementById('editUsername').value = user.username;
  document.getElementById('editDisplayName').value = user.display_name || '';
  document.getElementById('editPassword').value = '';
  document.getElementById('editCalGoal').value = settings?.calorie_goal || 2200;
  document.getElementById('editProGoal').value = settings?.protein_goal || 180;
  document.getElementById('editFatGoal').value = settings?.fat_goal || 70;
  document.getElementById('editCarbsGoal').value = settings?.carbs_goal || 220;
  document.getElementById('editApiKey').value = settings?.api_key || '';
  currentEditProvider = settings?.ai_provider || 'openai';
  updateProviderBtns('edit', currentEditProvider);

  document.getElementById('editUserModal').classList.add('visible');
}

async function saveEditUser() {
  const userId = document.getElementById('editUserId').value;
  const displayName = document.getElementById('editDisplayName').value.trim();
  const password = document.getElementById('editPassword').value.trim();

  // Update user record
  const userUpdate = { display_name: displayName };
  if (password) {
    userUpdate.password_hash = await hashPassword(password);
  }

  const { error: uErr } = await db.from('app_users').update(userUpdate).eq('id', userId);
  if (uErr) { showToast('❌ Error: ' + uErr.message); return; }

  // Update or create settings
  const settingsData = {
    calorie_goal: parseInt(document.getElementById('editCalGoal').value) || 2200,
    protein_goal: parseInt(document.getElementById('editProGoal').value) || 180,
    fat_goal: parseInt(document.getElementById('editFatGoal').value) || 70,
    carbs_goal: parseInt(document.getElementById('editCarbsGoal').value) || 220,
    ai_provider: currentEditProvider,
    api_key: document.getElementById('editApiKey').value.trim(),
    updated_at: new Date().toISOString(),
  };

  const { data: existing } = await db.from('user_settings').select('id').eq('user_id', userId).single();
  if (existing) {
    await db.from('user_settings').update(settingsData).eq('user_id', userId);
  } else {
    await db.from('user_settings').insert([{ user_id: userId, ...settingsData }]);
  }

  document.getElementById('editUserModal').classList.remove('visible');
  showToast('✅ User updated');
  loadUsers();
}

// ─── TOGGLE ACCESS ───
async function toggleUserAccess(userId, isActive) {
  const { error } = await db.from('app_users').update({ is_active: !isActive }).eq('id', userId);
  if (error) { showToast('❌ Error: ' + error.message); return; }
  showToast(isActive ? '🚫 Access revoked' : '✅ Access granted');
  loadUsers();
}

// ─── DELETE USER ───
async function confirmDeleteUser(userId, username) {
  if (!confirm(`Delete user "${username}"? This will also delete their food logs and settings.`)) return;
  const { error } = await db.from('app_users').delete().eq('id', userId);
  if (error) { showToast('❌ Error: ' + error.message); return; }
  showToast('🗑️ User deleted');
  loadUsers();
}

// ─── PROVIDER TOGGLE ───
function updateProviderBtns(prefix, provider) {
  document.getElementById(`${prefix}ProvOpenai`).classList.toggle('active', provider === 'openai');
  document.getElementById(`${prefix}ProvGemini`).classList.toggle('active', provider === 'gemini');
}

function setupProviderToggle(prefix, getSet) {
  document.getElementById(`${prefix}ProvOpenai`).addEventListener('click', () => {
    getSet('openai');
    updateProviderBtns(prefix, 'openai');
  });
  document.getElementById(`${prefix}ProvGemini`).addEventListener('click', () => {
    getSet('gemini');
    updateProviderBtns(prefix, 'gemini');
  });
}

// ─── INIT ───
document.addEventListener('DOMContentLoaded', () => {
  // Admin login
  document.getElementById('adminLoginBtn').addEventListener('click', adminLogin);
  document.getElementById('adminPassInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') adminLogin();
  });
  document.getElementById('adminIdInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('adminPassInput').focus();
  });
  document.getElementById('adminLogoutBtn').addEventListener('click', adminLogout);

  // Create user modal
  document.getElementById('createUserBtn').addEventListener('click', openCreateModal);
  document.getElementById('createSaveBtn').addEventListener('click', createUser);
  document.getElementById('createCancelBtn').addEventListener('click', () => {
    document.getElementById('createUserModal').classList.remove('visible');
  });
  document.getElementById('createUserModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('createUserModal').classList.remove('visible');
  });

  // Edit user modal
  document.getElementById('editSaveBtn').addEventListener('click', saveEditUser);
  document.getElementById('editCancelBtn').addEventListener('click', () => {
    document.getElementById('editUserModal').classList.remove('visible');
  });
  document.getElementById('editUserModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) document.getElementById('editUserModal').classList.remove('visible');
  });

  // Provider toggles
  setupProviderToggle('new', (p) => { currentNewProvider = p; });
  setupProviderToggle('edit', (p) => { currentEditProvider = p; });

  // Check if already logged in
  if (sessionStorage.getItem('nutritrack_admin') === 'true') {
    showDashboard();
  }
});
