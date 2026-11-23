// ==========================================
// 1. SUPABASE CONFIGURATION & GLOBAL STATE
// ==========================================
const SUPABASE_URL = 'https://wwwrkbwycthgboqvljfy.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3d3JrYnd5Y3RoZ2JvcXZsamZ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwMTk1NDAsImV4cCI6MjA5MDU5NTU0MH0.2nN0679F4zA2eG54K6f9A9h8U_R2T4K1o8iX2H6qL4s';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;
let currentAdminRole = null;
let allPlayers = [];
let allMatches = [];
let activeMatch = null;
let undoStack = [];
let liveSyncInterval = null;
let currentPublicTab = 'live';

// ==========================================
// 2. INITIALIZATION, MODALS & AUTHENTICATION
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    await checkAuthSession();
    await loadAllInitialData();
    startAutoSync();
});

function openModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'flex';
}

function closeModal(modalId) {
    const el = document.getElementById(modalId);
    if (el) el.style.display = 'none';
}

function openLoginModal() {
    openModal('loginModal');
}

async function checkAuthSession() {
    const { data: { session } } = await sb.auth.getSession();
    if (session && session.user) {
        currentUser = session.user;
        const { data: adminData } = await sb
            .from('admins')
            .select('*')
            .eq('id', currentUser.id)
            .single();
        currentAdminRole = adminData ? adminData.role : 'admin';
    } else {
        currentUser = null;
        currentAdminRole = null;
    }
    updateHeaderUI();
}

function updateHeaderUI() {
    const adminControls = document.getElementById('adminControls');
    const loginBtn = document.getElementById('headerLoginBtn');
    const logoutBtn = document.getElementById('headerLogoutBtn');
    const manageAdminsBtn = document.getElementById('manageAdminsNavBtn');

    if (currentUser) {
        if (adminControls) adminControls.style.display = 'flex';
        if (loginBtn) loginBtn.style.display = 'none';
        if (logoutBtn) logoutBtn.style.display = 'inline-block';
        if (manageAdminsBtn) {
            manageAdminsBtn.style.display = currentAdminRole === 'super_admin' ? 'inline-block' : 'none';
        }
    } else {
        if (adminControls) adminControls.style.display = 'none';
        if (loginBtn) loginBtn.style.display = 'inline-block';
        if (logoutBtn) logoutBtn.style.display = 'none';
    }
}

async function handleAdminLogin(e) {
    if (e) e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
        alert('Login Failed: ' + error.message);
        return;
    }
    await checkAuthSession();
    closeModal('loginModal');
    showPublicTab(currentPublicTab);
}

async function handleAdminLogout() {
    await sb.auth.signOut();
    currentUser = null;
    currentAdminRole = null;
    updateHeaderUI();
    showPublicTab('live');
}

// ==========================================
// 3. DATA LOADING & 1-SECOND AUTO-SYNC
// ==========================================
async function loadAllInitialData() {
    await Promise.all([fetchPlayers(), fetchMatches()]);
    renderCurrentView();
}

async function fetchPlayers() {
    const { data, error } = await sb.from('players').select('*').order('name', { ascending: true });
    if (!error && data) {
        allPlayers = data;
    }
}

async function fetchMatches() {
    const { data, error } = await sb.from('matches').select('*').order('created_at', { ascending: false });
    if (!error && data) {
        allMatches = data;
        const live = allMatches.find(m => m.status === 'live');
        if (live) {
            if (!activeMatch || activeMatch.id !== live.id || !currentUser) {
                activeMatch = live;
            } else if (currentUser && activeMatch && activeMatch.id === live.id) {
                if (live.active_scorer_id && live.active_scorer_id !== currentUser.id) {
                    activeMatch = live;
                }
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
        const prevUpdated = activeMatch ? JSON.stringify(activeMatch.scorecard) : '';

        await fetchMatches();

        const newLiveId = activeMatch ? activeMatch.id : null;
        const newUpdated = activeMatch ? JSON.stringify(activeMatch.scorecard) : '';

        if (currentPublicTab === 'live' && (prevLiveId !== newLiveId || prevUpdated !== newUpdated)) {
            renderLiveView();
        }
    }, 1000);
}

// ==========================================
// 4. NAVIGATION & PUBLIC TABS
// ==========================================
function showPublicTab(tabName) {
    currentPublicTab = tabName;
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`tab-${tabName}`);
    if (activeBtn) activeBtn.classList.add('active');

    renderCurrentView();
}

function renderCurrentView() {
    if (currentPublicTab === 'live') renderLiveView();
    else if (currentPublicTab === 'recent') renderRecentMatchesView();
    else if (currentPublicTab === 'history') renderMatchHistoryView();
    else if (currentPublicTab === 'stats') renderPlayerStatsView();
    else if (currentPublicTab === 'players') renderManagePlayersView();
    else if (currentPublicTab === 'admins') renderManageAdminsView();
    else if (currentPublicTab === 'new_match') renderNewMatchSetupView();
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
                <p style="color:#94a3b8; margin-top:8px;">Check Recent Matches or Match History for past scorecards.</p>
                ${currentUser ? `<button class="btn-primary" style="margin-top:16px;" onclick="showPublicTab('new_match')">+ Start New Match</button>` : ''}
            </div>
        `;
        return;
    }

    const isScorer = currentUser && (!activeMatch.active_scorer_id || activeMatch.active_scorer_id === currentUser.id);
    if (currentUser && isScorer) {
        renderLiveScoringScreen();
    } else {
        renderPublicLiveScoreboard();
    }
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

    const recentBalls = inn.ballsHistory.slice(-12).map(b => {
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
    activeMatch.active_scorer_id = currentUser.id;
    await sb.from('matches').update({ active_scorer_id: currentUser.id }).eq('id', activeMatch.id);
    renderLiveScoringScreen();
}

// ==========================================
// 6. NEW MATCH SETUP & TEAM MANAGEMENT
// ==========================================
function renderNewMatchSetupView() {
    if (!currentUser) return showPublicTab('live');
    const container = document.getElementById('appContainer');

    container.innerHTML = `
        <div class="card">
            <h2>🏏 Start New Gully Cricket Match</h2>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:14px;">
                <div>
                    <label>Team 1 Name (Batting First)</label>
                    <input type="text" id="t1Name" class="input-field" value="Team A">
                </div>
                <div>
                    <label>Team 2 Name (Bowling First)</label>
                    <input type="text" id="t2Name" class="input-field" value="Team B">
                </div>
            </div>
            <div style="margin-top:12px;">
                <label>Total Overs</label>
                <input type="number" id="matchOvers" class="input-field" value="6" min="1" max="50">
            </div>

            <div style="margin-top:16px;">
                <h4>Select Playing Squads (Optional - You can also add players live)</h4>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:8px;">
                    <div>
                        <strong style="color:#38bdf8;">Team 1 Players</strong>
                        <div id="t1PlayersBox" style="max-height:200px; overflow-y:auto; display:flex; flex-direction:column; gap:6px; margin-top:6px;">
                            ${allPlayers.map(p => `<label style="display:flex; gap:6px;"><input type="checkbox" name="t1p" value="${p.id}"> ${p.name}</label>`).join('')}
                        </div>
                    </div>
                    <div>
                        <strong style="color:#facc15;">Team 2 Players</strong>
                        <div id="t2PlayersBox" style="max-height:200px; overflow-y:auto; display:flex; flex-direction:column; gap:6px; margin-top:6px;">
                            ${allPlayers.map(p => `<label style="display:flex; gap:6px;"><input type="checkbox" name="t2p" value="${p.id}"> ${p.name}</label>`).join('')}
                        </div>
                    </div>
                </div>
            </div>

            <button class="btn-primary" style="width:100%; margin-top:18px; padding:12px;" onclick="createNewMatch()">🚀 Create & Start Live Match</button>
        </div>
    `;
}

async function createNewMatch() {
    const t1Name = document.getElementById('t1Name').value.trim() || 'Team A';
    const t2Name = document.getElementById('t2Name').value.trim() || 'Team B';
    const overs = parseInt(document.getElementById('matchOvers').value, 10) || 6;

    const t1Ids = Array.from(document.querySelectorAll('input[name="t1p"]:checked')).map(cb => cb.value);
    const t2Ids = Array.from(document.querySelectorAll('input[name="t2p"]:checked')).map(cb => cb.value);

    const makeSquad = (ids) => ids.map(id => {
        const p = allPlayers.find(x => x.id === id);
        return { id, name: p ? p.name : 'Player' };
    });

    const scorecard = {
        currentInnings: 1,
        team1Squad: makeSquad(t1Ids),
        team2Squad: makeSquad(t2Ids),
        innings1: {
            battingTeam: t1Name,
            bowlingTeam: t2Name,
            runs: 0,
            wickets: 0,
            legalBalls: 0,
            extras: { wd: 0, nb: 0 },
            strikerId: null,
            nonStrikerId: null,
            currentBowlerId: null,
            batters: [],
            bowlers: [],
            ballsHistory: [],
            overRunsTracker: 0
        },
        innings2: {
            battingTeam: t2Name,
            bowlingTeam: t1Name,
            runs: 0,
            wickets: 0,
            legalBalls: 0,
            extras: { wd: 0, nb: 0 },
            strikerId: null,
            nonStrikerId: null,
            currentBowlerId: null,
            batters: [],
            bowlers: [],
            ballsHistory: [],
            overRunsTracker: 0
        }
    };

    const { data, error } = await sb.from('matches').insert([{
        team1_name: t1Name,
        team2_name: t2Name,
        overs: overs,
        status: 'live',
        active_scorer_id: currentUser.id,
        scorecard: scorecard
    }]).select().single();

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
    if (undoStack.length === 0) {
        alert('Nothing to undo!');
        return;
    }
    const prev = undoStack.pop();
    activeMatch.scorecard = JSON.parse(prev);
    syncMatchToSupabase();
    renderLiveScoringScreen();
}

// ==========================================
// 7. BALL-BY-BALL LIVE SCORING ENGINE (NO EXTRA 1 RUN ON WD/NB + FULL RUN-OUT)
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

    const recentBalls = inn.ballsHistory.slice(-12).map(b => {
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

    // Gully rule: NO automatic +1 run on WD/NB; only runs scored are added, legalBalls does NOT increase
    inn.runs += runsScored;
    inn.overRunsTracker = (inn.overRunsTracker || 0) + runsScored;
    if (type === 'WD') inn.extras.wd += 1;
    else inn.extras.nb += 1;

    if (type === 'NB' && striker && runsScored > 0) {
        striker.runs += runsScored;
        if (runsScored === 4) striker.fours += 1;
        if (runsScored === 6) striker.sixes += 1;
    }
    if (bowler) {
        bowler.runs += runsScored;
    }

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
// 7B. WICKET & COMPLETE RUN-OUT MODAL (STRIKER / NON-STRIKER + 0/1/2 RUNS)
// ==========================================
function openWicketModal() {
    if (!validateCreaseReady()) return;

    document.getElementById('popupContent').innerHTML = `
        <div class="row-between" style="margin-bottom: 12px;">
            <h3>⚡ Select Wicket Type</h3>
            <button class="btn-secondary btn-sm" onclick="closeModal('popupModal')">✕</button>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 10px;">
            <button class="btn-danger" style="padding: 14px; font-weight: bold;" onclick="processStandardWicket('Bowled')">
                🎯 Bowled
            </button>
            <button class="btn-danger" style="padding: 14px; font-weight: bold;" onclick="processStandardWicket('Caught')">
                🙌 Caught
            </button>
            <button class="btn-danger" style="padding: 14px; font-weight: bold;" onclick="processStandardWicket('Stumping')">
                🧤 Stumping
            </button>
            <button class="btn-warning" style="padding: 14px; font-weight: bold; color: #000;" onclick="openRunOutOptions()">
                🏃 Run Out
            </button>
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
                <label style="background:#1e293b; padding:10px; border-radius:6px; border:1px solid #334155; cursor:pointer; display:flex; align-items:center; gap:6px;">
                    <input type="radio" name="roVictim" value="striker" checked>
                    <span><strong>Striker:</strong> ${striker ? striker.name : 'Striker'}</span>
                </label>
                <label style="background:#1e293b; padding:10px; border-radius:6px; border:1px solid #334155; cursor:pointer; display:flex; align-items:center; gap:6px;">
                    <input type="radio" name="roVictim" value="non_striker">
                    <span><strong>Non-Striker:</strong> ${nonStriker ? nonStriker.name : 'Non-Striker'}</span>
                </label>
            </div>
        </div>

        <div style="margin-bottom: 16px;">
            <label style="display:block; margin-bottom:6px; font-weight:600; color:#facc15;">2. कितने रन पूरे हुए? (Completed Runs)</label>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px;">
                <label style="background:#1e293b; padding:10px; border-radius:6px; border:1px solid #334155; cursor:pointer; text-align:center;">
                    <input type="radio" name="roRuns" value="0" checked> <strong>0 Run</strong>
                </label>
                <label style="background:#1e293b; padding:10px; border-radius:6px; border:1px solid #334155; cursor:pointer; text-align:center;">
                    <input type="radio" name="roRuns" value="1"> <strong>1 Run</strong>
                </label>
                <label style="background:#1e293b; padding:10px; border-radius:6px; border:1px solid #334155; cursor:pointer; text-align:center;">
                    <input type="radio" name="roRuns" value="2"> <strong>2 Runs</strong>
                </label>
            </div>
        </div>

        <button class="btn-danger" style="width:100%; padding:12px; font-weight:bold;" onclick="confirmRunOut()">
            Confirm Run Out
        </button>
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

    // Rotate strike if 1 run completed before run out
    if (completedRuns % 2 === 1) {
        const tempId = inn.strikerId;
        inn.strikerId = inn.nonStrikerId;
        inn.nonStrikerId = tempId;
    }

    // Mark chosen victim as out and clear their crease slot
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

    // Check over completion
    if (inn.legalBalls > 0 && inn.legalBalls % 6 === 0) {
        const bowler = inn.bowlers.find(b => b.id === inn.currentBowlerId);
        if (bowler && (inn.overRunsTracker || 0) === 0) {
            bowler.maidens += 1;
        }
        inn.overRunsTracker = 0;

        // Swap strike at end of over
        const temp = inn.strikerId;
        inn.strikerId = inn.nonStrikerId;
        inn.nonStrikerId = temp;
        inn.currentBowlerId = null;
    }

    // Check 2nd innings target chased
    if (sc.currentInnings === 2) {
        const target = sc.innings1.runs + 1;
        if (inn.runs >= target) {
            const wicketsLeft = Math.max(1, (sc.team2Squad.length || 11) - 1 - inn.wickets);
            finishMatch(`${inn.battingTeam} won by ${wicketsLeft} wickets!`);
            return;
        }
    }

    // Check overs finished
    if (inn.legalBalls >= maxBalls) {
        if (sc.currentInnings === 1) {
            alert(`1st Innings Complete! ${inn.battingTeam} scored ${inn.runs}/${inn.wickets}. Starting 2nd Innings.`);
            sc.currentInnings = 2;
        } else {
            if (inn.runs > sc.innings1.runs) {
                finishMatch(`${inn.battingTeam} won!`);
            } else if (inn.runs < sc.innings1.runs) {
                finishMatch(`${sc.innings1.battingTeam} won by ${sc.innings1.runs - inn.runs} runs!`);
            } else {
                finishMatch('Match Tied!');
            }
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
// 9. PLAYER SELECTION & LIVE TEAM EDITING
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
        <div style="display:flex; flex-direction:column; gap:6px; max-height:280px; overflow-y:auto; margin-top:12px;">
            ${listHtml || '<p style="color:#94a3b8;">No available players. Add players via Edit Teams.</p>'}
        </div>
        <div style="margin-top:12px; border-top:1px solid #334155; padding-top:10px;">
            <input type="text" id="quickGuestName" class="input-field" placeholder="Or type quick player name...">
            <button class="btn-primary btn-sm" style="margin-top:6px; width:100%;" onclick="addQuickGuestAndAssign('${role}')">+ Add & Select</button>
        </div>
    `;
    openModal('popupModal');
}

function addQuickGuestAndAssign(role) {
    const name = document.getElementById('quickGuestName').value.trim();
    if (!name) return;
    const guestId = 'guest_' + Date.now();
    assignPlayerRole(role, guestId, name);
}

function assignPlayerRole(role, playerId, playerName) {
    const inn = getCurrentInnings();

    if (role === 'striker' || role === 'non_striker') {
        if (!inn.batters.some(b => b.id === playerId)) {
            inn.batters.push({
                id: playerId,
                name: playerName,
                runs: 0,
                balls: 0,
                fours: 0,
                sixes: 0,
                isOut: false,
                dismissal: 'not out'
            });
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
            inn.bowlers.push({
                id: playerId,
                name: playerName,
                balls: 0,
                maidens: 0,
                runs: 0,
                wickets: 0
            });
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
            <label>Team 1 Name</label>
            <input type="text" id="editT1Name" class="input-field" value="${activeMatch.team1_name}">
            <label style="margin-top:8px; display:block;">Team 2 Name</label>
            <input type="text" id="editT2Name" class="input-field" value="${activeMatch.team2_name}">
        </div>
        <div style="margin-top:12px;">
            <label>Add Registered Player to Squad:</label>
            <select id="addSquadPlayerSelect" class="input-field" style="margin-top:4px;">
                ${allPlayers.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
            </select>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:8px;">
                <button class="btn-secondary btn-sm" onclick="addPlayerToLiveSquad(1)">+ Add to Team 1</button>
                <button class="btn-secondary btn-sm" onclick="addPlayerToLiveSquad(2)">+ Add to Team 2</button>
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
        alert(`${pName} added to Team ${teamNum}!`);
    }
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
    await sb.from('matches').update({
        scorecard: activeMatch.scorecard,
        active_scorer_id: currentUser ? currentUser.id : activeMatch.active_scorer_id
    }).eq('id', activeMatch.id);
}

// ==========================================
// 10. RECENT MATCHES (LAST 5) & MATCH HISTORY (DATE SEARCH)
// ==========================================
function renderRecentMatchesView() {
    const container = document.getElementById('appContainer');
    const recent = allMatches.filter(m => m.status === 'completed').slice(0, 5);

    container.innerHTML = `
        <div class="card">
            <h2>🕒 Recent Matches (Last 5)</h2>
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
                <h2>📚 All Match History (${completed.length})</h2>
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
    const filtered = dateVal
        ? completed.filter(m => new Date(m.created_at).toISOString().slice(0, 10) === dateVal)
        : completed;

    document.getElementById('historyMatchesList').innerHTML =
        filtered.length === 0
            ? '<p style="color:#94a3b8;">No matches played on this date.</p>'
            : filtered.map(m => renderMatchCardItem(m)).join('');
}

function resetHistoryDateFilter() {
    document.getElementById('historyDateFilter').value = '';
    filterMatchesByDate();
}

function renderMatchCardItem(m) {
    const sc = m.scorecard || {};
    const inn1 = sc.innings1 || { runs: 0, wickets: 0, legalBalls: 0 };
    const inn2 = sc.innings2 || { runs: 0, wickets: 0, legalBalls: 0 };
    const dateStr = new Date(m.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const deleteBtn = currentAdminRole === 'super_admin'
        ? `<button class="btn-danger btn-sm" onclick="deleteMatchById('${m.id}')">🗑️ Delete</button>`
        : '';

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
            <div style="color:#4ade80; font-weight:600; font-size:0.9rem; margin-top:4px;">
                🏆 ${m.result_text || 'Completed'}
            </div>
        </div>
    `;
}

async function deleteMatchById(matchId) {
    if (currentAdminRole !== 'super_admin') return alert('Only Super Admin can delete matches!');
    if (!confirm('Permanently delete this match from database?')) return;
    await sb.from('matches').delete().eq('id', matchId);
    await fetchMatches();
    renderCurrentView();
}

// ==========================================
// 11. FULL SCORECARD POPUP MODAL
// ==========================================
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
                            ${inn.batters.map(b => `
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

    const liveBadge = match.status === 'live'
        ? `<span class="badge badge-live" style="margin-right:8px;">● LIVE</span>`
        : '';

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
// 12. 100% ACCURATE CAREER PLAYER STATS FROM HISTORICAL SCORECARDS
// ==========================================
function renderPlayerStatsView() {
    const container = document.getElementById('appContainer');
    const statsMap = {};

    allPlayers.forEach(p => {
        statsMap[p.id] = {
            id: p.id,
            name: p.name,
            nickname: p.nickname || '',
            role: p.role || 'All-Rounder',
            photo_url: p.photo_url || '',
            matches: new Set(),
            runs: 0,
            ballsFaced: 0,
            fours: 0,
            sixes: 0,
            wickets: 0,
            ballsBowled: 0,
            runsConceded: 0
        };
    });

    allMatches.forEach(m => {
        if (!m.scorecard) return;
        [m.scorecard.innings1, m.scorecard.innings2].forEach(inn => {
            if (!inn) return;
            (inn.batters || []).forEach(b => {
                if (statsMap[b.id]) {
                    statsMap[b.id].matches.add(m.id);
                    statsMap[b.id].runs += (b.runs || 0);
                    statsMap[b.id].ballsFaced += (b.balls || 0);
                    statsMap[b.id].fours += (b.fours || 0);
                    statsMap[b.id].sixes += (b.sixes || 0);
                }
            });
            (inn.bowlers || []).forEach(bw => {
                if (statsMap[bw.id]) {
                    statsMap[bw.id].matches.add(m.id);
                    statsMap[bw.id].wickets += (bw.wickets || 0);
                    statsMap[bw.id].ballsBowled += (bw.balls || 0);
                    statsMap[bw.id].runsConceded += (bw.runs || 0);
                }
            });
        });
    });

    const rows = Object.values(statsMap).map(s => {
        const sr = s.ballsFaced > 0 ? ((s.runs / s.ballsFaced) * 100).toFixed(1) : '0.0';
        const econ = s.ballsBowled > 0 ? (s.runsConceded / (s.ballsBowled / 6)).toFixed(2) : '0.00';
        const avatar = s.photo_url
            ? `<img src="${s.photo_url}" style="width:32px; height:32px; border-radius:50%; object-fit:cover;">`
            : `<span style="display:inline-flex; width:32px; height:32px; border-radius:50%; background:#334155; align-items:center; justify-content:center; font-weight:700;">${s.name.charAt(0)}</span>`;

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
            </tr>
        `;
    }).join('');

    container.innerHTML = `
        <div class="card">
            <h2>📊 Career Player Stats (Verified Scorecards)</h2>
            <div class="stats-table-wrap" style="margin-top:14px;">
                <table class="stats-table">
                    <thead>
                        <tr><th>Player</th><th>Mat</th><th>Runs</th><th>BF</th><th>4s/6s</th><th>SR</th><th>Wkts</th><th>Econ</th></tr>
                    </thead>
                    <tbody>${rows || '<tr><td colspan="8">No players registered yet.</td></tr>'}</tbody>
                </table>
            </div>
        </div>
    `;
}

// ==========================================
// 13. MANAGE PLAYERS & ADMINS (ADMIN / SUPER ADMIN)
// ==========================================
function renderManagePlayersView() {
    if (!currentUser) return showPublicTab('live');
    const container = document.getElementById('appContainer');

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
                ${currentAdminRole === 'super_admin' ? `<button class="btn-danger btn-sm" onclick="deletePlayer('${p.id}')">🗑️</button>` : ''}
            </div>
        </div>
    `).join('');

    container.innerHTML = `
        <div class="card">
            <h2>👤 Manage Players</h2>
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

            <div style="display:flex; flex-direction:column; gap:8px; margin-top:16px;">
                ${playerCards}
            </div>
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
    const p = allPlayers.find(x => x.id === playerId);
    if (!p) return;

    document.getElementById('popupContent').innerHTML = `
        <div class="row-between">
            <h3>✏️ Edit Player</h3>
            <button class="btn-secondary btn-sm" onclick="closeModal('popupModal')">✕</button>
        </div>
        <div style="display:flex; flex-direction:column; gap:8px; margin-top:12px;">
            <input type="text" id="editPName" class="input-field" value="${p.name}">
            <input type="text" id="editPNick" class="input-field" value="${p.nickname || ''}" placeholder="Nickname">
            <select id="editPRole" class="input-field">
                <option value="All-Rounder" ${p.role === 'All-Rounder' ? 'selected' : ''}>All-Rounder</option>
                <option value="Batter" ${p.role === 'Batter' ? 'selected' : ''}>Batter</option>
                <option value="Bowler" ${p.role === 'Bowler' ? 'selected' : ''}>Bowler</option>
                <option value="Wicket-Keeper" ${p.role === 'Wicket-Keeper' ? 'selected' : ''}>Wicket-Keeper</option>
            </select>
            <label style="font-size:0.85rem; color:#94a3b8;">Update Photo (Optional):</label>
            <input type="file" id="editPPhoto" accept="image/*" class="input-field">
            ${p.photo_url ? `<button class="btn-danger btn-sm" onclick="removePlayerPhoto('${p.id}')">Remove Current Photo</button>` : ''}
            <button class="btn-primary" onclick="savePlayerEdits('${p.id}')">Save Changes</button>
        </div>
    `;
    openModal('popupModal');
}

async function removePlayerPhoto(playerId) {
    await sb.from('players').update({ photo_url: '' }).eq('id', playerId);
    await fetchPlayers();
    closeModal('popupModal');
    renderManagePlayersView();
}

async function savePlayerEdits(playerId) {
    const name = document.getElementById('editPName').value.trim();
    const nickname = document.getElementById('editPNick').value.trim();
    const role = document.getElementById('editPRole').value;
    const photoFile = document.getElementById('editPPhoto').files[0];

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
    closeModal('popupModal');
    renderManagePlayersView();
}

async function deletePlayer(playerId) {
    if (currentAdminRole !== 'super_admin') return alert('Only Super Admin can delete players!');
    if (!confirm('Delete this player permanently?')) return;
    await sb.from('players').delete().eq('id', playerId);
    await fetchPlayers();
    renderManagePlayersView();
}

async function renderManageAdminsView() {
    if (currentAdminRole !== 'super_admin') return showPublicTab('live');
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
