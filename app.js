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

let setupTeam1Squad = [];
let setupTeam2Squad = [];

// ==========================================
// 2. INITIALIZATION & AUTHENTICATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuthSession();
    await loadAllInitialData();
    startAutoSync();
});

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
// 3. MODALS, DRAWER & NAVIGATION
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
// 4. DATA LOADING & 1-SECOND AUTO-SYNC
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
// 5. LIVE VIEW (PUBLIC + ADMIN SCORING)
// ==========================================
function renderLiveView() {
    const container = document.getElementById('appContainer');
    if (!activeMatch) {
        container.innerHTML = `
            <div class="card" style="text-align:center; padding:40px 20px;">
                <h2>🏏 No Live Match Right Now</h2>
                <p style="color:#94a3b8; margin-top:8px;">Check Recent Matches, Match History, or Players Stats from the tabs above.</p>
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
    const oversText = `${Math.floor(inn.legalBalls / 6)}.${inn.legalBalls % 6}`;
    const striker = inn.batters.find(b => b.id === inn.strikerId);
    const nonStriker = inn.batters.find(b => b.id === inn.nonStrikerId);
    const bowler = inn.bowlers.find(b => b.id === inn.currentBowlerId);

    const targetHtml = sc.currentInnings === 2
        ? `<div style="color:#facc15; font-weight:700; margin-top:6px;">Target: ${sc.innings1.runs + 1} | Need ${Math.max(0, (sc.innings1.runs + 1) - inn.runs)} runs in ${Math.max(0, (activeMatch.overs * 6) - inn.legalBalls)} balls</div>`
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
        ? `<button class="btn-warning btn-sm" onclick="takeOverScoring()">⚡ Take Over Scoring</button>`
        : '';

    container.innerHTML = `
        <div class="score-banner">
            <div class="row-between">
                <span class="badge badge-live">● LIVE (Auto-Sync 1s)</span>
                ${takeControlBtn}
            </div>
            <h2 style="margin-top:8px;">${activeMatch.team1_name} vs ${activeMatch.team2_name}</h2>
            ${sc.tossText ? `<p style="font-size:0.82rem; color:#94a3b8; margin-top:2px;">🪙 ${sc.tossText}</p>` : ''}
            <div style="font-size:2.2rem; font-weight:800; margin:8px 0;">
                ${inn.battingTeam}: ${inn.runs}/${inn.wickets} <span style="font-size:1.1rem; color:#94a3b8;">(${oversText} / ${activeMatch.overs} Ov)</span>
            </div>
            ${targetHtml}
            <div class="balls-strip" style="margin-top:12px;">${recentBalls || '<span style="color:#64748b;">Match just started</span>'}</div>
        </div>

        <div class="card">
            <h3>🏏 Crease & Current Bowler</h3>
            <table class="stats-table" style="margin-top:10px;">
                <thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead>
                <tbody>
                    ${striker ? `<tr style="background:rgba(56,189,248,0.1);"><td><strong>${striker.name} *</strong></td><td><strong>${striker.runs}</strong></td><td>${striker.balls}</td><td>${striker.fours}</td><td>${striker.sixes}</td><td>${striker.balls > 0 ? ((striker.runs / striker.balls) * 100).toFixed(1) : '0.0'}</td></tr>` : ''}
                    ${nonStriker ? `<tr><td>${nonStriker.name}</td><td>${nonStriker.runs}</td><td>${nonStriker.balls}</td><td>${nonStriker.fours}</td><td>${nonStriker.sixes}</td><td>${nonStriker.balls > 0 ? ((nonStriker.runs / nonStriker.balls) * 100).toFixed(1) : '0.0'}</td></tr>` : ''}
                </tbody>
            </table>

            <table class="stats-table" style="margin-top:14px;">
                <thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr></thead>
                <tbody>
                    ${bowler ? `<tr><td><strong>${bowler.name}</strong></td><td>${Math.floor(bowler.balls / 6)}.${bowler.balls % 6}</td><td>${bowler.maidens}</td><td>${bowler.runs}</td><td><strong>${bowler.wickets}</strong></td><td>${bowler.balls > 0 ? (bowler.runs / (bowler.balls / 6)).toFixed(2) : '0.00'}</td></tr>` : ''}
                </tbody>
            </table>
            <div style="margin-top:14px; text-align:right;">
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
// 6. START LIVE MATCH SETUP (TOSS + REGISTERED & GUEST PLAYERS)
// ==========================================
function renderStartMatchView() {
    if (!currentUser) return goHome();
    const container = document.getElementById('appContainer');

    container.innerHTML = `
        <div class="card">
            <h2>🏏 Start New Live Match</h2>
            <p style="color:#94a3b8; font-size:0.85rem; margin-bottom:14px;">Enter team names, toss details, and select registered or guest players for both squads.</p>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
                <div>
                    <label>Team 1 Name *</label>
                    <input type="text" id="t1Name" class="input-field" placeholder="e.g. Raipur Eleven" oninput="updateTossDropdowns()">
                </div>
                <div>
                    <label>Team 2 Name *</label>
                    <input type="text" id="t2Name" class="input-field" placeholder="e.g. Ujiarpur Stars" oninput="updateTossDropdowns()">
                </div>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-top:12px;">
                <div>
                    <label>Total Overs *</label>
                    <input type="number" id="matchOvers" class="input-field" placeholder="e.g. 6" value="6" min="1" max="50">
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

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:18px;">
                <div style="background:#0f172a; padding:12px; border-radius:8px; border:1px solid #334155;">
                    <h4 style="color:#38bdf8; margin-bottom:8px;">Team 1 Squad (<span id="t1Count">0</span>)</h4>
                    <label style="font-size:0.8rem; color:#94a3b8;">Add Registered Player:</label>
                    <div style="display:flex; gap:6px; margin-top:4px;">
                        <select id="regPlayerSelect1" class="input-field" style="flex:1;">
                            <option value="">-- Choose Player --</option>
                            ${allPlayers.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
                        </select>
                        <button type="button" class="btn-primary btn-sm" onclick="addRegPlayerToSetup(1)">+ Add</button>
                    </div>
                    <label style="font-size:0.8rem; color:#94a3b8; display:block; margin-top:10px;">Or Add Guest Player:</label>
                    <div style="display:flex; gap:6px; margin-top:4px;">
                        <input type="text" id="guestInput1" class="input-field" placeholder="Guest player name" style="flex:1;">
                        <button type="button" class="btn-secondary btn-sm" onclick="addGuestPlayerToSetup(1)">+ Guest</button>
                    </div>
                    <div id="setupSquadList1" style="margin-top:10px; display:flex; flex-direction:column; gap:5px; max-height:180px; overflow-y:auto;"></div>
                </div>

                <div style="background:#0f172a; padding:12px; border-radius:8px; border:1px solid #334155;">
                    <h4 style="color:#facc15; margin-bottom:8px;">Team 2 Squad (<span id="t2Count">0</span>)</h4>
                    <label style="font-size:0.8rem; color:#94a3b8;">Add Registered Player:</label>
                    <div style="display:flex; gap:6px; margin-top:4px;">
                        <select id="regPlayerSelect2" class="input-field" style="flex:1;">
                            <option value="">-- Choose Player --</option>
                            ${allPlayers.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
                        </select>
                        <button type="button" class="btn-primary btn-sm" onclick="addRegPlayerToSetup(2)">+ Add</button>
                    </div>
                    <label style="font-size:0.8rem; color:#94a3b8; display:block; margin-top:10px;">Or Add Guest Player:</label>
                    <div style="display:flex; gap:6px; margin-top:4px;">
                        <input type="text" id="guestInput2" class="input-field" placeholder="Guest player name" style="flex:1;">
                        <button type="button" class="btn-secondary btn-sm" onclick="addGuestPlayerToSetup(2)">+ Guest</button>
                    </div>
                    <div id="setupSquadList2" style="margin-top:10px; display:flex; flex-direction:column; gap:5px; max-height:180px; overflow-y:auto;"></div>
                </div>
            </div>

            <button class="btn-success" style="width:100%; margin-top:20px; padding:13px; font-size:1rem; font-weight:700;" onclick="createNewMatch()">
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
    if (setupTeam1Squad.some(x => x.id === pId) || setupTeam2Squad.some(x => x.id === pId)) {
        return alert('This player is already selected in a team!');
    }
    const target = teamNum === 1 ? setupTeam1Squad : setupTeam2Squad;
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
    const renderList = (arr, teamNum) => arr.map((p, idx) => `
        <div style="display:flex; justify-content:space-between; align-items:center; background:#1e293b; padding:6px 10px; border-radius:6px; font-size:0.85rem;">
            <span>${idx + 1}. ${p.name}</span>
            <button type="button" onclick="removePlayerFromSetup(${teamNum}, ${idx})" style="background:transparent; border:none; color:#f87171; cursor:pointer; font-weight:bold;">✕</button>
        </div>
    `).join('');

    const l1 = document.getElementById('setupSquadList1');
    const l2 = document.getElementById('setupSquadList2');
    const c1 = document.getElementById('t1Count');
    const c2 = document.getElementById('t2Count');

    if (l1) l1.innerHTML = renderList(setupTeam1Squad, 1) || '<span style="color:#64748b; font-size:0.8rem;">No players added yet</span>';
    if (l2) l2.innerHTML = renderList(setupTeam2Squad, 2) || '<span style="color:#64748b; font-size:0.8rem;">No players added yet</span>';
    if (c1) c1.textContent = setupTeam1Squad.length;
    if (c2) c2.textContent = setupTeam2Squad.length;
}

async function createNewMatch() {
    const rawT1 = document.getElementById('t1Name').value.trim();
    const rawT2 = document.getElementById('t2Name').value.trim();
    const overs = parseInt(document.getElementById('matchOvers').value, 10) || 6;

    if (!rawT1 || !rawT2) return alert('Please enter both Team 1 and Team 2 names!');

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
        activeScorerId: currentUser.id,
        tossText: tossText,
        team1Squad: batFirstSquad,
        team2Squad: bowlFirstSquad,
        innings1: {
            battingTeam: batFirstTeam, bowlingTeam: bowlFirstTeam, runs: 0, wickets: 0, legalBalls: 0,
            extras: { wd: 0, nb: 0 }, strikerId: null, nonStrikerId: null, currentBowlerId: null,
            batters: [], bowlers: [], ballsHistory: [], overRunsTracker: 0
        },
        innings2: {
            battingTeam: bowlFirstTeam, bowlingTeam: batFirstTeam, runs: 0, wickets: 0, legalBalls: 0,
            extras: { wd: 0, nb: 0 }, strikerId: null, nonStrikerId: null, currentBowlerId: null,
            batters: [], bowlers: [], ballsHistory: [], overRunsTracker: 0
        }
    };

    const { data, error } = await sb.from('matches').insert([{
        team1_name: batFirstTeam,
        team2_name: bowlFirstTeam,
        overs: overs,
        status: 'live',
        scorecard: scorecard
    }]).select().single();

    if (error) return alert('Error starting match: ' + error.message);

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
// 7. BALL-BY-BALL LIVE SCORING ENGINE
// ==========================================
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
        ? `<div style="color:#facc15; font-weight:600; margin-top:4px;">Target: ${activeMatch.scorecard.innings1.runs + 1} | Need ${Math.max(0, (activeMatch.scorecard.innings1.runs + 1) - inn.runs)} off ${Math.max(0, (activeMatch.overs * 6) - inn.legalBalls)} balls</div>`
        : '';

    const recentBalls = (inn.ballsHistory || []).slice(-12).map(b => {
        let cls = 'ball-pill';
        if (b === '4') cls += ' ball-4';
        else if (b === '6') cls += ' ball-6';
        else if (b.includes('W')) cls += ' ball-w';
        else if (b.includes('WD') || b.includes('NB')) cls += ' ball-extra';
        return `<span class="${cls}">${b}</span>`;
    }).join('');

    document.getElementById('appContainer').innerHTML = `
        <div class="score-banner">
            <div class="row-between">
                <span class="badge badge-live">● SCORING LIVE</span>
                <div style="display:flex; gap:6px; flex-wrap:wrap;">
                    <button class="btn-secondary btn-sm" onclick="openEditTeamsModal()">👥 Edit Teams</button>
                    <button class="btn-secondary btn-sm" onclick="openBabyOverModal()">🍼 Baby Over</button>
                    <button class="btn-danger btn-sm" onclick="openMatchEndOptions()">🏁 End / Abandon</button>
                </div>
            </div>
            <h2 style="margin-top:8px;">${inn.battingTeam} vs ${inn.bowlingTeam}</h2>
            <div style="font-size:2.1rem; font-weight:800; margin:6px 0;">
                ${inn.runs}/${inn.wickets} <span style="font-size:1.1rem; color:#94a3b8;">(${oversText} / ${activeMatch.overs} Ov)</span>
            </div>
            ${targetBanner}
            <div class="balls-strip" style="margin-top:10px;">${recentBalls}</div>
        </div>

        <div class="card">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                <div style="background:#0f172a; padding:10px; border-radius:8px; border:1px solid #38bdf8;">
                    <div class="row-between">
                        <span style="font-size:0.8rem; color:#38bdf8;">STRIKER *</span>
                        <button class="btn-secondary btn-sm" onclick="openSelectPlayerModal('striker')">Change</button>
                    </div>
                    <div style="font-weight:700; margin-top:4px;">${striker ? `${striker.name} (${striker.runs} off ${striker.balls})` : '⚠️ Select Striker'}</div>
                </div>
                <div style="background:#0f172a; padding:10px; border-radius:8px; border:1px solid #334155;">
                    <div class="row-between">
                        <span style="font-size:0.8rem; color:#94a3b8;">NON-STRIKER</span>
                        <button class="btn-secondary btn-sm" onclick="openSelectPlayerModal('non_striker')">Change</button>
                    </div>
                    <div style="font-weight:700; margin-top:4px;">${nonStriker ? `${nonStriker.name} (${nonStriker.runs} off ${nonStriker.balls})` : '⚠️ Select Non-Striker'}</div>
                </div>
            </div>

            <div style="background:#0f172a; padding:10px; border-radius:8px; border:1px solid #facc15; margin-top:10px;">
                <div class="row-between">
                    <span style="font-size:0.8rem; color:#facc15;">CURRENT BOWLER</span>
                    <div style="display:flex; gap:6px;">
                        <button class="btn-secondary btn-sm" onclick="swapStrike()">⇄ Swap Strike</button>
                        <button class="btn-secondary btn-sm" onclick="openSelectPlayerModal('bowler')">Change Bowler</button>
                    </div>
                </div>
                <div style="font-weight:700; margin-top:4px;">
                    ${bowler ? `${bowler.name} — ${Math.floor(bowler.balls / 6)}.${bowler.balls % 6} Ov, ${bowler.runs} R, ${bowler.wickets} W` : '⚠️ Select Bowler'}
                </div>
            </div>

            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:8px; margin-top:16px;">
                <button class="btn-secondary" style="padding:14px; font-size:1.1rem; font-weight:700;" onclick="recordLegalBall(0)">0</button>
                <button class="btn-secondary" style="padding:14px; font-size:1.1rem; font-weight:700;" onclick="recordLegalBall(1)">1</button>
                <button class="btn-secondary" style="padding:14px; font-size:1.1rem; font-weight:700;" onclick="recordLegalBall(2)">2</button>
                <button class="btn-secondary" style="padding:14px; font-size:1.1rem; font-weight:700;" onclick="recordLegalBall(3)">3</button>
                <button class="btn-primary" style="padding:14px; font-size:1.1rem; font-weight:700;" onclick="recordLegalBall(4)">4</button>
                <button class="btn-primary" style="padding:14px; font-size:1.1rem; font-weight:700;" onclick="recordLegalBall(6)">6</button>
                <button class="btn-warning" style="padding:14px; font-weight:700; color:#000;" onclick="openExtraModal('WD')">WD (Re-ball)</button>
                <button class="btn-warning" style="padding:14px; font-weight:700; color:#000;" onclick="openExtraModal('NB')">NB (Re-ball)</button>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:10px;">
                <button class="btn-danger" style="padding:14px; font-size:1.05rem; font-weight:800;" onclick="openWicketModal()">⚡ WICKET</button>
                <button class="btn-secondary" style="padding:14px; font-weight:700;" onclick="undoLastBall()">↩ Undo Last Ball</button>
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
            <h3>${type === 'WD' ? 'Wide Ball (No Extra 1 Run)' : 'No Ball (No Extra 1 Run)'}</h3>
            <button class="btn-secondary btn-sm" onclick="closeModal('popupModal')">✕</button>
        </div>
        <p style="color:#94a3b8; font-size:0.9rem; margin:8px 0;">Gully Rule: Only runs scored off this delivery will be added, and the ball will be re-bowled.</p>
        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-top:12px;">
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
// 7B. WICKET MODAL (BOWLED, CAUGHT, STUMPING, RUN OUT + STRIKER/NON-STRIKER + 0/1/2 RUNS)
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
                <label style="background:#0f172a; padding:10px; border-radius:6px; border:1px solid #334155; cursor:pointer; display:flex; align-items:center; gap:6px;">
                    <input type="radio" name="roVictim" value="striker" checked>
                    <span><strong>Striker:</strong> ${striker ? striker.name : 'Striker'}</span>
                </label>
                <label style="background:#0f172a; padding:10px; border-radius:6px; border:1px solid #334155; cursor:pointer; display:flex; align-items:center; gap:6px;">
                    <input type="radio" name="roVictim" value="non_striker">
                    <span><strong>Non-Striker:</strong> ${nonStriker ? nonStriker.name : 'Non-Striker'}</span>
                </label>
            </div>
        </div>

        <div style="margin-bottom: 16px;">
            <label style="display:block; margin-bottom:6px; font-weight:600; color:#facc15;">2. कितने रन पूरे हुए? (Completed Runs)</label>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
                <label style="background:#0f172a; padding:10px; border-radius:6px; border:1px solid #334155; cursor:pointer; text-align:center;">
                    <input type="radio" name="roRuns" value="0" checked> <strong>0 Run</strong>
                </label>
                <label style="background:#0f172a; padding:10px; border-radius:6px; border:1px solid #334155; cursor:pointer; text-align:center;">
                    <input type="radio" name="roRuns" value="1"> <strong>1 Run</strong>
                </label>
                <label style="background:#0f172a; padding:10px; border-radius:6px; border:1px solid #334155; cursor:pointer; text-align:center;">
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
// 8. OVER COMPLETION, INNINGS SWITCH & MATCH RESULT
// ==========================================
function checkOverAndInningsState() {
    const sc = activeMatch.scorecard;
    const inn = getCurrentInnings();
    const maxBalls = activeMatch.overs * 6;

    if (inn.legalBalls > 0 && inn.legalBalls % 6 === 0) {
        const bowler = inn.bowlers.find(b => b.id === inn.currentBowlerId);
        if (bowler && (inn.overRunsTracker || 0) === 0) bowler.maidens += 1;
        inn.overRunsTracker = 0;

        const temp = inn.strikerId;
        inn.strikerId = inn.nonStrikerId;
        inn.nonStrikerId = temp;
        inn.currentBowlerId = null;
    }

    if (sc.currentInnings === 2) {
        const target = sc.innings1.runs + 1;
        if (inn.runs >= target) {
            const wicketsLeft = Math.max(1, (sc.team2Squad.length || 11) - 1 - inn.wickets);
            finishMatch(`${inn.battingTeam} won by ${wicketsLeft} wickets!`);
            return;
        }
    }

    if (inn.legalBalls >= maxBalls) {
        if (sc.currentInnings === 1) {
            alert(`1st Innings Complete! ${inn.battingTeam} scored ${inn.runs}/${inn.wickets}. Starting 2nd Innings.`);
            sc.currentInnings = 2;
        } else {
            if (inn.runs > sc.innings1.runs) finishMatch(`${inn.battingTeam} won!`);
            else if (inn.runs < sc.innings1.runs) finishMatch(`${sc.innings1.battingTeam} won by ${sc.innings1.runs - inn.runs} runs!`);
            else finishMatch('Match Tied!');
        }
    }
}

async function finishMatch(resultText) {
    activeMatch.status = 'completed';
    activeMatch.result_text = resultText;
    await sb.from('matches').update({
        status: 'completed',
        result_text: resultText,
        scorecard: activeMatch.scorecard
    }).eq('id', activeMatch.id);

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
    document.getElementById('popupContent').innerHTML = `
        <div class="row-between">
            <h3>🍼 Adjust Overs (Baby Over)</h3>
            <button class="btn-secondary btn-sm" onclick="closeModal('popupModal')">✕</button>
        </div>
        <p style="color:#94a3b8; font-size:0.9rem; margin:8px 0;">Current Match Overs: <strong>${activeMatch.overs}</strong></p>
        <input type="number" id="newOversInput" class="input-field" value="${activeMatch.overs}" min="1" max="50">
        <button class="btn-primary" style="width:100%; margin-top:12px;" onclick="updateMatchOvers()">Update Overs</button>
    `;
    openModal('popupModal');
}

async function updateMatchOvers() {
    const val = parseInt(document.getElementById('newOversInput').value, 10);
    if (!val || val < 1) return;
    activeMatch.overs = val;
    await sb.from('matches').update({ overs: val }).eq('id', activeMatch.id);
    closeModal('popupModal');
    renderLiveScoringScreen();
}

// ==========================================
// 9. PLAYER SELECTION & LIVE TEAM EDITING (WITH GUEST PLAYER OPTION)
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

    const listHtml = squad.map(p => {
        const alreadyOut = isBatting && inn.batters.some(b => b.id === p.id && b.isOut);
        if (alreadyOut) return '';
        return `
            <button class="btn-secondary" style="text-align:left; padding:10px; width:100%;" onclick="assignPlayerRole('${role}', '${p.id}', '${p.name.replace(/'/g, "\\'")}')">
                ${p.name}
            </button>
        `;
    }).join('');

    document.getElementById('popupContent').innerHTML = `
        <div class="row-between">
            <h3>Select ${role === 'striker' ? 'Striker' : (role === 'non_striker' ? 'Non-Striker' : 'Bowler')}</h3>
            <button class="btn-secondary btn-sm" onclick="closeModal('popupModal')">✕</button>
        </div>
        <div style="display:flex; flex-direction:column; gap:6px; max-height:260px; overflow-y:auto; margin-top:12px;">
            ${listHtml || '<p style="color:#94a3b8;">No available players in squad.</p>'}
        </div>
        <div style="margin-top:12px; border-top:1px solid #334155; padding-top:10px;">
            <label style="font-size:0.8rem; color:#94a3b8;">Quick Add Guest Player:</label>
            <div style="display:flex; gap:6px; margin-top:4px;">
                <input type="text" id="quickGuestName" class="input-field" placeholder="Guest player name...">
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
        if (!inn.batters.some(b => b.id === playerId)) {
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
        if (!inn.bowlers.some(b => b.id === playerId)) {
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
            <label>Add Registered Player to Squad:</label>
            <select id="addSquadPlayerSelect" class="input-field" style="margin-top:4px;">
                ${allPlayers.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
                <button class="btn-secondary btn-sm" onclick="addPlayerToLiveSquad(1)">+ Add to ${activeMatch.team1_name}</button>
                <button class="btn-secondary btn-sm" onclick="addPlayerToLiveSquad(2)">+ Add to ${activeMatch.team2_name}</button>
            </div>
        </div>
        <div style="margin-top:12px; border-top:1px solid #334155; padding-top:10px;">
            <label>Add Guest Player to Live Squad:</label>
            <input type="text" id="liveGuestNameInput" class="input-field" placeholder="Guest player name" style="margin-top:4px;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
                <button class="btn-secondary btn-sm" onclick="addGuestToLiveSquad(1)">+ Guest to ${activeMatch.team1_name}</button>
                <button class="btn-secondary btn-sm" onclick="addGuestToLiveSquad(2)">+ Guest to ${activeMatch.team2_name}</button>
            </div>
        </div>
        <button class="btn-primary" style="width:100%; margin-top:14px;" onclick="saveLiveTeamNames()">Save Team Names</button>
    `;
    openModal('popupModal');
}

function addPlayerToLiveSquad(teamNum) {
    const sel = document.getElementById('addSquadPlayerSelect');
    const pId = sel.value;
    const pName = sel.options[sel.selectedIndex].text;
    const sc = activeMatch.scorecard;
    const targetSquad = teamNum === 1 ? sc.team1Squad : sc.team2Squad;
    if (!targetSquad.some(p => p.id === pId)) {
        targetSquad.push({ id: pId, name: pName });
        syncMatchToSupabase();
        alert(`${pName} added!`);
    }
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
        scorecard: activeMatch.scorecard
    }).eq('id', activeMatch.id);

    closeModal('popupModal');
    renderLiveScoringScreen();
}

async function syncMatchToSupabase() {
    if (!activeMatch) return;
    if (currentUser) activeMatch.scorecard.activeScorerId = currentUser.id;
    await sb.from('matches').update({ scorecard: activeMatch.scorecard }).eq('id', activeMatch.id);
}

// ==========================================
// 10. PUBLIC VIEWS: RECENT (TOP 5), HISTORY & PLAYERS STATS
// ==========================================
function renderRecentMatchesView() {
    const container = document.getElementById('appContainer');
    const recent = allMatches.filter(m => m.status === 'completed').slice(0, 5);
    container.innerHTML = `
        <div class="card">
            <h2>🕒 Recent Matches (Top 5)</h2>
            <div style="display:flex; flex-direction:column; gap:10px; margin-top:14px;">
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
            <div class="row-between" style="flex-wrap:wrap; gap:10px;">
                <h2>📜 All Match History (${completed.length})</h2>
                <div style="display:flex; gap:8px; align-items:center;">
                    <input type="date" id="historyDateFilter" class="input-field" onchange="filterMatchesByDate()">
                    <button class="btn-secondary btn-sm" onclick="resetHistoryDateFilter()">All</button>
                </div>
            </div>
            <div id="historyMatchesList" style="display:flex; flex-direction:column; gap:10px; margin-top:14px;">
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
    const dateStr = new Date(m.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const isSuperAdmin = currentAdminProfile && currentAdminProfile.role === 'super_admin';
    const deleteBtn = isSuperAdmin ? `<button class="btn-danger btn-sm" onclick="deleteMatchById('${m.id}')">🗑️ Delete</button>` : '';

    return `
        <div style="background:#0f172a; padding:14px; border-radius:8px; border:1px solid #334155;">
            <div class="row-between">
                <span style="font-size:0.8rem; color:#94a3b8;">📅 ${dateStr}</span>
                <div style="display:flex; gap:6px;">
                    <button class="btn-secondary btn-sm" onclick="openMatchScorecardModal('${m.id}')">Scorecard</button>
                    ${deleteBtn}
                </div>
            </div>
            <div style="font-weight:700; font-size:1.05rem; margin-top:6px;">
                ${m.team1_name} (${inn1.runs}/${inn1.wickets}) vs ${m.team2_name} (${inn2.runs}/${inn2.wickets})
            </div>
            <div style="color:#4ade80; font-weight:600; font-size:0.9rem; margin-top:4px;">🏆 ${m.result_text || 'Completed'}</div>
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

    const renderInningsBlock = (inn, title) => {
        if (!inn) return '';
        const overs = `${Math.floor(inn.legalBalls / 6)}.${inn.legalBalls % 6}`;
        return `
            <div style="margin-top:16px; background:#0f172a; padding:12px; border-radius:8px; border:1px solid #334155;">
                <div class="row-between">
                    <h4>${title}: ${inn.battingTeam}</h4>
                    <strong>${inn.runs}/${inn.wickets} (${overs} Ov)</strong>
                </div>
                <div class="stats-table-wrap" style="margin-top:8px;">
                    <table class="stats-table">
                        <thead><tr><th>Batter</th><th>Status</th><th>R</th><th>B</th><th>4s</th><th>6s</th></tr></thead>
                        <tbody>
                            ${(inn.batters || []).map(b => `
                                <tr>
                                    <td><strong>${b.name}</strong></td>
                                    <td style="font-size:0.8rem; color:#94a3b8;">${b.isOut ? b.dismissal : 'not out'}</td>
                                    <td><strong>${b.runs}</strong></td>
                                    <td>${b.balls}</td>
                                    <td>${b.fours}</td>
                                    <td>${b.sixes}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="stats-table-wrap" style="margin-top:12px;">
                    <table class="stats-table">
                        <thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr></thead>
                        <tbody>
                            ${(inn.bowlers || []).map(bw => `
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

    const liveBadge = match.status === 'live' ? `<span class="badge badge-live" style="margin-right:8px;">● LIVE</span>` : '';
    document.getElementById('popupContent').innerHTML = `
        <div class="row-between">
            <h3>${liveBadge}${match.team1_name} vs ${match.team2_name}</h3>
            <button class="btn-secondary btn-sm" onclick="closeModal('popupModal')">✕ Close</button>
        </div>
        <span style="color:#94a3b8; font-size:0.8rem;">📅 Played on: ${new Date(match.created_at).toLocaleDateString()}</span>
        ${match.result_text ? `<p style="color:#4ade80; font-weight:700; margin-top:4px;">🏆 ${match.result_text}</p>` : ''}
        ${renderInningsBlock(match.scorecard.innings1, '1st Innings')}
        ${renderInningsBlock(match.scorecard.innings2, '2nd Innings')}
    `;
    openModal('popupModal');
}

// ==========================================
// 11. CAREER PLAYER STATS (PUBLIC TAB: 'players')
// ==========================================
function renderPlayerStatsView() {
    const container = document.getElementById('appContainer');
    const statsMap = {};
    const nameToId = {};

    allPlayers.forEach(p => {
        const key = String(p.id);
        statsMap[key] = {
            id: key, name: p.name, nickname: p.nickname || '', role: p.role || 'All-Rounder', photo_url: p.photo_url || '',
            matches: new Set(), runs: 0, ballsFaced: 0, fours: 0, sixes: 0, wickets: 0, ballsBowled: 0, runsConceded: 0
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
                    entry.runs += Number(b.runs || 0);
                    entry.ballsFaced += Number(b.balls || 0);
                    entry.fours += Number(b.fours || 0);
                    entry.sixes += Number(b.sixes || 0);
                }
            });
            (inn.bowlers || []).forEach(bw => {
                const entry = resolvePlayerStat(bw.id, bw.name);
                if (entry) {
                    entry.matches.add(m.id);
                    entry.wickets += Number(bw.wickets || 0);
                    entry.ballsBowled += Number(bw.balls || 0);
                    entry.runsConceded += Number(bw.runs || 0);
                }
            });
        });
    });

    const sortedStats = Object.values(statsMap).sort((a, b) => b.runs - a.runs || b.wickets - a.wickets);
    const rows = sortedStats.map(s => {
        const sr = s.ballsFaced > 0 ? ((s.runs / s.ballsFaced) * 100).toFixed(1) : '0.0';
        const econ = s.ballsBowled > 0 ? (s.runsConceded / (s.ballsBowled / 6)).toFixed(2) : '0.00';
        const avatar = s.photo_url
            ? `<img src="${s.photo_url}" style="width:34px; height:34px; border-radius:50%; object-fit:cover;">`
            : `<span style="display:inline-flex; width:34px; height:34px; border-radius:50%; background:#334155; align-items:center; justify-content:center; font-weight:700;">${s.name.charAt(0).toUpperCase()}</span>`;
        const editCol = currentUser ? `<td><button class="btn-secondary btn-sm" onclick="openEditPlayerModal('${s.id}')">✏️ Edit</button></td>` : '';

        return `
            <tr>
                <td style="display:flex; align-items:center; gap:8px;">
                    ${avatar}
                    <div>
                        <strong>${s.name}</strong> ${s.nickname ? `<span style="color:#94a3b8; font-size:0.8rem;">(${s.nickname})</span>` : ''}
                        <div style="font-size:0.75rem; color:#38bdf8;">${s.role}</div>
                    </div>
                </td>
                <td>${s.matches.size}</td>
                <td><strong>${s.runs}</strong></td>
                <td>${s.ballsFaced}</td>
                <td>${s.fours}/${s.sixes}</td>
                <td>${sr}</td>
                <td><strong>${s.wickets}</strong></td>
                <td>${econ}</td>
                ${editCol}
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="card">
            <h2>📊 Career Players Stats (Verified Scorecards)</h2>
            <div class="stats-table-wrap" style="margin-top:14px;">
                <table class="stats-table">
                    <thead>
                        <tr><th>Player</th><th>Mat</th><th>Runs</th><th>BF</th><th>4s/6s</th><th>SR</th><th>Wkts</th><th>Econ</th>${currentUser ? '<th>Action</th>' : ''}</tr>
                    </thead>
                    <tbody>${rows || '<tr><td colspan="9">No players registered yet.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;
}

// ==========================================
// 12. ADMIN DRAWER SECTIONS (PLAYERS, MATCHES, ADMINS, PASSWORD)
// ==========================================
function renderManagePlayersView() {
    if (!currentUser) return goHome();
    const container = document.getElementById('appContainer');
    const isSuperAdmin = currentAdminProfile && currentAdminProfile.role === 'super_admin';

    const playerCards = allPlayers.map(p => `
        <div class="row-between" style="background:#0f172a; padding:10px; border-radius:8px; border:1px solid #334155;">
            <div style="display:flex; align-items:center; gap:10px;">
                ${p.photo_url ? `<img src="${p.photo_url}" style="width:40px; height:40px; border-radius:50%; object-fit:cover;">` : ''}
                <div>
                    <strong>${p.name}</strong> ${p.nickname ? `(${p.nickname})` : ''}
                    <div style="font-size:0.8rem; color:#94a3b8;">${p.role || 'All-Rounder'}</div>
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
            <h2>👤 Add & Manage Players</h2>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px;">
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
            <div style="display:flex; flex-direction:column; gap:8px; margin-top:16px;">${playerCards}</div>
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
               <img src="${p.photo_url}" style="width:48px; height:48px; border-radius:50%; object-fit:cover;">
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
            <h2>🛡️ Manage Admins (Super Admin Only)</h2>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:12px;">
                <input type="text" id="newAdminName" class="input-field" placeholder="Admin Name">
                <input type="email" id="newAdminEmail" class="input-field" placeholder="Email">
                <input type="password" id="newAdminPass" class="input-field" placeholder="Password (min 6 chars)">
                <select id="newAdminRole" class="input-field">
                    <option value="admin">Admin</option>
                    <option value="super_admin">Super Admin</option>
                </select>
            </div>
            <button class="btn-primary" style="margin-top:10px; width:100%;" onclick="createNewAdmin()">+ Create Admin</button>
            <div style="display:flex; flex-direction:column; gap:8px; margin-top:16px;">
                ${(admins || []).map(a => `
                    <div class="row-between" style="background:#0f172a; padding:10px; border-radius:8px; border:1px solid #334155;">
                        <div>
                            <strong>${a.name}</strong> (${a.email})
                            <span class="badge" style="margin-left:6px;">${a.role}</span>
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
            <h2>🔑 Change Password</h2>
            <p style="color:#94a3b8; font-size:0.9rem; margin:8px 0;">Enter a new password (minimum 6 characters).</p>
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
