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
  team1Players: [], // {id, name, is_captain, is_common}
  team2Players: [],
  team1Captain: '',
  team2Captain: ''
};
let activeMatch = null;
let undoStack = [];

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
  document.getElementById(id).classList.add('hidden');
}

function goHome() {
  document.getElementById('publicNav').classList.remove('hidden');
  showPublicTab('live');
}

function showPublicTab(tab) {
  document.getElementById('publicNav').classList.remove('hidden');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  const btn = document.getElementById(`tab-${tab}`);
  if (btn) btn.classList.add('active');

  if (tab === 'live') renderPublicLiveMatches();
  if (tab === 'players') renderPublicPlayers();
  if (tab === 'recent') renderRecentMatches(false);
}

function navigateAdmin(section) {
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
      <p style="color:#94a3b8; font-size:0.85rem; margin-bottom:10px;">
        Naya Admin ya Super Admin jodne ke liye yahan details bharein:
      </p>
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
// 4. PLAYERS MANAGEMENT & 16/14 ROW CAREER PROFILE
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
      <input type="text" id="pRole" placeholder="e.g. Opening Batter / All-Rounder" />
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

async function renderPublicPlayers() {
  await loadPlayers();
  const container = document.getElementById('appContainer');
  container.innerHTML = `
    <div class="card">
      <h2>📊 Academy Players & Career Stats</h2>
      <input type="text" id="playerSearchBox" placeholder="🔍 Search player by name or nickname..." oninput="filterPublicPlayers()" />
      <div id="publicPlayerList"></div>
    </div>
  `;
  filterPublicPlayers();
}

function filterPublicPlayers() {
  const q = (document.getElementById('playerSearchBox')?.value || '').toLowerCase();
  const filtered = allPlayers.filter(p =>
    p.name.toLowerCase().includes(q) || (p.nickname && p.nickname.toLowerCase().includes(q))
  );

  document.getElementById('publicPlayerList').innerHTML = filtered.map(p => `
    <div class="player-item" style="cursor:pointer" onclick="openPlayerCareer('${p.id}')">
      <div class="player-info">
        <img class="avatar" src="${p.photo_url || 'https://ui-avatars.com/api/?background=334155&color=fff&name=' + encodeURIComponent(p.name)}" />
        <div>
          <strong>${p.name}</strong> ${p.nickname ? `<span style="color:#94a3b8;">(${p.nickname})</span>` : ''}
          <div style="font-size:0.8rem; color:#38bdf8;">${p.role || (p.is_guest ? 'Guest Player' : 'Player')}</div>
        </div>
      </div>
      <button class="btn-secondary btn-sm">View Stats ➔</button>
    </div>
  `).join('') || '<p style="color:#94a3b8;">No players found.</p>';
}

async function openPlayerCareer(playerId) {
  const player = allPlayers.find(p => p.id === playerId);
  const { data: stats } = await sb
    .from('player_format_stats')
    .select('*')
    .eq('player_id', playerId)
    .order('overs_format', { ascending: true });

  const formats = stats || [];
  const overHeaders = formats.map(f => `<th>${f.overs_format} Ov</th>`).join('');

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
    { label: 'Strike Rate', fn: s => s.balls_faced > 0 ? ((s.runs / s.balls_faced) * 100).toFixed(2) : '0.00' },
    { label: '100s', fn: s => s.hundreds },
    { label: '50s', fn: s => s.fifties },
    { label: '30s', fn: s => s.thirties },
    { label: '4s', fn: s => s.fours },
    { label: '6s', fn: s => s.sixes },
    { label: 'Ducks (0)', fn: s => s.ducks },
    { label: 'Boundary Runs', fn: s => (s.fours * 4) + (s.sixes * 6) },
    { label: 'Boundary %', fn: s => s.runs > 0 ? ((((s.fours * 4) + (s.sixes * 6)) / s.runs) * 100).toFixed(1) + '%' : '0%' }
  ];

  const bowlRows = [
    { label: 'Matches', fn: s => s.bowl_matches },
    { label: 'Innings', fn: s => s.bowl_innings },
    { label: 'Overs', fn: s => `${Math.floor(s.balls_bowled / 6)}.${s.balls_bowled % 6}` },
    { label: 'Balls', fn: s => s.balls_bowled },
    { label: 'Maidens', fn: s => s.maidens },
    { label: 'Runs Conceded', fn: s => s.runs_conceded },
    { label: 'Wickets', fn: s => s.wickets },
    { label: 'BBI (Best)', fn: s => s.best_wickets > 0 ? `${s.best_wickets}/${s.best_runs}` : '-' },
    { label: 'Economy', fn: s => s.balls_bowled > 0 ? (s.runs_conceded / (s.balls_bowled / 6)).toFixed(2) : '0.00' },
    { label: 'Average', fn: s => s.wickets > 0 ? (s.runs_conceded / s.wickets).toFixed(2) : '0.00' },
    { label: 'Strike Rate', fn: s => s.wickets > 0 ? (s.balls_bowled / s.wickets).toFixed(1) : '0.0' },
    { label: '3-Wicket Hauls', fn: s => s.three_wickets },
    { label: '5-Wicket Hauls', fn: s => s.five_wickets },
    { label: 'Extras (WD+NB)', fn: s => s.wides + s.no_balls }
  ];

  const renderTable = (rows) => formats.length === 0
    ? `<p style="color:#94a3b8; margin:8px 0;">Abhi tak koi match data nahi hai (All stats 0).</p>`
    : `<div class="stats-table-wrap">
        <table class="stats-table">
          <thead><tr><th>Statistic</th>${overHeaders}</tr></thead>
          <tbody>
            ${rows.map(r => `<tr><td>${r.label}</td>${formats.map(f => `<td>${r.fn(f)}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>`;

  document.getElementById('popupContent').innerHTML = `
    <div class="row-between">
      <div class="player-info">
        <img class="avatar" src="${player.photo_url || 'https://ui-avatars.com/api/?background=334155&color=fff&name=' + encodeURIComponent(player.name)}" />
        <div>
          <h3>${player.name} ${player.nickname ? `(${player.nickname})` : ''}</h3>
          <span style="color:#38bdf8; font-size:0.85rem;">${player.role || 'Player'}</span>
        </div>
      </div>
      <button class="btn-secondary btn-sm" onclick="closeModal('popupModal')">✕ Close</button>
    </div>

    <h4 style="margin-top:16px; color:#facc15;">🏏 Batting Career (16 Rows)</h4>
    ${renderTable(batRows)}

    <h4 style="margin-top:18px; color:#38bdf8;">⚾ Bowling Career (14 Rows)</h4>
    ${renderTable(bowlRows)}
  `;
  openModal('popupModal');
}

// =========================================================
// 5. ADMIN MATCH SETUP (1-20 OVERS, COMMON, GUEST, CAPTAINS)
// =========================================================
async function renderAdminMatchCenter() {
  const { data: liveMatches } = await sb.from('matches').select('*').eq('status', 'live');
  if (liveMatches && liveMatches.length > 0) {
    activeMatch = liveMatches[0];
    renderLiveScoringScreen();
    return;
  }
  await loadPlayers();
  renderMatchSetupForm();
}

function renderMatchSetupForm() {
  const overOptions = Array.from({ length: 20 }, (_, i) => i + 1)
    .map(n => `<option value="${n}" ${n === setupState.overs ? 'selected' : ''}>${n} Over${n > 1 ? 's' : ''}</option>`)
    .join('');

  document.getElementById('appContainer').innerHTML = `
    <div class="card">
      <h2>🏏 Setup New Live Match</h2>
      <div class="grid-2">
        <div>
          <label>Team 1 Name *</label>
          <input type="text" id="t1NameInput" value="${setupState.team1Name}" placeholder="e.g. Royal Strikers" oninput="setupState.team1Name=this.value" />
        </div>
        <div>
          <label>Team 2 Name *</label>
          <input type="text" id="t2NameInput" value="${setupState.team2Name}" placeholder="e.g. Super Kings" oninput="setupState.team2Name=this.value" />
        </div>
      </div>

      <label>Please select how many overs the match is (1 to 20 Overs):</label>
      <select id="matchOversSelect" onchange="setupState.overs=parseInt(this.value)">
        ${overOptions}
      </select>

      <div class="grid-2" style="margin-top:10px;">
        <div class="card" style="background:#0f172a;">
          <div class="row-between">
            <h4>${setupState.team1Name || 'Team 1'} Squad (${setupState.team1Players.length})</h4>
            <button class="btn-primary btn-sm" onclick="openPlayerSelector(1)">+ Select Players</button>
          </div>
          <div id="t1SquadList" style="margin-top:10px;">
            ${renderSelectedSquad(1)}
          </div>
          <label>Select Team 1 Captain:</label>
          <select onchange="setupState.team1Captain=this.value">
            <option value="">-- Choose Captain --</option>
            ${setupState.team1Players.map(p => `<option value="${p.id}" ${setupState.team1Captain === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
          </select>
        </div>

        <div class="card" style="background:#0f172a;">
          <div class="row-between">
            <h4>${setupState.team2Name || 'Team 2'} Squad (${setupState.team2Players.length})</h4>
            <button class="btn-primary btn-sm" onclick="openPlayerSelector(2)">+ Select Players</button>
          </div>
          <div id="t2SquadList" style="margin-top:10px;">
            ${renderSelectedSquad(2)}
          </div>
          <label>Select Team 2 Captain:</label>
          <select onchange="setupState.team2Captain=this.value">
            <option value="">-- Choose Captain --</option>
            ${setupState.team2Players.map(p => `<option value="${p.id}" ${setupState.team2Captain === p.id ? 'selected' : ''}>${p.name}</option>`).join('')}
          </select>
        </div>
      </div>

      <button class="btn-success" style="width:100%; padding:12px; font-size:1rem; margin-top:10px;" onclick="proceedToToss()">
        Start Match (Go to Toss) ➔
      </button>
    </div>
  `;
}

function renderSelectedSquad(teamNum) {
  const list = teamNum === 1 ? setupState.team1Players : setupState.team2Players;
  if (list.length === 0) return `<p style="color:#64748b; font-size:0.85rem;">No players added yet.</p>`;
  return list.map(p => `
    <div class="player-item" style="padding:6px 10px;">
      <span>
        ${p.name}
        ${p.is_common ? `<span class="badge badge-common">[COMMON]</span>` : ''}
      </span>
      <button class="btn-danger btn-sm" onclick="removeSquadPlayer(${teamNum}, '${p.id}')">✕</button>
    </div>
  `).join('');
}

function removeSquadPlayer(teamNum, playerId) {
  if (teamNum === 1) {
    setupState.team1Players = setupState.team1Players.filter(p => p.id !== playerId);
    if (setupState.team1Captain === playerId) setupState.team1Captain = '';
  } else {
    setupState.team2Players = setupState.team2Players.filter(p => p.id !== playerId);
    if (setupState.team2Captain === playerId) setupState.team2Captain = '';
  }
  renderMatchSetupForm();
}

function openPlayerSelector(teamNum) {
  document.getElementById('popupContent').innerHTML = `
    <div class="row-between">
      <h3>Select Players for ${teamNum === 1 ? (setupState.team1Name || 'Team 1') : (setupState.team2Name || 'Team 2')}</h3>
      <button class="btn-secondary btn-sm" onclick="closeModal('popupModal'); renderMatchSetupForm();">Done ✓</button>
    </div>
    <input type="text" id="squadSearchInput" placeholder="🔍 Search player..." oninput="renderSelectorList(${teamNum})" />
    <div id="selectorListArea" style="max-height:280px; overflow-y:auto;"></div>

    <div style="border-top:1px solid #334155; margin-top:12px; padding-top:10px;">
      <h4>⚡ Quick Add Guest Player (Only Name Required)</h4>
      <div class="row-between">
        <input type="text" id="guestPlayerName" placeholder="Guest Player Name" style="flex:1;" />
        <button class="btn-success" onclick="addGuestPlayerInSetup(${teamNum})">+ Add Guest</button>
      </div>
    </div>
  `;
  openModal('popupModal');
  renderSelectorList(teamNum);
}

function renderSelectorList(teamNum) {
  const q = (document.getElementById('squadSearchInput')?.value || '').toLowerCase();
  const currentList = teamNum === 1 ? setupState.team1Players : setupState.team2Players;
  const otherList = teamNum === 1 ? setupState.team2Players : setupState.team1Players;

  const filtered = allPlayers.filter(p => p.name.toLowerCase().includes(q));
  document.getElementById('selectorListArea').innerHTML = filtered.map(p => {
    const inCurrent = currentList.some(x => x.id === p.id);
    const inOther = otherList.find(x => x.id === p.id);
    const isOtherNonCommon = inOther && !inOther.is_common;

    return `
      <div class="player-item">
        <div>
          <strong>${p.name}</strong>
          ${inOther ? `<span class="badge badge-common">In Other Team</span>` : ''}
        </div>
        <div style="display:flex; gap:6px;">
          ${inCurrent
            ? `<button class="btn-danger btn-sm" onclick="togglePlayerInTeam(${teamNum}, '${p.id}', false)">Remove</button>`
            : isOtherNonCommon
              ? `<button class="btn-warning btn-sm" onclick="makeCommonAndAdd(${teamNum}, '${p.id}')">+ Add as [COMMON]</button>`
              : `<button class="btn-primary btn-sm" onclick="togglePlayerInTeam(${teamNum}, '${p.id}', false)">+ Add</button>
                 <button class="btn-warning btn-sm" onclick="togglePlayerInTeam(${teamNum}, '${p.id}', true)">+ [COMMON]</button>`
          }
        </div>
      </div>
    `;
  }).join('');
}

function togglePlayerInTeam(teamNum, playerId, isCommon) {
  const p = allPlayers.find(x => x.id === playerId);
  const target = teamNum === 1 ? setupState.team1Players : setupState.team2Players;
  const idx = target.findIndex(x => x.id === playerId);

  if (idx >= 0) {
    target.splice(idx, 1);
  } else {
    target.push({ id: p.id, name: p.name, is_common: isCommon });
    if (isCommon) {
      const other = teamNum === 1 ? setupState.team2Players : setupState.team1Players;
      if (!other.some(x => x.id === p.id)) {
        other.push({ id: p.id, name: p.name, is_common: true });
      }
    }
  }
  renderSelectorList(teamNum);
}

function makeCommonAndAdd(teamNum, playerId) {
  const p = allPlayers.find(x => x.id === playerId);
  const other = teamNum === 1 ? setupState.team2Players : setupState.team1Players;
  const target = teamNum === 1 ? setupState.team1Players : setupState.team2Players;
  const existing = other.find(x => x.id === playerId);
  if (existing) existing.is_common = true;
  target.push({ id: p.id, name: p.name, is_common: true });
  renderSelectorList(teamNum);
}

async function addGuestPlayerInSetup(teamNum) {
  const name = document.getElementById('guestPlayerName').value.trim();
  if (!name) return;
  const { data, error } = await sb.from('players').insert([{ name, is_guest: true }]).select().single();
  if (error) return alert(error.message);
  allPlayers.push(data);
  togglePlayerInTeam(teamNum, data.id, false);
  document.getElementById('guestPlayerName').value = '';
}

// =========================================================
// 6. TOSS & OPENING BATTERS / BOWLER SETUP
// =========================================================
function proceedToToss() {
  if (!setupState.team1Name.trim() || !setupState.team2Name.trim()) {
    return alert('Dono teams ke naam likhein.');
  }
  if (setupState.team1Players.length < 1 || setupState.team2Players.length < 1) {
    return alert('Dono teams me kam se kam 1-1 khiladi chunein.');
  }

  const t1Final = setupState.team1Players.map(p => ({ ...p, is_captain: p.id === setupState.team1Captain }));
  const t2Final = setupState.team2Players.map(p => ({ ...p, is_captain: p.id === setupState.team2Captain }));

  document.getElementById('popupContent').innerHTML = `
    <h3>🪙 Who won the toss?</h3>
    <div class="grid-2" style="margin-top:12px;">
      <button class="btn-primary" style="padding:14px;" onclick="selectTossWinner('${setupState.team1Name}')">${setupState.team1Name}</button>
      <button class="btn-primary" style="padding:14px;" onclick="selectTossWinner('${setupState.team2Name}')">${setupState.team2Name}</button>
    </div>
  `;
  setupState.t1Final = t1Final;
  setupState.t2Final = t2Final;
  openModal('popupModal');
}

function selectTossWinner(winnerName) {
  setupState.tossWinner = winnerName;
  document.getElementById('popupContent').innerHTML = `
    <h3>${winnerName} won the toss!</h3>
    <p style="color:#94a3b8; margin-bottom:12px;">What did ${winnerName} opt to do?</p>
    <div class="grid-2">
      <button class="btn-success" style="padding:14px;" onclick="chooseTossDecision('bat')">🏏 Bat First</button>
      <button class="btn-warning" style="padding:14px;" onclick="chooseTossDecision('bowl')">⚾ Bowl First</button>
    </div>
  `;
}

function chooseTossDecision(decision) {
  const t1IsWinner = setupState.tossWinner === setupState.team1Name;
  const batFirstTeam = (decision === 'bat')
    ? (t1IsWinner ? { name: setupState.team1Name, players: setupState.t1Final } : { name: setupState.team2Name, players: setupState.t2Final })
    : (t1IsWinner ? { name: setupState.team2Name, players: setupState.t2Final } : { name: setupState.team1Name, players: setupState.t1Final });

  const bowlFirstTeam = batFirstTeam.name === setupState.team1Name
    ? { name: setupState.team2Name, players: setupState.t2Final }
    : { name: setupState.team1Name, players: setupState.t1Final };

  openInningsSetupModal(1, batFirstTeam, bowlFirstTeam, decision);
}

function openInningsSetupModal(inningsNum, batTeam, bowlTeam, tossDecision = '') {
  const batOpts = batTeam.players.map(p => `<option value="${p.id}">${p.name} ${p.is_captain ? '(C)' : ''}</option>`).join('');
  const bowlOpts = bowlTeam.players.map(p => `<option value="${p.id}">${p.name} ${p.is_captain ? '(C)' : ''}</option>`).join('');

  document.getElementById('popupContent').innerHTML = `
    <h3>Innings ${inningsNum} Opening Setup</h3>
    <label>Select Batter 1 (Striker) — ${batTeam.name}:</label>
    <select id="openStriker" onchange="syncOpenerDropdowns()">${batOpts}</select>

    <label>Select Batter 2 (Non-Striker) — ${batTeam.name}:</label>
    <select id="openNonStriker">
      ${batTeam.players.length > 1 ? batOpts : '<option value="">-- Single Batter (Gully Rule) --</option>'}
    </select>

    <label>Select Opening Bowler — ${bowlTeam.name}:</label>
    <select id="openBowler">${bowlOpts}</select>

    <button class="btn-success" style="width:100%; margin-top:12px; padding:12px;"
      onclick='beginInnings(${inningsNum}, ${JSON.stringify(batTeam)}, ${JSON.stringify(bowlTeam)}, "${tossDecision}")'>
      Begin Innings ${inningsNum} 🏏
    </button>
  `;
  if (batTeam.players.length > 1) {
    document.getElementById('openNonStriker').selectedIndex = 1;
  }
  syncOpenerDropdowns();
  openModal('popupModal');
}

function syncOpenerDropdowns() {
  const s1 = document.getElementById('openStriker').value;
  const s2El = document.getElementById('openNonStriker');
  Array.from(s2El.options).forEach(opt => {
    opt.disabled = (opt.value !== '' && opt.value === s1);
  });
}

async function beginInnings(inningsNum, batTeam, bowlTeam, tossDecision) {
  const strikerId = document.getElementById('openStriker').value;
  const nonStrikerId = document.getElementById('openNonStriker').value;
  const bowlerId = document.getElementById('openBowler').value;

  const createInningsObj = (bTeam, bwTeam, sId, nsId, bwId) => {
    const sPlayer = bTeam.players.find(p => p.id === sId);
    const nsPlayer = bTeam.players.find(p => p.id === nsId);
    const bwPlayer = bwTeam.players.find(p => p.id === bwId);

    const batters = [{ id: sPlayer.id, name: sPlayer.name, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: 'not out' }];
    if (nsPlayer) {
      batters.push({ id: nsPlayer.id, name: nsPlayer.name, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: 'not out' });
    }

    return {
      batTeamName: bTeam.name,
      bowlTeamName: bwTeam.name,
      batSquad: bTeam.players,
      bowlSquad: bwTeam.players,
      runs: 0,
      wickets: 0,
      legalBalls: 0,
      extras: { wd: 0, nb: 0, b: 0, lb: 0 },
      strikerId: sPlayer.id,
      nonStrikerId: nsPlayer ? nsPlayer.id : null,
      currentBowlerId: bwPlayer.id,
      lastOverBowlerId: null,
      batters,
      bowlers: [{ id: bwPlayer.id, name: bwPlayer.name, balls: 0, maidens: 0, runs: 0, wickets: 0, wides: 0, noBalls: 0, currentOverRuns: 0 }],
      ballsHistory: []
    };
  };

  if (inningsNum === 1) {
    const scorecard = {
      currentInnings: 1,
      innings1: createInningsObj(batTeam, bowlTeam, strikerId, nonStrikerId, bowlerId),
      innings2: null
    };

    const { data, error } = await sb.from('matches').insert([{
      team1_name: setupState.team1Name,
      team2_name: setupState.team2Name,
      total_overs: setupState.overs,
      team1_players: setupState.t1Final,
      team2_players: setupState.t2Final,
      toss_winner: setupState.tossWinner,
      toss_decision: tossDecision,
      status: 'live',
      scorecard
    }]).select().single();

    if (error) return alert(error.message);
    activeMatch = data;
  } else {
    activeMatch.scorecard.currentInnings = 2;
    activeMatch.scorecard.innings2 = createInningsObj(batTeam, bowlTeam, strikerId, nonStrikerId, bowlerId);
    await syncLiveMatchToDB();
  }

  undoStack = [];
  closeModal('popupModal');
  renderLiveScoringScreen();
}

// =========================================================
// 7. BALL-BY-BALL LIVE SCORING ENGINE
// =========================================================
function getCurrentInnings() {
  return activeMatch.scorecard.currentInnings === 1
    ? activeMatch.scorecard.innings1
    : activeMatch.scorecard.innings2;
}

function renderLiveScoringScreen() {
  const inn = getCurrentInnings();
  const oversText = `${Math.floor(inn.legalBalls / 6)}.${inn.legalBalls % 6}`;
  const striker = inn.batters.find(b => b.id === inn.strikerId);
  const nonStriker = inn.batters.find(b => b.id === inn.nonStrikerId);
  const bowler = inn.bowlers.find(b => b.id === inn.currentBowlerId);

  const targetBanner = activeMatch.scorecard.currentInnings === 2
    ? `<div style="color:#facc15; font-weight:600; margin-top:4px;">
        Target: ${activeMatch.scorecard.innings1.runs + 1} | Need ${Math.max(0, (activeMatch.scorecard.innings1.runs + 1) - inn.runs)} runs in ${(activeMatch.total_overs * 6) - inn.legalBalls} balls
       </div>`
    : '';

  const recentBalls = inn.ballsHistory.slice(-12).map(b => {
    let cls = 'ball-pill';
    if (b === '4') cls += ' ball-4';
    else if (b === '6') cls += ' ball-6';
    else if (b.startsWith('W')) cls += ' ball-w';
    else if (b.includes('WD') || b.includes('NB')) cls += ' ball-extra';
    return `<span class="${cls}">${b}</span>`;
  }).join('');

  document.getElementById('appContainer').innerHTML = `
    <div class="score-banner">
      <div class="row-between">
        <div>
          <span class="badge badge-live">LIVE • ${activeMatch.total_overs} OVERS</span>
          <h2 style="margin-top:6px;">${inn.batTeamName} vs ${inn.bowlTeamName}</h2>
        </div>
        <div class="big-score">${inn.runs}/${inn.wickets} <span style="font-size:1.1rem; color:#cbd5e1;">(${oversText})</span></div>
      </div>
      ${targetBanner}
      <div class="ball-timeline">${recentBalls || '<span style="color:#64748b;">Ready for 1st ball...</span>'}</div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="row-between">
          <h4>🏏 Batting</h4>
          <button class="btn-secondary btn-sm" onclick="manualSwapStrike()">⇄ Swap Strike</button>
        </div>
        <p style="margin:6px 0; color:#38bdf8; font-weight:700;">
          * ${striker ? `${striker.name} — ${striker.runs} (${striker.balls}) [4s:${striker.fours}, 6s:${striker.sixes}]` : '-'}
        </p>
        <p style="color:#cbd5e1;">
          ${nonStriker ? `${nonStriker.name} — ${nonStriker.runs} (${nonStriker.balls})` : '(Single Batter)'}
        </p>
      </div>

      <div class="card">
        <h4>⚾ Current Bowler</h4>
        <p style="margin-top:8px; font-weight:700; color:#facc15;">
          ${bowler ? `${bowler.name} — ${Math.floor(bowler.balls / 6)}.${bowler.balls % 6}-${bowler.maidens}-${bowler.runs}-${bowler.wickets}` : '-'}
        </p>
      </div>
    </div>

    <div class="card">
      <div class="row-between">
        <h3>🎯 Next Ball: Over ${Math.floor(inn.legalBalls / 6)}.${(inn.legalBalls % 6) + 1}</h3>
        <button class="btn-warning btn-sm" onclick="undoLastBall()" ${undoStack.length === 0 ? 'disabled' : ''}>↩ Undo Last Ball</button>
      </div>

      <label>Select Ball Outcome:</label>
      <select id="ballOutcomeSelect">
        <option value="0">0 Run (Dot Ball)</option>
        <option value="1">1 Run</option>
        <option value="2">2 Runs</option>
        <option value="3">3 Runs</option>
        <option value="4">4 (Chauka / Four)</option>
        <option value="5">5 Runs</option>
        <option value="6">6 (Chhakka / Six)</option>
        <option value="WD">Wide (WD + 1)</option>
        <option value="WD+1">Wide + 1 Run (2 Runs)</option>
        <option value="WD+2">Wide + 2 Runs (3 Runs)</option>
        <option value="WD+4">Wide + 4 Runs (5 Runs)</option>
        <option value="NB">No Ball (NB + 1)</option>
        <option value="NB+1">No Ball + 1 Run</option>
        <option value="NB+2">No Ball + 2 Runs</option>
        <option value="NB+4">No Ball + 4 Runs</option>
        <option value="NB+6">No Ball + 6 Runs</option>
        <option value="B1">Bye 1 Run</option>
        <option value="B2">Bye 2 Runs</option>
        <option value="LB1">Leg Bye 1 Run</option>
        <option value="LB2">Leg Bye 2 Runs</option>
        <option value="WICKET">🔴 WICKET (Bowled / Caught By)</option>
      </select>

      <button class="btn-success" style="width:100%; padding:12px; font-size:1rem; margin-top:8px;" onclick="submitSelectedBall()">
        Record Ball ✓
      </button>
    </div>
  `;
}

function saveUndoSnapshot() {
  undoStack.push(JSON.stringify(activeMatch.scorecard));
  if (undoStack.length > 30) undoStack.shift();
}

async function undoLastBall() {
  if (undoStack.length === 0) return;
  activeMatch.scorecard = JSON.parse(undoStack.pop());
  await syncLiveMatchToDB();
  renderLiveScoringScreen();
}

async function manualSwapStrike() {
  const inn = getCurrentInnings();
  if (!inn.nonStrikerId) return;
  saveUndoSnapshot();
  [inn.strikerId, inn.nonStrikerId] = [inn.nonStrikerId, inn.strikerId];
  await syncLiveMatchToDB();
  renderLiveScoringScreen();
}

function submitSelectedBall() {
  const val = document.getElementById('ballOutcomeSelect').value;
  if (val === 'WICKET') {
    openWicketModal();
    return;
  }
  processBallDelivery(val, null);
}

function openWicketModal() {
  const inn = getCurrentInnings();
  const fielderOpts = inn.bowlSquad.map(p => `<option value="${p.name}">${p.name}</option>`).join('');

  document.getElementById('popupContent').innerHTML = `
    <h3>🔴 Wicket Details</h3>
    <label>How was the batter out?</label>
    <select id="wicketTypeSelect" onchange="toggleCatchFielder()">
      <option value="bowled">Bowled</option>
      <option value="caught">Caught By</option>
    </select>

    <div id="catcherDiv" class="hidden">
      <label>Caught By (Select Fielder):</label>
      <select id="catcherNameSelect">${fielderOpts}</select>
    </div>

    <div class="modal-actions">
      <button class="btn-secondary" onclick="closeModal('popupModal')">Cancel</button>
      <button class="btn-danger" onclick="confirmWicket()">Confirm Wicket</button>
    </div>
  `;
  openModal('popupModal');
}

function toggleCatchFielder() {
  const type = document.getElementById('wicketTypeSelect').value;
  document.getElementById('catcherDiv').classList.toggle('hidden', type !== 'caught');
}

function confirmWicket() {
  const type = document.getElementById('wicketTypeSelect').value;
  const catcher = type === 'caught' ? document.getElementById('catcherNameSelect').value : null;
  closeModal('popupModal');
  processBallDelivery('WICKET', { type, catcher });
}

async function processBallDelivery(outcome, wicketInfo) {
  saveUndoSnapshot();
  const inn = getCurrentInnings();
  const striker = inn.batters.find(b => b.id === inn.strikerId);
  const bowler = inn.bowlers.find(b => b.id === inn.currentBowlerId);

  let isLegal = true;
  let totalRunsAdded = 0;
  let batRuns = 0;
  let runningRuns = 0;

  if (outcome === 'WICKET') {
    inn.wickets += 1;
    striker.balls += 1;
    striker.out = true;
    striker.dismissal = wicketInfo.type === 'bowled'
      ? `b ${bowler.name}`
      : `c ${wicketInfo.catcher} b ${bowler.name}`;
    bowler.wickets += 1;
    inn.ballsHistory.push('W');
  } else if (outcome.startsWith('WD')) {
    isLegal = false;
    const extraRun = outcome.includes('+') ? parseInt(outcome.split('+')[1]) : 0;
    totalRunsAdded = 1 + extraRun;
    runningRuns = extraRun;
    inn.extras.wd += totalRunsAdded;
    bowler.wides += 1;
    bowler.runs += totalRunsAdded;
    bowler.currentOverRuns += totalRunsAdded;
    inn.ballsHistory.push(extraRun > 0 ? `WD+${extraRun}` : 'WD');
  } else if (outcome.startsWith('NB')) {
    isLegal = false;
    const extraRun = outcome.includes('+') ? parseInt(outcome.split('+')[1]) : 0;
    totalRunsAdded = 1 + extraRun;
    batRuns = extraRun;
    runningRuns = extraRun;
    inn.extras.nb += 1;
    bowler.noBalls += 1;
    bowler.runs += totalRunsAdded;
    bowler.currentOverRuns += totalRunsAdded;
    striker.runs += batRuns;
    if (batRuns === 4) striker.fours += 1;
    if (batRuns === 6) striker.sixes += 1;
    inn.ballsHistory.push(extraRun > 0 ? `NB+${extraRun}` : 'NB');
  } else if (outcome.startsWith('B') || outcome.startsWith('LB')) {
    const byeRuns = parseInt(outcome.replace(/\D/g, ''));
    totalRunsAdded = byeRuns;
    runningRuns = byeRuns;
    striker.balls += 1;
    inn.ballsHistory.push(outcome);
  } else {
    const r = parseInt(outcome);
    totalRunsAdded = r;
    batRuns = r;
    runningRuns = r;
    striker.runs += r;
    striker.balls += 1;
    if (r === 4) striker.fours += 1;
    if (r === 6) striker.sixes += 1;
    bowler.runs += r;
    bowler.currentOverRuns += r;
    inn.ballsHistory.push(String(r));
  }

  inn.runs += totalRunsAdded;

  if (isLegal) {
    inn.legalBalls += 1;
    bowler.balls += 1;
  }

  if (runningRuns % 2 === 1 && inn.nonStrikerId) {
    [inn.strikerId, inn.nonStrikerId] = [inn.nonStrikerId, inn.strikerId];
  }

  if (activeMatch.scorecard.currentInnings === 2) {
    const target = activeMatch.scorecard.innings1.runs + 1;
    if (inn.runs >= target) {
      await finishAndDeclareMatch();
      return;
    }
  }

  const maxWickets = inn.batSquad.length > 1 ? inn.batSquad.length - 1 : 1;
  const maxBalls = activeMatch.total_overs * 6;
  const isOverComplete = isLegal && (inn.legalBalls % 6 === 0);

  if (isOverComplete) {
    if (bowler.currentOverRuns === 0) bowler.maidens += 1;
    bowler.currentOverRuns = 0;
    inn.lastOverBowlerId = bowler.id;
    if (inn.nonStrikerId) {
      [inn.strikerId, inn.nonStrikerId] = [inn.nonStrikerId, inn.strikerId];
    }
  }

  if (inn.wickets >= maxWickets || inn.legalBalls >= maxBalls) {
    await syncLiveMatchToDB();
    if (activeMatch.scorecard.currentInnings === 1) {
      alert(`1st Innings Complete! ${inn.batTeamName} scored ${inn.runs}/${inn.wickets}. Target: ${inn.runs + 1}`);
      const team1Obj = { name: activeMatch.team1_name, players: activeMatch.team1_players };
      const team2Obj = { name: activeMatch.team2_name, players: activeMatch.team2_players };
      const nextBat = inn.bowlTeamName === team1Obj.name ? team1Obj : team2Obj;
      const nextBowl = inn.batTeamName === team1Obj.name ? team1Obj : team2Obj;
      openInningsSetupModal(2, nextBat, nextBowl);
    } else {
      await finishAndDeclareMatch();
    }
    return;
  }

  if (outcome === 'WICKET') {
    await syncLiveMatchToDB();
    openNewBatterModal(isOverComplete);
    return;
  }

  if (isOverComplete) {
    await syncLiveMatchToDB();
    openNextBowlerModal();
    return;
  }

  await syncLiveMatchToDB();
  renderLiveScoringScreen();
}

function openNewBatterModal(needNewBowlerAfter) {
  const inn = getCurrentInnings();
  const usedIds = inn.batters.map(b => b.id);
  const available = inn.batSquad.filter(p => !usedIds.includes(p.id));

  if (available.length === 0) {
    if (needNewBowlerAfter) openNextBowlerModal();
    else renderLiveScoringScreen();
    return;
  }

  document.getElementById('popupContent').innerHTML = `
    <h3>🏏 Select Next Batter (${inn.batTeamName})</h3>
    <select id="nextBatterSelect">
      ${available.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
    </select>
    <button class="btn-success" style="width:100%; margin-top:10px;" onclick="confirmNewBatter(${needNewBowlerAfter})">
      Send to Crease ✓
    </button>
  `;
  openModal('popupModal');
}

async function confirmNewBatter(needNewBowlerAfter) {
  const inn = getCurrentInnings();
  const nextId = document.getElementById('nextBatterSelect').value;
  const p = inn.batSquad.find(x => x.id === nextId);

  inn.batters.push({ id: p.id, name: p.name, runs: 0, balls: 0, fours: 0, sixes: 0, out: false, dismissal: 'not out' });
  const outBatter = inn.batters.find(b => b.out && (b.id === inn.strikerId || b.id === inn.nonStrikerId));
  if (outBatter && inn.strikerId === outBatter.id) inn.strikerId = p.id;
  else if (outBatter && inn.nonStrikerId === outBatter.id) inn.nonStrikerId = p.id;
  else inn.strikerId = p.id;

  closeModal('popupModal');
  await syncLiveMatchToDB();

  if (needNewBowlerAfter) openNextBowlerModal();
  else renderLiveScoringScreen();
}

function openNextBowlerModal() {
  const inn = getCurrentInnings();
  const options = inn.bowlSquad.map(p => {
    const isPrev = inn.bowlSquad.length > 1 && p.id === inn.lastOverBowlerId;
    return `<option value="${p.id}" ${isPrev ? 'disabled' : ''}>${p.name} ${isPrev ? '(Bowled Last Over)' : ''}</option>`;
  }).join('');

  document.getElementById('popupContent').innerHTML = `
    <h3>⚾ Over Complete! Select Next Over Bowler</h3>
    <select id="nextBowlerSelect">${options}</select>
    <button class="btn-primary" style="width:100%; margin-top:10px;" onclick="confirmNextBowler()">
      Start Next Over ✓
    </button>
  `;
  openModal('popupModal');
}

async function confirmNextBowler() {
  const inn = getCurrentInnings();
  const bId = document.getElementById('nextBowlerSelect').value;
  const p = inn.bowlSquad.find(x => x.id === bId);

  let existing = inn.bowlers.find(b => b.id === bId);
  if (!existing) {
    inn.bowlers.push({ id: p.id, name: p.name, balls: 0, maidens: 0, runs: 0, wickets: 0, wides: 0, noBalls: 0, currentOverRuns: 0 });
  }
  inn.currentBowlerId = p.id;
  closeModal('popupModal');
  await syncLiveMatchToDB();
  renderLiveScoringScreen();
}

async function syncLiveMatchToDB() {
  await sb.from('matches').update({ scorecard: activeMatch.scorecard }).eq('id', activeMatch.id);
}

// =========================================================
// 8. MATCH DECLARATION, CAREER STATS & AI PLAYER OF THE MATCH
// =========================================================
async function finishAndDeclareMatch() {
  const i1 = activeMatch.scorecard.innings1;
  const i2 = activeMatch.scorecard.innings2;

  let resultText = '';
  let winnerTeamName = '';

  if (i2.runs > i1.runs) {
    const maxW = i2.batSquad.length > 1 ? i2.batSquad.length - 1 : 1;
    const wicketsLeft = maxW - i2.wickets;
    resultText = `${i2.batTeamName} won by ${wicketsLeft} wicket${wicketsLeft !== 1 ? 's' : ''}`;
    winnerTeamName = i2.batTeamName;
  } else if (i1.runs > i2.runs) {
    const runDiff = i1.runs - i2.runs;
    resultText = `${i1.batTeamName} won by ${runDiff} run${runDiff !== 1 ? 's' : ''}`;
    winnerTeamName = i1.batTeamName;
  } else {
    resultText = 'Match Tied!';
    winnerTeamName = 'TIE';
  }

  const potm = calculateAIPlayerOfMatch(i1, i2, winnerTeamName);
  await updateAllPlayersCareerStats(activeMatch.total_overs, i1, i2);

  await sb.from('matches').update({
    status: 'completed',
    scorecard: activeMatch.scorecard,
    result_text: resultText,
    player_of_match: potm
  }).eq('id', activeMatch.id);

  activeMatch = null;
  alert(`🏆 Match Finished!\n${resultText}\n🌟 AI Player of the Match: ${potm.name} (${potm.summary})`);
  renderRecentMatches(Boolean(currentAdmin));
}

function calculateAIPlayerOfMatch(i1, i2, winnerTeam) {
  const pointsMap = {};

  const addPoints = (id, name, team, pts, note) => {
    if (!pointsMap[id]) pointsMap[id] = { id, name, team, points: 0, notes: [] };
    pointsMap[id].points += pts;
    if (note) pointsMap[id].notes.push(note);
  };

  [i1, i2].forEach(inn => {
    inn.batters.forEach(b => {
      let pts = b.runs * 1.2 + (b.fours * 1) + (b.sixes * 2);
      if (b.balls >= 6 && (b.runs / b.balls) * 100 >= 150) pts += 10;
      if (b.runs >= 30) pts += 10;
      if (b.runs >= 50) pts += 20;
      if (b.runs > 0) addPoints(b.id, b.name, inn.batTeamName, pts, `${b.runs}(${b.balls})`);
    });

    inn.bowlers.forEach(bw => {
      let pts = bw.wickets * 25 + bw.maidens * 10;
      if (bw.balls >= 6) {
        const eco = bw.runs / (bw.balls / 6);
        if (eco <= 6) pts += 12;
      }
      if (bw.wickets > 0 || bw.balls > 0) {
        addPoints(bw.id, bw.name, inn.bowlTeamName, pts, `${bw.wickets}/${bw.runs}`);
      }
    });
  });

  let best = { name: 'N/A', points: -1, summary: '' };
  Object.values(pointsMap).forEach(p => {
    if (p.team === winnerTeam) p.points *= 1.15;
    if (p.points > best.points) {
      best = { id: p.id, name: p.name, points: Math.round(p.points), summary: p.notes.join(' & ') };
    }
  });
  return best;
}

async function updateAllPlayersCareerStats(oversFormat, i1, i2) {
  const allSquadIds = new Set([
    ...i1.batSquad.map(p => p.id),
    ...i1.bowlSquad.map(p => p.id)
  ]);

  for (const playerId of allSquadIds) {
    let { data: row } = await sb
      .from('player_format_stats')
      .select('*')
      .eq('player_id', playerId)
      .eq('overs_format', oversFormat)
      .maybeSingle();

    if (!row) {
      const { data: inserted } = await sb
        .from('player_format_stats')
        .insert([{ player_id: playerId, overs_format: oversFormat }])
        .select()
        .single();
      row = inserted;
    }

    let playedBatMatch = false;
    let playedBowlMatch = false;

    [i1, i2].forEach(inn => {
      if (inn.batSquad.some(p => p.id === playerId)) playedBatMatch = true;
      if (inn.bowlSquad.some(p => p.id === playerId)) playedBowlMatch = true;

      const bat = inn.batters.find(b => b.id === playerId);
      if (bat && (bat.balls > 0 || bat.out)) {
        row.bat_innings += 1;
        if (!bat.out) row.not_outs += 1;
        row.runs += bat.runs;
        row.balls_faced += bat.balls;
        row.fours += bat.fours;
        row.sixes += bat.sixes;
        if (bat.runs === 0 && bat.out) row.ducks += 1;
        if (bat.runs >= 100) row.hundreds += 1;
        else if (bat.runs >= 50) row.fifties += 1;
        else if (bat.runs >= 30) row.thirties += 1;

        if (bat.runs > row.highest_score || (bat.runs === row.highest_score && !bat.out)) {
          row.highest_score = bat.runs;
          row.highest_not_out = !bat.out;
        }
      }

      const bowl = inn.bowlers.find(b => b.id === playerId);
      if (bowl && bowl.balls > 0) {
        row.bowl_innings += 1;
        row.balls_bowled += bowl.balls;
        row.maidens += bowl.maidens;
        row.runs_conceded += bowl.runs;
        row.wickets += bowl.wickets;
        row.wides += bowl.wides;
        row.no_balls += bowl.noBalls;
        if (bowl.wickets >= 5) row.five_wickets += 1;
        else if (bowl.wickets >= 3) row.three_wickets += 1;

        if (bowl.wickets > row.best_wickets || (bowl.wickets === row.best_wickets && bowl.runs < row.best_runs)) {
          row.best_wickets = bowl.wickets;
          row.best_runs = bowl.runs;
        }
      }
    });

    if (playedBatMatch) row.bat_matches += 1;
    if (playedBowlMatch) row.bowl_matches += 1;

    await sb.from('player_format_stats').update(row).eq('id', row.id);
  }
}

// =========================================================
// 9. PUBLIC LIVE VIEW & RECENT MATCHES (WITH SCORECARD)
// =========================================================
async function renderPublicLiveMatches() {
  const container = document.getElementById('appContainer');
  const { data: matches } = await sb.from('matches').select('*').eq('status', 'live').order('created_at', { ascending: false });

  if (!matches || matches.length === 0) {
    container.innerHTML = `<div class="card"><p style="color:#94a3b8;">Abhi koi Live Match nahi chal raha hai.</p></div>`;
    return;
  }

  container.innerHTML = matches.map(m => {
    const inn = m.scorecard.currentInnings === 1 ? m.scorecard.innings1 : m.scorecard.innings2;
    const ov = `${Math.floor(inn.legalBalls / 6)}.${inn.legalBalls % 6}`;
    return `
      <div class="score-banner" style="cursor:pointer;" onclick='openFullScorecard(${JSON.stringify(m)})'>
        <div class="row-between">
          <div>
            <span class="badge badge-live">LIVE • ${m.total_overs} OVERS</span>
            <h3 style="margin-top:6px;">${m.team1_name} vs ${m.team2_name}</h3>
            <p style="color:#94a3b8; font-size:0.85rem;">Batting: ${inn.batTeamName}</p>
          </div>
          <div class="big-score">${inn.runs}/${inn.wickets} (${ov})</div>
        </div>
        <p style="color:#38bdf8; font-size:0.85rem; margin-top:8px;">Tap to view live scorecard ➔</p>
      </div>
    `;
  }).join('');
}

async function renderRecentMatches(isAdminView) {
  const container = document.getElementById('appContainer');
  const { data: matches } = await sb.from('matches').select('*').eq('status', 'completed').order('created_at', { ascending: false });

  if (!matches || matches.length === 0) {
    container.innerHTML = `<div class="card"><p style="color:#94a3b8;">Abhi tak koi Recent Match nahi hai.</p></div>`;
    return;
  }

  container.innerHTML = matches.map(m => `
    <div class="card">
      <div class="row-between">
        <div style="cursor:pointer; flex:1;" onclick='openFullScorecard(${JSON.stringify(m)})'>
          <span style="color:#94a3b8; font-size:0.8rem;">${new Date(m.created_at).toLocaleDateString()} • ${m.total_overs} Overs</span>
          <h3>${m.team1_name} vs ${m.team2_name}</h3>
          <p style="color:#4ade80; font-weight:700;">🏆 ${m.result_text}</p>
          ${m.player_of_match ? `<p style="margin-top:4px;"><span class="badge badge-potm">AI POTM</span> <strong>${m.player_of_match.name}</strong> (${m.player_of_match.summary})</p>` : ''}
        </div>
        <div style="display:flex; gap:8px;">
          <button class="btn-secondary btn-sm" onclick='openFullScorecard(${JSON.stringify(m)})'>Scorecard</button>
          ${(isAdminView && currentAdmin) ? `<button class="btn-danger btn-sm" onclick="deleteCompletedMatch('${m.id}')">Delete</button>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

async function deleteCompletedMatch(matchId) {
  if (!confirm('Kya aap is match ko permanently delete karna chahte hain?')) return;
  const { error } = await sb.from('matches').delete().eq('id', matchId);
  if (error) alert(error.message);
  else renderRecentMatches(true);
}

function openFullScorecard(match) {
  const renderInningsBlock = (inn, title) => {
    if (!inn) return '';
    const ov = `${Math.floor(inn.legalBalls / 6)}.${inn.legalBalls % 6}`;
    return `
      <div style="margin-top:14px; border-top:1px solid #334155; padding-top:10px;">
        <div class="row-between">
          <h4 style="color:#38bdf8;">${title}: ${inn.batTeamName}</h4>
          <strong>${inn.runs}/${inn.wickets} (${ov} Ov)</strong>
        </div>
        <div class="stats-table-wrap">
          <table class="stats-table">
            <thead><tr><th>Batter</th><th>Dismissal</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
            <tbody>
              ${inn.batters.map(b => `
                <tr>
                  <td>${b.name}</td>
                  <td style="color:#94a3b8;">${b.dismissal}</td>
                  <td><strong>${b.runs}</strong></td>
                  <td>${b.balls}</td>
                  <td>${b.fours}</td>
                  <td>${b.sixes}</td>
                  <td>${b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : '0.0'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="stats-table-wrap">
          <table class="stats-table">
            <thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr></thead>
            <tbody>
              ${inn.bowlers.map(bw => `
                <tr>
                  <td>${bw.name}</td>
                  <td>${Math.floor(bw.balls / 6)}.${bw.balls % 6}</td>
                  <td>${bw.maidens}</td>
                  <td>${bw.runs}</td>
                  <td><strong>${bw.wickets}</strong></td>
                  <td>${bw.balls > 0 ? (bw.runs / (bw.balls / 6)).toFixed(2) : '0.00'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  };

  document.getElementById('popupContent').innerHTML = `
    <div class="row-between">
      <h3>${match.team1_name} vs ${match.team2_name}</h3>
      <button class="btn-secondary btn-sm" onclick="closeModal('popupModal')">✕ Close</button>
    </div>
    ${match.result_text ? `<p style="color:#4ade80; font-weight:700; margin-top:4px;">🏆 ${match.result_text}</p>` : ''}
    ${renderInningsBlock(match.scorecard.innings1, '1st Innings')}
    ${renderInningsBlock(match.scorecard.innings2, '2nd Innings')}
  `;
  openModal('popupModal');
}
