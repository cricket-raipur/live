// ==========================================
// 1. SUPABASE CONFIGURATION & GLOBAL STATE
// ==========================================
const SUPABASE_URL = 'https://wwwrkbwycthgboqvljfy.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__JjU5SFZFPvqLVbxpVXYJQ_v8s3CyNX';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentAdminProfile = null;
let allPlayers = [];
let allMatches = [];
let activeMatch = null;
let undoStack = [];
let liveSyncInterval = null;
let currentView = 'live';
let statsSubTab = 'both';

let setupTeam1Squad = [];
let setupTeam2Squad = [];

function getMatchOvers(matchObj = activeMatch) {
    if (!matchObj) return 6;
    return Number(matchObj.total_overs || (matchObj.scorecard && matchObj.scorecard.total_overs) || matchObj.overs || 6);
}

// ==========================================
// 2. INITIALIZATION & RESPONSIVE STYLES
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    injectResponsiveMobileStyles();
    await checkAuthSession();
    await loadAllInitialData();
    startAutoSync();
});

function injectResponsiveMobileStyles() {
    if (document.getElementById('smartResponsiveStyles')) return;
    const style = document.createElement('style');
    style.id = 'smartResponsiveStyles';
    style.textContent = `
        * { box-sizing: border-box; }
        html, body { max-width: 100vw; overflow-x: hidden; margin: 0; padding: 0; }
        .container { width: 100%; max-width: 960px; margin: 0 auto; padding: 10px; }
        .resp-grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
        .resp-grid-3 { display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: 8px; }
        .resp-grid-crease { display: grid; grid-template-columns: repeat(auto-fit, minmax(145px, 1fr)); gap: 8px; }
        .compact-table { width: 100%; border-collapse: collapse; font-size: 0.84rem; }
        .compact-table th, .compact-table td { padding: 7px 4px; text-align: left; border-bottom: 1px solid #1e293b; }
        .compact-table th { color: #94a3b8; font-weight: 600; font-size: 0.76rem; }
        .player-link { color: #f8fafc; font-weight: 700; cursor: pointer; text-decoration: none; }
        .player-link:hover { color: #38bdf8; text-decoration: underline; }
        .stats-pill-bar { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
        .stats-pill-btn { padding: 6px 11px; border-radius: 20px; border: 1px solid #334155; background: #0f172a; color: #cbd5e1; font-size: 0.78rem; font-weight: 600; cursor: pointer; }
        .stats-pill-btn.active { background: #2563eb; color: #fff; border-color: #2563eb; }
        .icc-stat-box { background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 10px; text-align: center; }
        .icc-stat-val { font-size: 1.25rem; font-weight: 800; color: #f8fafc; }
        .icc-stat-lbl { font-size: 0.72rem; color: #94a3b8; text-transform: uppercase; margin-top: 2px; }
        .cmp-win { color: #4ade80; font-weight: 800; }
        @media (max-width: 600px) {
            .container { padding: 6px !important; }
            .card, .score-banner { padding: 11px !important; border-radius: 10px !important; }
            .compact-table { font-size: 0.75rem; }
            .compact-table th, .compact-table td { padding: 5px 3px; }
            .tabs-nav { gap: 4px !important; }
            .tab-btn { padding: 7px 8px !important; font-size: 0.76rem !important; }
        }
    `;
    document.head.appendChild(style);
}

// ==========================================
// 3. AUTHENTICATION & NAVBAR
// ==========================================
async function checkAuthSession() {
    const { data: { session } } = await sb.auth.getSession();
    if (session && session.user) {
        currentUser = session.user;
        const { data: adminData } = await sb.from('admins').select('*').eq('id', currentUser.id).single();
        currentAdminProfile = adminData || { id: currentUser.id, name: currentUser.email, role: 'admin' };
    } else {
        currentUser = null;
        currentAdminProfile = null;
    }
    updateNavbarUI();
}

function updateNavbarUI() {
    const menuBtn = document.getElementById('menuBtn');
    const openLoginBtn = document.getElementById('openLoginBtn');
    const welcomeText = document.getElementById('welcomeText');
    const logoutBtn = document.getElementById('logoutBtn');
    const manageAdminsLink = document.getElementById('manageAdminsLink');
    const adminDrawer = document.getElementById('adminDrawer');

    if (currentUser) {
        if (menuBtn) menuBtn.classList.remove('hidden');
        if (openLoginBtn) openLoginBtn.classList.add('hidden');
        if (logoutBtn) logoutBtn.classList.remove('hidden');
        if (welcomeText) {
            welcomeText.textContent = `Hi, ${currentAdminProfile.name || 'Admin'}`;
            welcomeText.classList.remove('hidden');
        }
        if (manageAdminsLink) {
            manageAdminsLink.classList.toggle('hidden', currentAdminProfile.role !== 'super_admin');
        }
    } else {
        if (menuBtn) menuBtn.classList.add('hidden');
        if (openLoginBtn) openLoginBtn.classList.remove('hidden');
        if (logoutBtn) logoutBtn.classList.add('hidden');
        if (welcomeText) welcomeText.classList.add('hidden');
        if (manageAdminsLink) manageAdminsLink.classList.add('hidden');
        if (adminDrawer) adminDrawer.classList.add('hidden');
    }
}

async function loginAdmin() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl = document.getElementById('loginError');

    if (errEl) errEl.classList.add('hidden');
    if (!email || !password) {
        if (errEl) {
            errEl.textContent = 'Please enter both Email and Password.';
            errEl.classList.remove('hidden');
        }
        return;
    }

    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
        if (errEl) {
            errEl.textContent = error.message;
            errEl.classList.remove('hidden');
        } else {
            alert('Login Failed: ' + error.message);
        }
        return;
    }

    await checkAuthSession();
    closeModal('loginModal');
    renderCurrentView();
}

async function logoutAdmin() {
    await sb.auth.signOut();
    currentUser = null;
    currentAdminProfile = null;
    updateNavbarUI();
    goHome();
}

// ==========================================
// 4. PLAYER AVATAR & FULL-SCREEN PHOTO ZOOM LIGHTBOX
// ==========================================
function getPlayerPhotoUrl(playerId, playerName) {
    if (playerId) {
        const byId = allPlayers.find(p => String(p.id) === String(playerId));
        if (byId && byId.photo_url) return byId.photo_url;
    }
    if (playerName) {
        const clean = playerName.replace(/\s*\(Guest\)\s*/i, '').replace(/\s*\(Common\)\s*/i, '').trim().toLowerCase();
        const byName = allPlayers.find(p => (p.name || '').trim().toLowerCase() === clean);
        if (byName && byName.photo_url) return byName.photo_url;
    }
    return '';
}

function renderPlayerAvatarHtml(playerId, playerName, size = 26) {
    const photoUrl = getPlayerPhotoUrl(playerId, playerName);
    const safeName = (playerName || 'Player').replace(/'/g, "\\'").replace(/"/g, '&quot;');
    if (photoUrl) {
        return `<img src="${photoUrl}" alt="${safeName}" title="Click to enlarge photo" onclick="event.stopPropagation(); openPhotoZoomModal('${photoUrl}', '${safeName}')" style="width:${size}px; height:${size}px; border-radius:50%; object-fit:cover; cursor:zoom-in; border:1.5px solid #38bdf8; flex-shrink:0; vertical-align:middle;">`;
    }
    const initial = (playerName || 'P').trim().charAt(0).toUpperCase();
    return `<span style="display:inline-flex; width:${size}px; height:${size}px; border-radius:50%; background:#334155; color:#f8fafc; align-items:center; justify-content:center; font-weight:700; font-size:${Math.max(10, Math.floor(size * 0.45))}px; flex-shrink:0; vertical-align:middle;">${initial}</span>`;
}

function openPhotoZoomModal(photoUrl, playerName) {
    if (!photoUrl) return;
    let overlay = document.getElementById('photoZoomOverlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'photoZoomOverlay';
        overlay.style.cssText = 'display:none; position:fixed; inset:0; background:rgba(0,0,0,0.92); z-index:99999; align-items:center; justify-content:center; flex-direction:column; padding:16px;';
        overlay.onclick = () => { overlay.style.display = 'none'; };
        document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
        <div onclick="event.stopPropagation()" style="position:relative; max-width:92vw; max-height:85vh; text-align:center;">
            <button onclick="document.getElementById('photoZoomOverlay').style.display='none'" style="position:absolute; top:-12px; right:-12px; background:#ef4444; color:#fff; border:none; width:34px; height:34px; border-radius:50%; font-weight:bold; cursor:pointer; font-size:1rem;">✕</button>
            <img src="${photoUrl}" style="max-width:90vw; max-height:75vh; border-radius:12px; border:2px solid #38bdf8; object-fit:contain;">
            <div style="color:#f8fafc; font-weight:700; font-size:1.05rem; margin-top:10px;">${playerName || ''}</div>
        </div>
    `;
    overlay.style.display = 'flex';
}

// ==========================================
// 5. MODALS, DRAWER & NAVIGATION
// ==========================================
function openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.remove('hidden');
}

function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.classList.add('hidden');
}

function toggleDrawer() {
    const drawer = document.getElementById('adminDrawer');
    if (drawer) drawer.classList.toggle('hidden');
}

function goHome() {
    const drawer = document.getElementById('adminDrawer');
    if (drawer) drawer.classList.add('hidden');
    showPublicTab('live');
}

function showPublicTab(tabName) {
    currentView = tabName;
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    const activeTab = document.getElementById(`tab-${tabName}`);
    if (activeTab) activeTab.classList.add('active');
    renderCurrentView();
}

function navigateAdmin(section) {
    if (!currentUser) return openModal('loginModal');
    const drawer = document.getElementById('adminDrawer');
    if (drawer) drawer.classList.add('hidden');
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    currentView = section;
    if (section === 'startMatch') {
        setupTeam1Squad = [];
        setupTeam2Squad = [];
    }
    renderCurrentView();
}

function renderCurrentView() {
    if (currentView === 'live') renderLiveView();
    else if (currentView === 'recent') renderRecentMatchesView();
    else if (currentView === 'history') renderMatchHistoryView();
    else if (currentView === 'players') renderPlayerStatsView();
    else if (currentView === 'startMatch') renderStartMatchView();
    else if (currentView === 'addPlayer') renderManagePlayersView();
    else if (currentView === 'recentMatches') renderManageMatchesView();
    else if (currentView === 'manageAdmins') renderManageAdminsView();
    else if (currentView === 'changePassword') renderChangePasswordView();
    else renderLiveView();
}

// ==========================================
// 6. DATA LOADING & 1-SECOND AUTO-SYNC
// ==========================================
async function loadAllInitialData() {
    await Promise.all([fetchPlayers(), fetchMatches()]);
    renderCurrentView();
}

async function fetchPlayers() {
    const { data, error } = await sb.from('players').select('*').order('name', { ascending: true });
    if (!error && data) allPlayers = data;
}

async function fetchMatches() {
    const { data, error } = await sb.from('matches').select('*').order('created_at', { ascending: false });
    if (!error && data) {
        allMatches = data;
        const live = allMatches.find(m => m.status === 'live');
        if (live) {
            const remoteScorerId = live.scorecard ? live.scorecard.activeScorerId : null;
            if (!activeMatch || activeMatch.id !== live.id || !currentUser) {
                activeMatch = live;
            } else if (currentUser && activeMatch && activeMatch.id === live.id) {
                if (remoteScorerId && remoteScorerId !== currentUser.id) activeMatch = live;
            }
        } else {
            activeMatch = null;
        }
    }
}

function startAutoSync() {
    if (liveSyncInterval) clearInterval(liveSyncInterval);
    liveSyncInterval = setInterval(async () => {
        const prevLiveId = activeMatch ? activeMatch.id : null;
        const prevScoreStr = activeMatch ? JSON.stringify(activeMatch.scorecard) : '';
        await fetchMatches();
        const newLiveId = activeMatch ? activeMatch.id : null;
        const newScoreStr = activeMatch ? JSON.stringify(activeMatch.scorecard) : '';
        if (currentView === 'live' && (prevLiveId !== newLiveId || prevScoreStr !== newScoreStr)) {
            renderLiveView();
        }
    }, 1000);
}

// ==========================================
// 7. LIVE VIEW (PUBLIC + ADMIN SCORING)
// ==========================================
function renderLiveView() {
    const container = document.getElementById('appContainer');
    if (!activeMatch) {
        container.innerHTML = `
            <div class="card" style="text-align:center; padding:32px 16px;">
                <h2>🏏 No Live Match Right Now</h2>
                <p style="color:#94a3b8; margin-top:8px; font-size:0.9rem;">Check Recent Matches, Match History, or Players Stats from the tabs above.</p>
                ${currentUser ? `<button class="btn-primary" style="margin-top:16px;" onclick="navigateAdmin('startMatch')">+ Start New Live Match</button>` : ''}
            </div>
        `;
        return;
    }

    const scorerId = activeMatch.scorecard ? activeMatch.scorecard.activeScorerId : null;
    const isScorer = currentUser && (!scorerId || scorerId === currentUser.id);
    if (currentUser && isScorer) renderLiveScoringScreen();
    else renderPublicLiveScoreboard();
}

function renderPublicLiveScoreboard() {
    const container = document.getElementById('appContainer');
    const sc = activeMatch.scorecard;
    const inn = sc.currentInnings === 1 ? sc.innings1 : sc.innings2;
    const totalOvers = getMatchOvers(activeMatch);
    const oversText = `${Math.floor(inn.legalBalls / 6)}.${inn.legalBalls % 6}`;
    const striker = inn.batters.find(b => b.id === inn.strikerId);
    const nonStriker = inn.batters.find(b => b.id === inn.nonStrikerId);
    const bowler = inn.bowlers.find(b => b.id === inn.currentBowlerId);

    const targetHtml = sc.currentInnings === 2
        ? `<div style="color:#facc15; font-weight:700; font-size:0.9rem; margin-top:6px;">Target: ${sc.innings1.runs + 1} | Need ${Math.max(0, (sc.innings1.runs + 1) - inn.runs)} runs in ${Math.max(0, (totalOvers * 6) - inn.legalBalls)} balls</div>`
        : '';

    const recentBalls = (inn.ballsHistory || []).slice(-12).map(b => {
        let cls = 'ball-pill';
        if (b === '4') cls += ' ball-4';
        else if (b === '6') cls += ' ball-6';
        else if (b.includes('W')) cls += ' ball-w';
        else if (b.includes('WD') || b.includes('NB')) cls += ' ball-extra';
        return `<span class="${cls}">${b}</span>`;
    }).join('');

    const takeControlBtn = currentUser
        ? `<button class="btn-warning btn-sm" onclick="takeOverScoring()">⚡ Take Over</button>`
        : '';

    container.innerHTML = `
        <div class="score-banner">
            <div class="row-between">
                <span class="badge badge-live">● LIVE</span>
                ${takeControlBtn}
            </div>
            <h2 style="margin-top:6px; font-size:1.15rem;">${activeMatch.team1_name} vs ${activeMatch.team2_name}</h2>
            ${sc.tossText ? `<p style="font-size:0.8rem; color:#94a3b8; margin-top:2px;">🪙 ${sc.tossText}</p>` : ''}
            <div style="font-size:1.85rem; font-weight:800; margin:6px 0;">
                ${inn.battingTeam}: ${inn.runs}/${inn.wickets} <span style="font-size:1rem; color:#94a3b8;">(${oversText} / ${totalOvers} Ov)</span>
            </div>
            ${targetHtml}
            <div class="balls-strip" style="margin-top:10px;">${recentBalls || '<span style="color:#64748b; font-size:0.85rem;">Match just started</span>'}</div>
        </div>

        <div class="card">
            <h3 style="font-size:1rem;">🏏 Crease & Bowler</h3>
            <table class="compact-table" style="margin-top:8px;">
                <thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
                <tbody>
                    ${striker ? `<tr style="background:rgba(56,189,248,0.1);"><td style="display:flex; align-items:center; gap:6px;">${renderPlayerAvatarHtml(striker.id, striker.name, 24)}<strong>${striker.name}*</strong></td><td><strong>${striker.runs}</strong></td><td>${striker.balls}</td><td>${striker.fours}</td><td>${striker.sixes}</td><td>${striker.balls > 0 ? ((striker.runs / striker.balls) * 100).toFixed(0) : '0'}</td></tr>` : ''}
                    ${nonStriker ? `<tr><td style="display:flex; align-items:center; gap:6px;">${renderPlayerAvatarHtml(nonStriker.id, nonStriker.name, 24)}<span>${nonStriker.name}</span></td><td>${nonStriker.runs}</td><td>${nonStriker.balls}</td><td>${nonStriker.fours}</td><td>${nonStriker.sixes}</td><td>${nonStriker.balls > 0 ? ((nonStriker.runs / nonStriker.balls) * 100).toFixed(0) : '0'}</td></tr>` : ''}
                </tbody>
            </table>

            <table class="compact-table" style="margin-top:12px;">
                <thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr></thead>
                <tbody>
                    ${bowler ? `<tr><td style="display:flex; align-items:center; gap:6px;">${renderPlayerAvatarHtml(bowler.id, bowler.name, 24)}<strong>${bowler.name}</strong></td><td>${Math.floor(bowler.balls / 6)}.${bowler.balls % 6}</td><td>${bowler.maidens}</td><td>${bowler.runs}</td><td><strong>${bowler.wickets}</strong></td><td>${bowler.balls > 0 ? (bowler.runs / (bowler.balls / 6)).toFixed(1) : '0.0'}</td></tr>` : ''}
                </tbody>
            </table>
            <div style="margin-top:12px; text-align:right;">
                <button class="btn-secondary btn-sm" onclick="openMatchScorecardModal('${activeMatch.id}')">📋 Full Scorecard</button>
            </div>
        </div>
    `;
}

async function takeOverScoring() {
    if (!currentUser || !activeMatch) return;
    activeMatch.scorecard.activeScorerId = currentUser.id;
    await sb.from('matches').update({ scorecard: activeMatch.scorecard }).eq('id', activeMatch.id);
    renderLiveScoringScreen();
}

// ==========================================
// 8. START LIVE MATCH SETUP (AUTO-SELECT + ALL REQUIRED DB COLUMNS)
// ==========================================
function renderStartMatchView() {
    if (!currentUser) return goHome();
    const container = document.getElementById('appContainer');

    container.innerHTML = `
        <div class="card">
            <h2 style="font-size:1.15rem;">🏏 Start New Live Match</h2>
            <p style="color:#94a3b8; font-size:0.82rem; margin-bottom:12px;">Select player from dropdown to add immediately (Common & Guest supported).</p>

            <div class="resp-grid-2">
                <div>
                    <label>Team 1 Name *</label>
                    <input type="text" id="t1Name" class="input-field" placeholder="e.g. Raipur Eleven" oninput="updateTossDropdowns()">
                </div>
                <div>
                    <label>Team 2 Name *</label>
                    <input type="text" id="t2Name" class="input-field" placeholder="e.g. Ujiarpur Stars" oninput="updateTossDropdowns()">
                </div>
            </div>

            <div class="resp-grid-3" style="margin-top:10px;">
                <div>
                    <label>Total Overs *</label>
                    <input type="number" id="matchOvers" class="input-field" placeholder="6" value="6" min="1" max="50">
                </div>
                <div>
                    <label>Toss Won By</label>
                    <select id="tossWinnerSelect" class="input-field">
                        <option value="team1">Team 1</option>
                        <option value="team2">Team 2</option>
                    </select>
                </div>
                <div>
                    <label>Elected To</label>
                    <select id="tossDecisionSelect" class="input-field">
                        <option value="bat">Bat First</option>
                        <option value="bowl">Bowl First</option>
                    </select>
                </div>
            </div>

            <div class="resp-grid-2" style="margin-top:14px;">
                <div style="background:#0f172a; padding:10px; border-radius:8px; border:1px solid #334155;">
                    <h4 style="color:#38bdf8; margin-bottom:6px; font-size:0.95rem;">Team 1 Squad (<span id="t1Count">0</span>)</h4>
                    <select id="regPlayerSelect1" class="input-field" onchange="addRegPlayerToSetup(1)" style="width:100%;">
                        <option value="">+ Select Player to Add...</option>
                        ${allPlayers.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
                    </select>
                    <div style="display:flex; gap:6px; margin-top:8px;">
                        <input type="text" id="guestInput1" class="input-field" placeholder="Guest player name" style="flex:1;" onkeydown="if(event.key==='Enter'){event.preventDefault();addGuestPlayerToSetup(1);}">
                        <button type="button" class="btn-secondary btn-sm" onclick="addGuestPlayerToSetup(1)">+ Guest</button>
                    </div>
                    <div id="setupSquadList1" style="margin-top:8px; display:flex; flex-direction:column; gap:5px; max-height:170px; overflow-y:auto;"></div>
                </div>

                <div style="background:#0f172a; padding:10px; border-radius:8px; border:1px solid #334155;">
                    <h4 style="color:#facc15; margin-bottom:6px; font-size:0.95rem;">Team 2 Squad (<span id="t2Count">0</span>)</h4>
                    <select id="regPlayerSelect2" class="input-field" onchange="addRegPlayerToSetup(2)" style="width:100%;">
                        <option value="">+ Select Player to Add...</option>
                        ${allPlayers.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
                    </select>
                    <div style="display:flex; gap:6px; margin-top:8px;">
                        <input type="text" id="guestInput2" class="input-field" placeholder="Guest player name" style="flex:1;" onkeydown="if(event.key==='Enter'){event.preventDefault();addGuestPlayerToSetup(2);}">
                        <button type="button" class="btn-secondary btn-sm" onclick="addGuestPlayerToSetup(2)">+ Guest</button>
                    </div>
                    <div id="setupSquadList2" style="margin-top:8px; display:flex; flex-direction:column; gap:5px; max-height:170px; overflow-y:auto;"></div>
                </div>
            </div>

            <button id="startMatchSubmitBtn" class="btn-success" style="width:100%; margin-top:16px; padding:12px; font-size:1rem; font-weight:700;" onclick="createNewMatch()">
                🚀 Start Live Match Now
            </button>
        </div>
    `;
    renderSetupSquadLists();
}

function updateTossDropdowns() {
    const t1 = document.getElementById('t1Name').value.trim() || 'Team 1';
    const t2 = document.getElementById('t2Name').value.trim() || 'Team 2';
    const sel = document.getElementById('tossWinnerSelect');
    if (sel) {
        sel.options[0].text = t1;
        sel.options[1].text = t2;
    }
}

function addRegPlayerToSetup(teamNum) {
    const sel = document.getElementById(`regPlayerSelect${teamNum}`);
    const pId = sel.value;
    if (!pId) return;
    const pName = sel.options[sel.selectedIndex].text;
    const target = teamNum === 1 ? setupTeam1Squad : setupTeam2Squad;

    if (target.some(x => String(x.id) === String(pId))) {
        sel.value = '';
        return;
    }
    target.push({ id: pId, name: pName, isGuest: false });
    sel.value = '';
    renderSetupSquadLists();
}

function addGuestPlayerToSetup(teamNum) {
    const inp = document.getElementById(`guestInput${teamNum}`);
    const gName = inp.value.trim();
    if (!gName) return;
    const guestObj = {
        id: 'guest_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        name: gName + ' (Guest)',
        isGuest: true
    };
    const target = teamNum === 1 ? setupTeam1Squad : setupTeam2Squad;
    target.push(guestObj);
    inp.value = '';
    renderSetupSquadLists();
}

function removePlayerFromSetup(teamNum, index) {
    if (teamNum === 1) setupTeam1Squad.splice(index, 1);
    else setupTeam2Squad.splice(index, 1);
    renderSetupSquadLists();
}

function renderSetupSquadLists() {
    const renderList = (arr, otherArr, teamNum) => arr.map((p, idx) => {
        const isCommon = otherArr.some(o => String(o.id) === String(p.id) || o.name.toLowerCase() === p.name.toLowerCase());
        const commonTag = isCommon ? `<span style="color:#facc15; font-size:0.72rem; font-weight:700;"> (Common)</span>` : '';
        return `
            <div style="display:flex; justify-content:space-between; align-items:center; background:#1e293b; padding:5px 8px; border-radius:6px; font-size:0.82rem;">
                <span style="display:flex; align-items:center; gap:6px; overflow:hidden;">${renderPlayerAvatarHtml(p.id, p.name, 20)} <span>${idx + 1}. ${p.name}${commonTag}</span></span>
                <button type="button" onclick="removePlayerFromSetup(${teamNum}, ${idx})" style="background:transparent; border:none; color:#f87171; cursor:pointer; font-weight:bold; padding:0 4px;">✕</button>
            </div>
        `;
    }).join('');

    const l1 = document.getElementById('setupSquadList1');
    const l2 = document.getElementById('setupSquadList2');
    const c1 = document.getElementById('t1Count');
    const c2 = document.getElementById('t2Count');

    if (l1) l1.innerHTML = renderList(setupTeam1Squad, setupTeam2Squad, 1) || '<span style="color:#64748b; font-size:0.78rem;">No players selected</span>';
    if (l2) l2.innerHTML = renderList(setupTeam2Squad, setupTeam1Squad, 2) || '<span style="color:#64748b; font-size:0.78rem;">No players selected</span>';
    if (c1) c1.textContent = setupTeam1Squad.length;
    if (c2) c2.textContent = setupTeam2Squad.length;
}

async function createNewMatch() {
    const rawT1 = document.getElementById('t1Name').value.trim();
    const rawT2 = document.getElementById('t2Name').value.trim();
    const overs = parseInt(document.getElementById('matchOvers').value, 10) || 6;

    if (!rawT1 || !rawT2) return alert('Please enter both Team 1 and Team 2 names!');

    const btn = document.getElementById('startMatchSubmitBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Starting Match...';
    }

    const tossWinner = document.getElementById('tossWinnerSelect').value;
    const tossDecision = document.getElementById('tossDecisionSelect').value;

    let batFirstTeam = rawT1;
    let bowlFirstTeam = rawT2;
    let batFirstSquad = [...setupTeam1Squad];
    let bowlFirstSquad = [...setupTeam2Squad];

    const tossWinnerName = tossWinner === 'team1' ? rawT1 : rawT2;
    const tossText = `${tossWinnerName} won the toss and elected to ${tossDecision} first`;

    if ((tossWinner === 'team1' && tossDecision === 'bowl') || (tossWinner === 'team2' && tossDecision === 'bat')) {
        batFirstTeam = rawT2;
        bowlFirstTeam = rawT1;
        batFirstSquad = [...setupTeam2Squad];
        bowlFirstSquad = [...setupTeam1Squad];
    }

    const scorecard = {
        currentInnings: 1,
        total_overs: overs,
        activeScorerId: currentUser.id,
        tossText: tossText,
        team1Squad: batFirstSquad,
        team2Squad: bowlFirstSquad,
        innings1: {
            battingTeam: batFirstTeam, bowlingTeam: bowlFirstTeam, runs: 0, wickets: 0, legalBalls: 0,
            extras: { wd: 0, nb: 0 }, strikerId: null, nonStrikerId: null, currentBowlerId: null,
            lastBowlerId: null, batters: [], bowlers: [], ballsHistory: [], overRunsTracker: 0
        },
        innings2: {
            battingTeam: bowlFirstTeam, bowlingTeam: batFirstTeam, runs: 0, wickets: 0, legalBalls: 0,
            extras: { wd: 0, nb: 0 }, strikerId: null, nonStrikerId: null, currentBowlerId: null,
            lastBowlerId: null, batters: [], bowlers: [], ballsHistory: [], overRunsTracker: 0
        }
    };

    const { data, error } = await sb.from('matches').insert([{
        team1_name: batFirstTeam,
        team2_name: bowlFirstTeam,
        team1_players: batFirstSquad,
        team2_players: bowlFirstSquad,
        total_overs: overs,
        status: 'live',
        scorecard: scorecard
    }]).select().single();

    if (btn) {
        btn.disabled = false;
        btn.textContent = '🚀 Start Live Match Now';
    }

    if (error) {
        alert('Error starting match: ' + error.message);
        return;
    }

    activeMatch = data;
    undoStack = [];
    showPublicTab('live');
}

function saveUndoState() {
    if (!activeMatch) return;
    undoStack.push(JSON.stringify(activeMatch.scorecard));
    if (undoStack.length > 25) undoStack.shift();
}

function undoLastBall() {
    if (undoStack.length === 0) return alert('Nothing to undo!');
    activeMatch.scorecard = JSON.parse(undoStack.pop());
    syncMatchToSupabase();
    renderLiveScoringScreen();
}

// ==========================================
// 9. BALL-BY-BALL LIVE SCORING ENGINE (SELECT BUTTONS + CHANGE STRIKE BELOW CREASE)
// ==========================================
function getCurrentInnings() {
    return activeMatch.scorecard.currentInnings === 1
        ? activeMatch.scorecard.innings1
        : activeMatch.scorecard.innings2;
}

function getBattingTeamMaxWickets() {
    const sc = activeMatch.scorecard;
    const battingSquad = sc.currentInnings === 1 ? (sc.team1Squad || []) : (sc.team2Squad || []);
    if (battingSquad.length >= 2) {
        return battingSquad.length - 1; // e.g., 6 players -> 5 wickets all-out
    }
    return 10; // Default standard 10 wickets if squad not pre-selected
}

function renderLiveScoringScreen() {
    const inn = getCurrentInnings();
    const totalOvers = getMatchOvers(activeMatch);
    const oversText = `${Math.floor(inn.legalBalls / 6)}.${inn.legalBalls % 6}`;
    const striker = inn.batters.find(b => b.id === inn.strikerId);
    const nonStriker = inn.batters.find(b => b.id === inn.nonStrikerId);
    const bowler = inn.bowlers.find(b => b.id === inn.currentBowlerId);

    const targetBanner = activeMatch.scorecard.currentInnings === 2
        ? `<div style="color:#facc15; font-weight:600; font-size:0.85rem; margin-top:4px;">Target: ${activeMatch.scorecard.innings1.runs + 1} | Need ${Math.max(0, (activeMatch.scorecard.innings1.runs + 1) - inn.runs)} off ${Math.max(0, (totalOvers * 6) - inn.legalBalls)} balls</div>`
        : '';

    const recentBalls = (inn.ballsHistory || []).slice(-10).map(b => {
        let cls = 'ball-pill';
        if (b === '4') cls += ' ball-4';
        else if (b === '6') cls += ' ball-6';
        else if (b.includes('W')) cls += ' ball-w';
        else if (b.includes('WD') || b.includes('NB')) cls += ' ball-extra';
        return `<span class="${cls}">${b}</span>`;
    }).join('');

    document.getElementById('appContainer').innerHTML = `
        <div class="score-banner">
            <div class="row-between" style="flex-wrap:wrap; gap:6px;">
                <span class="badge badge-live">● LIVE</span>
                <div style="display:flex; gap:5px; flex-wrap:wrap;">
                    <button class="btn-secondary btn-sm" onclick="openEditTeamsModal()">👥 Teams</button>
                    <button class="btn-secondary btn-sm" onclick="openBabyOverModal()">🍼 Overs</button>
                    <button class="btn-danger btn-sm" onclick="openMatchEndOptions()">🏁 End</button>
                </div>
            </div>
            <h2 style="margin-top:6px; font-size:1.1rem;">${inn.battingTeam} vs ${inn.bowlingTeam}</h2>
            <div style="font-size:1.85rem; font-weight:800; margin:4px 0;">
                ${inn.runs}/${inn.wickets} <span style="font-size:1rem; color:#94a3b8;">(${oversText} / ${totalOvers} Ov)</span>
            </div>
            ${targetBanner}
            <div class="balls-strip" style="margin-top:8px;">${recentBalls}</div>
        </div>

        <div class="card">
            <div class="resp-grid-crease">
                <div style="background:#0f172a; padding:8px; border-radius:8px; border:1px solid #38bdf8;">
                    <div class="row-between">
                        <span style="font-size:0.75rem; color:#38bdf8; font-weight:700;">STRIKER *</span>
                        <button class="btn-primary btn-sm" style="padding:3px 8px; font-size:0.75rem;" onclick="openSelectPlayerModal('striker')">Select</button>
                    </div>
                    <div style="font-weight:700; font-size:0.88rem; margin-top:5px; display:flex; align-items:center; gap:6px;">
                        ${striker ? `${renderPlayerAvatarHtml(striker.id, striker.name, 22)} <span>${striker.name} (${striker.runs}/${striker.balls})</span>` : '⚠️ Select Striker'}
                    </div>
                </div>
                <div style="background:#0f172a; padding:8px; border-radius:8px; border:1px solid #334155;">
                    <div class="row-between">
                        <span style="font-size:0.75rem; color:#94a3b8; font-weight:700;">NON-STRIKER</span>
                        <button class="btn-primary btn-sm" style="padding:3px 8px; font-size:0.75rem;" onclick="openSelectPlayerModal('non_striker')">Select</button>
                    </div>
                    <div style="font-weight:700; font-size:0.88rem; margin-top:5px; display:flex; align-items:center; gap:6px;">
                        ${nonStriker ? `${renderPlayerAvatarHtml(nonStriker.id, nonStriker.name, 22)} <span>${nonStriker.name} (${nonStriker.runs}/${nonStriker.balls})</span>` : '⚠️ Select Non-Striker'}
                    </div>
                </div>
            </div>

            <!-- CHANGE STRIKE BUTTON DIRECTLY BELOW STRIKER & NON-STRIKER -->
            <div style="margin-top:8px;">
                <button class="btn-secondary" style="width:100%; padding:7px; font-size:0.82rem; font-weight:700; border:1px dashed #475569;" onclick="swapStrike()">
                    ⇄ Change Strike
                </button>
            </div>

            <div style="background:#0f172a; padding:8px; border-radius:8px; border:1px solid #facc15; margin-top:8px;">
                <div class="row-between" style="flex-wrap:wrap; gap:4px;">
                    <span style="font-size:0.75rem; color:#facc15; font-weight:700;">BOWLER</span>
                    <button class="btn-primary btn-sm" style="padding:3px 8px; font-size:0.75rem;" onclick="openSelectPlayerModal('bowler')">Select</button>
                </div>
                <div style="font-weight:700; font-size:0.88rem; margin-top:5px; display:flex; align-items:center; gap:6px;">
                    ${bowler ? `${renderPlayerAvatarHtml(bowler.id, bowler.name, 22)} <span>${bowler.name} (${Math.floor(bowler.balls / 6)}.${bowler.balls % 6} Ov, ${bowler.runs}R, ${bowler.wickets}W)</span>` : '⚠️ Select Bowler'}
                </div>
            </div>

            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; margin-top:12px;">
                <button class="btn-secondary" style="padding:12px 4px; font-size:1.05rem; font-weight:700;" onclick="recordLegalBall(0)">0</button>
                <button class="btn-secondary" style="padding:12px 4px; font-size:1.05rem; font-weight:700;" onclick="recordLegalBall(1)">1</button>
                <button class="btn-secondary" style="padding:12px 4px; font-size:1.05rem; font-weight:700;" onclick="recordLegalBall(2)">2</button>
                <button class="btn-secondary" style="padding:12px 4px; font-size:1.05rem; font-weight:700;" onclick="recordLegalBall(3)">3</button>
                <button class="btn-primary" style="padding:12px 4px; font-size:1.05rem; font-weight:700;" onclick="recordLegalBall(4)">4</button>
                <button class="btn-primary" style="padding:12px 4px; font-size:1.05rem; font-weight:700;" onclick="recordLegalBall(6)">6</button>
                <button class="btn-warning" style="padding:12px 4px; font-size:0.85rem; font-weight:700; color:#000;" onclick="openExtraModal('WD')">WD</button>
                <button class="btn-warning" style="padding:12px 4px; font-size:0.85rem; font-weight:700; color:#000;" onclick="openExtraModal('NB')">NB</button>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:8px;">
                <button class="btn-danger" style="padding:12px; font-size:1rem; font-weight:800;" onclick="openWicketModal()">⚡ WICKET</button>
                <button class="btn-secondary" style="padding:12px; font-size:0.95rem; font-weight:700;" onclick="undoLastBall()">↩ Undo</button>
            </div>
        </div>
    `;
}

function validateCreaseReady() {
    const inn = getCurrentInnings();
    if (!inn.strikerId || !inn.nonStrikerId || !inn.currentBowlerId) {
        alert('Please select Striker, Non-Striker, and Bowler first!');
        return false;
    }
    return true;
}

function swapStrike() {
    const inn = getCurrentInnings();
    if (!inn.strikerId && !inn.nonStrikerId) return;
    const temp = inn.strikerId;
    inn.strikerId = inn.nonStrikerId;
    inn.nonStrikerId = temp;
    syncMatchToSupabase();
    renderLiveScoringScreen();
}

function recordLegalBall(runs) {
    if (!validateCreaseReady()) return;
    saveUndoState();

    const inn = getCurrentInnings();
    const striker = inn.batters.find(b => b.id === inn.strikerId);
    const bowler = inn.bowlers.find(b => b.id === inn.currentBowlerId);

    inn.runs += runs;
    inn.legalBalls += 1;
    inn.overRunsTracker = (inn.overRunsTracker || 0) + runs;

    if (striker) {
        striker.runs += runs;
        striker.balls += 1;
        if (runs === 4) striker.fours += 1;
        if (runs === 6) striker.sixes += 1;
    }
    if (bowler) {
        bowler.runs += runs;
        bowler.balls += 1;
    }

    inn.ballsHistory.push(String(runs));
    if (runs % 2 === 1) {
        const temp = inn.strikerId;
        inn.strikerId = inn.nonStrikerId;
        inn.nonStrikerId = temp;
    }

    checkOverAndInningsState();
    syncMatchToSupabase();
    renderLiveScoringScreen();
}

function openExtraModal(type) {
    if (!validateCreaseReady()) return;
    document.getElementById('popupContent').innerHTML = `
        <div class="row-between">
            <h3>${type === 'WD' ? 'Wide Ball (Re-ball)' : 'No Ball (Re-ball)'}</h3>
            <button class="btn-secondary btn-sm" onclick="closeModal('popupModal')">✕</button>
        </div>
        <p style="color:#94a3b8; font-size:0.85rem; margin:8px 0;">Gully Rule: No extra 1 run; only scored runs added & ball re-bowled.</p>
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-top:10px;">
            <button class="btn-secondary" style="padding:12px;" onclick="recordExtraBall('${type}', 0)">${type} + 0</button>
            <button class="btn-secondary" style="padding:12px;" onclick="recordExtraBall('${type}', 1)">${type} + 1</button>
            <button class="btn-secondary" style="padding:12px;" onclick="recordExtraBall('${type}', 2)">${type} + 2</button>
            <button class="btn-secondary" style="padding:12px;" onclick="recordExtraBall('${type}', 3)">${type} + 3</button>
            <button class="btn-primary" style="padding:12px;" onclick="recordExtraBall('${type}', 4)">${type} + 4</button>
            <button class="btn-primary" style="padding:12px;" onclick="recordExtraBall('${type}', 6)">${type} + 6</button>
        </div>
    `;
    openModal('popupModal');
}

function recordExtraBall(type, runsScored) {
    saveUndoState();
    const inn = getCurrentInnings();
    const striker = inn.batters.find(b => b.id === inn.strikerId);
    const bowler = inn.bowlers.find(b => b.id === inn.currentBowlerId);

    inn.runs += runsScored;
    inn.overRunsTracker = (inn.overRunsTracker || 0) + runsScored;
    if (type === 'WD') inn.extras.wd += 1;
    else inn.extras.nb += 1;

    if (type === 'NB' && striker && runsScored > 0) {
        striker.runs += runsScored;
        if (runsScored === 4) striker.fours += 1;
        if (runsScored === 6) striker.sixes += 1;
    }
    if (bowler) bowler.runs += runsScored;

    inn.ballsHistory.push(runsScored > 0 ? `${runsScored}${type}` : type);
    if (runsScored % 2 === 1) {
        const temp = inn.strikerId;
        inn.strikerId = inn.nonStrikerId;
        inn.nonStrikerId = temp;
    }

    closeModal('popupModal');
    checkOverAndInningsState();
    syncMatchToSupabase();
    renderLiveScoringScreen();
}

// ==========================================
// 9B. WICKET & RUN-OUT MODAL
// ==========================================
function openWicketModal() {
    if (!validateCreaseReady()) return;
    document.getElementById('popupContent').innerHTML = `
        <div class="row-between" style="margin-bottom: 12px;">
            <h3>⚡ Select Wicket Type</h3>
            <button class="btn-secondary btn-sm" onclick="closeModal('popupModal')">✕</button>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px;">
            <button class="btn-danger" style="padding: 14px; font-weight: bold;" onclick="processStandardWicket('Bowled')">🎯 Bowled</button>
            <button class="btn-danger" style="padding: 14px; font-weight: bold;" onclick="processStandardWicket('Caught')">🙌 Caught</button>
            <button class="btn-danger" style="padding: 14px; font-weight: bold;" onclick="processStandardWicket('Stumping')">🧤 Stumping</button>
            <button class="btn-warning" style="padding: 14px; font-weight: bold; color: #000;" onclick="openRunOutOptions()">🏃 Run Out</button>
        </div>
    `;
    openModal('popupModal');
}

function openRunOutOptions() {
    const inn = getCurrentInnings();
    const striker = inn.batters.find(b => b.id === inn.strikerId);
    const nonStriker = inn.batters.find(b => b.id === inn.nonStrikerId);

    document.getElementById('popupContent').innerHTML = `
        <div class="row-between" style="margin-bottom: 12px;">
            <h3>🏃 Run Out Details</h3>
            <button class="btn-secondary btn-sm" onclick="openWicketModal()">← Back</button>
        </div>
        <div style="margin-bottom: 14px;">
            <label style="display:block; margin-bottom:6px; font-weight:600; color:#facc15;">1. कौन आउट हुआ? (Who is Out?)</label>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                <label style="background:#0f172a; padding:10px; border-radius:6px; border:1px solid #334155; cursor:pointer; display:flex; align-items:center; gap:6px; font-size:0.85rem;">
                    <input type="radio" name="roVictim" value="striker" checked>
                    <span><strong>Striker:</strong> ${striker ? striker.name : 'Striker'}</span>
                </label>
                <label style="background:#0f172a; padding:10px; border-radius:6px; border:1px solid #334155; cursor:pointer; display:flex; align-items:center; gap:6px; font-size:0.85rem;">
                    <input type="radio" name="roVictim" value="non_striker">
                    <span><strong>Non-Striker:</strong> ${nonStriker ? nonStriker.name : 'Non-Striker'}</span>
                </label>
            </div>
        </div>
        <div style="margin-bottom: 16px;">
            <label style="display:block; margin-bottom:6px; font-weight:600; color:#facc15;">2. कितने रन पूरे हुए? (Completed Runs)</label>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
                <label style="background:#0f172a; padding:10px; border-radius:6px; border:1px solid #334155; cursor:pointer; text-align:center; font-size:0.85rem;">
                    <input type="radio" name="roRuns" value="0" checked> <strong>0 Run</strong>
                </label>
                <label style="background:#0f172a; padding:10px; border-radius:6px; border:1px solid #334155; cursor:pointer; text-align:center; font-size:0.85rem;">
                    <input type="radio" name="roRuns" value="1"> <strong>1 Run</strong>
                </label>
                <label style="background:#0f172a; padding:10px; border-radius:6px; border:1px solid #334155; cursor:pointer; text-align:center; font-size:0.85rem;">
                    <input type="radio" name="roRuns" value="2"> <strong>2 Runs</strong>
                </label>
            </div>
        </div>
        <button class="btn-danger" style="width:100%; padding:12px; font-weight:bold;" onclick="confirmRunOut()">Confirm Run Out</button>
    `;
}

function processStandardWicket(type) {
    saveUndoState();
    const inn = getCurrentInnings();
    const striker = inn.batters.find(b => b.id === inn.strikerId);
    const bowler = inn.bowlers.find(b => b.id === inn.currentBowlerId);

    inn.wickets += 1;
    inn.legalBalls += 1;
    if (striker) {
        striker.balls += 1;
        striker.isOut = true;
        striker.dismissal = `${type} b ${bowler ? bowler.name : ''}`;
    }
    if (bowler) {
        bowler.balls += 1;
        bowler.wickets += 1;
    }

    const ballLabel = type === 'Bowled' ? 'W(B)' : (type === 'Caught' ? 'W(C)' : 'W(St)');
    inn.ballsHistory.push(ballLabel);
    inn.strikerId = null;

    closeModal('popupModal');
    checkOverAndInningsState();
    syncMatchToSupabase();
    renderLiveScoringScreen();
}

function confirmRunOut() {
    const victimRole = document.querySelector('input[name="roVictim"]:checked').value;
    const completedRuns = parseInt(document.querySelector('input[name="roRuns"]:checked').value, 10);

    saveUndoState();
    const inn = getCurrentInnings();
    const striker = inn.batters.find(b => b.id === inn.strikerId);
    const nonStriker = inn.batters.find(b => b.id === inn.nonStrikerId);
    const bowler = inn.bowlers.find(b => b.id === inn.currentBowlerId);

    inn.runs += completedRuns;
    inn.wickets += 1;
    inn.legalBalls += 1;
    inn.overRunsTracker = (inn.overRunsTracker || 0) + completedRuns;

    if (striker) {
        striker.runs += completedRuns;
        striker.balls += 1;
    }
    if (bowler) {
        bowler.runs += completedRuns;
        bowler.balls += 1;
    }

    if (completedRuns % 2 === 1) {
        const tempId = inn.strikerId;
        inn.strikerId = inn.nonStrikerId;
        inn.nonStrikerId = tempId;
    }

    if (victimRole === 'striker' && striker) {
        striker.isOut = true;
        striker.dismissal = 'Run Out';
        if (inn.strikerId === striker.id) inn.strikerId = null;
        if (inn.nonStrikerId === striker.id) inn.nonStrikerId = null;
    } else if (victimRole === 'non_striker' && nonStriker) {
        nonStriker.isOut = true;
        nonStriker.dismissal = 'Run Out';
        if (inn.strikerId === nonStriker.id) inn.strikerId = null;
        if (inn.nonStrikerId === nonStriker.id) inn.nonStrikerId = null;
    }

    const ballLabel = completedRuns > 0 ? `${completedRuns}+W(RO)` : 'W(RO)';
    inn.ballsHistory.push(ballLabel);

    closeModal('popupModal');
    checkOverAndInningsState();
    syncMatchToSupabase();
    renderLiveScoringScreen();
}

// ==========================================
// 10. OVER COMPLETION (NO CONSECUTIVE BOWLER), ALL-OUT & AUTO WIN
// ==========================================
function checkOverAndInningsState() {
    const sc = activeMatch.scorecard;
    const inn = getCurrentInnings();
    const maxBalls = getMatchOvers(activeMatch) * 6;
    const maxWickets = getBattingTeamMaxWickets();

    // 1. Check Over Completion (record lastBowlerId so same bowler cannot bowl next over)
    if (inn.legalBalls > 0 && inn.legalBalls % 6 === 0) {
        const bowler = inn.bowlers.find(b => b.id === inn.currentBowlerId);
        if (bowler && (inn.overRunsTracker || 0) === 0) bowler.maidens += 1;
        inn.overRunsTracker = 0;

        inn.lastBowlerId = inn.currentBowlerId;
        inn.currentBowlerId = null;

        const temp = inn.strikerId;
        inn.strikerId = inn.nonStrikerId;
        inn.nonStrikerId = temp;
    }

    // 2. Check 2nd Innings Target Chased
    if (sc.currentInnings === 2) {
        const target = sc.innings1.runs + 1;
        if (inn.runs >= target) {
            const wicketsLeft = Math.max(1, maxWickets - inn.wickets);
            finishMatch(`${inn.battingTeam} won by ${wicketsLeft} wicket${wicketsLeft > 1 ? 's' : ''}!`);
            return;
        }
    }

    // 3. Check All-Out (e.g., 5 wickets fallen in a 6-player team) OR Overs Finished
    const isAllOut = inn.wickets >= maxWickets;
    const isOversDone = inn.legalBalls >= maxBalls;

    if (isAllOut || isOversDone) {
        if (sc.currentInnings === 1) {
            const reason = isAllOut ? `All Out (${inn.wickets} Wickets)!` : 'Overs Complete!';
            alert(`1st Innings ${reason} ${inn.battingTeam} scored ${inn.runs}/${inn.wickets}. Starting 2nd Innings.`);
            sc.currentInnings = 2;
        } else {
            if (inn.runs > sc.innings1.runs) {
                const wicketsLeft = Math.max(1, maxWickets - inn.wickets);
                finishMatch(`${inn.battingTeam} won by ${wicketsLeft} wicket${wicketsLeft > 1 ? 's' : ''}!`);
            } else if (inn.runs < sc.innings1.runs) {
                finishMatch(`${sc.innings1.battingTeam} won by ${sc.innings1.runs - inn.runs} run${(sc.innings1.runs - inn.runs) > 1 ? 's' : ''}!`);
            } else {
                finishMatch('Match Tied!');
            }
        }
    }
}

async function finishMatch(resultText) {
    activeMatch.status = 'completed';
    activeMatch.scorecard.result_text = resultText;
    const { error } = await sb.from('matches').update({
        status: 'completed',
        result_text: resultText,
        scorecard: activeMatch.scorecard
    }).eq('id', activeMatch.id);

    if (error) {
        await sb.from('matches').update({
            status: 'completed',
            scorecard: activeMatch.scorecard
        }).eq('id', activeMatch.id);
    }

    alert(`🏆 Match Finished: ${resultText}`);
    activeMatch = null;
    await fetchMatches();
    showPublicTab('recent');
}

function openMatchEndOptions() {
    const sc = activeMatch.scorecard;
    document.getElementById('popupContent').innerHTML = `
        <div class="row-between">
            <h3>🏁 Match Controls</h3>
            <button class="btn-secondary btn-sm" onclick="closeModal('popupModal')">✕</button>
        </div>
        <div style="display:flex; flex-direction:column; gap:10px; margin-top:14px;">
            ${sc.currentInnings === 1 ? `<button class="btn-primary" onclick="declareFirstInnings()">End 1st Innings & Start 2nd Innings</button>` : ''}
            <button class="btn-warning" style="color:#000;" onclick="declareManualResult()">Declare Winner & Finish Match</button>
            <button class="btn-danger" onclick="abandonCurrentMatch()">Abandon Match (No Result)</button>
        </div>
    `;
    openModal('popupModal');
}

function declareFirstInnings() {
    activeMatch.scorecard.currentInnings = 2;
    closeModal('popupModal');
    syncMatchToSupabase();
    renderLiveScoringScreen();
}

function declareManualResult() {
    const res = prompt('Enter Match Result (e.g. Team A won by 15 runs):');
    if (!res) return;
    closeModal('popupModal');
    finishMatch(res);
}

async function abandonCurrentMatch() {
    if (!confirm('Are you sure you want to abandon this match?')) return;
    closeModal('popupModal');
    await finishMatch('Match Abandoned');
}

function openBabyOverModal() {
    const currentOvers = getMatchOvers(activeMatch);
    document.getElementById('popupContent').innerHTML = `
        <div class="row-between">
            <h3>🍼 Adjust Overs (Baby Over)</h3>
            <button class="btn-secondary btn-sm" onclick="closeModal('popupModal')">✕</button>
        </div>
        <p style="color:#94a3b8; font-size:0.9rem; margin:8px 0;">Current Match Overs: <strong>${currentOvers}</strong></p>
        <input type="number" id="newOversInput" class="input-field" value="${currentOvers}" min="1" max="50">
        <button class="btn-primary" style="width:100%; margin-top:12px;" onclick="updateMatchOvers()">Update Overs</button>
    `;
    openModal('popupModal');
}

async function updateMatchOvers() {
    const val = parseInt(document.getElementById('newOversInput').value, 10);
    if (!val || val < 1) return;
    activeMatch.total_overs = val;
    activeMatch.scorecard.total_overs = val;
    await sb.from('matches').update({ total_overs: val, scorecard: activeMatch.scorecard }).eq('id', activeMatch.id);
    closeModal('popupModal');
    renderLiveScoringScreen();
}

// ==========================================
// 11. PLAYER SELECTION (BLOCKS PREVIOUS OVER BOWLER) & TEAM EDITING
// ==========================================
function openSelectPlayerModal(role) {
    const inn = getCurrentInnings();
    const sc = activeMatch.scorecard;
    const isBatting = role === 'striker' || role === 'non_striker';

    let squad = isBatting
        ? (sc.currentInnings === 1 ? sc.team1Squad : sc.team2Squad)
        : (sc.currentInnings === 1 ? sc.team2Squad : sc.team1Squad);

    if (!squad || squad.length === 0) {
        squad = allPlayers.map(p => ({ id: p.id, name: p.name }));
    }

    // Filter out previous over bowler if other bowlers are available
    let filteredSquad = squad;
    if (role === 'bowler' && inn.lastBowlerId) {
        const others = squad.filter(p => String(p.id) !== String(inn.lastBowlerId));
        if (others.length > 0) {
            filteredSquad = others;
        }
    }

    const listHtml = filteredSquad.map(p => {
        const alreadyOut = isBatting && inn.batters.some(b => String(b.id) === String(p.id) && b.isOut);
        if (alreadyOut) return '';
        return `
            <button class="btn-secondary" style="text-align:left; padding:10px; width:100%; display:flex; align-items:center; gap:8px;" onclick="assignPlayerRole('${role}', '${p.id}', '${p.name.replace(/'/g, "\\'")}')">
                ${renderPlayerAvatarHtml(p.id, p.name, 24)}
                <span>${p.name}</span>
            </button>
        `;
    }).join('');

    const prevBowlerNote = (role === 'bowler' && inn.lastBowlerId)
        ? `<p style="font-size:0.78rem; color:#facc15; margin-top:6px;">ℹ️ Previous over bowler is hidden (cannot bowl consecutive overs).</p>`
        : '';

    document.getElementById('popupContent').innerHTML = `
        <div class="row-between">
            <h3>Select ${role === 'striker' ? 'Striker' : (role === 'non_striker' ? 'Non-Striker' : 'Bowler')}</h3>
            <button class="btn-secondary btn-sm" onclick="closeModal('popupModal')">✕</button>
        </div>
        ${prevBowlerNote}
        <div style="display:flex; flex-direction:column; gap:6px; max-height:250px; overflow-y:auto; margin-top:10px;">
            ${listHtml || '<p style="color:#94a3b8;">No available players in squad.</p>'}
        </div>
        <div style="margin-top:10px; border-top:1px solid #334155; padding-top:10px;">
            <label style="font-size:0.8rem; color:#94a3b8;">Quick Add Guest Player:</label>
            <div style="display:flex; gap:6px; margin-top:4px;">
                <input type="text" id="quickGuestName" class="input-field" placeholder="Guest player name..." style="flex:1;">
                <button class="btn-primary btn-sm" onclick="addQuickGuestAndAssign('${role}')">+ Add</button>
            </div>
        </div>
    `;
    openModal('popupModal');
}

function addQuickGuestAndAssign(role) {
    const name = document.getElementById('quickGuestName').value.trim();
    if (!name) return;
    const guestId = 'guest_' + Date.now();
    const guestLabel = name + ' (Guest)';

    const sc = activeMatch.scorecard;
    const isBatting = role === 'striker' || role === 'non_striker';
    const targetSquad = isBatting
        ? (sc.currentInnings === 1 ? sc.team1Squad : sc.team2Squad)
        : (sc.currentInnings === 1 ? sc.team2Squad : sc.team1Squad);
    if (Array.isArray(targetSquad)) {
        targetSquad.push({ id: guestId, name: guestLabel, isGuest: true });
    }
    assignPlayerRole(role, guestId, guestLabel);
}

function assignPlayerRole(role, playerId, playerName) {
    const inn = getCurrentInnings();

    if (role === 'striker' || role === 'non_striker') {
        if (!inn.batters.some(b => String(b.id) === String(playerId))) {
            inn.batters.push({ id: playerId, name: playerName, runs: 0, balls: 0, fours: 0, sixes: 0, isOut: false, dismissal: 'not out' });
        }
        if (role === 'striker') {
            if (inn.nonStrikerId === playerId) inn.nonStrikerId = inn.strikerId;
            inn.strikerId = playerId;
        } else {
            if (inn.strikerId === playerId) inn.strikerId = inn.nonStrikerId;
            inn.nonStrikerId = playerId;
        }
    } else if (role === 'bowler') {
        if (!inn.bowlers.some(b => String(b.id) === String(playerId))) {
            inn.bowlers.push({ id: playerId, name: playerName, balls: 0, maidens: 0, runs: 0, wickets: 0 });
        }
        inn.currentBowlerId = playerId;
    }

    closeModal('popupModal');
    syncMatchToSupabase();
    renderLiveScoringScreen();
}

function openEditTeamsModal() {
    document.getElementById('popupContent').innerHTML = `
        <div class="row-between">
            <h3>👥 Edit Live Teams & Squads</h3>
            <button class="btn-secondary btn-sm" onclick="closeModal('popupModal')">✕</button>
        </div>
        <div style="margin-top:10px;">
            <label>Batting First Team Name</label>
            <input type="text" id="editT1Name" class="input-field" value="${activeMatch.team1_name}">
            <label style="margin-top:8px; display:block;">Bowling First Team Name</label>
            <input type="text" id="editT2Name" class="input-field" value="${activeMatch.team2_name}">
        </div>
        <div style="margin-top:12px;">
            <label>Select Player to Add to Squad:</label>
            <select id="addSquadPlayerSelect" class="input-field" style="margin-top:4px;">
                <option value="">-- Choose Player --</option>
                ${allPlayers.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
                <button class="btn-secondary btn-sm" onclick="addPlayerToLiveSquad(1)">+ ${activeMatch.team1_name}</button>
                <button class="btn-secondary btn-sm" onclick="addPlayerToLiveSquad(2)">+ ${activeMatch.team2_name}</button>
            </div>
        </div>
        <div style="margin-top:12px; border-top:1px solid #334155; padding-top:10px;">
            <label>Add Guest Player to Live Squad:</label>
            <input type="text" id="liveGuestNameInput" class="input-field" placeholder="Guest player name" style="margin-top:4px;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
                <button class="btn-secondary btn-sm" onclick="addGuestToLiveSquad(1)">+ Guest (${activeMatch.team1_name})</button>
                <button class="btn-secondary btn-sm" onclick="addGuestToLiveSquad(2)">+ Guest (${activeMatch.team2_name})</button>
            </div>
        </div>
        <button class="btn-primary" style="width:100%; margin-top:14px;" onclick="saveLiveTeamNames()">Save Team Names</button>
    `;
    openModal('popupModal');
}

function addPlayerToLiveSquad(teamNum) {
    const sel = document.getElementById('addSquadPlayerSelect');
    const pId = sel.value;
    if (!pId) return alert('Please select a player first.');
    const pName = sel.options[sel.selectedIndex].text;
    const sc = activeMatch.scorecard;
    const targetSquad = teamNum === 1 ? sc.team1Squad : sc.team2Squad;
    if (!targetSquad.some(p => String(p.id) === String(pId))) {
        targetSquad.push({ id: pId, name: pName });
        syncMatchToSupabase();
        alert(`${pName} added!`);
    }
    sel.value = '';
}

function addGuestToLiveSquad(teamNum) {
    const gName = document.getElementById('liveGuestNameInput').value.trim();
    if (!gName) return;
    const sc = activeMatch.scorecard;
    const targetSquad = teamNum === 1 ? sc.team1Squad : sc.team2Squad;
    targetSquad.push({ id: 'guest_' + Date.now(), name: gName + ' (Guest)', isGuest: true });
    document.getElementById('liveGuestNameInput').value = '';
    syncMatchToSupabase();
    alert(`${gName} (Guest) added!`);
}

async function saveLiveTeamNames() {
    const t1 = document.getElementById('editT1Name').value.trim();
    const t2 = document.getElementById('editT2Name').value.trim();
    if (!t1 || !t2) return;

    activeMatch.team1_name = t1;
    activeMatch.team2_name = t2;
    activeMatch.scorecard.innings1.battingTeam = t1;
    activeMatch.scorecard.innings1.bowlingTeam = t2;
    activeMatch.scorecard.innings2.battingTeam = t2;
    activeMatch.scorecard.innings2.bowlingTeam = t1;

    await sb.from('matches').update({
        team1_name: t1,
        team2_name: t2,
        team1_players: activeMatch.scorecard.team1Squad,
        team2_players: activeMatch.scorecard.team2Squad,
        scorecard: activeMatch.scorecard
    }).eq('id', activeMatch.id);

    closeModal('popupModal');
    renderLiveScoringScreen();
}

async function syncMatchToSupabase() {
    if (!activeMatch) return;
    if (currentUser) activeMatch.scorecard.activeScorerId = currentUser.id;
    await sb.from('matches').update({
        team1_players: activeMatch.scorecard.team1Squad,
        team2_players: activeMatch.scorecard.team2Squad,
        scorecard: activeMatch.scorecard
    }).eq('id', activeMatch.id);
}

// ==========================================
// 12. PUBLIC VIEWS: RECENT, HISTORY & SCORECARD WITH PHOTO ZOOM
// ==========================================
function renderRecentMatchesView() {
    const container = document.getElementById('appContainer');
    const recent = allMatches.filter(m => m.status === 'completed').slice(0, 5);
    container.innerHTML = `
        <div class="card">
            <h2 style="font-size:1.15rem;">🕒 Recent Matches (Top 5)</h2>
            <div style="display:flex; flex-direction:column; gap:10px; margin-top:12px;">
                ${recent.length === 0 ? '<p style="color:#94a3b8;">No completed matches yet.</p>' : recent.map(m => renderMatchCardItem(m)).join('')}
            </div>
        </div>
    `;
}

function renderMatchHistoryView() {
    const container = document.getElementById('appContainer');
    const completed = allMatches.filter(m => m.status === 'completed');
    container.innerHTML = `
        <div class="card">
            <div class="row-between" style="flex-wrap:wrap; gap:8px;">
                <h2 style="font-size:1.15rem;">📜 Match History (${completed.length})</h2>
                <div style="display:flex; gap:6px; align-items:center;">
                    <input type="date" id="historyDateFilter" class="input-field" style="padding:6px;" onchange="filterMatchesByDate()">
                    <button class="btn-secondary btn-sm" onclick="resetHistoryDateFilter()">All</button>
                </div>
            </div>
            <div id="historyMatchesList" style="display:flex; flex-direction:column; gap:10px; margin-top:12px;">
                ${completed.length === 0 ? '<p style="color:#94a3b8;">No matches found.</p>' : completed.map(m => renderMatchCardItem(m)).join('')}
            </div>
        </div>
    `;
}

function filterMatchesByDate() {
    const dateVal = document.getElementById('historyDateFilter').value;
    const completed = allMatches.filter(m => m.status === 'completed');
    const filtered = dateVal ? completed.filter(m => new Date(m.created_at).toISOString().slice(0, 10) === dateVal) : completed;
    document.getElementById('historyMatchesList').innerHTML =
        filtered.length === 0 ? '<p style="color:#94a3b8;">No matches played on this date.</p>' : filtered.map(m => renderMatchCardItem(m)).join('');
}

function resetHistoryDateFilter() {
    document.getElementById('historyDateFilter').value = '';
    filterMatchesByDate();
}

function renderMatchCardItem(m) {
    const sc = m.scorecard || {};
    const inn1 = sc.innings1 || { runs: 0, wickets: 0 };
    const inn2 = sc.innings2 || { runs: 0, wickets: 0 };
    const resText = m.result_text || sc.result_text || 'Completed';
    const dateStr = new Date(m.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const isSuperAdmin = currentAdminProfile && currentAdminProfile.role === 'super_admin';
    const deleteBtn = isSuperAdmin ? `<button class="btn-danger btn-sm" onclick="deleteMatchById('${m.id}')">🗑️</button>` : '';

    return `
        <div style="background:#0f172a; padding:12px; border-radius:8px; border:1px solid #334155;">
            <div class="row-between">
                <span style="font-size:0.78rem; color:#94a3b8;">📅 ${dateStr}</span>
                <div style="display:flex; gap:6px;">
                    <button class="btn-secondary btn-sm" onclick="openMatchScorecardModal('${m.id}')">Scorecard</button>
                    ${deleteBtn}
                </div>
            </div>
            <div style="font-weight:700; font-size:0.98rem; margin-top:6px;">
                ${m.team1_name} (${inn1.runs}/${inn1.wickets}) vs ${m.team2_name} (${inn2.runs}/${inn2.wickets})
            </div>
            <div style="color:#4ade80; font-weight:600; font-size:0.85rem; margin-top:4px;">🏆 ${resText}</div>
        </div>
    `;
}

async function deleteMatchById(matchId) {
    if (!currentAdminProfile || currentAdminProfile.role !== 'super_admin') return alert('Only Super Admin can delete matches!');
    if (!confirm('Permanently delete this match from database?')) return;
    await sb.from('matches').delete().eq('id', matchId);
    await fetchMatches();
    renderCurrentView();
}

function openMatchScorecardModal(matchId) {
    const match = allMatches.find(m => m.id === matchId) || activeMatch;
    if (!match || !match.scorecard) return;
    const resText = match.result_text || match.scorecard.result_text || '';

    const renderInningsBlock = (inn, title) => {
        if (!inn) return '';
        const overs = `${Math.floor(inn.legalBalls / 6)}.${inn.legalBalls % 6}`;
        return `
            <div style="margin-top:12px; background:#0f172a; padding:10px; border-radius:8px; border:1px solid #334155;">
                <div class="row-between">
                    <h4 style="font-size:0.95rem;">${title}: ${inn.battingTeam}</h4>
                    <strong style="font-size:0.95rem;">${inn.runs}/${inn.wickets} (${overs})</strong>
                </div>
                <div style="margin-top:6px;">
                    <table class="compact-table">
                        <thead><tr><th>Batter</th><th>Out</th><th>R</th><th>B</th><th>4s</th><th>6s</th></tr></thead>
                        <tbody>
                            ${(inn.batters || []).map(b => `
                                <tr>
                                    <td style="display:flex; align-items:center; gap:6px;">${renderPlayerAvatarHtml(b.id, b.name, 22)}<strong>${b.name}</strong></td>
                                    <td style="font-size:0.75rem; color:#94a3b8;">${b.isOut ? b.dismissal : 'not out'}</td>
                                    <td><strong>${b.runs}</strong></td>
                                    <td>${b.balls}</td>
                                    <td>${b.fours}</td>
                                    <td>${b.sixes}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div style="margin-top:10px;">
                    <table class="compact-table">
                        <thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr></thead>
                        <tbody>
                            ${(inn.bowlers || []).map(bw => `
                                <tr>
                                    <td style="display:flex; align-items:center; gap:6px;">${renderPlayerAvatarHtml(bw.id, bw.name, 22)}<span>${bw.name}</span></td>
                                    <td>${Math.floor(bw.balls / 6)}.${bw.balls % 6}</td>
                                    <td>${bw.maidens}</td>
                                    <td>${bw.runs}</td>
                                    <td><strong>${bw.wickets}</strong></td>
                                    <td>${bw.balls > 0 ? (bw.runs / (bw.balls / 6)).toFixed(1) : '0.0'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    };

    const liveBadge = match.status === 'live' ? `<span class="badge badge-live" style="margin-right:6px;">● LIVE</span>` : '';
    document.getElementById('popupContent').innerHTML = `
        <div class="row-between">
            <h3 style="font-size:1.05rem;">${liveBadge}${match.team1_name} vs ${match.team2_name}</h3>
            <button class="btn-secondary btn-sm" onclick="closeModal('popupModal')">✕</button>
        </div>
        <span style="color:#94a3b8; font-size:0.78rem;">📅 ${new Date(match.created_at).toLocaleDateString()}</span>
        ${resText ? `<p style="color:#4ade80; font-weight:700; font-size:0.9rem; margin-top:4px;">🏆 ${resText}</p>` : ''}
        ${renderInningsBlock(match.scorecard.innings1, '1st Innings')}
        ${renderInningsBlock(match.scorecard.innings2, '2nd Innings')}
    `;
    openModal('popupModal');
}

// ==========================================
// 13. CAREER PLAYER STATS + FULL PLAYER PROFILE + ICC COMPARISON
// ==========================================
function computeAllPlayerCareerStats() {
    const statsMap = {};
    const nameToId = {};

    allPlayers.forEach(p => {
        const key = String(p.id);
        statsMap[key] = {
            id: key,
            name: p.name,
            nickname: p.nickname || '',
            role: p.role || 'All-Rounder',
            photo_url: p.photo_url || '',
            matches: new Set(),
            inningsBat: 0,
            notOuts: 0,
            runs: 0,
            ballsFaced: 0,
            fours: 0,
            sixes: 0,
            highestScore: 0,
            thirties: 0,
            fifties: 0,
            inningsBowl: 0,
            wickets: 0,
            ballsBowled: 0,
            runsConceded: 0,
            maidens: 0,
            bestWickets: 0,
            bestRuns: 999
        };
        nameToId[p.name.trim().toLowerCase()] = key;
    });

    const resolvePlayerStat = (rawId, rawName) => {
        const idStr = rawId ? String(rawId) : '';
        const lowerName = (rawName || '').trim().toLowerCase();
        if (idStr && statsMap[idStr]) return statsMap[idStr];
        if (lowerName && nameToId[lowerName]) return statsMap[nameToId[lowerName]];
        return null;
    };

    allMatches.forEach(m => {
        if (!m.scorecard) return;
        [m.scorecard.innings1, m.scorecard.innings2].forEach(inn => {
            if (!inn) return;
            (inn.batters || []).forEach(b => {
                const entry = resolvePlayerStat(b.id, b.name);
                if (entry) {
                    entry.matches.add(m.id);
                    entry.inningsBat += 1;
                    if (!b.isOut) entry.notOuts += 1;
                    const r = Number(b.runs || 0);
                    entry.runs += r;
                    entry.ballsFaced += Number(b.balls || 0);
                    entry.fours += Number(b.fours || 0);
                    entry.sixes += Number(b.sixes || 0);
                    if (r > entry.highestScore) entry.highestScore = r;
                    if (r >= 50) entry.fifties += 1;
                    else if (r >= 30) entry.thirties += 1;
                }
            });
            (inn.bowlers || []).forEach(bw => {
                const entry = resolvePlayerStat(bw.id, bw.name);
                if (entry) {
                    entry.matches.add(m.id);
                    entry.inningsBowl += 1;
                    const w = Number(bw.wickets || 0);
                    const rc = Number(bw.runs || 0);
                    entry.wickets += w;
                    entry.ballsBowled += Number(bw.balls || 0);
                    entry.runsConceded += rc;
                    entry.maidens += Number(bw.maidens || 0);
                    if (w > entry.bestWickets || (w === entry.bestWickets && w > 0 && rc < entry.bestRuns)) {
                        entry.bestWickets = w;
                        entry.bestRuns = rc;
                    }
                }
            });
        });
    });

    return statsMap;
}

function setStatsSubTab(mode) {
    statsSubTab = mode;
    renderPlayerStatsView();
}

function renderPlayerStatsView() {
    const container = document.getElementById('appContainer');
    const statsMap = computeAllPlayerCareerStats();
    const allStatsList = Object.values(statsMap);

    const battingSorted = [...allStatsList].sort((a, b) => b.runs - a.runs || b.highestScore - a.highestScore);
    const bowlingSorted = [...allStatsList].sort((a, b) => b.wickets - a.wickets || a.runsConceded - b.runsConceded);

    const battingRows = battingSorted.map(s => {
        const sr = s.ballsFaced > 0 ? ((s.runs / s.ballsFaced) * 100).toFixed(0) : '0';
        const avatar = renderPlayerAvatarHtml(s.id, s.name, 28);
        const editCol = currentUser ? `<td><button class="btn-secondary btn-sm" style="padding:3px 6px;" onclick="openEditPlayerModal('${s.id}')">✏️</button></td>` : '';
        return `
            <tr>
                <td style="display:flex; align-items:center; gap:6px;">
                    ${avatar}
                    <div>
                        <span class="player-link" onclick="openPlayerFullProfile('${s.id}')">${s.name}</span>
                        <div style="font-size:0.68rem; color:#38bdf8;">${s.role}</div>
                    </div>
                </td>
                <td>${s.matches.size}</td>
                <td><strong>${s.runs}</strong></td>
                <td>${s.ballsFaced}</td>
                <td>${s.fours}/${s.sixes}</td>
                <td>${s.highestScore}</td>
                <td>${sr}</td>
                ${editCol}
            </tr>
        `;
    }).join('');

    const bowlingRows = bowlingSorted.map(s => {
        const oversStr = `${Math.floor(s.ballsBowled / 6)}.${s.ballsBowled % 6}`;
        const econ = s.ballsBowled > 0 ? (s.runsConceded / (s.ballsBowled / 6)).toFixed(1) : '0.0';
        const bestFig = s.bestWickets > 0 ? `${s.bestWickets}/${s.bestRuns}` : '-';
        const avatar = renderPlayerAvatarHtml(s.id, s.name, 28);
        return `
            <tr>
                <td style="display:flex; align-items:center; gap:6px;">
                    ${avatar}
                    <div>
                        <span class="player-link" onclick="openPlayerFullProfile('${s.id}')">${s.name}</span>
                        <div style="font-size:0.68rem; color:#facc15;">${s.role}</div>
                    </div>
                </td>
                <td>${s.matches.size}</td>
                <td>${oversStr}</td>
                <td>${s.maidens}</td>
                <td>${s.runsConceded}</td>
                <td><strong>${s.wickets}</strong></td>
                <td>${bestFig}</td>
                <td>${econ}</td>
            </tr>
        `;
    }).join('');

    const showBat = statsSubTab === 'both' || statsSubTab === 'batting';
    const showBowl = statsSubTab === 'both' || statsSubTab === 'bowling';

    container.innerHTML = `
        <div class="card">
            <div class="row-between" style="flex-wrap:wrap; gap:8px;">
                <div>
                    <h2 style="font-size:1.15rem;">📊 Career Players Stats</h2>
                    <p style="font-size:0.75rem; color:#94a3b8;">Tap photo to zoom • Tap player name for full profile</p>
                </div>
                <button class="btn-primary btn-sm" onclick="openPlayerComparisonModal()">⚖️ Compare Players</button>
            </div>

            <div class="stats-pill-bar" style="margin-top:10px;">
                <button class="stats-pill-btn ${statsSubTab === 'both' ? 'active' : ''}" onclick="setStatsSubTab('both')">All (Bat + Bowl)</button>
                <button class="stats-pill-btn ${statsSubTab === 'batting' ? 'active' : ''}" onclick="setStatsSubTab('batting')">🏏 Batting</button>
                <button class="stats-pill-btn ${statsSubTab === 'bowling' ? 'active' : ''}" onclick="setStatsSubTab('bowling')">🎯 Bowling</button>
            </div>

            ${showBat ? `
                <h3 style="font-size:0.98rem; color:#38bdf8; margin-top:14px; margin-bottom:6px;">🏏 Batting Career Records</h3>
                <table class="compact-table">
                    <thead>
                        <tr><th>Player</th><th>M</th><th>Runs</th><th>BF</th><th>4/6</th><th>HS</th><th>SR</th>${currentUser ? '<th></th>' : ''}</tr>
                    </thead>
                    <tbody>${battingRows || '<tr><td colspan="8">No players registered yet.</td></tr>'}</tbody>
                </table>
            ` : ''}

            ${showBowl ? `
                <h3 style="font-size:0.98rem; color:#facc15; margin-top:18px; margin-bottom:6px;">🎯 Bowling Career Records</h3>
                <table class="compact-table">
                    <thead>
                        <tr><th>Player</th><th>M</th><th>Ov</th><th>Mdn</th><th>Runs</th><th>Wkts</th><th>Best</th><th>Econ</th></tr>
                    </thead>
                    <tbody>${bowlingRows || '<tr><td colspan="8">No players registered yet.</td></tr>'}</tbody>
                </table>
            ` : ''}
        </div>
    `;
}

function openPlayerFullProfile(playerId) {
    const statsMap = computeAllPlayerCareerStats();
    const s = statsMap[String(playerId)];
    if (!s) return;

    const dismissals = Math.max(1, s.inningsBat - s.notOuts);
    const batAvg = s.inningsBat > 0 ? (s.runs / dismissals).toFixed(1) : '0.0';
    const batSR = s.ballsFaced > 0 ? ((s.runs / s.ballsFaced) * 100).toFixed(1) : '0.0';

    const oversStr = `${Math.floor(s.ballsBowled / 6)}.${s.ballsBowled % 6}`;
    const bowlEcon = s.ballsBowled > 0 ? (s.runsConceded / (s.ballsBowled / 6)).toFixed(2) : '0.00';
    const bowlAvg = s.wickets > 0 ? (s.runsConceded / s.wickets).toFixed(1) : '-';
    const bestFig = s.bestWickets > 0 ? `${s.bestWickets}/${s.bestRuns}` : '-';

    const container = document.getElementById('appContainer');
    container.innerHTML = `
        <div class="card">
            <div class="row-between" style="margin-bottom:12px;">
                <button class="btn-secondary btn-sm" onclick="renderPlayerStatsView()">← Back to Stats</button>
                <button class="btn-primary btn-sm" onclick="openPlayerComparisonModal('${s.id}')">⚖️ Compare</button>
            </div>

            <div style="display:flex; align-items:center; gap:14px; background:#0f172a; padding:14px; border-radius:10px; border:1px solid #334155;">
                ${renderPlayerAvatarHtml(s.id, s.name, 68)}
                <div>
                    <h2 style="margin:0; font-size:1.3rem;">${s.name}</h2>
                    ${s.nickname ? `<div style="color:#94a3b8; font-size:0.85rem;">"${s.nickname}"</div>` : ''}
                    <span class="badge" style="margin-top:6px; display:inline-block; background:#1e293b; color:#38bdf8;">${s.role}</span>
                </div>
            </div>

            <h3 style="font-size:1rem; color:#38bdf8; margin-top:16px; margin-bottom:8px;">🏏 Career Batting Summary</h3>
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;">
                <div class="icc-stat-box"><div class="icc-stat-val">${s.matches.size}</div><div class="icc-stat-lbl">Matches</div></div>
                <div class="icc-stat-box"><div class="icc-stat-val">${s.inningsBat}</div><div class="icc-stat-lbl">Innings</div></div>
                <div class="icc-stat-box"><div class="icc-stat-val" style="color:#4ade80;">${s.runs}</div><div class="icc-stat-lbl">Runs</div></div>
                <div class="icc-stat-box"><div class="icc-stat-val">${s.highestScore}</div><div class="icc-stat-lbl">Highest</div></div>
                <div class="icc-stat-box"><div class="icc-stat-val">${batAvg}</div><div class="icc-stat-lbl">Average</div></div>
                <div class="icc-stat-box"><div class="icc-stat-val">${batSR}</div><div class="icc-stat-lbl">Strike Rate</div></div>
                <div class="icc-stat-box"><div class="icc-stat-val">${s.ballsFaced}</div><div class="icc-stat-lbl">Balls Faced</div></div>
                <div class="icc-stat-box"><div class="icc-stat-val">${s.fours} / ${s.sixes}</div><div class="icc-stat-lbl">4s / 6s</div></div>
                <div class="icc-stat-box"><div class="icc-stat-val">${s.fifties} / ${s.thirties}</div><div class="icc-stat-lbl">50s / 30s</div></div>
            </div>

            <h3 style="font-size:1rem; color:#facc15; margin-top:18px; margin-bottom:8px;">🎯 Career Bowling Summary</h3>
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;">
                <div class="icc-stat-box"><div class="icc-stat-val">${s.inningsBowl}</div><div class="icc-stat-lbl">Innings</div></div>
                <div class="icc-stat-box"><div class="icc-stat-val">${oversStr}</div><div class="icc-stat-lbl">Overs</div></div>
                <div class="icc-stat-box"><div class="icc-stat-val" style="color:#facc15;">${s.wickets}</div><div class="icc-stat-lbl">Wickets</div></div>
                <div class="icc-stat-box"><div class="icc-stat-val">${bestFig}</div><div class="icc-stat-lbl">Best Bowl</div></div>
                <div class="icc-stat-box"><div class="icc-stat-val">${bowlEcon}</div><div class="icc-stat-lbl">Economy</div></div>
                <div class="icc-stat-box"><div class="icc-stat-val">${bowlAvg}</div><div class="icc-stat-lbl">Bowl Avg</div></div>
                <div class="icc-stat-box"><div class="icc-stat-val">${s.runsConceded}</div><div class="icc-stat-lbl">Runs Given</div></div>
                <div class="icc-stat-box"><div class="icc-stat-val">${s.maidens}</div><div class="icc-stat-lbl">Maidens</div></div>
                <div class="icc-stat-box"><div class="icc-stat-val">${s.notOuts}</div><div class="icc-stat-lbl">Not Outs</div></div>
            </div>
        </div>
    `;
}

function openPlayerComparisonModal(preselectP1 = '') {
    if (allPlayers.length < 2) {
        return alert('At least 2 registered players are needed to compare!');
    }
    const p1Default = preselectP1 || String(allPlayers[0].id);
    const p2Obj = allPlayers.find(p => String(p.id) !== p1Default) || allPlayers[1];
    const p2Default = String(p2Obj.id);

    const container = document.getElementById('appContainer');
    container.innerHTML = `
        <div class="card">
            <div class="row-between" style="margin-bottom:12px;">
                <h2 style="font-size:1.15rem;">⚖️ ICC Style Player Comparison</h2>
                <button class="btn-secondary btn-sm" onclick="renderPlayerStatsView()">← Back</button>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                <div>
                    <label style="font-size:0.75rem; color:#38bdf8;">Player 1</label>
                    <select id="cmpPlayer1" class="input-field" onchange="renderComparisonTable()">
                        ${allPlayers.map(p => `<option value="${p.id}" ${String(p.id) === p1Default ? 'selected' : ''}>${p.name}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <label style="font-size:0.75rem; color:#facc15;">Player 2</label>
                    <select id="cmpPlayer2" class="input-field" onchange="renderComparisonTable()">
                        ${allPlayers.map(p => `<option value="${p.id}" ${String(p.id) === p2Default ? 'selected' : ''}>${p.name}</option>`).join('')}
                    </select>
                </div>
            </div>

            <div id="comparisonResultArea" style="margin-top:14px;"></div>
        </div>
    `;
    renderComparisonTable();
}

function renderComparisonTable() {
    const id1 = document.getElementById('cmpPlayer1').value;
    const id2 = document.getElementById('cmpPlayer2').value;
    const statsMap = computeAllPlayerCareerStats();
    const p1 = statsMap[id1];
    const p2 = statsMap[id2];
    if (!p1 || !p2) return;

    const p1SR = p1.ballsFaced > 0 ? Number(((p1.runs / p1.ballsFaced) * 100).toFixed(1)) : 0;
    const p2SR = p2.ballsFaced > 0 ? Number(((p2.runs / p2.ballsFaced) * 100).toFixed(1)) : 0;

    const p1Econ = p1.ballsBowled > 0 ? Number((p1.runsConceded / (p1.ballsBowled / 6)).toFixed(2)) : 0;
    const p2Econ = p2.ballsBowled > 0 ? Number((p2.runsConceded / (p2.ballsBowled / 6)).toFixed(2)) : 0;

    const cmpRow = (label, v1, v2, lowerIsBetter = false) => {
        let c1 = '', c2 = '';
        if (v1 !== v2) {
            if (lowerIsBetter) {
                if (v1 > 0 && (v2 === 0 || v1 < v2)) c1 = 'cmp-win';
                else if (v2 > 0) c2 = 'cmp-win';
            } else {
                if (v1 > v2) c1 = 'cmp-win';
                else c2 = 'cmp-win';
            }
        }
        return `
            <tr>
                <td style="text-align:center;" class="${c1}">${v1}</td>
                <td style="text-align:center; color:#94a3b8; font-weight:600;">${label}</td>
                <td style="text-align:center;" class="${c2}">${v2}</td>
            </tr>
        `;
    };

    document.getElementById('comparisonResultArea').innerHTML = `
        <div style="display:grid; grid-template-columns:1fr auto 1fr; align-items:center; background:#0f172a; padding:12px; border-radius:10px; border:1px solid #334155; text-align:center;">
            <div>
                ${renderPlayerAvatarHtml(p1.id, p1.name, 54)}
                <div style="font-weight:700; margin-top:6px; font-size:0.95rem;">${p1.name}</div>
                <div style="font-size:0.72rem; color:#38bdf8;">${p1.role}</div>
            </div>
            <div style="font-weight:900; color:#facc15; font-size:1.1rem; padding:0 8px;">VS</div>
            <div>
                ${renderPlayerAvatarHtml(p2.id, p2.name, 54)}
                <div style="font-weight:700; margin-top:6px; font-size:0.95rem;">${p2.name}</div>
                <div style="font-size:0.72rem; color:#facc15;">${p2.role}</div>
            </div>
        </div>

        <table class="compact-table" style="margin-top:12px;">
            <thead>
                <tr>
                    <th style="text-align:center;">${p1.name}</th>
                    <th style="text-align:center;">STAT</th>
                    <th style="text-align:center;">${p2.name}</th>
                </tr>
            </thead>
            <tbody>
                ${cmpRow('Matches', p1.matches.size, p2.matches.size)}
                ${cmpRow('Bat Runs', p1.runs, p2.runs)}
                ${cmpRow('Highest Score', p1.highestScore, p2.highestScore)}
                ${cmpRow('Strike Rate', p1SR, p2SR)}
                ${cmpRow('Fours (4s)', p1.fours, p2.fours)}
                ${cmpRow('Sixes (6s)', p1.sixes, p2.sixes)}
                ${cmpRow('Wickets', p1.wickets, p2.wickets)}
                ${cmpRow('Economy', p1Econ, p2Econ, true)}
                ${cmpRow('Maidens', p1.maidens, p2.maidens)}
            </tbody>
        </table>
    `;
}

// ==========================================
// 14. ADMIN DRAWER SECTIONS (PLAYERS, MATCHES, ADMINS, PASSWORD)
// ==========================================
function renderManagePlayersView() {
    if (!currentUser) return goHome();
    const container = document.getElementById('appContainer');
    const isSuperAdmin = currentAdminProfile && currentAdminProfile.role === 'super_admin';

    const playerCards = allPlayers.map(p => `
        <div class="row-between" style="background:#0f172a; padding:8px 10px; border-radius:8px; border:1px solid #334155;">
            <div style="display:flex; align-items:center; gap:8px;">
                ${renderPlayerAvatarHtml(p.id, p.name, 34)}
                <div>
                    <strong style="font-size:0.92rem;">${p.name}</strong> ${p.nickname ? `<span style="font-size:0.8rem; color:#94a3b8;">(${p.nickname})</span>` : ''}
                    <div style="font-size:0.75rem; color:#94a3b8;">${p.role || 'All-Rounder'}</div>
                </div>
            </div>
            <div style="display:flex; gap:6px;">
                <button class="btn-secondary btn-sm" onclick="openEditPlayerModal('${p.id}')">✏️ Edit</button>
                ${isSuperAdmin ? `<button class="btn-danger btn-sm" onclick="deletePlayer('${p.id}')">🗑️</button>` : ''}
            </div>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="card">
            <h2 style="font-size:1.15rem;">👤 Add & Manage Players</h2>
            <div class="resp-grid-2" style="margin-top:10px;">
                <input type="text" id="newPlayerName" class="input-field" placeholder="Full Name *">
                <input type="text" id="newPlayerNick" class="input-field" placeholder="Nickname">
                <select id="newPlayerRole" class="input-field">
                    <option value="All-Rounder">All-Rounder</option>
                    <option value="Batter">Batter</option>
                    <option value="Bowler">Bowler</option>
                    <option value="Wicket-Keeper">Wicket-Keeper</option>
                </select>
                <input type="file" id="newPlayerPhoto" accept="image/*" class="input-field">
            </div>
            <button class="btn-primary" style="margin-top:10px; width:100%;" onclick="addNewPlayer()">+ Add Player</button>
            <div style="display:flex; flex-direction:column; gap:8px; margin-top:14px;">${playerCards}</div>
        </div>
    `;
}

async function addNewPlayer() {
    const name = document.getElementById('newPlayerName').value.trim();
    const nickname = document.getElementById('newPlayerNick').value.trim();
    const role = document.getElementById('newPlayerRole').value;
    const photoFile = document.getElementById('newPlayerPhoto').files[0];

    if (!name) return alert('Player name is required!');
    let photoUrl = '';

    if (photoFile) {
        const fileName = `${Date.now()}_${photoFile.name.replace(/\s+/g, '_')}`;
        const { data: upData, error: upErr } = await sb.storage.from('player-photos').upload(fileName, photoFile);
        if (!upErr && upData) {
            const { data: pubUrl } = sb.storage.from('player-photos').getPublicUrl(fileName);
            photoUrl = pubUrl.publicUrl;
        }
    }

    const { error } = await sb.from('players').insert([{ name, nickname, role, photo_url: photoUrl }]);
    if (error) return alert('Error adding player: ' + error.message);

    await fetchPlayers();
    renderManagePlayersView();
}

function openEditPlayerModal(playerId) {
    const p = allPlayers.find(x => String(x.id) === String(playerId));
    if (!p) return;

    document.getElementById('editPlayerId').value = p.id;
    document.getElementById('editPlayerName').value = p.name || '';
    document.getElementById('editPlayerNick').value = p.nickname || '';
    document.getElementById('editPlayerRole').value = p.role || 'All-Rounder';
    document.getElementById('editPlayerPhotoFile').value = '';

    const preview = document.getElementById('editPlayerPhotoPreview');
    preview.innerHTML = p.photo_url
        ? `<div style="display:flex; align-items:center; gap:10px;">
               <img src="${p.photo_url}" style="width:44px; height:44px; border-radius:50%; object-fit:cover;">
               <button type="button" class="btn-danger btn-sm" onclick="removePlayerPhoto('${p.id}')">Remove Photo</button>
           </div>`
        : '<span style="font-size:0.8rem; color:#94a3b8;">No photo uploaded</span>';

    openModal('editPlayerModal');
}

async function removePlayerPhoto(playerId) {
    await sb.from('players').update({ photo_url: '' }).eq('id', playerId);
    await fetchPlayers();
    closeModal('editPlayerModal');
    renderCurrentView();
}

async function saveEditedPlayer() {
    const playerId = document.getElementById('editPlayerId').value;
    const name = document.getElementById('editPlayerName').value.trim();
    const nickname = document.getElementById('editPlayerNick').value.trim();
    const role = document.getElementById('editPlayerRole').value;
    const photoFile = document.getElementById('editPlayerPhotoFile').files[0];

    if (!name) return alert('Player name cannot be empty!');
    const updates = { name, nickname, role };

    if (photoFile) {
        const fileName = `${Date.now()}_${photoFile.name.replace(/\s+/g, '_')}`;
        const { data: upData, error: upErr } = await sb.storage.from('player-photos').upload(fileName, photoFile);
        if (!upErr && upData) {
            const { data: pubUrl } = sb.storage.from('player-photos').getPublicUrl(fileName);
            updates.photo_url = pubUrl.publicUrl;
        }
    }

    await sb.from('players').update(updates).eq('id', playerId);
    await fetchPlayers();
    closeModal('editPlayerModal');
    renderCurrentView();
}

async function deletePlayer(playerId) {
    if (!currentAdminProfile || currentAdminProfile.role !== 'super_admin') return alert('Only Super Admin can delete players!');
    if (!confirm('Delete this player permanently?')) return;
    await sb.from('players').delete().eq('id', playerId);
    await fetchPlayers();
    renderManagePlayersView();
}

function renderManageMatchesView() {
    if (!currentUser) return goHome();
    renderMatchHistoryView();
}

async function renderManageAdminsView() {
    if (!currentAdminProfile || currentAdminProfile.role !== 'super_admin') return goHome();
    const { data: admins } = await sb.from('admins').select('*');

    document.getElementById('appContainer').innerHTML = `
        <div class="card">
            <h2 style="font-size:1.15rem;">🛡️ Manage Admins</h2>
            <div class="resp-grid-2" style="margin-top:10px;">
                <input type="text" id="newAdminName" class="input-field" placeholder="Admin Name">
                <input type="email" id="newAdminEmail" class="input-field" placeholder="Email">
                <input type="password" id="newAdminPass" class="input-field" placeholder="Password (min 6 chars)">
                <select id="newAdminRole" class="input-field">
                    <option value="admin">Admin</option>
                    <option value="super_admin">Super Admin</option>
                </select>
            </div>
            <button class="btn-primary" style="margin-top:10px; width:100%;" onclick="createNewAdmin()">+ Create Admin</button>
            <div style="display:flex; flex-direction:column; gap:8px; margin-top:14px;">
                ${(admins || []).map(a => `
                    <div class="row-between" style="background:#0f172a; padding:8px 10px; border-radius:8px; border:1px solid #334155;">
                        <div style="font-size:0.88rem;">
                            <strong>${a.name}</strong> (${a.email})
                            <span class="badge" style="margin-left:4px;">${a.role}</span>
                        </div>
                        ${a.id !== currentUser.id ? `<button class="btn-danger btn-sm" onclick="removeAdminAccess('${a.id}')">Remove</button>` : '<span style="color:#4ade80; font-size:0.8rem;">You</span>'}
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

async function createNewAdmin() {
    const name = document.getElementById('newAdminName').value.trim();
    const email = document.getElementById('newAdminEmail').value.trim();
    const password = document.getElementById('newAdminPass').value;
    const role = document.getElementById('newAdminRole').value;

    if (!name || !email || password.length < 6) {
        return alert('Please enter valid Name, Email, and Password (at least 6 characters).');
    }

    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) return alert('Error: ' + error.message);

    if (data && data.user) {
        await sb.from('admins').insert([{ id: data.user.id, name, email, role }]);
        alert('Admin created successfully!');
        renderManageAdminsView();
    }
}

async function removeAdminAccess(adminId) {
    if (!confirm('Remove admin access for this user?')) return;
    await sb.from('admins').delete().eq('id', adminId);
    renderManageAdminsView();
}

function renderChangePasswordView() {
    if (!currentUser) return goHome();
    document.getElementById('appContainer').innerHTML = `
        <div class="card">
            <h2 style="font-size:1.15rem;">🔑 Change Password</h2>
            <p style="color:#94a3b8; font-size:0.85rem; margin:8px 0;">Enter a new password (minimum 6 characters).</p>
            <input type="password" id="newSelfPassword" class="input-field" placeholder="New Password">
            <button class="btn-primary" style="margin-top:12px; width:100%;" onclick="updateSelfPassword()">Update Password</button>
        </div>
    `;
}

async function updateSelfPassword() {
    const newPassword = document.getElementById('newSelfPassword').value;
    if (!newPassword || newPassword.length < 6) return alert('Password must be at least 6 characters.');
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) return alert('Error: ' + error.message);
    alert('Password updated successfully!');
    goHome();
}
