// =========================================================
// APNA SUPABASE PROJECT URL AUR ANON PUBLIC KEY YAHAN DALEIN
// =========================================================
const SUPABASE_URL = 'https://wwwrkbwycthgboqvljfy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__JjU5SFZFPvqLVbxpVXYJQ_v8s3CyNX';

const sb = window.supabase.createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim());

// GLOBAL STATE
let currentAdmin = null;
let allPlayers = [];
let setupState = {
  team1Name: '',
  team2Name: '',
  overs: 6,
  team1Players: [],
  team2Players: [],
  team1Captain: '',
  team2Captain: ''
};
let activeMatch = null;
let undoStack = [];

// AUTO-REFRESH TIMERS (1 SECOND LIVE SYNC)
let liveListInterval = null;
let liveScorecardInterval = null;
let liveAdminMatchInterval = null; // Admin screen sync timer

function stopAllLiveTimers() {
  if (liveListInterval) clearInterval(liveListInterval);
  if (liveScorecardInterval) clearInterval(liveScorecardInterval);
  if (liveAdminMatchInterval) clearInterval(liveAdminMatchInterval);
  liveListInterval = null;
  liveScorecardInterval = null;
  liveAdminMatchInterval = null;
}

// =========================================================
// 1. INITIALIZATION & AUTHENTICATION
// =========================================================
window.addEventListener('DOMContentLoaded', async () => {
  await checkAuthSession();
  await loadPlayers();
  showPublicTab('live');
});

async function checkAuthSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session && session.user) {
    const { data: adminData } = await sb
      .from('admins')
      .select('*')
      .or(`id.eq.${session.user.id},email.ilike.${session.user.email}`)
      .maybeSingle();

    if (adminData) {
      currentAdmin = adminData;
      applyAdminUI();
    }
  }
}

function applyAdminUI() {
  if (!currentAdmin) return;
  document.getElementById('menuBtn').classList.remove('hidden');
  document.getElementById('openLoginBtn').classList.add('hidden');
  document.getElementById('logoutBtn').classList.remove('hidden');

  const roleLabel = currentAdmin.role === 'super_admin' ? 'Super Admin' : 'Admin';
  const welcomeEl = document.getElementById('welcomeText');
  welcomeEl.textContent = `Welcome ${currentAdmin.name} (${roleLabel})`;
  welcomeEl.classList.remove('hidden');

  if (currentAdmin.role === 'super_admin') {
    document.getElementById('manageAdminsLink').classList.remove('hidden');
  } else {
    document.getElementById('manageAdminsLink').classList.add('hidden');
  }
}

async function loginAdmin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    errEl.textContent = error.message;
    errEl.classList.remove('hidden');
    return;
  }

  const { data: adminData, error: adminErr } = await sb
    .from('admins')
    .select('*')
    .or(`id.eq.${data.user.id},email.ilike.${email}`)
    .maybeSingle();

  if (adminErr || !adminData) {
    await sb.auth.signOut();
    errEl.textContent = adminErr
      ? `DB Error: ${adminErr.message}`
      : `Record not found for ${email} on URL: ${SUPABASE_URL}`;
    errEl.classList.remove('hidden');
    return;
  }

  currentAdmin = adminData;
  applyAdminUI();
  closeModal('loginModal');
  navigateAdmin('startMatch');
}

async function logoutAdmin() {
  stopAllLiveTimers();
  await sb.auth.signOut();
  currentAdmin = null;
  document.getElementById('menuBtn').classList.add('hidden');
  document.getElementById('welcomeText').classList.add('hidden');
  document.getElementById('logoutBtn').classList.add('hidden');
  document.getElementById('openLoginBtn').classList.remove('hidden');
  document.getElementById('adminDrawer').classList.add('hidden');
  goHome();
}

// =========================================================
// 2. NAVIGATION & MODALS
// =========================================================
function toggleDrawer() {
  document.getElementById('adminDrawer').classList.toggle('hidden');
}

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  if (id === 'popupModal' && liveScorecardInterval) {
    clearInterval(liveScorecardInterval);
    liveScorecardInterval = null;
  }
  document.getElementById(id).classList.add('hidden');
}

function goHome() {
  document.getElementById('publicNav').classList.remove('hidden');
  showPublicTab('live');
}

function showPublicTab(tab) {
  stopAllLiveTimers();
  document.getElementById('publicNav').classList.remove('hidden');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`tab-${tab}`);
  if (btn) btn.classList.add('active');

  if (tab === 'live') startPublicLiveAutoRefresh();
  if (tab === 'players') renderPublicPlayers();
  if (tab === 'recent') renderRecentMatches(false);
  if (tab === 'history') renderMatchHistory();
}

function navigateAdmin(section) {
  stopAllLiveTimers();
  toggleDrawer();
  document.getElementById('publicNav').classList.add('hidden');

  if (section === 'addPlayer') renderAddPlayerForm();
  if (section === 'startMatch') renderAdminMatchCenter();
  if (section === 'recentMatches') renderRecentMatches(true);
  if (section === 'manageAdmins') renderManageAdmins();
  if (section === 'changePassword') renderChangePassword();
}

// =========================================================
// 3. SUPER ADMIN: MANAGE ADMINS & CHANGE PASSWORD
// =========================================================
async function renderManageAdmins() {
  if (!currentAdmin || currentAdmin.role !== 'super_admin') return;
  const container = document.getElementById('appContainer');
  container.innerHTML = `<div class="card"><p>Loading admins...</p></div>`;

  const { data: admins } = await sb.from('admins').select('*').order('created_at', { ascending: true });

  container.innerHTML = `
    <div class="card">
      <h2>🛡️ Manage Admins (Super Admin Only)</h2>
      <p style="color:#94a3b8; font-size:0.85rem; margin-bottom:10px;">Naya Admin/Super Admin jodne ke liye details bharein:</p>
      <div class="grid-2">
        <input type="text" id="newAdminName" placeholder="Admin Name (e.g. Rahul)" />
        <input type="email" id="newAdminEmail" placeholder="Admin Email" />
        <input type="password" id="newAdminPass" placeholder="Password (min 6 chars)" />
        <select id="newAdminRole">
          <option value="admin">Normal Admin</option>
          <option value="super_admin">Super Admin</option>
        </select>
      </div>
      <button class="btn-success" onclick="createNewAdmin()">➕ Add Admin</button>
    </div>

    <div class="card">
      <h3>Existing Admins</h3>
      ${(admins || []).map(a => `
        <div class="player-item">
          <div>
            <strong>${a.name}</strong> (${a.email})
            <span class="badge ${a.role === 'super_admin' ? 'badge-potm' : 'badge-cap'}">${a.role.toUpperCase()}</span>
          </div>
          ${a.id !== currentAdmin.id
            ? `<button class="btn-danger btn-sm" onclick="deleteAdmin('${a.id}')">Delete</button>`
            : `<span style="color:#94a3b8; font-size:0.8rem;">(Current You)</span>`}
        </div>
      `).join('')}
    </div>
  `;
}

async function createNewAdmin() {
  const name = document.getElementById('newAdminName').value.trim();
  const email = document.getElementById('newAdminEmail').value.trim();
  const password = document.getElementById('newAdminPass').value;
  const role = document.getElementById('newAdminRole').value;

  if (!name || !email || password.length < 6) {
    alert('Please fill name, email, and at least 6-character password.');
    return;
  }

  const tempClient = window.supabase.createClient(SUPABASE_URL.trim(), SUPABASE_ANON_KEY.trim(), {
    auth: { persistSession: false }
  });

  const { data, error } = await tempClient.auth.signUp({ email, password });
  if (error) {
    alert('Error creating user: ' + error.message);
    return;
  }

  if (data.user) {
    const { error: dbErr } = await sb.from('admins').insert([{
      id: data.user.id,
      name,
      email,
      role
    }]);
    if (dbErr) {
      alert('Saved in Auth, but DB insert failed: ' + dbErr.message);
    } else {
      alert('Admin successfully added!');
      renderManageAdmins();
    }
  }
}

async function deleteAdmin(id) {
  if (!confirm('Kya aap sach me is admin ko remove karna chahte hain?')) return;
  const { error } = await sb.from('admins').delete().eq('id', id);
  if (error) alert(error.message);
  else renderManageAdmins();
}

function renderChangePassword() {
  document.getElementById('appContainer').innerHTML = `
    <div class="card">
      <h2>🔑 Change Password</h2>
      <input type="password" id="newPassInput" placeholder="Enter New Password (min 6 chars)" />
      <button class="btn-primary" onclick="updateAdminPassword()">Update Password</button>
    </div>
  `;
}

async function updateAdminPassword() {
  const newPassword = document.getElementById('newPassInput').value;
  if (newPassword.length < 6) return alert('Password kam se kam 6 akshar ka rakhein.');
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) alert(error.message);
  else alert('Password successfully updated!');
}

// =========================================================
// 4. PLAYERS & PHOTO MANAGEMENT (EDIT & DELETE PHOTO / SUPER ADMIN DELETE PLAYER)
// =========================================================
async function loadPlayers() {
  const { data } = await sb.from('players').select('*').order('name', { ascending: true });
  allPlayers = data || [];
}

function renderAddPlayerForm() {
  document.getElementById('appContainer').innerHTML = `
    <div class="card">
      <h2>➕ Add New Player</h2>
      <label>Full Name *</label>
      <input type="text" id="pFullName" placeholder="e.g. Virat Kumar" />
      <label>Nickname</label>
      <input type="text" id="pNickName" placeholder="e.g. Cheeku" />
      <label>Role</label>
      <input type="text" id="pRole" placeholder="e.g. Opening Batter" />
      <label>Player Photo (Optional)</label>
      <input type="file" id="pPhotoFile" accept="image/*" />
      <button class="btn-success" onclick="saveNewPlayer()">Save Player</button>
    </div>
  `;
}

async function saveNewPlayer() {
  const name = document.getElementById('pFullName').value.trim();
  const nickname = document.getElementById('pNickName').value.trim();
  const role = document.getElementById('pRole').value.trim();
  const fileInput = document.getElementById('pPhotoFile');

  if (!name) return alert('Player ka naam likhna zaroori hai.');

  let photo_url = '';
  if (fileInput.files.length > 0) {
    const file = fileInput.files[0];
    const fileName = `${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
    const { error: upErr } = await sb.storage.from('player-photos').upload(fileName, file);
    if (!upErr) {
      const { data: urlData } = sb.storage.from('player-photos').getPublicUrl(fileName);
      photo_url = urlData.publicUrl;
    }
  }

  const { error } = await sb.from('players').insert([{ name, nickname, role, photo_url, is_guest: false }]);
  if (error) {
    alert(error.message);
  } else {
    alert('Player saved!');
    await loadPlayers();
    renderAddPlayerForm();
  }
}

// Player details edit
function editPlayer(playerId) {
  const p = allPlayers.find(x => x.id === playerId);
  if (!p) return;

  document.getElementById('editPlayerId').value = p.id;
  document.getElementById('editPlayerName').value = p.name;
  document.getElementById('editPlayerNick').value = p.nickname || '';
  document.getElementById('editPlayerRole').value = p.role || '';
  
  const preview = document.getElementById('editPlayerPhotoPreview');
  preview.innerHTML = p.photo_url 
    ? `<div style="display:flex; align-items:center; gap:8px;">
         <img src="${p.photo_url}" class="avatar" />
         <button class="btn-danger btn-sm" type="button" onclick="deletePlayerPhoto('${p.id}')">Delete Photo</button>
       </div>`
    : `<span style="color:#64748b; font-size:0.8rem;">No photo uploaded.</span>`;

  openModal('editPlayerModal');
}

async function deletePlayerPhoto(playerId) {
  if (!confirm('Kya aap sach me ye photo delete karna chahte hain?')) return;
  const { error } = await sb.from('players').update({ photo_url: '' }).eq('id', playerId);
  if (error) {
    alert(error.message);
  } else {
    alert('Photo deleted!');
    closeModal('editPlayerModal');
    await loadPlayers();
    navigateAdmin('startMatch'); // list refresh
  }
}

async function saveEditedPlayer() {
  const id = document.getElementById('editPlayerId').value;
  const name = document.getElementById('editPlayerName').value.trim();
  const nickname = document.getElementById('editPlayerNick').value.trim();
  const role = document.getElementById('editPlayerRole').value.trim();
  const fileInput = document.getElementById('editPlayerPhotoFile');

  if (!name) return alert('Name required.');

  let photo_url = undefined;
  if (fileInput.files.length > 0) {
    const file = fileInput.files[0];
    const fileName = `${Date.now()}_${file.name.replace(/\s+/g, '_')}`;
    const { error: upErr } = await sb.storage.from('player-photos').upload(fileName, file);
    if (!upErr) {
      const { data: urlData } = sb.storage.from('player-photos').getPublicUrl(fileName);
      photo_url = urlData.publicUrl;
    }
  }

  const payload = { name, nickname, role };
  if (photo_url !== undefined) payload.photo_url = photo_url;

  const { error } = await sb.from('players').update(payload).eq('id', id);
  if (error) {
    alert(error.message);
  } else {
    alert('Player updated!');
    closeModal('editPlayerModal');
    await loadPlayers();
    // automatic list reload
    renderPublicPlayers();
  }
}

async function deletePlayer(playerId) {
  if (!currentAdmin || currentAdmin.role !== 'super_admin') {
    return alert('Sirf Super Admin hi player delete kar sakta hai.');
  }
  if (!confirm('Warning: Player delete karne se unka saara purana career data database se mit jayega! Kya aap delete karna chahte hain?')) return;

  const { error } = await sb.from('players').delete().eq('id', playerId);
  if (error) {
    alert(error.message);
  } else {
    alert('Player successfully deleted!');
    await loadPlayers();
    renderPublicPlayers();
  }
}

// 100% Accuracy from Completed Matches Scorecards (Live Sync)
async function calculateCareerStatsLive(playerId) {
  const { data: matches } = await sb.from('matches').select('*').eq('status', 'completed');
  const result = {}; // format -> statistics

  (matches || []).forEach(m => {
    const fmt = m.total_overs;
    const i1 = m.scorecard.innings1;
    const i2 = m.scorecard.innings2;
    if (!i1 || !i2) return;

    if (!result[fmt]) {
      result[fmt] = {
        overs_format: fmt, bat_matches: 0, bat_innings: 0, not_outs: 0, runs: 0, highest_score: 0, highest_not_out: false,
        balls_faced: 0, fours: 0, sixes: 0, thirties: 0, fifties: 0, hundreds: 0, ducks: 0,
        bowl_matches: 0, bowl_innings: 0, balls_bowled: 0, maidens: 0, runs_conceded: 0, wickets: 0,
        best_wickets: 0, best_runs: 999, three_wickets: 0, five_wickets: 0, wides: 0, no_balls: 0
      };
    }
    const stat = result[fmt];

    let t1InSquad = i1.batSquad.some(p => p.id === playerId);
    let t2InSquad = i2.batSquad.some(p => p.id === playerId);
    if (t1InSquad || t2InSquad) {
      stat.bat_matches += 1;
      stat.bowl_matches += 1; // standard count as part of standard squad
    }

    [i1, i2].forEach(inn => {
      const bat = inn.batters.find(b => b.id === playerId);
      if (bat && (bat.balls > 0 || bat.out)) {
        stat.bat_innings += 1;
        if (!bat.out) stat.not_outs += 1;
        stat.runs += bat.runs;
        stat.balls_faced += bat.balls;
        stat.fours += bat.fours;
        stat.sixes += bat.sixes;
        if (bat.runs === 0 && bat.out) stat.ducks += 1;
        if (bat.runs >= 100) stat.hundreds += 1;
        else if (bat.runs >= 50) stat.fifties += 1;
        else if (bat.runs >= 30) stat.thirties += 1;

        if (bat.runs > stat.highest_score || (bat.runs === stat.highest_score && !bat.out)) {
          stat.highest_score = bat.runs;
          stat.highest_not_out = !bat.out;
        }
      }

      const bowl = inn.bowlers.find(b => b.id === playerId);
      if (bowl && bowl.balls > 0) {
        stat.bowl_innings += 1;
        stat.balls_bowled += bowl.balls;
        stat.maidens += bowl.maidens;
        stat.runs_conceded += bowl.runs;
        stat.wickets += bowl.wickets;
        stat.wides += bowl.wides || 0;
        stat.no_balls += bowl.noBalls || 0;
        if (bowl.wickets >= 5) stat.five_wickets += 1;
        else if (bowl.wickets >= 3) stat.three_wickets += 1;

        if (bowl.wickets > stat.best_wickets || (bowl.wickets === stat.best_wickets && bowl.runs < stat.best_runs)) {
          stat.best_wickets = bowl.wickets;
          stat.best_runs = bowl.runs;
        }
      }
    });
  });

  return Object.values(result).filter(s => s.bat_matches > 0 || s.bowl_matches > 0);
}

async function renderPublicPlayers() {
  await loadPlayers();
  const container = document.getElementById('appContainer');
  container.innerHTML = `
    <div class="card">
      <h2>📊 Academy Players & Career Stats (100% Accurate)</h2>
      <input type="text" id="playerSearchBox" placeholder="🔍 Search player by name..." oninput="filterPublicPlayers()" />
      <div id="publicPlayerList"></div>
    </div>
  `;
  filterPublicPlayers();
}

function filterPublicPlayers() {
  const q = (document.getElementById('playerSearchBox')?.value || '').toLowerCase();
  const filtered = allPlayers.filter(p => p.name.toLowerCase().includes(q));

  const isSuperAdmin = currentAdmin && currentAdmin.role === 'super_admin';

  document.getElementById('publicPlayerList').innerHTML = filtered.map(p => `
    <div class="player-item">
      <div class="player-info" style="cursor:pointer" onclick="openPlayerCareer('${p.id}')">
        <img class="avatar" src="${p.photo_url || 'https://ui-avatars.com/api/?background=334155&color=fff&name=' + encodeURIComponent(p.name)}" />
        <div>
          <strong>${p.name}</strong> ${p.nickname ? `<span style="color:#94a3b8;">(${p.nickname})</span>` : ''}
          <div style="font-size:0.8rem; color:#38bdf8;">${p.role || (p.is_guest ? 'Guest' : 'Player')}</div>
        </div>
      </div>
      <div style="display:flex; gap:6px;">
        <button class="btn-secondary btn-sm" onclick="openPlayerCareer('${p.id}')">View Stats ➔</button>
        ${currentAdmin ? `<button class="btn-warning btn-sm" onclick="editPlayer('${p.id}')">Edit</button>` : ''}
        ${isSuperAdmin ? `<button class="btn-danger btn-sm" onclick="deletePlayer('${p.id}')">Delete</button>` : ''}
      </div>
    </div>
  `).join('') || '<p style="color:#94a3b8;">No players found.</p>';
}

async function openPlayerCareer(playerId) {
  const player = allPlayers.find(p => p.id === playerId);
  const stats = await calculateCareerStatsLive(playerId);

  const overHeaders = stats.map(f => `<th>${f.overs_format} Ov</th>`).join('');

  const batRows = [
    { label: 'Matches', fn: s => s.bat_matches },
    { label: 'Innings', fn: s => s.bat_innings },
    { label: 'Not Outs', fn: s => s.not_outs },
    { label: 'Runs', fn: s => s.runs },
    { label: 'Highest Score', fn: s => `${s.highest_score}${s.highest_not_out ? '*' : ''}` },
    { label: 'Average', fn: s => {
      const outs = s.bat_innings - s.not_outs;
      return outs > 0 ? (s.runs / outs).toFixed(2) : (s.runs > 0 ? s.runs.toFixed(2) : '0.00');
    }},
    { label: 'Balls Faced', fn: s => s.balls_faced },
    { label: 'Strike Rate', fn: s => s.balls_face
