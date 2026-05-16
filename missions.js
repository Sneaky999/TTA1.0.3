// ═══════════════════════════════════════════════════════════════
//  missions.js  –  MISSIONS SYSTEM
//
//  Walk into a mission zone to accept a job. Progress is tracked
//  via recordKill() in world.js → reportMissionKill() here.
//  Mission waypoints appear on both the main view and full map.
//
//  Activated in index.html after ai.js:
//    <script src="missions.js"></script>
//
//  Depends on: world.js, game.js, ai.js
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── MISSION PICKUP ZONES ──────────────────────────────────────
// Small areas on the map. Player walks in → mission offered/started.
// Shown as gold "M" markers on the full map.
const MISSION_ZONES = [
  { x1:30, y1:30, x2:35, y2:35, missionId:'delivery_01', name:'PHONE BOOTH',
    npc:{ label:'V', col:'#e8c87a', dialogue:[
      '"Hey. You look like someone who doesn\'t ask questions."',
      '"There\'s a package at the docks. Pick it up, drop it at the warehouse. Simple."',
      '"Don\'t open it. Don\'t be late. Clock starts when you take the job."',
    ]}},
  { x1:90, y1:93, x2:96, y2:99, missionId:'hit_01', name:'CONTACT',
    npc:{ label:'C', col:'#a0c8e0', dialogue:[
      '"Someone needs to disappear. A marked man. You\'ll see who."',
      '"No guns if you can help it. The less noise, the better for both of us."',
      '"Payment on confirmation. Don\'t come back until it\'s done."',
    ]}},
  { x1:75, y1:15, x2:81, y2:21, missionId:'rampage_01', name:'GANG BOSS',
    npc:{ label:'B', col:'#e05050', dialogue:[
      '"These streets belong to us. The East Side crew keeps pushing."',
      '"I need ten of them gone. I don\'t care how. I care about results."',
      '"You do this right, you\'ll have friends in this city. You feel me?"',
    ]}},
  { x1:21, y1:72, x2:27, y2:78, missionId:'escape_01', name:'SAFEHOUSE',
    npc:{ label:'S', col:'#80e080', dialogue:[
      '"The cops have been watching me. I need to know you\'re serious."',
      '"Rack up heat — three stars minimum — then get back here clean."',
      '"Show me you can shake a tail and I\'ll keep paying you."',
    ]}},
  { x1:127,y1:45,x2:133, y2:51, missionId:'patrol_01', name:'COP INFORMANT',
    npc:{ label:'I', col:'#c0a0e8', dialogue:[
      '"You didn\'t hear this from me."',
      '"Five badges. That\'s the number. Dirty ones — they know what they did."',
      '"Make it look random. I\'ll cover the paperwork from my end."',
    ]}},
  { x1:80, y1:112,x2:86,y2:118, missionId:'delivery_02', name:'NORTHGATE JOB',
    npc:{ label:'N', col:'#e8a040', dialogue:[
      '"Northgate express. Special cargo, tight window."',
      '"My last runner got pinched. I need someone with wheels and brains."',
      '"Ninety seconds late and the deal falls apart. Don\'t let that happen."',
    ]}},
];

// ── MISSION DEFINITIONS ───────────────────────────────────────
const MISSION_DEFS = {

  delivery_01: {
    name: 'HOT PACKAGE',
    desc: 'Pick up the package and deliver it — fast.',
    reward: 600,
    wantedPenalty: 0,
    type: 'delivery',
    timerMax: 70,
    count: 1,
  },

  hit_01: {
    name: 'THE CONTRACT',
    desc: 'Eliminate the marked target. Stay out of sight.',
    reward: 900,
    wantedPenalty: 2,
    type: 'elimination',
    timerMax: null,
    count: 1,
  },

  rampage_01: {
    name: 'GANG SWEEP',
    desc: 'Take out 10 gang members before time runs out.',
    reward: 1400,
    wantedPenalty: 1,
    type: 'rampage',
    target: 'gang',
    timerMax: 90,
    count: 10,
  },

  escape_01: {
    name: 'HOT PURSUIT',
    desc: 'Get to 3+ stars, then reach the safe zone.',
    reward: 1600,
    wantedPenalty: 0,
    type: 'escape',
    timerMax: null,
    count: 1,
  },

  delivery_02: {
    name: 'NORTHGATE EXPRESS',
    desc: 'Deliver a package across the expanded city. Time is tight.',
    reward: 700,
    wantedPenalty: 0,
    type: 'delivery',
    timerMax: 90,
    count: 1,
  },

  patrol_01: {
    name: 'INFORMANT RUN',
    desc: 'Kill 5 cops without dying. Dirty work pays well.',
    reward: 2000,
    wantedPenalty: 3,
    type: 'rampage',
    target: 'cop',
    timerMax: 120,
    count: 5,
  },
};

// ── RUNTIME STATE ─────────────────────────────────────────────
let activeMission  = null;
let missionPhase   = 'idle';
let _completedIds  = new Set();
let _bannerEl      = null;
let _hudEl         = null;
let _zonePromptEl  = null;
let _lastZoneId    = null;
let _offerTimer    = 0;
let _targetNPC     = null;

// ── Giver NPC system ─────────────────────────────────────────
let _giverNPCs     = [];   // persistent NPC objects per mission zone
let _talkBtn       = null; // floating TALK button
let _dialogueEl    = null; // dialogue panel element
let _activeGiver   = null; // which zone giver is in dialogue
let _dialogueLine  = 0;    // current dialogue line index

// ── PUBLIC API ────────────────────────────────────────────────

let _missionEndTimer = null; // track so restart can cancel it

function initMissions() {
  if (_missionEndTimer) { clearTimeout(_missionEndTimer); _missionEndTimer = null; }
  activeMission  = null;
  missionPhase   = 'idle';
  _completedIds  = new Set();
  _targetNPC     = null;
  _lastZoneId    = null;
  _offerTimer    = 0;
  _activeGiver   = null;
  _dialogueLine  = 0;
  _giverNPCs     = [];

  // Spawn persistent giver NPCs at each mission zone centre
  for (const mz of MISSION_ZONES) {
    if (!mz.npc) continue;
    const wx = ((mz.x1 + mz.x2) / 2) * T;
    const wy = ((mz.y1 + mz.y2) / 2) * T;
    const giver = {
      x: wx, y: wy, w: 12, h: 12,
      hp: 999, maxHp: 999, spd: 0,
      angle: 0, timer: 99, flee: false,
      col: mz.npc.col, colorIdx: 0,
      state: 'idle', isGiver: true,
      missionZone: mz,
      cash: 0,
    };
    npcs.push(giver);
    _giverNPCs.push(giver);
  }

  _buildUI();
  _hideZonePrompt();
  _hideHUD();
  _hideTalkBtn();
  if (_dialogueEl) _dialogueEl.style.display = 'none';
  _activeGiver = null;
  console.log('[missions] System ready — ' + Object.keys(MISSION_DEFS).length + ' missions loaded');
}

/** Called every frame from game.js update() hook */
function updateMissions(dt) {
  _checkZones(dt);
  if (missionPhase !== 'active' || !activeMission) return;
  const m = activeMission;

  // Countdown timer
  if (m.timerMax !== null) {
    m.timer -= dt;
    _updateHUD();
    if (m.timer <= 0) { _failMission('TIME EXPIRED'); return; }
  }

  // Per-type win condition checks
  if (m.type === 'rampage') {
    if (m.progress >= m.count) { _completeMission(); return; }
  }

  if (m.type === 'delivery') {
    if (m.phase === 'pickup' && m.pickup) {
      // Close enough to pickup point?
      if (d2(PL.x, PL.y, m.pickup.x, m.pickup.y) < 45*45) {
        m.phase = 'deliver';
        m.target = _randRoadPt(400); // new destination
        _showBanner('PACKAGE PICKED UP — DELIVER IT!');
        _updateHUD();
      }
    } else if (m.phase === 'deliver' && m.target) {
      if (d2(PL.x, PL.y, m.target.x, m.target.y) < 50*50) {
        _completeMission();
      }
    }
  }

  if (m.type === 'escape') {
    if (m.target && PL.wanted >= 3) {
      if (d2(PL.x, PL.y, m.target.x, m.target.y) < 60*60) {
        _completeMission();
      }
    }
  }

  if (m.type === 'elimination') {
    // Target NPC removed from npcs array = dead
    if (_targetNPC && !npcs.includes(_targetNPC)) {
      _completeMission();
    } else if (_targetNPC) {
      // Keep waypoint tracking the moving NPC
      m.target = { x: _targetNPC.x, y: _targetNPC.y };
    }
  }
}

/** Called by renderMissions hook in game.js render() */
function renderMissions(ctx, cam, W, H) {
  if (missionPhase !== 'active' || !activeMission) return;
  const m = activeMission;

  // Determine which point to draw waypoint at
  const wp = m.type === 'delivery' && m.phase === 'pickup' ? m.pickup : m.target;
  if (!wp) return;

  const sx = (wp.x - cam.x) + W/2;
  const sy = (wp.y - cam.y) + H/2;

  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 260);
  const r = 20 + pulse * 6;

  ctx.save();
  // Outer pulse ring
  ctx.strokeStyle = `rgba(255,210,0,${0.5 + pulse * 0.45})`;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);
  // Inner fill
  ctx.fillStyle = `rgba(255,210,0,${0.15 + pulse * 0.12})`;
  ctx.beginPath(); ctx.arc(sx, sy, 13, 0, Math.PI * 2); ctx.fill();
  // Star icon
  ctx.fillStyle = `rgba(255,220,60,${0.85 + pulse * 0.15})`;
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('★', sx, sy);

  // Off-screen arrow if waypoint is off screen
  const margin = 40;
  const offScreen = sx < margin || sx > W - margin || sy < margin || sy > H - margin;
  if (offScreen) {
    const ang = Math.atan2(wp.y - PL.y, wp.x - PL.x);
    const ax = W/2 + Math.cos(ang) * (Math.min(W, H)/2 - margin);
    const ay = H/2 + Math.sin(ang) * (Math.min(W, H)/2 - margin);
    ctx.fillStyle = 'rgba(255,210,0,0.9)';
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(10, 0); ctx.lineTo(-6, -6); ctx.lineTo(-6, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  // Timer bar
  if (m.timerMax !== null) {
    const pct = Math.max(0, m.timer / m.timerMax);
    const bw = 100, bh = 6, bx = W/2 - bw/2, by = 90;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = pct > 0.4 ? '#ffc820' : '#ff3322';
    ctx.fillRect(bx, by, bw * pct, bh);
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(Math.ceil(m.timer) + 's', W/2, by + bh/2);
  }
  ctx.restore();
}

/** Called by recordKill() in world.js for every player kill */
function reportMissionKill(faction) {
  if (missionPhase !== 'active' || !activeMission) return;
  const m = activeMission;
  if (m.type !== 'rampage') return;
  if (m.target !== faction) return;
  m.progress++;
  _showBanner(m.name + '  ' + m.progress + ' / ' + m.count);
  _updateHUD();
}

// ── INTERNALS ─────────────────────────────────────────────────

// ── ZONE ENTRY DEBOUNCE ───────────────────────────────────────
let _zoneCooldown = 0; // seconds before zone can trigger again

function _checkZones(dt) {
  if (_zoneCooldown > 0) _zoneCooldown -= dt;
  if (missionPhase === 'active') { _lastZoneId = null; _hideZonePrompt(); _hideTalkBtn(); return; }
  if (_activeGiver) return; // dialogue open — don't change state

  // Check proximity to any giver NPC (60px trigger range)
  const TALK_RANGE = 60 * 60;
  let nearGiver = null;
  for (const g of _giverNPCs) {
    if (d2(PL.x, PL.y, g.x, g.y) < TALK_RANGE) { nearGiver = g; break; }
  }

  if (!nearGiver) {
    _lastZoneId = null;
    _hideZonePrompt();
    _hideTalkBtn();
    return;
  }

  const mz  = nearGiver.missionZone;
  const id  = mz.missionId;

  if (_completedIds.has(id)) {
    _showZonePrompt('[ ' + mz.name + ' ]  MISSION COMPLETE');
    _hideTalkBtn();
    return;
  }

  // Show TALK button near giver — only if debounce expired
  if (_zoneCooldown > 0) return;
  const def = MISSION_DEFS[id];
  _showZonePrompt('[ ' + mz.name + ' ]  ' + def.name);
  _showTalkBtn(nearGiver, mz);
}

function _startMission(id, zone) {
  const def = MISSION_DEFS[id];
  if (!def) return;
  // Bug 6: Prevent retrigger — don't start if already active or completed
  if (missionPhase === 'active' || missionPhase === 'success' || missionPhase === 'failed') return;
  if (_completedIds.has(id)) return;

  activeMission = {
    id,
    ...def,
    progress    : 0,
    timer       : def.timerMax || 0,
    phase       : 'pickup',
    pickup      : null,
    target      : null,
    rewardGiven : false,  // Bug 5: init reward flag
  };
  missionPhase = 'active';
  _targetNPC   = null;
  _hideZonePrompt();

  // Set up targets
  if (def.type === 'delivery') {
    activeMission.pickup = _randRoadPt(300);
    activeMission.target = null;
  } else if (def.type === 'escape') {
    // Safe zone is the hospital area
    const hz = SPECIAL_ZONES.hospital;
    activeMission.target = {
      x: ((hz.x1 + hz.x2) / 2) * T,
      y: ((hz.y1 + hz.y2) / 2) * T,
    };
  } else if (def.type === 'elimination') {
    // Spawn a bright-red target NPC far from player
    _targetNPC = _spawnTargetNPC();
    activeMission.target = _targetNPC ? { x: _targetNPC.x, y: _targetNPC.y } : _randRoadPt(500);
  } else if (def.type === 'rampage') {
    activeMission.target = def.target; // 'gang' | 'cop'
  }

  _showBanner('MISSION START — ' + def.name.toUpperCase());
  _updateHUD();
  _buildHUD();
}

function _completeMission() {
  // Bug 8: Race condition guard — only run once per mission
  if (!activeMission || missionPhase !== 'active') return;
  const m = activeMission;
  // Bug 5: Money duplication guard — reward only fires once
  if (m.rewardGiven) return;
  m.rewardGiven = true;
  _completedIds.add(m.id);
  missionPhase = 'success';
  PL.cash  += m.reward;
  PL.score += m.reward;
  if (typeof onApprovalMission === 'function') onApprovalMission(true);
  // Remove target NPC from world if it's still alive
  if (_targetNPC) {
    const idx = npcs.indexOf(_targetNPC);
    if (idx >= 0) npcs.splice(idx, 1);
  }
  _showBanner('MISSION COMPLETE  +$' + m.reward + ' ✓');
  _hideHUD();
  _missionEndTimer = setTimeout(() => {
    missionPhase = 'idle'; activeMission = null; _targetNPC = null; _missionEndTimer = null;
    _zoneCooldown = 3.0; // Bug 6: 3s cooldown before zone can trigger again
  }, 3200);
}

function _failMission(reason) {
  // Bug 8: Only fail if actually active
  if (missionPhase !== 'active') return;
  missionPhase = 'failed';
  if (activeMission && activeMission.wantedPenalty > 0) addWanted(activeMission.wantedPenalty);
  if (typeof onApprovalMission === 'function') onApprovalMission(false);
  // Clean up target NPC
  if (_targetNPC) {
    const idx = npcs.indexOf(_targetNPC);
    if (idx >= 0) npcs.splice(idx, 1);
  }
  _showBanner('MISSION FAILED — ' + (reason || ''));
  _hideHUD();
  _missionEndTimer = setTimeout(() => {
    missionPhase = 'idle'; activeMission = null; _targetNPC = null; _missionEndTimer = null;
    _zoneCooldown = 2.0; // Bug 6/7: cooldown prevents immediate retrigger after fail
  }, 2800);
}

// ── HELPERS ───────────────────────────────────────────────────

function _randRoadPt(minDist) {
  // Use pre-cached road tiles from cops.js if available
  const src = typeof _roadTiles !== 'undefined' && _roadTiles.length ? _roadTiles : null;
  if (src) {
    const minD2 = minDist ? minDist * minDist : 0;
    const pool  = minDist
      ? src.filter(t => { const wx=t.x*T+T/2,wy=t.y*T+T/2; return d2(wx,wy,PL.x,PL.y)>minD2; })
      : src;
    const t = pool[Math.floor(Math.random() * pool.length)];
    return t ? { x: t.x*T+T/2, y: t.y*T+T/2 } : { x: PL.x+400, y: PL.y };
  }
  // Fallback full scan
  const tiles = [];
  for (let y = MAP_EDGE_MARGIN; y < WH - MAP_EDGE_MARGIN; y++)
    for (let x = MAP_EDGE_MARGIN; x < WW - MAP_EDGE_MARGIN; x++)
      if (WD[y][x] === 1) {
        const wx = x * T + T/2, wy = y * T + T/2;
        if (!minDist || d2(wx, wy, PL.x, PL.y) > minDist * minDist)
          tiles.push({ x: wx, y: wy });
      }
  return tiles[Math.floor(Math.random() * tiles.length)] || { x: PL.x + 400, y: PL.y };
}

function _spawnTargetNPC() {
  // Place target NPC in a gang zone, far from player
  const zones = [SPECIAL_ZONES.gangA, SPECIAL_ZONES.gangB];
  const z = zones[Math.floor(Math.random() * zones.length)];
  const tx = z.x1 + Math.floor(Math.random() * (z.x2 - z.x1));
  const ty = z.y1 + Math.floor(Math.random() * (z.y2 - z.y1));
  const npc = {
    x: tx * T + T/2, y: ty * T + T/2,
    w: 12, h: 12,
    hp: 60, maxHp: 60,
    spd: 55,
    angle: 0, timer: 0,
    col: '#ff2200',
    cash: 200,
    flee: false,
    colorIdx: 0,
    type: 'target',
    state: 'idle',
    isTarget: true,
  };
  npcs.push(npc);
  return npc;
}

// ── UI ────────────────────────────────────────────────────────

function _buildUI() {
  const gc = document.getElementById('gc');
  if (!gc) return;
  if (document.getElementById('missionBanner')) {
    _bannerEl     = document.getElementById('missionBanner');
    _zonePromptEl = document.getElementById('missionZonePrompt');
    _hudEl        = document.getElementById('missionHud');
    _talkBtn      = document.getElementById('missionTalkBtn');
    _dialogueEl   = document.getElementById('missionDialogue');
    return;
  }

  // ── Banner ───────────────────────────────────────────────
  _bannerEl = document.createElement('div');
  _bannerEl.id = 'missionBanner';
  _bannerEl.style.cssText = `
    position:absolute;top:38%;left:50%;transform:translateX(-50%);
    background:rgba(5,5,15,0.93);border:1px solid rgba(255,200,0,0.45);
    border-radius:5px;padding:10px 22px;font-family:'Bebas Neue',monospace;
    font-size:15px;color:#ffc820;letter-spacing:2.5px;z-index:30;
    opacity:0;transition:opacity .25s;pointer-events:none;
    white-space:pre;text-align:center;line-height:1.7;
  `;
  gc.appendChild(_bannerEl);

  // ── Zone prompt ──────────────────────────────────────────
  _zonePromptEl = document.createElement('div');
  _zonePromptEl.id = 'missionZonePrompt';
  _zonePromptEl.style.cssText = `
    position:absolute;
    bottom:calc(var(--ctrl-h, 155px) + 10px);
    left:50%;transform:translateX(-50%);
    background:rgba(0,0,0,0.82);border:1px solid rgba(255,200,0,0.45);
    border-radius:4px;padding:6px 16px;font-family:'Share Tech Mono',monospace;
    font-size:9px;color:rgba(255,200,0,0.9);letter-spacing:1.5px;z-index:25;
    display:none;pointer-events:none;text-align:center;white-space:nowrap;
    box-shadow:0 2px 12px rgba(0,0,0,0.7);
    max-width:80vw;overflow:hidden;text-overflow:ellipsis;
  `;
  gc.appendChild(_zonePromptEl);

  // ── TALK button ──────────────────────────────────────────
  _talkBtn = document.createElement('button');
  _talkBtn.id = 'missionTalkBtn';
  _talkBtn.textContent = '💬 TALK';
  _talkBtn.style.cssText = `
    position:absolute;
    bottom:calc(var(--ctrl-h, 155px) + 52px);
    left:50%;transform:translateX(-50%);
    background:rgba(255,200,0,0.18);border:2px solid rgba(255,200,0,0.85);
    border-radius:6px;padding:8px 24px;font-family:'Bebas Neue',monospace;
    font-size:16px;color:#ffc820;letter-spacing:3px;z-index:26;
    display:none;cursor:pointer;-webkit-tap-highlight-color:transparent;
    box-shadow:0 0 18px rgba(255,200,0,0.25);white-space:nowrap;
  `;
  _talkBtn.addEventListener('click',    () => _openDialogue(_activeTalkTarget));
  _talkBtn.addEventListener('touchend', e  => { e.preventDefault(); _openDialogue(_activeTalkTarget); });
  gc.appendChild(_talkBtn);

  // ── Dialogue panel ───────────────────────────────────────
  _dialogueEl = document.createElement('div');
  _dialogueEl.id = 'missionDialogue';
  _dialogueEl.style.cssText = `
    position:absolute;
    bottom:calc(var(--ctrl-h, 155px) + 10px);
    left:50%;transform:translateX(-50%);
    width:min(94vw,400px);
    background:rgba(4,4,14,0.97);border:1px solid rgba(255,200,0,0.45);
    border-radius:8px;padding:0;z-index:40;display:none;overflow:hidden;
    box-shadow:0 4px 32px rgba(0,0,0,0.9);
  `;
  _dialogueEl.innerHTML = `
    <div id="dlgHeader" style="display:flex;align-items:center;gap:10px;padding:10px 14px 8px;border-bottom:1px solid rgba(255,200,0,0.2);">
      <div id="dlgPortrait" style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Bebas Neue',monospace;font-size:18px;font-weight:bold;flex-shrink:0;"></div>
      <div>
        <div id="dlgName" style="font-family:'Bebas Neue',monospace;font-size:13px;letter-spacing:3px;color:#ffc820;"></div>
        <div id="dlgMissionName" style="font-family:'Share Tech Mono',monospace;font-size:8px;color:rgba(255,200,0,0.55);letter-spacing:1.5px;"></div>
      </div>
      <div id="dlgReward" style="margin-left:auto;font-family:'Bebas Neue',monospace;font-size:13px;color:#4f4;letter-spacing:1px;"></div>
    </div>
    <div id="dlgText" style="padding:12px 16px;font-family:'Share Tech Mono',monospace;font-size:11px;color:rgba(255,255,255,0.85);line-height:1.6;letter-spacing:0.5px;min-height:52px;"></div>
    <div id="dlgDots" style="padding:0 16px 4px;display:flex;gap:5px;"></div>
    <div id="dlgButtons" style="display:flex;gap:8px;padding:8px 12px 12px;">
      <button id="dlgNext"    style="flex:1;padding:9px;background:rgba(255,200,0,0.15);border:1px solid rgba(255,200,0,0.6);border-radius:5px;color:#ffc820;font-family:'Bebas Neue',monospace;font-size:14px;letter-spacing:2px;cursor:pointer;">NEXT ›</button>
      <button id="dlgAccept"  style="flex:1;padding:9px;background:rgba(0,200,80,0.2);border:1px solid rgba(0,255,80,0.6);border-radius:5px;color:#4f4;font-family:'Bebas Neue',monospace;font-size:14px;letter-spacing:2px;cursor:pointer;display:none;">ACCEPT</button>
      <button id="dlgDecline" style="flex:1;padding:9px;background:rgba(200,0,0,0.15);border:1px solid rgba(255,50,50,0.5);border-radius:5px;color:#f66;font-family:'Bebas Neue',monospace;font-size:14px;letter-spacing:2px;cursor:pointer;">DECLINE</button>
    </div>
  `;
  gc.appendChild(_dialogueEl);

  // Wire dialogue buttons
  const _wire = (id, fn) => {
    const el = document.getElementById(id);
    el.addEventListener('click',    fn);
    el.addEventListener('touchend', e => { e.preventDefault(); fn(); });
  };
  _wire('dlgNext',    _dialogueNext);
  _wire('dlgAccept',  _dialogueAccept);
  _wire('dlgDecline', _dialogueDecline);

  // ── Mission HUD ──────────────────────────────────────────
  _hudEl = document.createElement('div');
  _hudEl.id = 'missionHud';
  _hudEl.style.cssText = `
    position:absolute;top:72px;left:50%;transform:translateX(-50%);
    background:rgba(5,5,15,0.88);border:1px solid rgba(255,200,0,0.3);
    border-radius:4px;padding:4px 12px;font-family:'Share Tech Mono',monospace;
    font-size:9px;color:#ffc820;letter-spacing:1.5px;z-index:22;
    display:none;text-align:center;white-space:nowrap;max-width:80vw;
  `;
  gc.appendChild(_hudEl);
}

// ── Giver NPC render in main canvas ──────────────────────────
// Called from game.js render() after regular NPC loop
function renderGiverNPCs(CX, wsFunc, now) {
  for (const g of _giverNPCs) {
    const s = wsFunc(g.x, g.y);
    const W = CX.canvas.width, H = CX.canvas.height;
    if (s.x < -50 || s.x > W + 50 || s.y < -50 || s.y > H + 50) continue;
    const mz  = g.missionZone;
    const done = _completedIds.has(mz.missionId);
    const pulse = 0.6 + 0.4 * Math.sin(now / 400);

    CX.save();
    CX.translate(s.x, s.y);

    // Aura ring
    CX.shadowColor = done ? 'rgba(80,255,80,0.6)' : `rgba(255,200,0,${0.5 * pulse})`;
    CX.shadowBlur  = done ? 8 : 14 * pulse;
    CX.strokeStyle = done ? 'rgba(80,255,80,0.8)' : `rgba(255,200,0,${0.6 + pulse * 0.4})`;
    CX.lineWidth   = 2;
    CX.beginPath(); CX.arc(0, 0, 13, 0, Math.PI * 2); CX.stroke();
    CX.shadowBlur  = 0;

    // Body
    CX.fillStyle = g.col;
    CX.beginPath(); CX.arc(0, 0, 9, 0, Math.PI * 2); CX.fill();

    // Label letter
    CX.fillStyle = '#fff';
    CX.font = 'bold 9px monospace';
    CX.textAlign = 'center'; CX.textBaseline = 'middle';
    CX.fillText(mz.npc.label, 0, 0.5);

    // "!" or "✓" above head
    CX.font = 'bold 11px monospace';
    CX.fillStyle = done ? '#4f4' : '#ffc820';
    CX.fillText(done ? '✓' : '!', 0, -20);

    CX.restore();
  }
}

let _activeTalkTarget = null; // giver NPC + zone currently offered

function _showTalkBtn(giver, mz) {
  if (!_talkBtn) return;
  _activeTalkTarget = { giver, mz };
  _talkBtn.style.display = 'block';
}

function _hideTalkBtn() {
  if (_talkBtn) _talkBtn.style.display = 'none';
  _activeTalkTarget = null;
}

function _openDialogue(target) {
  if (!target || !_dialogueEl) return;
  _activeGiver  = target;
  _dialogueLine = 0;
  _hideTalkBtn();
  _hideZonePrompt();

  const mz  = target.mz;
  const def = MISSION_DEFS[mz.missionId];

  // Populate header
  document.getElementById('dlgPortrait').textContent  = mz.npc.label;
  document.getElementById('dlgPortrait').style.background = mz.npc.col + '33';
  document.getElementById('dlgPortrait').style.border      = `2px solid ${mz.npc.col}`;
  document.getElementById('dlgPortrait').style.color        = mz.npc.col;
  document.getElementById('dlgName').textContent      = mz.name;
  document.getElementById('dlgMissionName').textContent = def.name.toUpperCase();
  document.getElementById('dlgReward').textContent    = '$' + def.reward;

  _dialogueRender();
  _dialogueEl.style.display = 'block';
}

function _dialogueRender() {
  if (!_activeGiver) return;
  const mz    = _activeGiver.mz;
  const lines = mz.npc.dialogue;
  const total = lines.length;
  const isLast = _dialogueLine >= total - 1;

  document.getElementById('dlgText').textContent = lines[_dialogueLine];

  // Progress dots
  const dotsEl = document.getElementById('dlgDots');
  dotsEl.innerHTML = '';
  for (let i = 0; i < total; i++) {
    const d = document.createElement('div');
    d.style.cssText = `width:6px;height:6px;border-radius:50%;background:${i === _dialogueLine ? '#ffc820' : 'rgba(255,200,0,0.25)'};transition:background .2s`;
    dotsEl.appendChild(d);
  }

  // Show Next or Accept on last line
  document.getElementById('dlgNext').style.display   = isLast ? 'none' : 'flex';
  document.getElementById('dlgAccept').style.display = isLast ? 'flex' : 'none';
}

function _dialogueNext() {
  if (!_activeGiver) return;
  const total = _activeGiver.mz.npc.dialogue.length;
  if (_dialogueLine < total - 1) { _dialogueLine++; _dialogueRender(); }
}

function _dialogueAccept() {
  if (!_activeGiver) return;
  const mz = _activeGiver.mz;
  _closeDialogue();
  _startMission(mz.missionId, mz);
}

function _dialogueDecline() {
  _closeDialogue();
  showNotif && showNotif('MISSION DECLINED');
}

function _closeDialogue() {
  _activeGiver = null;
  if (_dialogueEl) _dialogueEl.style.display = 'none';
}

function _buildHUD() {
  if (!_hudEl || !activeMission) return;
  _hudEl.style.display = 'block';
  _updateHUD();
}

function _updateHUD() {
  if (!_hudEl || !activeMission) return;
  const m = activeMission;
  let lines = '[ MISSION ]\n' + m.name;
  if (m.type === 'rampage') lines += '\n' + m.progress + ' / ' + m.count + ' kills';
  if (m.timerMax !== null)  lines += '\n⏱ ' + Math.ceil(m.timer) + 's';
  if (m.type === 'delivery' && m.phase === 'pickup') lines += '\nGO TO PICKUP';
  if (m.type === 'delivery' && m.phase === 'deliver') lines += '\nDELIVER NOW';
  if (m.type === 'escape')  lines += '\nNEED ★★★ + SAFE ZONE';
  _hudEl.style.whiteSpace = 'pre';
  _hudEl.textContent = lines;
}

function _hideHUD() { if (_hudEl) _hudEl.style.display = 'none'; }

function _showBanner(text) {
  if (!_bannerEl) return;
  _bannerEl.textContent = text;
  _bannerEl.style.opacity = '1';
  clearTimeout(_bannerEl._t);
  _bannerEl._t = setTimeout(() => { _bannerEl.style.opacity = '0'; }, 3200);
}

function _showZonePrompt(text) {
  if (!_zonePromptEl) return;
  _zonePromptEl.textContent = text;
  _zonePromptEl.style.display = 'block';
}

function _hideZonePrompt() {
  if (_zonePromptEl) _zonePromptEl.style.display = 'none';
}
