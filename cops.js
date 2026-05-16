// ═══════════════════════════════════════════════════════════════
//  cops.js  –  COP SYSTEM  (Logic, data, spawning, HQ, raids)
//
//  Owns:
//    COP_GRADES, cops[], pcars[]
//    mkPoliceCar(), spawnCop(), repopCopHQ(), launchRaid()
//    snapToRoad(), safePatrolPt(), randRoadPt(), raidPt()
//    isTileInGangZone(), GANG_ZONES_AVOID, GANG_AVOID_MARGIN
//    updateCopSpawns(dt), resetCops()
//    addWanted(), WANTED_DECAY_TIME
//
//  Does NOT handle: AI movement/shooting (ai.js), rendering (game.js)
//  Depends on: world.js  →  load cops.js AFTER world.js
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── COP GRADES ────────────────────────────────────────────────
// Bug 17: Freeze cop grade definitions — prevents console stat editing
const COP_GRADES = Object.freeze([
  Object.freeze({ name:'PATROL',    col:'#1a55cc', trim:'#88aaff', hp:50,  maxHp:50,  spd:88,  dmg:10, shootCd:1.1, atkDmg:8,  reward:200, w:11, h:11, hasCar:true,  carMinWanted:0  }),
  Object.freeze({ name:'SERGEANT',  col:'#1a3a99', trim:'#5577ee', hp:80,  maxHp:80,  spd:95,  dmg:14, shootCd:0.9, atkDmg:11, reward:350, w:12, h:12, hasCar:true,  carMinWanted:2  }),
  Object.freeze({ name:'DETECTIVE', col:'#3a2a55', trim:'#9988cc', hp:70,  maxHp:70,  spd:100, dmg:16, shootCd:0.8, atkDmg:13, reward:400, w:11, h:11, hasCar:false, carMinWanted:99 }),
  Object.freeze({ name:'SWAT',      col:'#111111', trim:'#444444', hp:130, maxHp:130, spd:82,  dmg:22, shootCd:0.7, atkDmg:18, reward:600, w:13, h:13, hasCar:true,  carMinWanted:3  }),
]);

// ── ENTITY ARRAYS ─────────────────────────────────────────────
const cops  = [];
const pcars = [];

// ── GANG ZONE REFERENCES (used by cop patrol avoidance) ───────
const GANG_ZONES_AVOID  = [SPECIAL_ZONES.gangA, SPECIAL_ZONES.gangB];
const GANG_AVOID_MARGIN = 8;

function isTileInGangZone(tx, ty, margin) {
  for (const z of GANG_ZONES_AVOID)
    if (tx >= z.x1 - margin && tx < z.x2 + margin &&
        ty >= z.y1 - margin && ty < z.y2 + margin) return true;
  return false;
}

// ── ROAD POINT HELPERS ────────────────────────────────────────

// ── PRE-CACHED TILE LISTS (built once, used by safePatrolPt/randRoadPt) ──
let _safePatrolTiles = [];
let _roadTiles       = [];

function _buildTileCache() {
  _safePatrolTiles = [];
  _roadTiles       = [];
  for (let y = MAP_EDGE_MARGIN; y < WH - MAP_EDGE_MARGIN; y++) {
    for (let x = MAP_EDGE_MARGIN; x < WW - MAP_EDGE_MARGIN; x++) {
      if (WD[y][x] !== 1) continue;
      _roadTiles.push({ x, y });
      if (!isTileInGangZone(x, y, GANG_AVOID_MARGIN)) _safePatrolTiles.push({ x, y });
    }
  }
  if (!_safePatrolTiles.length) _safePatrolTiles = [..._roadTiles];
}

function randRoadPt() {
  const t = _roadTiles[Math.floor(Math.random() * _roadTiles.length)];
  if (!t) return { x: WW * T / 2, y: WH * T / 2 };
  return { x: t.x * T + T / 2, y: t.y * T + T / 2 };
}

function safePatrolPt() {
  const t = _safePatrolTiles[Math.floor(Math.random() * _safePatrolTiles.length)];
  if (!t) return { px: WW * T / 2, py: WH * T / 2 };
  return { px: t.x * T + T / 2, py: t.y * T + T / 2 };
}

function raidPt(zone) {
  const tx = zone.x1 + Math.floor(Math.random() * (zone.x2 - zone.x1));
  const ty = zone.y1 + Math.floor(Math.random() * (zone.y2 - zone.y1));
  return { px: tx * T + T / 2, py: ty * T + T / 2 };
}

function newPatrolWP() { return safePatrolPt(); }

function snapToRoad(wx, wy) {
  const tx = Math.floor(wx / T), ty = Math.floor(wy / T);
  if (ty >= 0 && ty < WH && tx >= 0 && tx < WW && WD[ty][tx] === 1)
    return { x: tx * T + T / 2, y: ty * T + T / 2 };
  for (let r = 1; r <= 8; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const nx = tx + dx, ny = ty + dy;
        if (ny >= 1 && ny < WH - 1 && nx >= 1 && nx < WW - 1 && WD[ny][nx] === 1)
          return { x: nx * T + T / 2, y: ny * T + T / 2 };
      }
  return { x: WW * T / 2, y: WH * T / 2 };
}

// ── POLICE CAR FACTORY ────────────────────────────────────────

function mkPoliceCar(x, y, grade) {
  const gd = COP_GRADES[grade];
  const isSWAT = grade === 3;
  return {
    x, y,
    w: isSWAT ? 38 : 30,   h: isSWAT ? 18 : 14,
    angle: 0, speed: 0,
    maxS: isSWAT ? 155 : 185,
    acc:  isSWAT ? 180 : 250,
    trn:  isSWAT ? 4.5 : 6.0,
    col:  isSWAT ? '#222' : '#1144cc',
    style: isSWAT ? 'suv' : 'sedan',
    grade, health: isSWAT ? 100 : 70,
    driven: false, copIdx: -1, lightT: 0,
    name: gd.name + ' CAR', isSWAT,
  };
}

// ── COP SPAWNING ──────────────────────────────────────────────

function spawnCop(x, y, gradeOverride) {
  x = Math.max((MAP_EDGE_MARGIN + 1) * T, Math.min((WW - MAP_EDGE_MARGIN - 1) * T, x));
  y = Math.max((MAP_EDGE_MARGIN + 1) * T, Math.min((WH - MAP_EDGE_MARGIN - 1) * T, y));
  const snapped = snapToRoad(x, y);
  x = snapped.x; y = snapped.y;

  const wanted = PL ? PL.wanted : 0;
  const grade  = gradeOverride != null ? gradeOverride :
    wanted >= 4 ? 3 :
    wanted >= 3 ? (Math.random() < 0.4 ? 3 : 2) :
    wanted >= 2 ? (Math.random() < 0.5 ? 1 : 2) :
    (Math.random() < 0.3 ? 1 : 0);

  const gd = COP_GRADES[grade];
  const wp = safePatrolPt();

  // ── Cop without a car (HQ patrol, detective on foot) ──────────
  if (!gd.hasCar || wanted < gd.carMinWanted) {
    const cop = {
      x, y, w: gd.w, h: gd.h,
      hp: gd.hp, maxHp: gd.maxHp, spd: gd.spd,
      angle: 0, atkCd: 0, shootCd: 0,
      px: wp.px, py: wp.py,
      patrolT: 0, raiding: false,
      grade, name: gd.name, carIdx: -1,
      state: 'on_foot', role: null, exitT: 0,
    };
    cops.push(cop);
    return;
  }

  // ── 2-cop unit: driver + passenger ───────────────────────────
  const pc = mkPoliceCar(x, y, grade);
  pc.mode       = 'carrying';
  pc.blockAngle = Math.random() * Math.PI;

  // Driver — permanently in car, controls it
  const driver = {
    x, y, w: gd.w, h: gd.h,
    hp: gd.hp, maxHp: gd.maxHp, spd: gd.spd,
    angle: 0, atkCd: 0, shootCd: 0,
    px: wp.px, py: wp.py,
    patrolT: 0, raiding: false,
    grade, name: gd.name + ' (DRIVER)',
    carIdx: -1, state: 'in_car', role: 'driver', exitT: 0,
  };

  // Passenger — rides on car, exits near player
  const pasGrade = Math.max(0, grade - (Math.random() < 0.4 ? 1 : 0)); // sometimes 1 grade lower
  const pgd = COP_GRADES[pasGrade];
  const passenger = {
    x, y, w: pgd.w, h: pgd.h,
    hp: pgd.hp, maxHp: pgd.maxHp, spd: pgd.spd,
    angle: 0, atkCd: 0, shootCd: 0,
    px: wp.px, py: wp.py,
    patrolT: 0, raiding: false,
    grade: pasGrade, name: pgd.name + ' (UNIT)',
    carIdx: -1, state: 'riding', role: 'passenger', exitT: 0,
    // Passenger bobs slightly to show they're ready to jump
    _rideOffset: Math.random() * Math.PI * 2,
  };

  cops.push(driver);
  const driverIdx = cops.length - 1;
  cops.push(passenger);
  const passengerIdx = cops.length - 1;

  pc.driven       = true;
  pc.copIdx       = driverIdx;      // primary link (driver)
  pc.driverIdx    = driverIdx;
  pc.passengerIdx = passengerIdx;

  driver.carIdx    = pcars.length;  // will be the index after push
  passenger.carIdx = pcars.length;

  pcars.push(pc);
}

// ── HQ REPOPULATION ───────────────────────────────────────────
const COP_HQ_MIN_COUNT = 6;

function repopCopHQ() {
  const z     = SPECIAL_ZONES.copHQ;
  const count = cops.filter(c => {
    if (c.state === 'in_car' || c.state === 'riding') return false;
    const tx = Math.floor(c.x / T), ty = Math.floor(c.y / T);
    return tx >= z.x1 && tx < z.x2 && ty >= z.y1 && ty < z.y2;
  }).length;
  if (count < COP_HQ_MIN_COUNT) {
    const tx = z.x1 + Math.floor(Math.random() * (z.x2 - z.x1));
    const ty = z.y1 + Math.floor(Math.random() * (z.y2 - z.y1));
    spawnCop(tx * T + T / 2, ty * T + T / 2);
  }
}

// ── RAID SYSTEM ───────────────────────────────────────────────
const RAID_INTERVAL   = 30;
const RAID_SQUAD_SIZE = 5;
let   raidTimer       = 20;

function launchRaid(targetZone) {
  targetZone = targetZone ||
    GANG_ZONES_AVOID[Math.floor(Math.random() * GANG_ZONES_AVOID.length)];

  const zCX = (targetZone.x1 + targetZone.x2) / 2 * T;
  const zCY = (targetZone.y1 + targetZone.y2) / 2 * T;

  for (let ri = 0; ri < RAID_SQUAD_SIZE; ri++) {
    const ang  = Math.random() * Math.PI * 2;
    const dist = 320 + Math.random() * 80;
    const sx   = Math.max((MAP_EDGE_MARGIN + 1) * T,
                  Math.min((WW - MAP_EDGE_MARGIN - 1) * T, zCX + Math.cos(ang) * dist));
    const sy   = Math.max((MAP_EDGE_MARGIN + 1) * T,
                  Math.min((WH - MAP_EDGE_MARGIN - 1) * T, zCY + Math.sin(ang) * dist));

    const wp        = raidPt(targetZone);
    const raidGrade = ri === 0 ? 1 : 0;
    const rgd       = COP_GRADES[raidGrade];

    const rpc = mkPoliceCar(sx, sy, raidGrade);
    rpc.driven = true; rpc.mode = 'carrying';
    rpc.blockAngle = Math.random() * Math.PI;

    const rDriver = {
      x: sx, y: sy, w: rgd.w, h: rgd.h,
      hp: rgd.hp + 15, maxHp: rgd.maxHp + 15, spd: rgd.spd + 10,
      angle: 0, atkCd: 0, shootCd: 0,
      px: wp.px, py: wp.py,
      patrolT: 25, raiding: true,
      grade: raidGrade, name: rgd.name + ' (DRIVER)', carIdx: -1,
      state: 'in_car', role: 'driver', exitT: 0,
    };
    const rPas = {
      x: sx, y: sy, w: rgd.w, h: rgd.h,
      hp: rgd.hp + 10, maxHp: rgd.maxHp + 10, spd: rgd.spd + 12,
      angle: 0, atkCd: 0, shootCd: 0,
      px: wp.px, py: wp.py,
      patrolT: 25, raiding: true,
      grade: raidGrade, name: rgd.name + ' (UNIT)', carIdx: -1,
      state: 'riding', role: 'passenger', exitT: 0,
      _rideOffset: Math.random() * Math.PI * 2,
    };
    cops.push(rDriver);
    cops.push(rPas);
    rpc.copIdx       = cops.length - 2;
    rpc.driverIdx    = cops.length - 2;
    rpc.passengerIdx = cops.length - 1;
    rDriver.carIdx   = pcars.length;
    rPas.carIdx      = pcars.length;
    pcars.push(rpc);
  }
  if (typeof showNotif === 'function') showNotif('[ RAID ] COP RAID ON GANG TURF!');
}

// ── SPAWN TICK (called from game.js update) ───────────────────
let _copSpawnT  = 0;
let _copWantedT = 0;

function updateCopSpawns(dt) {
  // HQ repop
  _copSpawnT += dt;
  if (_copSpawnT > 5) { _copSpawnT = 0; repopCopHQ(); }

  // Periodic raids
  raidTimer -= dt;
  if (raidTimer <= 0) {
    raidTimer = RAID_INTERVAL + Math.random() * 15;
    launchRaid();
  }

  // Bug 10: Hard entity cap — prevents unbounded growth / memory leak
  const MAX_COPS_TOTAL = 40;
  if (cops.length >= MAX_COPS_TOTAL) return;

  const activeCopCount = cops.filter(c => c.state === 'on_foot').length;
  const mult = typeof approvalCopSpawnMult === 'function' ? approvalCopSpawnMult() : 1;
  const capMin = PL.wanted * 3;
  const cap    = Math.max(capMin, capMin * mult);
  _copWantedT += dt;
  if (PL.wanted > 0 && activeCopCount < cap && _copWantedT >= 1.5) {
    _copWantedT = 0;
    const a  = Math.random() * Math.PI * 2;
    const sd = 270 + Math.random() * 130;
    const sx = Math.max((MAP_EDGE_MARGIN + 1) * T,
                Math.min((WW - MAP_EDGE_MARGIN - 1) * T, PL.x + Math.cos(a) * sd));
    const sy = Math.max((MAP_EDGE_MARGIN + 1) * T,
                Math.min((WH - MAP_EDGE_MARGIN - 1) * T, PL.y + Math.sin(a) * sd));
    spawnCop(sx, sy);
  }
}

// ── WANTED SYSTEM ─────────────────────────────────────────────
const WANTED_DECAY_TIME = Object.freeze([0, 8, 12, 18, 25, 35]); // Bug 17: freeze constant

function addWanted(n) {
  PL.wanted = Math.min(5, PL.wanted + n);
  PL.wantT  = WANTED_DECAY_TIME[PL.wanted] || 8;
}

// Remove excess cops/cars when wanted level drops, keeping a proportional count
// Called from game.js after wanted drops
function despawnExcessCops() {
  const targetFootCops = Math.max(2, PL.wanted * 2); // keep 2 minimum
  const footCops = cops.filter(c => c.state === 'on_foot' && c.role !== 'driver');
  const excess = footCops.length - targetFootCops;
  if (excess <= 0) return;

  // Remove farthest cops from player first
  const sorted = footCops.sort((a, b) =>
    d2(b.x, b.y, PL.x, PL.y) - d2(a.x, a.y, PL.x, PL.y)
  );
  for (let i = 0; i < excess; i++) {
    const c = sorted[i];
    const idx = cops.indexOf(c);
    if (idx >= 0) {
      if (typeof _unlinkCopFromCar === 'function') _unlinkCopFromCar(c, idx);
      cops.splice(idx, 1);
    }
  }

  // Also remove pcars that now have no linked cop (abandoned carrying cars)
  for (let pi = pcars.length - 1; pi >= 0; pi--) {
    const pc = pcars[pi];
    if (pc.mode === 'abandoned') continue;
    const hasDriver = pc.driverIdx >= 0 && pc.driverIdx < cops.length;
    const hasPas    = pc.passengerIdx >= 0 && pc.passengerIdx < cops.length;
    if (!hasDriver && !hasPas) pcars.splice(pi, 1);
  }
}

// ── RESET ─────────────────────────────────────────────────────
function resetCops() {
  cops.length  = 0;
  pcars.length = 0;
  raidTimer    = 20;
  _copSpawnT   = 0;
  _copWantedT  = 0;
  PL.wanted    = 0;
  PL.wantT     = 0;
  for (let i = 0; i < COP_HQ_MIN_COUNT; i++) {
    const z  = SPECIAL_ZONES.copHQ;
    const tx = z.x1 + Math.floor(Math.random() * (z.x2 - z.x1));
    const ty = z.y1 + Math.floor(Math.random() * (z.y2 - z.y1));
    spawnCop(tx * T + T / 2, ty * T + T / 2);
  }
}
