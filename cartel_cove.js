// ═══════════════════════════════════════════════════════════════
//  island_c.js  –  CARTEL COVE  v2  (Full Crime Expansion)
//
//  Self-contained island expansion. Drop in and activate with
//  4 calls in game.js (see ACTIVATION below). No other files
//  are modified.
//
//  WHAT'S INSIDE:
//    • 23×23 tile island (529 tiles) — bigger than v1's 20×20
//    • 2 long bridges (12 tiles each) — west + north
//    • 9 distinct named zones in a 3×3 road grid:
//        NW  Beach Resort     NC  Cartel Mansion    NE  Casino
//        CW  Black Market     CC  Airstrip          CE  Drug Lab
//        SW  Cartel HQ        SC  Fight Club        SE  Smuggler Docks
//    • 4 cartel enemy types (cartel · elite · heavy · sniper)
//      Max 20 cartel on island — tougher AI via gangster system
//    • 6 exclusive island missions injected into MISSION_ZONES/DEFS
//    • 10 island pickup types scattered across all zones
//    • FIGHT CLUB: enter zone → 5-cartel wave → earn bonus cash
//    • DOCK ESCAPE: dwell on docks 5s (★2+) → drop 2 wanted stars
//    • LIGHTHOUSE BRIBE: stand near light 4s → drop 1 star (60s CD)
//    • BLACK MARKET: entering zone opens game shop
//    • STORM EVENT: random 20s storm — screen darkens, cartel ambush
//    • CARTEL AMBUSH EVENT: 12 cartel spawn around player randomly
//    • Island HUD panel (cartel count, events, cooldowns)
//    • Animated arrival/zone-change banner
//    • Minimap patched at init with all 9 zones coloured
//    • Full rendering: ocean shimmer, palm trees, lighthouse beam,
//      casino neon, mansion, airstrip runway lights, drug smoke,
//      fight club ring, boats, yachts, pier, bridge guardrails
//
//  ACTIVATION — add these calls to game.js (search the comment tag):
//
//    index.html — after approval.js:
//      <script src="island_c.js"></script>
//
//    startGame() — after initApproval():
//      if (typeof initIsland   === 'function') initIsland();
//
//    update(dt) — after updateApproval(dt):
//      if (typeof updateIsland === 'function') updateIsland(dt);
//
//    render()   — near end of render, after architecture:
//      if (typeof renderIsland === 'function')
//        renderIsland(CX, cam, W, H, Date.now());
//
//    resetGame() — after initApproval() re-call:
//      if (typeof resetIsland  === 'function') resetIsland();
//
//  Depends on: world.js · cops.js · gangsters.js · assets.js · game.js
// ═══════════════════════════════════════════════════════════════

'use strict';

// ══════════════════════════════════════════════════════════════════
//  §1  TILE / PIXEL CONSTANTS
// ══════════════════════════════════════════════════════════════════

// Island tile bounds (both inclusive)
const ISL_X1 = 152, ISL_Y1 = 152;
const ISL_X2 = 172, ISL_Y2 = 172;

// Water zone starts at x>122 && y>122 (from world.js buildWorld)
const ISL_SEA_X = 123, ISL_SEA_Y = 123;

// Island road grid: one cross-island road at y=165-166 and x=165-166
// Entry perimeter roads auto-exist at island edges from bridge continuation
const ISL_HR = [165];   // interior horizontal road row
const ISL_VR = [165];   // interior vertical road col

// West bridge: y=144-145, x=123→152 (reaches island west edge)
const ISL_BWX1 = 123, ISL_BWX2 = 152;
const ISL_BWY1 = 144, ISL_BWY2 = 145;

// North bridge: x=144-145, y=123→152 (reaches island north edge)
const ISL_BNX1 = 144, ISL_BNX2 = 145;
const ISL_BNY1 = 123, ISL_BNY2 = 152;

// Island world-pixel bounds (for player position checks)
const ISL_WX1 = ISL_X1 * T,       ISL_WY1 = ISL_Y1 * T;
const ISL_WX2 = (ISL_X2 + 1) * T, ISL_WY2 = (ISL_Y2 + 1) * T;


// ══════════════════════════════════════════════════════════════════
//  §2  ZONE DEFINITIONS  (3×3 grid between two roads)
//
//  Road pairs split island into 3 column bands and 3 row bands:
//    West col  x=152-159  Center col x=163-168  East col x=170-172
//    North row y=152-159  Middle row y=163-168   South row y=170-172
// ══════════════════════════════════════════════════════════════════

// Island 152-172. Entry roads at edges (x=152,y=152) from bridges.
// Interior dividing roads: x=165-166 and y=165-166.
// 2 column bands: West x=152-163, East x=167-172
// 2 row bands:    North y=152-163, South y=167-172
// Centre strip (x=164-166, y=164-166) = road/intersection area
const ISLAND_ZONES = {
  // ── North row ────────────────────────────────────────────────
  beach:     { x1:152, y1:152, x2:163, y2:163, name:'BEACH RESORT'    },
  mansion:   { x1:152, y1:152, x2:163, y2:163, name:'CARTEL MANSION'  },
  casino:    { x1:167, y1:152, x2:172, y2:163, name:'CASINO'          },
  // ── South row ────────────────────────────────────────────────
  black_mkt: { x1:152, y1:167, x2:163, y2:172, name:'BLACK MARKET'    },
  airstrip:  { x1:152, y1:167, x2:163, y2:172, name:'AIRSTRIP'        },
  drug_lab:  { x1:167, y1:167, x2:172, y2:172, name:'DRUG LAB'        },
  // ── Aliases (centre zones share space) ───────────────────────
  cartel_hq: { x1:152, y1:167, x2:163, y2:172, name:'CARTEL HQ'       },
  fight_club:{ x1:167, y1:152, x2:172, y2:163, name:'FIGHT CLUB'      },
  docks:     { x1:167, y1:167, x2:172, y2:172, name:'SMUGGLER DOCKS'  },
};

// Register in SPECIAL_ZONES so getSpecial() returns them
Object.entries(ISLAND_ZONES).forEach(([k, z]) => {
  if (typeof SPECIAL_ZONES !== 'undefined')
    SPECIAL_ZONES['isl_' + k] = { ...z, key: 'isl_' + k, isIsland: true };
});

// Add island to NZONES so zone labels appear on full map
if (typeof NZONES !== 'undefined') {
  NZONES.push({
    name: 'CARTEL COVE',
    x1: 123, y1: 123, x2: 175, y2: 175,
    den: 0.30, bc: '#1a3010',
  });
}

// Zone area tags shown in game HUD
const ISL_ZONE_TAGS = {
  isl_beach:     '[ BEACH RESORT ] PARADISE AWAITS',
  isl_mansion:   '[ CARTEL MANSION ] PRIVATE PROPERTY',
  isl_casino:    '[ CASINO ] HIGH STAKES — HIGH RISK',
  isl_black_mkt: '[ BLACK MARKET ] BACK-ALLEY DEALS',
  isl_airstrip:  '[ AIRSTRIP ] SMUGGLER RUNWAY',
  isl_drug_lab:  '[ DRUG LAB ] TOXIC ZONE',
  isl_cartel_hq: '[ CARTEL HQ ] ⚠ EXTREME DANGER',
  isl_fight_club:'[ FIGHT CLUB ] UNDERGROUND ARENA',
  isl_docks:     '[ DOCKS ] SMUGGLER HARBOUR',
};


// ══════════════════════════════════════════════════════════════════
//  §3  ISLAND MISSIONS  (6 missions injected into missions.js arrays)
// ══════════════════════════════════════════════════════════════════

if (typeof MISSION_ZONES !== 'undefined') {
  MISSION_ZONES.push(
    { x1:167,y1:152,x2:172,y2:158, missionId:'casino_heist',   name:'CASINO VAULT',
      npc:{ label:'K', col:'#f0c040', dialogue:[
        '"The vault has eight guards. None of them are paid enough to die — but they will."',
        '"I\'ve got the schematics. You go in loud, crack it fast, get out before the alarms reset."',
        '"Split is sixty-forty. You do the bleeding, I do the planning. Deal?"',
      ]}},
    { x1:152,y1:167,x2:158,y2:172, missionId:'cartel_boss',    name:'CARTEL HIDEOUT',
      npc:{ label:'R', col:'#e04040', dialogue:[
        '"El Jefe thinks this island is untouchable. That ends today."',
        '"He\'s in the fortress, surrounded by his heavies. Only one way in."',
        '"Bring me proof he\'s gone and you\'ll never need to work again."',
      ]}},
    { x1:167,y1:167,x2:172,y2:172, missionId:'island_run',     name:'DOCKMASTER',
      npc:{ label:'D', col:'#40c0e0', dialogue:[
        '"Package is already loaded. You just need to move it before the tide turns."',
        '"Take the east bridge. Your contact on the mainland will be waiting eighty seconds."',
        '"Don\'t stop. Don\'t open it. And don\'t come back without the handshake."',
      ]}},
    { x1:152,y1:167,x2:158,y2:172, missionId:'airstrip_heist', name:'RUNWAY INTEL',
      npc:{ label:'A', col:'#80e060', dialogue:[
        '"There\'s a shipment landing on the strip in minutes. Cartel. Ten men minimum."',
        '"I need them gone before the cargo gets transferred. Clean sweep."',
        '"You do this, the airstrip is yours to use. That\'s worth more than the cash."',
      ]}},
    { x1:167,y1:152,x2:172,y2:158, missionId:'fight_champion', name:'FIGHT PROMOTER',
      npc:{ label:'F', col:'#e080c0', dialogue:[
        '"You want the underground title? Earn it. Get the island hot — three stars."',
        '"Then make it to the docks alive. The crowd needs to know you\'re the real thing."',
        '"Every fighter who tried this ended up in the ocean. You won\'t. Probably."',
      ]}},
    { x1:167,y1:167,x2:172,y2:172, missionId:'drug_bust',      name:'UNDERCOVER OP',
      npc:{ label:'U', col:'#a060e0', dialogue:[
        '"I\'m not a cop. I\'m just someone who wants the lab burned down."',
        '"Twelve targets inside. Don\'t ask questions, don\'t leave witnesses."',
        '"When it\'s done, leave through the north bridge. I\'ll transfer payment remotely."',
      ]}},
  );
}

if (typeof MISSION_DEFS !== 'undefined') {
  MISSION_DEFS.casino_heist = {
    name: 'CASINO HEIST',
    desc: 'Fight through 8 cartel guards and crack the vault.',
    reward: 2500, wantedPenalty: 3,
    type: 'rampage', target: 'gang', timerMax: 60, count: 8,
  };
  MISSION_DEFS.cartel_boss = {
    name: 'TAKE DOWN THE BOSS',
    desc: 'Eliminate the cartel boss hiding in his island fortress.',
    reward: 3200, wantedPenalty: 2,
    type: 'elimination', timerMax: null, count: 1,
  };
  MISSION_DEFS.island_run = {
    name: 'CONTRABAND RUN',
    desc: 'Smuggle a package from the docks to a mainland contact.',
    reward: 1600, wantedPenalty: 0,
    type: 'delivery', timerMax: 80, count: 1,
  };
  MISSION_DEFS.airstrip_heist = {
    name: 'AIRSTRIP AMBUSH',
    desc: 'The cartel is moving product at the airstrip. Take out 10.',
    reward: 2200, wantedPenalty: 2,
    type: 'rampage', target: 'gang', timerMax: 70, count: 10,
  };
  MISSION_DEFS.fight_champion = {
    name: 'UNDERGROUND CHAMPION',
    desc: 'Reach 3+ wanted stars on the island and escape to the docks.',
    reward: 2800, wantedPenalty: 0,
    type: 'escape', timerMax: null, count: 1,
  };
  MISSION_DEFS.drug_bust = {
    name: 'DRUG BUST',
    desc: 'NARCO task force: eliminate 12 cartel in the drug lab.',
    reward: 3000, wantedPenalty: 1,
    type: 'rampage', target: 'gang', timerMax: 90, count: 12,
  };
}


// ══════════════════════════════════════════════════════════════════
//  §4  WORLD PATCHING — called immediately at parse time
//      buildWorld() in world.js already ran, so we overwrite WD[][]
// ══════════════════════════════════════════════════════════════════

function _patchIsland() {
  const iz = ISLAND_ZONES;

  // ── 1. Island base: water → tropical grass ───────────────────
  for (let y = ISL_Y1; y <= ISL_Y2; y++)
    for (let x = ISL_X1; x <= ISL_X2; x++) {
      WD[y][x] = 0;
      BC[y][x] = '#1e3610';
    }

  // ── 2. Zone-flavoured tile fills (before roads overwrite them) ─
  _isfill(iz.beach.x1,     iz.beach.y1,     iz.beach.x2,     iz.beach.y2,     4); // park/sand
  _isfill(iz.mansion.x1,   iz.mansion.y1,   iz.mansion.x2,   iz.mansion.y2,   0); // grass
  _isfill(iz.casino.x1,    iz.casino.y1,    iz.casino.x2,    iz.casino.y2,    9); // shop-gold
  _isfill(iz.black_mkt.x1, iz.black_mkt.y1, iz.black_mkt.x2, iz.black_mkt.y2, 0); // grass
  _isfill(iz.airstrip.x1,  iz.airstrip.y1,  iz.airstrip.x2,  iz.airstrip.y2,  3); // concrete
  _isfill(iz.drug_lab.x1,  iz.drug_lab.y1,  iz.drug_lab.x2,  iz.drug_lab.y2,  2); // building
  _isfill(iz.cartel_hq.x1, iz.cartel_hq.y1, iz.cartel_hq.x2, iz.cartel_hq.y2, 7); // gang-red
  _isfill(iz.fight_club.x1,iz.fight_club.y1,iz.fight_club.x2,iz.fight_club.y2, 3); // concrete
  _isfill(iz.docks.x1,     iz.docks.y1,     iz.docks.x2,     iz.docks.y2,     3); // planks

  // ── 3. Island road grid ────────────────────────────────────
  for (let y = ISL_Y1; y <= ISL_Y2; y++)
    for (let x = ISL_X1; x <= ISL_X2; x++)
      if (ISL_HR.includes(y) || ISL_HR.includes(y - 1) ||
          ISL_VR.includes(x) || ISL_VR.includes(x - 1))
        WD[y][x] = 1;

  // Entry corridors: bridge road y=144-145 and x=144-145 continue into island perimeter
  for (let x = ISL_X1; x <= ISL_X2; x++) {
    WD[ISL_Y1][x]     = 1; // north edge road
    WD[ISL_Y1 + 1][x] = 1;
  }
  for (let y = ISL_Y1; y <= ISL_Y2; y++) {
    WD[y][ISL_X1]     = 1; // west edge road
    WD[y][ISL_X1 + 1] = 1;
  }

  // ── 4. Sidewalk fringe around roads ──────────────────────────
  for (let y = ISL_Y1; y <= ISL_Y2; y++)
    for (let x = ISL_X1; x <= ISL_X2; x++) {
      if (WD[y][x] !== 0 && WD[y][x] !== 4) continue;
      if (_isladj(x, y, 1)) WD[y][x] = 3;
    }

  // ── 5. Buildings: sparse pseudo-random fill on remaining grass ─
  for (let y = ISL_Y1; y <= ISL_Y2; y++)
    for (let x = ISL_X1; x <= ISL_X2; x++)
      if (WD[y][x] === 0 && (x * 97 + y * 53) % 100 < 25)
        WD[y][x] = 2;

  // ── 6. West bridge + connector (y=144-145, x=123→ISL_X1) ──────
  for (let y = ISL_BWY1; y <= ISL_BWY2; y++)
    for (let x = ISL_BWX1; x <= ISL_X1; x++)
      WD[y][x] = 1;

  // Connector: join bridge row to island west-edge perimeter road
  for (let y = ISL_BWY1; y <= ISL_Y1 + 1; y++) {
    if (y >= 0 && y < WH) { WD[y][ISL_X1] = 1; WD[y][ISL_X1 + 1] = 1; }
  }

  // ── 7. North bridge + connector (x=144-145, y=123→ISL_Y1) ─────
  for (let x = ISL_BNX1; x <= ISL_BNX2; x++)
    for (let y = ISL_BNY1; y <= ISL_Y1; y++)
      WD[y][x] = 1;

  // Connector: join bridge col to island north-edge perimeter road
  for (let x = ISL_BNX1; x <= ISL_X1 + 1; x++) {
    if (x >= 0 && x < WW) { WD[ISL_Y1][x] = 1; WD[ISL_Y1 + 1][x] = 1; }
  }

  console.log('[island_c v2] Cartel Cove patched — 9 zones active.');
}

function _isfill(x1, y1, x2, y2, type) {
  for (let y = y1; y < y2; y++)
    for (let x = x1; x < x2; x++)
      if (x >= 0 && y >= 0 && x < WW && y < WH) WD[y][x] = type;
}

function _isladj(x, y, r) {
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx === 0 && dy === 0) continue;
      const ny = y + dy, nx = x + dx;
      if (ny >= 0 && ny < WH && nx >= 0 && nx < WW && WD[ny][nx] === 1) return true;
    }
  return false;
}

// Patch tiles NOW (world.js buildWorld() has already run)
_patchIsland();
// Rebuild tile cache so safePatrolPt/randRoadPt see island roads + bridges
if (typeof _buildTileCache === 'function') _buildTileCache();


// ══════════════════════════════════════════════════════════════════
//  §5  CARTEL FACTION  (4 types added to GANG_DEFS)
//      All use the existing gangster AI in ai.js automatically.
//      Only spawn via _repopCartel() — not via standard repopGangs().
// ══════════════════════════════════════════════════════════════════

if (typeof GANG_DEFS !== 'undefined') {
  GANG_DEFS.cartel = {
    name:'PARADISE CARTEL', zone: ISLAND_ZONES.cartel_hq,
    col:'#c8a000', glowCol:'rgba(200,160,0,0.55)',
    hp:70, maxHp:70, spd:85,
    cashDrop:60, scoreWorth:150, symbol:'C',
  };
  GANG_DEFS.cartel_elite = {
    name:'CARTEL ELITE', zone: ISLAND_ZONES.casino,
    col:'#ff7700', glowCol:'rgba(255,120,0,0.65)',
    hp:110, maxHp:110, spd:78,
    cashDrop:90, scoreWorth:220, symbol:'★',
  };
  GANG_DEFS.cartel_heavy = {
    name:'CARTEL ENFORCER', zone: ISLAND_ZONES.cartel_hq,
    col:'#881100', glowCol:'rgba(200,0,0,0.70)',
    hp:180, maxHp:180, spd:58,
    cashDrop:120, scoreWorth:300, symbol:'H',
  };
  GANG_DEFS.cartel_sniper = {
    name:'CARTEL SCOUT', zone: ISLAND_ZONES.mansion,
    col:'#6622aa', glowCol:'rgba(140,40,200,0.60)',
    hp:55, maxHp:55, spd:100,
    cashDrop:80, scoreWorth:200, symbol:'S',
  };
}

const ISL_CARTEL_MAX = 20;
let _islCartelSpawnT = 0;

function _repopCartel() {
  if (typeof gangs === 'undefined' || typeof spawnGangster === 'undefined') return;

  const alive = gangs.filter(g =>
    g.faction && g.faction.startsWith('cartel') &&
    g.x >= ISL_WX1 && g.x <= ISL_WX2 &&
    g.y >= ISL_WY1 && g.y <= ISL_WY2
  ).length;
  if (alive >= ISL_CARTEL_MAX) return;

  const toSpawn = Math.min(4, ISL_CARTEL_MAX - alive);

  // Each zone spawns one type of cartel member
  const zoneTypes = [
    { zone: ISLAND_ZONES.cartel_hq,  factions: ['cartel', 'cartel_heavy'] },
    { zone: ISLAND_ZONES.casino,     factions: ['cartel_elite', 'cartel'] },
    { zone: ISLAND_ZONES.mansion,    factions: ['cartel_sniper','cartel'] },
    { zone: ISLAND_ZONES.drug_lab,   factions: ['cartel', 'cartel_elite'] },
    { zone: ISLAND_ZONES.airstrip,   factions: ['cartel', 'cartel_heavy'] },
    { zone: ISLAND_ZONES.docks,      factions: ['cartel', 'cartel_sniper']},
  ];

  for (let i = 0; i < toSpawn; i++) {
    const zt = zoneTypes[Math.floor(Math.random() * zoneTypes.length)];
    const sz = zt.zone;
    const faction = zt.factions[Math.random() < 0.28 ? 1 : 0];

    let tx, ty, tries = 0;
    do {
      tx = sz.x1 + Math.floor(Math.random() * (sz.x2 - sz.x1));
      ty = sz.y1 + Math.floor(Math.random() * (sz.y2 - sz.y1));
      tries++;
    } while (!isW(tx, ty) && tries < 50);
    if (!isW(tx, ty)) continue;

    spawnGangster(tx * T + T / 2, ty * T + T / 2, faction);
  }
}


// ══════════════════════════════════════════════════════════════════
//  §6  ISLAND EVENTS
//      • STORM — random 20s, screen darkens, cartel aggro boost
//      • AMBUSH — 12 cartel spawn around player
// ══════════════════════════════════════════════════════════════════

const ISL_EVENT = { NONE:0, STORM:1, AMBUSH:2 };
let _islEventType  = ISL_EVENT.NONE;
let _islEventTimer = 0;      // remaining seconds of active event
let _islEventCD    = 60;     // seconds until next event can trigger
let _islStormAlpha = 0;      // current storm overlay opacity (0-0.45)

function _triggerEvent(type) {
  _islEventType  = type;
  _islEventTimer = type === ISL_EVENT.STORM ? 22 : 0.1;
  _islEventCD    = 50 + Math.random() * 40;

  if (type === ISL_EVENT.STORM) {
    if (typeof showNotif === 'function') showNotif('⛈ STORM OVER CARTEL COVE!');
    // Spawn 6 extra cartel during storm
    for (let i = 0; i < 6; i++) _spawnAmbushGang();
  }
  if (type === ISL_EVENT.AMBUSH) {
    if (typeof showNotif === 'function') showNotif('🚨 CARTEL AMBUSH! THEY\'RE EVERYWHERE!');
    for (let i = 0; i < 12; i++) _spawnAmbushGang();
  }
}

function _spawnAmbushGang() {
  if (typeof spawnGangster === 'undefined') return;
  const a  = Math.random() * Math.PI * 2;
  const r  = 160 + Math.random() * 180;
  let   wx = PL.x + Math.cos(a) * r;
  let   wy = PL.y + Math.sin(a) * r;
  // Clamp to island bounds
  wx = Math.max(ISL_WX1 + T, Math.min(ISL_WX2 - T, wx));
  wy = Math.max(ISL_WY1 + T, Math.min(ISL_WY2 - T, wy));
  const tx = Math.floor(wx / T), ty = Math.floor(wy / T);
  if (!isW(tx, ty)) return;
  const types = ['cartel', 'cartel_elite', 'cartel_sniper'];
  spawnGangster(wx, wy, types[Math.floor(Math.random() * types.length)]);
}

function _updateEvents(dt, onIsland) {
  if (!onIsland) {
    _islEventTimer = 0;
    _islEventType  = ISL_EVENT.NONE;
    _islStormAlpha = Math.max(0, _islStormAlpha - dt * 0.5);
    return;
  }

  // Active event countdown
  if (_islEventTimer > 0) {
    _islEventTimer -= dt;
    if (_islEventTimer <= 0) {
      _islEventType = ISL_EVENT.NONE;
      if (typeof showNotif === 'function') showNotif('EVENT OVER — STAY SHARP');
    }
  }

  // Storm overlay fade
  const targetAlpha = _islEventType === ISL_EVENT.STORM ? 0.45 : 0;
  _islStormAlpha += (targetAlpha - _islStormAlpha) * Math.min(1, dt * 1.2);

  // Trigger next event
  if (_islEventType === ISL_EVENT.NONE) {
    _islEventCD -= dt;
    if (_islEventCD <= 0) {
      _islEventCD = 55 + Math.random() * 45;
      _triggerEvent(Math.random() < 0.55 ? ISL_EVENT.STORM : ISL_EVENT.AMBUSH);
    }
  }
}


// ══════════════════════════════════════════════════════════════════
//  §7  ISLAND PICKUPS  (10 types, scattered across all zones)
// ══════════════════════════════════════════════════════════════════

const _islPicks = [];  // { x, y, bob, type, active, respawnMs }

const _ISL_PICK_DEFS = [
  // [ tx, ty, type, respawnMs ]
  // Ammo caches at road intersections (road tiles: 152,165 cross)
  [153, 153, 'ammo',       40000],
  [153, 165, 'ammo',       40000],
  [165, 153, 'ammo',       40000],
  [165, 165, 'ammo',       40000],
  // Gold casino chip in casino zone (top-right)
  [169, 154, 'gold_chip',  60000],
  [170, 156, 'gold_chip',  60000],
  // Medkits scattered around
  [154, 154, 'medkit',     50000],
  [168, 168, 'medkit',     50000],
  // Armor vest in cartel HQ (bottom-left)
  [154, 169, 'armor',      90000],
  // Drug cash in drug lab (bottom-right — adds wanted)
  [168, 169, 'drug_cash',  30000],
  [170, 168, 'drug_cash',  30000],
  [169, 170, 'drug_cash',  30000],
  // RPG crate on airstrip (mid-right)
  [169, 163, 'rpg_crate', 120000],
  // Beach rest (top-left)
  [154, 156, 'beach_rest', 45000],
  // Sniper kit in mansion (top-centre)
  [163, 154, 'sniper_kit', 80000],
];

function _spawnIslandPickups() {
  _islPicks.length = 0;
  for (const [tx, ty, type, respawnMs] of _ISL_PICK_DEFS) {
    _islPicks.push({
      x: tx * T + T / 2,
      y: ty * T + T / 2,
      bob: Math.random() * Math.PI * 2,
      type, respawnMs,
      active: true,
    });
  }
}

function _collectPick(p) {
  p.active = false;
  switch (p.type) {
    case 'ammo':
      if (typeof refillAll === 'function') refillAll();
      PL.cash += 100;
      if (typeof showNotif === 'function') showNotif('ISLAND CACHE — AMMO REFILLED + $100');
      break;
    case 'gold_chip':
      PL.cash  += 600;
      PL.score += 300;
      if (typeof showNotif === 'function') showNotif('💰 CASINO CHIP — +$600 +300PTS');
      break;
    case 'medkit':
      PL.hp = Math.min(PL.maxHp, PL.hp + 60);
      if (typeof showNotif === 'function') showNotif('🏥 ISLAND MEDKIT — +60 HP');
      break;
    case 'armor':
      PL.maxHp = Math.max(PL.maxHp, 150);
      PL.hp    = Math.min(150, PL.hp + 30);
      if (typeof showNotif === 'function') showNotif('🛡 ARMOR VEST — MAX HP 150');
      break;
    case 'drug_cash':
      PL.cash += 250;
      if (typeof addWanted === 'function') addWanted(1);
      if (typeof showNotif === 'function') showNotif('💊 DRUG CASH +$250 — COPS ALERTED ★');
      break;
    case 'rpg_crate':
      if (typeof giveW === 'function') giveW('rocket');
      if (typeof buildWHUD === 'function') buildWHUD();
      PL.cash += 200;
      if (typeof showNotif === 'function') showNotif('🚀 RPG CRATE — ROCKET LAUNCHER + $200');
      break;
    case 'beach_rest':
      PL.hp = Math.min(PL.maxHp, PL.hp + 30);
      PL.cash += 50;
      if (typeof showNotif === 'function') showNotif('🌴 BEACH REFRESH — +30HP +$50');
      break;
    case 'sniper_kit':
      if (typeof giveW === 'function') giveW('sniper');
      if (typeof buildWHUD === 'function') buildWHUD();
      PL.cash += 150;
      if (typeof showNotif === 'function') showNotif('🎯 SNIPER KIT — SNIPER RIFLE + $150');
      break;
  }
  // Schedule respawn
  setTimeout(() => {
    p.active = true;
    p.bob    = Math.random() * Math.PI * 2;
  }, p.respawnMs);
}


// ══════════════════════════════════════════════════════════════════
//  §8  FIGHT CLUB SYSTEM
//      Enter zone → wave of 5 cartel spawns → bonus cash per kill
//      Up to 3 rounds, then 60s cooldown before next session
// ══════════════════════════════════════════════════════════════════

let _fcWave       = 0;    // 0 = idle, 1-3 = wave number
let _fcAlive      = 0;    // how many wave cartel are alive
let _fcCooldown   = 0;    // seconds until next session allowed
let _fcEntryT     = 0;    // dwell time in zone before wave starts (1.5s)
const FC_WAVE_SIZE   = 5;
const FC_WAVE_MAX    = 3;
const FC_BONUS_CASH  = 60;   // per kill bonus
const FC_WAVE_REWARD = 300;  // bonus on wave clear

function _updateFightClub(dt, onFightClub) {
  if (_fcCooldown > 0) { _fcCooldown -= dt; return; }

  if (!onFightClub) {
    _fcEntryT = 0;
    return;
  }

  // Idle: accumulate dwell time until wave starts
  if (_fcWave === 0) {
    _fcEntryT += dt;
    if (_fcEntryT < 1.5) return;
    _fcEntryT = 0;
    _fcWave   = 1;
    _fcAlive  = 0;
    _spawnFCWave();
    if (typeof showNotif === 'function') showNotif('🥊 FIGHT CLUB WAVE 1 — SURVIVE!');
    return;
  }

  // Count how many fight-club cartel are still alive
  if (typeof gangs !== 'undefined') {
    const fz = ISLAND_ZONES.fight_club;
    _fcAlive = gangs.filter(g => g.faction && g.faction.startsWith('cartel') &&
      g.x >= fz.x1 * T && g.x <= fz.x2 * T &&
      g.y >= fz.y1 * T && g.y <= fz.y2 * T).length;
  }

  // Wave cleared
  if (_fcAlive === 0 && _fcWave > 0) {
    PL.cash  += FC_WAVE_REWARD;
    PL.score += FC_WAVE_REWARD / 2;
    if (_fcWave < FC_WAVE_MAX) {
      _fcWave++;
      _spawnFCWave();
      if (typeof showNotif === 'function')
        showNotif('🥊 WAVE ' + _fcWave + ' — +$' + FC_WAVE_REWARD + ' BONUS!');
    } else {
      // All waves done
      PL.cash  += 500;   // championship bonus
      PL.score += 400;
      _fcWave     = 0;
      _fcCooldown = 60;
      if (typeof showNotif === 'function')
        showNotif('🏆 FIGHT CHAMPION — +$500 +400PTS BONUS!');
    }
  }
}

function _spawnFCWave() {
  if (typeof spawnGangster === 'undefined') return;
  const fz = ISLAND_ZONES.fight_club;
  for (let i = 0; i < FC_WAVE_SIZE; i++) {
    const tx = fz.x1 + Math.floor(Math.random() * (fz.x2 - fz.x1));
    const ty = fz.y1 + Math.floor(Math.random() * (fz.y2 - fz.y1));
    if (!isW(tx, ty)) continue;
    const types = ['cartel', 'cartel_elite', 'cartel_heavy'];
    const faction = types[Math.min(i % 3, types.length - 1)];
    spawnGangster(tx * T + T / 2, ty * T + T / 2, faction);
  }
}


// ══════════════════════════════════════════════════════════════════
//  §9  DOCK ESCAPE  (5s dwell at ★2+ → lose 2 wanted stars, 45s CD)
// ══════════════════════════════════════════════════════════════════

let _dockEscCD   = 0;
let _dockEscProg = 0;  // 0→5

function _updateDockEscape(dt, onDocks) {
  if (_dockEscCD > 0) { _dockEscCD -= dt; _dockEscProg = 0; return; }
  if (!onDocks || PL.wanted < 2) { _dockEscProg = 0; return; }

  _dockEscProg += dt;
  const pct = Math.floor((_dockEscProg / 5) * 100);
  const el  = document.getElementById('areaTag');
  if (el) el.textContent = '[ DOCKS ] ESCAPING VIA BOAT... ' + pct + '%';

  if (_dockEscProg >= 5) {
    _dockEscProg = 0;
    _dockEscCD   = 45;
    const lost   = Math.min(2, PL.wanted);
    PL.wanted    = Math.max(0, PL.wanted - lost);
    if (typeof despawnExcessCops === 'function') despawnExcessCops();
    if (typeof spawnPts === 'function') spawnPts(PL.x, PL.y, '#00eeff', 14);
    if (typeof showNotif === 'function')
      showNotif('⛵ SPEEDBOAT OUT! HEAT DROPPED ' + lost + '★ (45s CD)');
  }
}


// ══════════════════════════════════════════════════════════════════
//  §10  LIGHTHOUSE BRIBE  (4s near lighthouse → drop 1 star, 60s CD)
//       Lighthouse is at the NE corner of the island: tile (148, 126)
// ══════════════════════════════════════════════════════════════════

const ISL_LIGHTHOUSE_WX = 172 * T + T / 2;
const ISL_LIGHTHOUSE_WY = 152 * T + T / 2;
const ISL_LH_RANGE = 72;   // px — how close player must be
let _lhBribeCD   = 0;
let _lhBribeProg = 0;       // 0→4
let _lhBeamAngle = 0;       // rotates every frame

function _updateLighthouse(dt) {
  _lhBeamAngle += dt * 0.8;
  if (_lhBribeCD > 0) { _lhBribeCD -= dt; _lhBribeProg = 0; return; }
  if (PL.wanted === 0) { _lhBribeProg = 0; return; }

  const near = d2(PL.x, PL.y, ISL_LIGHTHOUSE_WX, ISL_LIGHTHOUSE_WY) < ISL_LH_RANGE * ISL_LH_RANGE;
  if (!near) { _lhBribeProg = 0; return; }

  _lhBribeProg += dt;
  const pct = Math.floor((_lhBribeProg / 4) * 100);
  const el  = document.getElementById('areaTag');
  if (el) el.textContent = '[ LIGHTHOUSE ] BRIBING KEEPER... ' + pct + '%';

  if (_lhBribeProg >= 4) {
    _lhBribeProg = 0;
    _lhBribeCD   = 60;
    PL.wanted    = Math.max(0, PL.wanted - 1);
    PL.cash      = Math.max(0, PL.cash - 300);
    if (typeof despawnExcessCops === 'function') despawnExcessCops();
    if (typeof showNotif === 'function')
      showNotif('💡 LIGHTHOUSE KEEPER BRIBED — 1★ CLEARED, -$300');
  }
}


// ══════════════════════════════════════════════════════════════════
//  §11  BLACK MARKET  (entering the zone opens the shop)
// ══════════════════════════════════════════════════════════════════

let _bmWasIn = false;

function _updateBlackMarket(onBlackMkt) {
  if (onBlackMkt && !_bmWasIn) {
    if (typeof openShop === 'function') {
      openShop();
      if (typeof showNotif === 'function') showNotif('🔫 BLACK MARKET — BACK-ALLEY DEALS');
    }
  }
  _bmWasIn = onBlackMkt;
}


// ══════════════════════════════════════════════════════════════════
//  §12  MODULE STATE
// ══════════════════════════════════════════════════════════════════

let _islHudEl         = null;
let _islArriveBanner  = 0;     // countdown for arrival banner (s)
let _islZoneBanner    = 0;     // countdown for zone-change banner (s)
let _islZoneBannerTxt = '';
let _wasOnIsland      = false;
let _lastZoneKey      = '';


// ══════════════════════════════════════════════════════════════════
//  §13  MINIMAP PATCH
// ══════════════════════════════════════════════════════════════════

function _patchIslandMinimap() {
  if (typeof mmBC === 'undefined') return;

  const TCOL_MAP = {
    0:'#1e3610', 1:'#555', 2:'#2a2a2a', 3:'#3a3a30',
    4:'#3a5a1a', 7:'#3a0808', 9:'#3a1800',
  };

  for (let ty = ISL_Y1; ty <= ISL_Y2; ty++)
    for (let tx = ISL_X1; tx <= ISL_X2; tx++) {
      mmBC.fillStyle = TCOL_MAP[WD[ty][tx]] || '#1e3610';
      mmBC.fillRect(tx, ty, 1, 1);
    }

  // Bridge tiles
  mmBC.fillStyle = '#555';
  for (let y = ISL_BWY1; y <= ISL_BWY2; y++)
    for (let x = ISL_BWX1; x <= ISL_BWX2; x++) mmBC.fillRect(x, y, 1, 1);
  for (let x = ISL_BNX1; x <= ISL_BNX2; x++)
    for (let y = ISL_BNY1; y <= ISL_BNY2; y++) mmBC.fillRect(x, y, 1, 1);

  // Zone colour overlays (tiny but visible)
  const ZC = [
    [ISLAND_ZONES.beach,     'rgba(80,200,80,0.7)' ],
    [ISLAND_ZONES.mansion,   'rgba(200,160,80,0.7)'],
    [ISLAND_ZONES.casino,    'rgba(220,180,0,0.9)' ],
    [ISLAND_ZONES.black_mkt, 'rgba(60,60,60,0.85)' ],
    [ISLAND_ZONES.airstrip,  'rgba(120,120,180,0.8)'],
    [ISLAND_ZONES.drug_lab,  'rgba(0,180,80,0.7)'  ],
    [ISLAND_ZONES.cartel_hq, 'rgba(200,20,20,0.9)' ],
    [ISLAND_ZONES.fight_club,'rgba(220,80,0,0.85)' ],
    [ISLAND_ZONES.docks,     'rgba(40,120,200,0.85)'],
  ];
  for (const [z, col] of ZC) {
    mmBC.fillStyle = col;
    mmBC.fillRect(z.x1, z.y1, z.x2 - z.x1, z.y2 - z.y1);
  }
}


// ══════════════════════════════════════════════════════════════════
//  §14  ISLAND HUD ELEMENT
// ══════════════════════════════════════════════════════════════════

function _createIslandHUD() {
  if (document.getElementById('islHud')) {
    _islHudEl = document.getElementById('islHud');
    return;
  }
  _islHudEl = document.createElement('div');
  _islHudEl.id = 'islHud';
  Object.assign(_islHudEl.style, {
    position:'absolute',
    bottom:'calc(var(--ctrl-h, 155px) + 80px)',
    left:'12px',
    background:'rgba(5,8,18,0.90)',
    border:'1px solid rgba(200,160,0,0.40)',
    borderRadius:'4px', padding:'4px 10px',
    fontFamily:"'Share Tech Mono',monospace",
    fontSize:'9px', letterSpacing:'2px',
    color:'rgba(200,160,0,0.9)', lineHeight:'1.7',
    pointerEvents:'none', zIndex:'11', display:'none',
    minWidth:'120px', maxWidth:'160px',
  });
  const gc = document.getElementById('gc');
  if (gc) gc.appendChild(_islHudEl);
}

function _updateIslandHUD(onIsland, ptx, pty) {
  if (!_islHudEl) return;
  if (!onIsland) { _islHudEl.style.display = 'none'; return; }

  const cc = (typeof gangs !== 'undefined')
    ? gangs.filter(g => g.faction && g.faction.startsWith('cartel')).length
    : 0;

  const dockLine = _dockEscCD > 0
    ? 'DOCK ESC: ' + Math.ceil(_dockEscCD) + 's'
    : 'DOCK ESC: READY (★2+)';
  const lhLine = _lhBribeCD > 0
    ? 'LIGHTHOUSE: ' + Math.ceil(_lhBribeCD) + 's'
    : PL.wanted > 0 ? 'LIGHTHOUSE: READY (NEAR)' : 'LIGHTHOUSE: —';
  const fcLine = _fcCooldown > 0
    ? 'FIGHT CLUB: ' + Math.ceil(_fcCooldown) + 's'
    : _fcWave > 0 ? 'FIGHT CLUB: WAVE ' + _fcWave + '/3'
    : 'FIGHT CLUB: ENTER ZONE';
  const evLine = _islEventType === ISL_EVENT.STORM ? '⛈ STORM ACTIVE'
    : _islEventType === ISL_EVENT.AMBUSH ? '🚨 AMBUSH!'
    : '☀ CLEAR';

  _islHudEl.style.display = 'block';
  _islHudEl.innerHTML =
    '🏝 CARTEL COVE<br>' +
    'CARTEL: ' + cc + ' ACTIVE<br>' +
    dockLine + '<br>' +
    lhLine   + '<br>' +
    fcLine   + '<br>' +
    evLine;
}


// ══════════════════════════════════════════════════════════════════
//  §15  PUBLIC API
// ══════════════════════════════════════════════════════════════════

function initIsland() {
  _islCartelSpawnT = 0;
  _dockEscCD       = 0; _dockEscProg = 0;
  _lhBribeCD       = 0; _lhBribeProg = 0; _lhBeamAngle = 0;
  _fcWave = 0; _fcAlive = 0; _fcCooldown = 0; _fcEntryT = 0;
  _islEventType = ISL_EVENT.NONE; _islEventTimer = 0;
  _islEventCD   = 55 + Math.random() * 40; _islStormAlpha = 0;
  _islArriveBanner = 0; _islZoneBanner = 0; _islZoneBannerTxt = '';
  _wasOnIsland = false; _lastZoneKey = ''; _bmWasIn = false;
  _patchIslandMinimap();
  _createIslandHUD();
  _spawnIslandPickups();
  _repopCartel();
  // Rebuild tile cache so safePatrolPt/randRoadPt see island roads
  if (typeof _buildTileCache === 'function') _buildTileCache();
  console.log('[island_c v2] Cartel Cove initialised.');
}

function resetIsland() {
  _islCartelSpawnT = 0;
  _dockEscCD = 0; _dockEscProg = 0;
  _lhBribeCD = 0; _lhBribeProg = 0; _lhBeamAngle = 0;
  _fcWave = 0; _fcAlive = 0; _fcCooldown = 0; _fcEntryT = 0;
  _islEventType = ISL_EVENT.NONE; _islEventTimer = 0;
  _islEventCD   = 55 + Math.random() * 40; _islStormAlpha = 0;
  _islArriveBanner = 0; _islZoneBanner = 0; _islZoneBannerTxt = '';
  _wasOnIsland = false; _lastZoneKey = ''; _bmWasIn = false;
  _patchIslandMinimap();
  _spawnIslandPickups();
  setTimeout(_repopCartel, 280);
}

function updateIsland(dt) {
  // ── Cartel repop ────────────────────────────────────────────
  _islCartelSpawnT += dt;
  if (_islCartelSpawnT >= 10) { _islCartelSpawnT = 0; _repopCartel(); }

  // ── Player state ────────────────────────────────────────────
  const ptx = Math.floor(PL.x / T);
  const pty = Math.floor(PL.y / T);
  // Player is "on island" if inside island bounds OR on either bridge
  const onBridgeW = pty >= ISL_BWY1 && pty <= ISL_BWY2 && ptx >= ISL_BWX1 && ptx <= ISL_X1;
  const onBridgeN = ptx >= ISL_BNX1 && ptx <= ISL_BNX2 && pty >= ISL_BNY1 && pty <= ISL_Y1;
  const onIsland  = (PL.x >= ISL_WX1 && PL.x <= ISL_WX2 &&
                     PL.y >= ISL_WY1 && PL.y <= ISL_WY2)
                 || onBridgeW || onBridgeN;

  // ── Zone detection ───────────────────────────────────────────
  let curZoneKey = '';
  if (onIsland) {
    for (const [k, z] of Object.entries(ISLAND_ZONES)) {
      if (ptx >= z.x1 && ptx < z.x2 && pty >= z.y1 && pty < z.y2) {
        curZoneKey = 'isl_' + k; break;
      }
    }
    // Update area tag if inside a zone
    if (curZoneKey) {
      const el = document.getElementById('areaTag');
      if (el) el.textContent = ISL_ZONE_TAGS[curZoneKey] || '[ CARTEL COVE ]';
    }
  }

  // ── Zone-change banner ───────────────────────────────────────
  if (curZoneKey && curZoneKey !== _lastZoneKey && _lastZoneKey !== '') {
    const z = ISLAND_ZONES[curZoneKey.replace('isl_', '')];
    if (z) {
      _islZoneBannerTxt = z.name;
      _islZoneBanner    = 2.2;
    }
  }
  _lastZoneKey = curZoneKey;
  if (_islZoneBanner > 0) _islZoneBanner -= dt;

  // ── Arrival banner ───────────────────────────────────────────
  if (onIsland && !_wasOnIsland) {
    _islArriveBanner = 4.0;
    if (typeof showNotif === 'function') showNotif('🏝 WELCOME TO CARTEL COVE!');
  }
  _wasOnIsland = onIsland;
  if (_islArriveBanner > 0) _islArriveBanner -= dt;

  // ── Sub-system updates ───────────────────────────────────────
  _updateEvents(dt, onIsland);
  _updateLighthouse(dt);

  if (onIsland) {
    const dz = ISLAND_ZONES.docks;
    const onDocks = ptx >= dz.x1 && ptx < dz.x2 && pty >= dz.y1 && pty < dz.y2;
    _updateDockEscape(dt, onDocks);

    const fz = ISLAND_ZONES.fight_club;
    const onFC = ptx >= fz.x1 && ptx < fz.x2 && pty >= fz.y1 && pty < fz.y2;
    _updateFightClub(dt, onFC);

    const bz = ISLAND_ZONES.black_mkt;
    const onBM = ptx >= bz.x1 && ptx < bz.x2 && pty >= bz.y1 && pty < bz.y2;
    _updateBlackMarket(onBM);
  } else {
    _updateDockEscape(dt, false);
    _updateBlackMarket(false);
  }

  // ── Island HUD ───────────────────────────────────────────────
  _updateIslandHUD(onIsland, ptx, pty);

  // ── Pickups ──────────────────────────────────────────────────
  for (const p of _islPicks) {
    if (!p.active) continue;
    p.bob += dt * 2.6;
    if (d2(p.x, p.y, PL.x, PL.y) < 22 * 22) _collectPick(p);
  }
}

// ── renderIsland  (call from game.js render after architecture) ──
function renderIsland(CX, cam, W, H, now) {
  // Frustum cull — skip if water zone entirely off screen
  const vx0 = cam.x - W / 2, vy0 = cam.y - H / 2;
  const vx1 = cam.x + W / 2, vy1 = cam.y + H / 2;
  const seaPxX = ISL_SEA_X * T, seaPxY = ISL_SEA_Y * T;
  if (ISL_WX2 + T * 6 < vx0 || seaPxX > vx1 ||
      ISL_WY2 + T * 6 < vy0 || seaPxY > vy1) {
    if (_islArriveBanner > 0 || _islZoneBanner > 0)
      _renderBanners(CX, W, H);
    return;
  }

  // Coordinate helpers
  const stx = tx => (tx * T - cam.x) + W / 2;
  const sty = ty => (ty * T - cam.y) + H / 2;
  const swx = wx => (wx       - cam.x) + W / 2;
  const swy = wy => (wy       - cam.y) + H / 2;

  // Visible tile range clamped to sea zone
  const tx0 = Math.max(ISL_SEA_X, Math.floor((cam.x - W/2) / T) - 1);
  const ty0 = Math.max(ISL_SEA_Y, Math.floor((cam.y - H/2) / T) - 1);
  const tx1 = Math.min(149,        Math.ceil ((cam.x + W/2) / T) + 1);
  const ty1 = Math.min(149,        Math.ceil ((cam.y + H/2) / T) + 1);

  CX.save();

  _renderOcean      (CX, stx, sty, tx0, ty0, tx1, ty1, now);
  _renderBridges    (CX, stx, sty, now);
  _renderPalms      (CX, stx, sty, tx0, ty0, tx1, ty1, now);
  _renderBeach      (CX, stx, sty, now);
  _renderMansion    (CX, stx, sty, now);
  _renderCasino     (CX, stx, sty, now);
  _renderBlackMkt   (CX, stx, sty, now);
  _renderAirstrip   (CX, stx, sty, now);
  _renderDrugLab    (CX, stx, sty, now);
  _renderCartelHQ   (CX, stx, sty, now);
  _renderFightClub  (CX, stx, sty, now);
  _renderDocks      (CX, stx, sty, now, swx, swy);
  _renderLighthouse (CX, stx, sty, swx, swy, now);
  _renderIslandPicks(CX, swx, swy, W, H);

  // Storm overlay
  if (_islStormAlpha > 0.01) {
    CX.fillStyle = `rgba(20,10,50,${_islStormAlpha})`;
    CX.fillRect(0, 0, W, H);
    // Rain streaks
    const streaks = Math.floor(_islStormAlpha * 60);
    CX.strokeStyle = `rgba(140,180,255,${_islStormAlpha * 0.5})`;
    CX.lineWidth   = 1;
    for (let i = 0; i < streaks; i++) {
      const rx = (now / 18 + i * 173) % W;
      const ry = (now / 8  + i * 97)  % H;
      CX.beginPath();
      CX.moveTo(rx, ry);
      CX.lineTo(rx - 4, ry + 14);
      CX.stroke();
    }
  }

  CX.restore();

  // Banners drawn on top of everything
  _renderBanners(CX, W, H);
}


// ══════════════════════════════════════════════════════════════════
//  §16  RENDER HELPERS
// ══════════════════════════════════════════════════════════════════

// ── Ocean ─────────────────────────────────────────────────────
function _renderOcean(CX, stx, sty, tx0, ty0, tx1, ty1, now) {
  for (let ty = ty0; ty <= ty1; ty++) {
    if (!WD[ty]) continue;
    for (let tx = tx0; tx <= tx1; tx++) {
      if (WD[ty][tx] !== 5) continue;
      const sx = stx(tx), sy = sty(ty);
      const wave = Math.sin(now / 620 + tx * 0.38 + ty * 0.62) * 0.06;
      // Base water
      CX.fillStyle = `rgba(18,60,160,${0.24 + wave})`;
      CX.fillRect(sx, sy, T + 1, T + 1);
      // Foam streak
      if ((tx * 11 + ty * 7) % 6 === 0) {
        const fy = sy + ((ty * 19) % (T - 8)) + 4;
        const fw = Math.sin(now / 800 + tx + ty) * 6 + (T - 14);
        CX.strokeStyle = `rgba(160,215,255,${0.10 + wave * 1.5})`;
        CX.lineWidth   = 1;
        CX.beginPath(); CX.moveTo(sx + 4, fy); CX.lineTo(sx + 4 + fw, fy); CX.stroke();
      }
    }
  }
}

// ── Bridges ───────────────────────────────────────────────────
function _renderBridges(CX, stx, sty, now) {
  _drawBridge(CX,
    stx(ISL_BWX1), sty(ISL_BWY1),
    (ISL_BWX2 - ISL_BWX1 + 1) * T, (ISL_BWY2 - ISL_BWY1 + 1) * T,
    'h', 'CARTEL BRIDGE', now);
  _drawBridge(CX,
    stx(ISL_BNX1), sty(ISL_BNY1),
    (ISL_BNX2 - ISL_BNX1 + 1) * T, (ISL_BNY2 - ISL_BNY1 + 1) * T,
    'v', 'NORTH BRIDGE', now);
}

function _drawBridge(CX, bx, by, bw, bh, dir, label, now) {
  // Cable shadow
  CX.strokeStyle = 'rgba(80,60,20,0.6)'; CX.lineWidth = 3;
  CX.setLineDash([]);
  if (dir === 'h') {
    CX.beginPath(); CX.moveTo(bx, by + bh/2); CX.lineTo(bx + bw, by + bh/2); CX.stroke();
  } else {
    CX.beginPath(); CX.moveTo(bx + bw/2, by); CX.lineTo(bx + bw/2, by + bh); CX.stroke();
  }

  // Road surface already rendered by world tile renderer — just draw guardrails
  CX.setLineDash([8, 4]);
  CX.lineWidth = 2;
  const flick = 0.5 + 0.5 * Math.abs(Math.sin(now / 900));
  CX.strokeStyle = `rgba(255,255,255,${0.40 + flick * 0.15})`;
  if (dir === 'h') {
    CX.beginPath(); CX.moveTo(bx, by);      CX.lineTo(bx + bw, by);      CX.stroke();
    CX.beginPath(); CX.moveTo(bx, by + bh); CX.lineTo(bx + bw, by + bh); CX.stroke();
  } else {
    CX.beginPath(); CX.moveTo(bx,      by);       CX.lineTo(bx,      by + bh); CX.stroke();
    CX.beginPath(); CX.moveTo(bx + bw, by);       CX.lineTo(bx + bw, by + bh); CX.stroke();
  }
  CX.setLineDash([]);

  // Lamp posts every 32px
  CX.fillStyle = `rgba(200,140,0,${flick})`;
  const step = 32;
  if (dir === 'h') {
    for (let px = bx + 12; px < bx + bw - 8; px += step) {
      CX.fillRect(px, by - 4, 4, 5); CX.fillRect(px, by + bh - 1, 4, 5);
      // Lamp glow
      CX.shadowColor = 'rgba(255,200,80,0.6)'; CX.shadowBlur = 6;
      CX.fillStyle   = `rgba(255,220,100,${flick})`;
      CX.beginPath(); CX.arc(px + 2, by - 6, 3, 0, Math.PI * 2); CX.fill();
      CX.fillStyle = `rgba(200,140,0,${flick})`;
      CX.shadowBlur = 0;
    }
  } else {
    for (let py = by + 12; py < by + bh - 8; py += step) {
      CX.fillRect(bx - 4, py, 5, 4); CX.fillRect(bx + bw - 1, py, 5, 4);
      CX.shadowColor = 'rgba(255,200,80,0.6)'; CX.shadowBlur = 6;
      CX.fillStyle   = `rgba(255,220,100,${flick})`;
      CX.beginPath(); CX.arc(bx - 6, py + 2, 3, 0, Math.PI * 2); CX.fill();
      CX.fillStyle = `rgba(200,140,0,${flick})`;
      CX.shadowBlur = 0;
    }
  }

  // Bridge name
  CX.fillStyle    = 'rgba(255,240,160,0.40)';
  CX.font         = 'bold 7px monospace';
  CX.textAlign    = 'center';
  CX.textBaseline = 'middle';
  CX.fillText(label, bx + bw / 2, by + bh / 2);
  CX.textAlign = 'left'; CX.textBaseline = 'alphabetic';
}

// ── Palm trees ────────────────────────────────────────────────
function _renderPalms(CX, stx, sty, tx0, ty0, tx1, ty1, now) {
  for (let ty = Math.max(ISL_Y1, ty0); ty <= Math.min(ISL_Y2, ty1); ty++) {
    for (let tx = Math.max(ISL_X1, tx0); tx <= Math.min(ISL_X2, tx1); tx++) {
      const tt = WD[ty][tx];
      if (tt !== 0 && tt !== 4) continue;
      const seed = (tx * 137 + ty * 91) % 100;
      if (seed < 20)
        _drawPalm(CX, stx(tx) + T / 2, sty(ty) + T / 2, now + seed * 600);
    }
  }
}

function _drawPalm(CX, sx, sy, t) {
  CX.save();
  const lean = Math.sin(t / 2400) * 5;
  const tipX = sx + lean, tipY = sy - 22;

  // Trunk
  CX.strokeStyle = '#7a4a18'; CX.lineWidth = 3.5;
  CX.beginPath();
  CX.moveTo(sx, sy + 8);
  CX.quadraticCurveTo(sx + lean * 0.5, sy - 2, tipX, tipY);
  CX.stroke();

  // Fronds
  for (let i = 0; i < 7; i++) {
    const a  = (i / 7) * Math.PI * 2 + t / 5000;
    const fc = i % 2 === 0 ? '#2a8a12' : '#1a6c08';
    CX.strokeStyle = fc; CX.lineWidth = 2;
    CX.beginPath();
    CX.moveTo(tipX, tipY);
    CX.quadraticCurveTo(
      tipX + Math.cos(a) * 11, tipY + Math.sin(a) * 8,
      tipX + Math.cos(a) * 24, tipY + Math.sin(a) * 16
    );
    CX.stroke();
  }

  // Coconuts
  CX.fillStyle = '#7a4010';
  for (let i = 0; i < 3; i++) {
    const ca = (i / 3) * Math.PI * 2;
    CX.beginPath();
    CX.arc(tipX + Math.cos(ca) * 3.5, tipY + Math.sin(ca) * 3.5, 2.5, 0, Math.PI * 2);
    CX.fill();
  }
  CX.restore();
}

// ── Beach Resort ──────────────────────────────────────────────
function _renderBeach(CX, stx, sty, now) {
  const z   = ISLAND_ZONES.beach;
  const sx  = stx(z.x1), sy = sty(z.y1);
  const zw  = (z.x2 - z.x1) * T, zh = (z.y2 - z.y1) * T;
  const cx  = sx + zw / 2,   cy  = sy + zh / 2;
  CX.save();

  // Sandy fill
  CX.fillStyle = '#c8a050';
  CX.fillRect(sx + 2, sy + 2, zw - 4, zh - 4);

  // Animated wave at south edge
  const wOff = Math.sin(now / 750) * 4;
  CX.strokeStyle = 'rgba(140,200,255,0.6)';
  CX.lineWidth = 2.5; CX.setLineDash([7, 4]);
  CX.beginPath();
  CX.moveTo(sx + 4, sy + zh - 8 + wOff);
  CX.lineTo(sx + zw - 4, sy + zh - 8 + wOff);
  CX.stroke(); CX.setLineDash([]);

  // 2 umbrellas
  [[cx - 18, cy - 6], [cx + 16, cy + 8]].forEach(([ux, uy], i) => {
    CX.fillStyle = i === 0 ? 'rgba(200,20,20,0.7)' : 'rgba(20,100,200,0.7)';
    CX.beginPath(); CX.arc(ux, uy - 9, 11, Math.PI, 0); CX.fill();
    CX.fillStyle = i === 0 ? 'rgba(255,220,0,0.7)' : 'rgba(255,200,0,0.7)';
    CX.beginPath(); CX.arc(ux, uy - 9, 11, 0, Math.PI * 2 / 3); CX.fill();
    CX.strokeStyle = '#5a3a10'; CX.lineWidth = 1.5; CX.setLineDash([]);
    CX.beginPath(); CX.moveTo(ux, uy - 9); CX.lineTo(ux, uy + 7); CX.stroke();
  });

  // Beach label
  CX.fillStyle = 'rgba(50,30,10,0.65)';
  CX.font = '7px monospace'; CX.textAlign = 'center'; CX.textBaseline = 'middle';
  CX.fillText('BEACH RESORT', cx, cy + zh / 2 - 8);
  CX.textAlign = 'left'; CX.textBaseline = 'alphabetic';
  CX.restore();
}

// ── Cartel Mansion ────────────────────────────────────────────
function _renderMansion(CX, stx, sty, now) {
  const z  = ISLAND_ZONES.mansion;
  const sx = stx(z.x1), sy = sty(z.y1);
  const zw = (z.x2 - z.x1) * T, zh = (z.y2 - z.y1) * T;
  const cx = sx + zw / 2,  cy = sy + zh / 2;
  CX.save();

  // Grounds
  CX.fillStyle = '#1a3a08'; CX.fillRect(sx + 2, sy + 2, zw - 4, zh - 4);

  // Main building
  CX.fillStyle = '#e8d8b8';
  CX.fillRect(cx - 30, cy - 22, 60, 44);
  CX.strokeStyle = '#8a7a6a'; CX.lineWidth = 2;
  CX.strokeRect(cx - 30, cy - 22, 60, 44);

  // Roof
  CX.fillStyle = '#8a4020';
  CX.beginPath();
  CX.moveTo(cx - 34, cy - 22);
  CX.lineTo(cx,       cy - 38);
  CX.lineTo(cx + 34,  cy - 22);
  CX.closePath(); CX.fill();

  // Windows (2×3 grid)
  CX.fillStyle = 'rgba(180,220,255,0.55)';
  [[-18, -10], [0, -10], [18, -10], [-18, 8], [0, 8], [18, 8]].forEach(([ox, oy]) => {
    CX.fillRect(cx + ox - 5, cy + oy - 6, 10, 12);
    CX.strokeStyle = '#7a6a5a'; CX.lineWidth = 0.5;
    CX.strokeRect(cx + ox - 5, cy + oy - 6, 10, 12);
  });

  // Columns
  CX.fillStyle = '#f0e8d0';
  [[-22, 0], [22, 0]].forEach(([ox]) => {
    CX.fillRect(cx + ox - 3, cy - 22, 6, 44);
  });

  // Front door
  CX.fillStyle = '#5a3820';
  CX.fillRect(cx - 8, cy + 4, 16, 18);

  // Gate/fence
  CX.strokeStyle = '#5a4030'; CX.lineWidth = 1.5;
  for (let fx = sx + 4; fx <= sx + zw - 4; fx += 8) {
    CX.beginPath(); CX.moveTo(fx, sy + 2); CX.lineTo(fx, sy + 10); CX.stroke();
  }
  CX.beginPath(); CX.moveTo(sx + 4, sy + 6); CX.lineTo(sx + zw - 4, sy + 6); CX.stroke();

  // Label
  CX.fillStyle = 'rgba(220,200,160,0.55)';
  CX.font = '7px monospace'; CX.textAlign = 'center'; CX.textBaseline = 'middle';
  CX.fillText('MANSION', cx, sy + 6);
  CX.textAlign = 'left'; CX.textBaseline = 'alphabetic';
  CX.restore();
}

// ── Casino ─────────────────────────────────────────────────────
function _renderCasino(CX, stx, sty, now) {
  const z   = ISLAND_ZONES.casino;
  const sx  = stx(z.x1), sy = sty(z.y1);
  const zw  = (z.x2 - z.x1) * T, zh = (z.y2 - z.y1) * T;
  const cx  = sx + zw / 2,   cy  = sy + zh / 2;
  CX.save();

  // Animated neon border
  const flick = 0.7 + 0.3 * Math.sin(now / 260);
  CX.shadowColor = `rgba(255,200,0,${flick})`; CX.shadowBlur = 22;
  CX.strokeStyle = `rgba(255,200,0,${0.55 + 0.45 * flick})`;
  CX.lineWidth   = 3;
  CX.strokeRect(sx + 3, sy + 3, zw - 6, zh - 6);
  CX.shadowBlur  = 0;

  // Building fill
  CX.fillStyle = '#0a0a08'; CX.fillRect(sx + 6, sy + 6, zw - 12, zh - 12);

  // Gold stripe
  CX.fillStyle = `rgba(255,190,0,${0.30 + 0.15 * Math.sin(now / 320)})`;
  CX.fillRect(sx + 6, sy + 6, zw - 12, 6);
  CX.fillRect(sx + 6, sy + zh - 12, zw - 12, 6);

  // "CASINO" neon sign
  CX.fillStyle    = `rgba(255,220,0,${flick})`;
  CX.font         = 'bold 10px monospace';
  CX.textAlign    = 'center'; CX.textBaseline = 'middle';
  CX.shadowColor  = 'rgba(255,200,0,0.9)'; CX.shadowBlur = 14;
  CX.fillText('CASINO', cx, cy - 6);
  CX.fillStyle    = `rgba(255,120,0,${flick * 0.85})`;
  CX.font         = '7px monospace';
  CX.fillText('♠ ♥ ♦ ♣', cx, cy + 6);
  CX.shadowBlur   = 0;

  // Spinning roulette wheel graphic
  const wRad = 11, wX = cx, wY = cy + 18;
  CX.strokeStyle = `rgba(255,200,0,${flick})`; CX.lineWidth = 2;
  CX.beginPath(); CX.arc(wX, wY, wRad, 0, Math.PI * 2); CX.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + now / 1200;
    CX.strokeStyle = i % 2 === 0 ? 'rgba(255,0,0,0.7)' : 'rgba(0,0,0,0.7)';
    CX.lineWidth = 4;
    CX.beginPath();
    CX.moveTo(wX, wY);
    CX.lineTo(wX + Math.cos(a) * wRad, wY + Math.sin(a) * wRad);
    CX.stroke();
  }
  // Ball
  const bA = now / 500;
  CX.fillStyle = '#fff';
  CX.beginPath(); CX.arc(wX + Math.cos(bA)*(wRad-3), wY + Math.sin(bA)*(wRad-3), 2, 0, Math.PI * 2); CX.fill();

  // Dot lights on border
  for (let i = 0; i < 10; i++) {
    const a   = (i / 10) * Math.PI * 2 + now / 950;
    const dx  = cx + Math.cos(a) * (zw / 2 - 8);
    const dy  = cy + Math.sin(a) * (zh / 2 - 10);
    const on  = Math.sin(now / 130 + i * 0.9) > 0;
    CX.fillStyle  = on ? 'rgba(255,220,0,0.95)' : 'rgba(100,80,0,0.4)';
    CX.shadowBlur = on ? 7 : 0;
    CX.beginPath(); CX.arc(dx, dy, 3, 0, Math.PI * 2); CX.fill();
  }
  CX.shadowBlur = 0;
  CX.textAlign = 'left'; CX.textBaseline = 'alphabetic';
  CX.restore();
}

// ── Black Market ──────────────────────────────────────────────
function _renderBlackMkt(CX, stx, sty, now) {
  const z  = ISLAND_ZONES.black_mkt;
  const sx = stx(z.x1), sy = sty(z.y1);
  const zw = (z.x2 - z.x1) * T, zh = (z.y2 - z.y1) * T;
  const cx = sx + zw / 2, cy = sy + zh / 2;
  CX.save();

  // Dark zone
  CX.fillStyle = '#080810'; CX.fillRect(sx + 2, sy + 2, zw - 4, zh - 4);

  // Crates scattered around
  CX.fillStyle = '#5a3a10';
  [[cx - 22, cy - 12, 14, 12], [cx + 10, cy - 8, 16, 10],
   [cx - 10, cy + 8,  12, 14], [cx + 18, cy + 6,  10, 12]].forEach(([rx,ry,rw,rh]) => {
    CX.fillRect(rx, ry, rw, rh);
    CX.strokeStyle = '#3a2208'; CX.lineWidth = 1;
    CX.strokeRect(rx, ry, rw, rh);
    // Crate slats
    CX.strokeStyle = '#3a2208'; CX.lineWidth = 0.5;
    CX.beginPath(); CX.moveTo(rx, ry + rh / 2); CX.lineTo(rx + rw, ry + rh / 2); CX.stroke();
    CX.beginPath(); CX.moveTo(rx + rw/2, ry); CX.lineTo(rx + rw/2, ry + rh); CX.stroke();
  });

  // Hanging red lamp
  const bulbFlick = 0.65 + 0.35 * Math.sin(now / 350);
  CX.fillStyle    = `rgba(200,0,0,${bulbFlick})`;
  CX.shadowColor  = 'rgba(200,0,0,0.8)'; CX.shadowBlur = 10;
  CX.beginPath(); CX.arc(cx, sy + 14, 5, 0, Math.PI * 2); CX.fill();
  CX.shadowBlur   = 0;

  // "BLACK MARKET" text in red
  CX.fillStyle    = `rgba(200,30,30,${0.55 + 0.2 * bulbFlick})`;
  CX.font         = '7px monospace'; CX.textAlign = 'center'; CX.textBaseline = 'middle';
  CX.fillText('BLACK MARKET', cx, cy + 2);
  CX.fillStyle    = 'rgba(140,140,140,0.5)';
  CX.font         = '5px monospace';
  CX.fillText('ENTER TO SHOP', cx, cy + 12);
  CX.textAlign = 'left'; CX.textBaseline = 'alphabetic';
  CX.restore();
}

// ── Airstrip ──────────────────────────────────────────────────
function _renderAirstrip(CX, stx, sty, now) {
  const z  = ISLAND_ZONES.airstrip;
  const sx = stx(z.x1), sy = sty(z.y1);
  const zw = (z.x2 - z.x1) * T, zh = (z.y2 - z.y1) * T;
  const cx = sx + zw / 2, cy = sy + zh / 2;
  CX.save();

  // Runway surface
  CX.fillStyle = '#3a3a3a'; CX.fillRect(sx + 2, sy + 2, zw - 4, zh - 4);

  // Runway centre line (dashed white)
  CX.strokeStyle = 'rgba(255,255,255,0.60)';
  CX.lineWidth   = 3; CX.setLineDash([16, 12]);
  CX.beginPath(); CX.moveTo(sx + 6, cy); CX.lineTo(sx + zw - 6, cy); CX.stroke();
  CX.setLineDash([]);

  // Edge markings
  CX.strokeStyle = 'rgba(255,255,255,0.30)'; CX.lineWidth = 1.5;
  CX.strokeRect(sx + 6, sy + 6, zw - 12, zh - 12);

  // Animated runway lights (sequence)
  const litIdx = Math.floor(now / 200) % 8;
  for (let i = 0; i < 8; i++) {
    const lx = sx + 10 + i * ((zw - 20) / 7);
    const on  = i === litIdx || i === (litIdx + 1) % 8;
    CX.fillStyle  = on ? 'rgba(255,255,100,0.95)' : 'rgba(80,80,30,0.5)';
    CX.shadowBlur = on ? 8 : 0;
    CX.shadowColor= 'rgba(255,255,80,0.9)';
    CX.beginPath(); CX.arc(lx, sy + zh - 8, 3, 0, Math.PI * 2); CX.fill();
    CX.beginPath(); CX.arc(lx, sy + 8, 3, 0, Math.PI * 2); CX.fill();
  }
  CX.shadowBlur = 0;

  // Small parked plane silhouette
  const px = cx - 20, py = cy - 10;
  CX.fillStyle = '#445566';
  // Fuselage
  CX.beginPath(); CX.ellipse(px + 20, py + 5, 22, 5, 0, 0, Math.PI * 2); CX.fill();
  // Wings
  CX.beginPath();
  CX.moveTo(px + 14, py + 5); CX.lineTo(px, py - 8); CX.lineTo(px + 8, py + 5);
  CX.closePath(); CX.fill();
  CX.beginPath();
  CX.moveTo(px + 14, py + 5); CX.lineTo(px, py + 18); CX.lineTo(px + 8, py + 5);
  CX.closePath(); CX.fill();
  // Tail
  CX.beginPath();
  CX.moveTo(px + 36, py); CX.lineTo(px + 42, py - 8); CX.lineTo(px + 42, py); CX.closePath(); CX.fill();

  // AIRSTRIP label
  CX.fillStyle    = 'rgba(180,180,220,0.55)';
  CX.font         = '7px monospace'; CX.textAlign = 'center'; CX.textBaseline = 'middle';
  CX.fillText('AIRSTRIP', cx, sy + zh - 14);
  CX.textAlign = 'left'; CX.textBaseline = 'alphabetic';
  CX.restore();
}

// ── Drug Lab ──────────────────────────────────────────────────
function _renderDrugLab(CX, stx, sty, now) {
  const z  = ISLAND_ZONES.drug_lab;
  const sx = stx(z.x1), sy = sty(z.y1);
  const zw = (z.x2 - z.x1) * T, zh = (z.y2 - z.y1) * T;
  const cx = sx + zw / 2, cy = sy + zh / 2;
  CX.save();

  // Building walls
  CX.fillStyle = '#222222'; CX.fillRect(sx + 3, sy + 3, zw - 6, zh - 6);
  CX.strokeStyle = '#44aa44'; CX.lineWidth = 1.5;
  CX.strokeRect(sx + 3, sy + 3, zw - 6, zh - 6);

  // Hazmat symbol (simplified ☣ = circle + arcs)
  CX.strokeStyle = 'rgba(80,200,80,0.7)'; CX.lineWidth = 1.5;
  CX.beginPath(); CX.arc(cx, cy, 12, 0, Math.PI * 2); CX.stroke();
  CX.beginPath(); CX.arc(cx, cy, 4, 0, Math.PI * 2); CX.fill();
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    CX.beginPath();
    CX.arc(cx + Math.cos(a) * 7, cy + Math.sin(a) * 7, 4, a + Math.PI, a + Math.PI * 0.3);
    CX.stroke();
  }

  // Animated smoke puffs from chimneys
  for (let s = 0; s < 3; s++) {
    const smX = sx + 10 + s * 12;
    const smY = sy + 6;
    const smT = (now / 800 + s * 0.5) % 1;
    const smA = 0.6 - smT * 0.5;
    const smR = 4 + smT * 8;
    CX.fillStyle = `rgba(60,180,60,${smA})`;
    CX.beginPath(); CX.arc(smX, smY - smT * 14, smR, 0, Math.PI * 2); CX.fill();
  }

  // Warning label
  CX.fillStyle    = 'rgba(80,200,80,0.70)';
  CX.font         = '7px monospace'; CX.textAlign = 'center'; CX.textBaseline = 'middle';
  CX.fillText('DRUG LAB', cx, cy + 16);
  CX.fillStyle    = 'rgba(200,200,0,0.55)';
  CX.font         = '5px monospace';
  CX.fillText('⚠ TOXIC', cx, cy + 24);
  CX.textAlign = 'left'; CX.textBaseline = 'alphabetic';
  CX.restore();
}

// ── Cartel HQ ─────────────────────────────────────────────────
function _renderCartelHQ(CX, stx, sty, now) {
  const z  = ISLAND_ZONES.cartel_hq;
  const sx = stx(z.x1), sy = sty(z.y1);
  const zw = (z.x2 - z.x1) * T, zh = (z.y2 - z.y1) * T;
  const cx = sx + zw / 2, cy = sy + zh / 2;
  CX.save();

  // Outer compound
  CX.fillStyle = '#1a0408'; CX.fillRect(sx + 2, sy + 2, zw - 4, zh - 4);

  // Perimeter wall
  CX.strokeStyle = '#3a0a0a'; CX.lineWidth = 4;
  CX.strokeRect(sx + 4, sy + 4, zw - 8, zh - 8);

  // Crenellations
  CX.fillStyle = '#3a0a0a';
  const cw = (zw - 12) / 6;
  for (let i = 0; i < 6; i++) {
    CX.fillRect(sx + 6 + i * cw, sy + 2, cw * 0.5, 6);
    CX.fillRect(sx + 6 + i * cw, sy + zh - 8, cw * 0.5, 6);
  }

  // Corner watchtowers
  [[sx + 6, sy + 6], [sx + zw - 16, sy + 6],
   [sx + 6, sy + zh - 16],[sx + zw - 16, sy + zh - 16]].forEach(([tx, ty]) => {
    CX.fillStyle = '#2a0606'; CX.fillRect(tx, ty, 10, 10);
    CX.strokeStyle = 'rgba(200,20,0,0.5)'; CX.lineWidth = 1;
    CX.strokeRect(tx, ty, 10, 10);
  });

  // Main keep
  const kw = zw * 0.55, kh = zh * 0.55;
  const pulse = 0.3 + 0.2 * Math.sin(now / 450);
  CX.fillStyle   = '#0e0202';
  CX.fillRect(cx - kw / 2, cy - kh / 2, kw, kh);
  CX.shadowColor = `rgba(220,20,0,${pulse})`; CX.shadowBlur = 18;
  CX.strokeStyle = `rgba(200,10,0,${0.45 + pulse * 0.8})`;
  CX.lineWidth   = 2;
  CX.strokeRect(cx - kw / 2, cy - kh / 2, kw, kh);
  CX.shadowBlur  = 0;

  // Flag on keep (animated)
  const flagA = Math.sin(now / 380) * 6;
  CX.fillStyle = 'rgba(200,10,10,0.85)';
  CX.beginPath();
  CX.moveTo(cx, cy - kh / 2 - 14);
  CX.lineTo(cx + 14 + flagA, cy - kh / 2 - 9);
  CX.lineTo(cx,              cy - kh / 2 - 4);
  CX.closePath(); CX.fill();
  CX.strokeStyle = '#440000'; CX.lineWidth = 1;
  CX.beginPath(); CX.moveTo(cx, cy - kh / 2 - 14); CX.lineTo(cx, cy - kh / 2); CX.stroke();

  // Label
  CX.fillStyle    = `rgba(220,40,20,${0.65 + 0.2 * Math.sin(now / 500)})`;
  CX.font         = 'bold 8px monospace'; CX.textAlign = 'center'; CX.textBaseline = 'middle';
  CX.fillText('CARTEL HQ', cx, cy);
  CX.textAlign = 'left'; CX.textBaseline = 'alphabetic';
  CX.restore();
}

// ── Fight Club ────────────────────────────────────────────────
function _renderFightClub(CX, stx, sty, now) {
  const z  = ISLAND_ZONES.fight_club;
  const sx = stx(z.x1), sy = sty(z.y1);
  const zw = (z.x2 - z.x1) * T, zh = (z.y2 - z.y1) * T;
  const cx = sx + zw / 2, cy = sy + zh / 2;
  CX.save();

  // Arena floor
  CX.fillStyle = '#1a1a10'; CX.fillRect(sx + 2, sy + 2, zw - 4, zh - 4);

  // Boxing ring
  const rw = zw * 0.65, rh = zh * 0.55;
  CX.fillStyle = '#c8b878';
  CX.fillRect(cx - rw / 2, cy - rh / 2, rw, rh);

  // Ring ropes (3 colored lines)
  const rColors = ['rgba(255,0,0,0.8)', 'rgba(255,255,255,0.7)', 'rgba(255,0,0,0.8)'];
  rColors.forEach((rc, ri) => {
    const ro = 3 + ri * 4;
    CX.strokeStyle = rc; CX.lineWidth = 2;
    CX.strokeRect(cx - rw / 2 + ro, cy - rh / 2 + ro, rw - ro * 2, rh - ro * 2);
  });

  // Corner posts
  [[cx - rw/2, cy - rh/2],[cx + rw/2, cy - rh/2],
   [cx - rw/2, cy + rh/2],[cx + rw/2, cy + rh/2]].forEach(([px, py]) => {
    CX.fillStyle = '#aa8822';
    CX.fillRect(px - 3, py - 3, 6, 6);
  });

  // Fight-in-progress indicator
  if (_fcWave > 0) {
    const fBlink = Math.floor(now / 300) % 2 === 0;
    if (fBlink) {
      CX.fillStyle    = 'rgba(255,80,0,0.85)';
      CX.font         = 'bold 9px monospace'; CX.textAlign = 'center'; CX.textBaseline = 'middle';
      CX.fillText('WAVE ' + _fcWave + '/3', cx, cy);
    }
  } else {
    CX.fillStyle    = 'rgba(200,160,60,0.55)';
    CX.font         = '7px monospace'; CX.textAlign = 'center'; CX.textBaseline = 'middle';
    CX.fillText('FIGHT CLUB', cx, cy);
  }

  // Crowd (dots around edge)
  CX.fillStyle = 'rgba(150,100,50,0.4)';
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2 + now / 3000;
    const dr = zw * 0.42;
    CX.beginPath(); CX.arc(cx + Math.cos(a)*dr, cy + Math.sin(a)*(dr*0.7), 3, 0, Math.PI*2); CX.fill();
  }

  CX.textAlign = 'left'; CX.textBaseline = 'alphabetic';
  CX.restore();
}

// ── Smuggler Docks ────────────────────────────────────────────
function _renderDocks(CX, stx, sty, now, swx, swy) {
  const z  = ISLAND_ZONES.docks;
  const sx = stx(z.x1), sy = sty(z.y1);
  const zw = (z.x2 - z.x1) * T, zh = (z.y2 - z.y1) * T;
  const cx = sx + zw / 2, cy = sy + zh / 2;
  CX.save();

  // Plank boards
  for (let row = 0; row < 6; row++) {
    const ry = sy + 3 + row * ((zh - 6) / 6);
    CX.fillStyle = row % 2 === 0 ? '#3a2808' : '#2a1a04';
    CX.fillRect(sx + 3, ry, zw - 6, (zh - 6) / 6 - 1);
  }
  CX.strokeStyle = '#5a3a18'; CX.lineWidth = 2;
  CX.strokeRect(sx + 3, sy + 3, zw - 6, zh - 6);

  // Pier posts
  CX.fillStyle = '#1e1004';
  [[sx + 10, cy - 10],[sx + zw - 10, cy - 10],
   [sx + 10, cy + 10],[sx + zw - 10, cy + 10]].forEach(([px, py]) => {
    CX.beginPath(); CX.arc(px, py, 4.5, 0, Math.PI * 2); CX.fill();
    CX.strokeStyle = '#5a3510'; CX.lineWidth = 1;
    CX.stroke();
  });

  // Animated main speedboat
  const boatOff = Math.sin(now / 1300) * 5;
  _drawBoat(CX, sx + zw - 36, cy - 12 + boatOff, now, false);

  // Second smaller boat
  const b2Off = Math.sin(now / 1100 + 1.2) * 4;
  _drawBoat(CX, sx + 8, cy - 4 + b2Off, now + 1500, true);

  // Dock escape progress bar
  if (_dockEscProg > 0 && _dockEscCD <= 0) {
    const pct = _dockEscProg / 5;
    CX.fillStyle = 'rgba(0,0,0,0.6)';
    CX.fillRect(sx + 6, sy + 4, zw - 12, 6);
    CX.fillStyle = 'rgba(0,255,180,0.85)';
    CX.fillRect(sx + 6, sy + 4, (zw - 12) * pct, 6);
  }

  // Docks label
  CX.fillStyle    = 'rgba(100,180,255,0.6)';
  CX.font         = '7px monospace'; CX.textAlign = 'center'; CX.textBaseline = 'middle';
  CX.fillText('DOCKS', cx, sy + 9);
  if (_dockEscCD <= 0 && PL.wanted >= 2) {
    CX.fillStyle = 'rgba(0,255,180,0.65)'; CX.font = '5px monospace';
    CX.fillText('⚓ BOAT ESCAPE READY', cx, sy + 17);
  }
  CX.textAlign = 'left'; CX.textBaseline = 'alphabetic';
  CX.restore();
}

function _drawBoat(CX, bx, by, now, small) {
  CX.save();
  const sc = small ? 0.7 : 1;
  CX.scale(sc, sc);
  bx /= sc; by /= sc;

  // Hull
  CX.fillStyle = small ? '#1a3a66' : '#223366';
  CX.beginPath();
  CX.moveTo(bx,      by + 8); CX.lineTo(bx + 22, by + 8);
  CX.lineTo(bx + 20, by + 14); CX.lineTo(bx + 2,  by + 14);
  CX.closePath(); CX.fill();

  // White hull stripe
  CX.strokeStyle = 'rgba(255,255,255,0.4)'; CX.lineWidth = 1.5;
  CX.beginPath(); CX.moveTo(bx + 2, by + 9); CX.lineTo(bx + 20, by + 9); CX.stroke();

  // Cabin
  CX.fillStyle = small ? '#2a4a88' : '#334477';
  CX.fillRect(bx + 4, by + 2, 12, 6);

  // Porthole
  CX.fillStyle = 'rgba(180,230,255,0.55)';
  CX.beginPath(); CX.arc(bx + 10, by + 5, 2.5, 0, Math.PI * 2); CX.fill();

  // Mast
  CX.strokeStyle = '#886622'; CX.lineWidth = 1.5;
  CX.beginPath(); CX.moveTo(bx + 11, by + 2); CX.lineTo(bx + 11, by - 12); CX.stroke();

  // Flapping flag
  const fa = Math.sin(now / 380 + (small ? 1 : 0)) * 4;
  CX.fillStyle = small ? 'rgba(0,150,255,0.8)' : 'rgba(200,20,20,0.8)';
  CX.beginPath();
  CX.moveTo(bx + 11, by - 12);
  CX.lineTo(bx + 11 + 10 + fa, by - 9);
  CX.lineTo(bx + 11,           by - 6);
  CX.closePath(); CX.fill();

  CX.restore();
}

// ── Lighthouse ────────────────────────────────────────────────
function _renderLighthouse(CX, stx, sty, swx, swy, now) {
  const lx = swx(ISL_LIGHTHOUSE_WX);
  const ly = swy(ISL_LIGHTHOUSE_WY);
  CX.save();

  // Tower base
  CX.fillStyle = '#e0d8c8';
  CX.beginPath();
  CX.moveTo(lx - 8, ly + 20);
  CX.lineTo(lx + 8, ly + 20);
  CX.lineTo(lx + 5, ly - 24);
  CX.lineTo(lx - 5, ly - 24);
  CX.closePath(); CX.fill();

  // Red stripes
  CX.fillStyle = '#cc2200';
  [[ly + 10, 5], [ly - 2, 5], [ly - 14, 4]].forEach(([ey, eh]) => {
    CX.fillRect(lx - 6, ey, 12, eh);
  });

  // Light housing
  CX.fillStyle = '#cccc22';
  CX.fillRect(lx - 6, ly - 28, 12, 8);
  CX.strokeStyle = '#888800'; CX.lineWidth = 1;
  CX.strokeRect(lx - 6, ly - 28, 12, 8);

  // Rotating beam
  const beamA = _lhBeamAngle;
  const beamLen = 180;
  CX.save();
  CX.globalAlpha = 0.22;
  const grad = CX.createLinearGradient(
    lx, ly - 24,
    lx + Math.cos(beamA) * beamLen,
    ly - 24 + Math.sin(beamA) * beamLen
  );
  grad.addColorStop(0, 'rgba(255,255,180,0.9)');
  grad.addColorStop(1, 'rgba(255,255,180,0)');
  CX.fillStyle = grad;
  CX.beginPath();
  CX.moveTo(lx, ly - 24);
  CX.lineTo(
    lx + Math.cos(beamA - 0.18) * beamLen,
    ly - 24 + Math.sin(beamA - 0.18) * beamLen
  );
  CX.lineTo(
    lx + Math.cos(beamA + 0.18) * beamLen,
    ly - 24 + Math.sin(beamA + 0.18) * beamLen
  );
  CX.closePath(); CX.fill();
  CX.restore();

  // Pulsing light
  const lp = 0.75 + 0.25 * Math.sin(now / 280);
  CX.fillStyle    = `rgba(255,255,180,${lp})`;
  CX.shadowColor  = 'rgba(255,255,100,0.9)'; CX.shadowBlur = 16;
  CX.beginPath(); CX.arc(lx, ly - 24, 5, 0, Math.PI * 2); CX.fill();
  CX.shadowBlur = 0;

  // Bribe progress bar
  if (_lhBribeProg > 0 && _lhBribeCD <= 0) {
    const pct = _lhBribeProg / 4;
    CX.fillStyle = 'rgba(0,0,0,0.55)';
    CX.fillRect(lx - 22, ly + 25, 44, 5);
    CX.fillStyle = 'rgba(255,220,0,0.85)';
    CX.fillRect(lx - 22, ly + 25, 44 * pct, 5);
  }

  // Label
  CX.fillStyle = 'rgba(255,250,200,0.45)';
  CX.font = '5px monospace'; CX.textAlign = 'center'; CX.textBaseline = 'top';
  CX.fillText('LIGHTHOUSE', lx, ly + 24);
  CX.textAlign = 'left'; CX.textBaseline = 'alphabetic';
  CX.restore();
}

// ── Island pickups ────────────────────────────────────────────
function _renderIslandPicks(CX, swx, swy, W, H) {
  const PICK_COLS = {
    ammo:      '#00cc00',  gold_chip: '#ffc800',
    medkit:    '#ff4444',  armor:     '#4488ff',
    drug_cash: '#44ff88',  rpg_crate: '#ff6600',
    beach_rest:'#ff88aa',  sniper_kit:'#aa44ff',
  };
  const PICK_LABELS = {
    ammo:'AMM', gold_chip:'$', medkit:'+', armor:'A',
    drug_cash:'💊', rpg_crate:'🚀', beach_rest:'🌴', sniper_kit:'S',
  };

  for (const p of _islPicks) {
    if (!p.active) continue;
    const sx = swx(p.x), sy = swy(p.y);
    if (sx < -24 || sx > W + 24 || sy < -24 || sy > H + 24) continue;

    const bob = Math.sin(p.bob) * 4;
    const col = PICK_COLS[p.type] || '#ffffff';
    const lbl = PICK_LABELS[p.type] || '?';

    CX.save();
    CX.shadowColor = col; CX.shadowBlur = 10;

    if (p.type === 'rpg_crate') {
      // Crate
      CX.fillStyle = '#884400';
      CX.fillRect(sx - 10, sy - 10 + bob, 20, 14);
      CX.fillStyle = '#ff4400';
      CX.font = '8px monospace'; CX.textAlign = 'center'; CX.textBaseline = 'middle';
      CX.fillText('🚀', sx, sy - 3 + bob);
    } else {
      // Circular pickup
      CX.fillStyle = col;
      CX.beginPath(); CX.arc(sx, sy + bob, 9, 0, Math.PI * 2); CX.fill();
      CX.fillStyle   = '#000000';
      CX.font        = 'bold 7px monospace';
      CX.textAlign   = 'center'; CX.textBaseline = 'middle';
      CX.fillText(lbl, sx, sy + bob);
    }
    CX.shadowBlur = 0;
    CX.textAlign = 'left'; CX.textBaseline = 'alphabetic';
    CX.restore();
  }
}

// ── Arrival + zone-change banners ─────────────────────────────
function _renderBanners(CX, W, H) {
  // Island arrival banner
  if (_islArriveBanner > 0) {
    const alpha = Math.min(1, _islArriveBanner / 0.8);
    CX.save(); CX.globalAlpha = alpha;
    CX.fillStyle = 'rgba(0,0,0,0.72)'; CX.fillRect(0, H / 2 - 40, W, 80);
    CX.strokeStyle = 'rgba(255,200,0,0.8)'; CX.lineWidth = 2; CX.setLineDash([]);
    CX.beginPath(); CX.moveTo(0, H/2-40); CX.lineTo(W, H/2-40); CX.stroke();
    CX.beginPath(); CX.moveTo(0, H/2+40); CX.lineTo(W, H/2+40); CX.stroke();
    CX.fillStyle    = 'rgba(255,210,0,0.95)';
    CX.font         = 'bold 24px "Bebas Neue",monospace';
    CX.textAlign    = 'center'; CX.textBaseline = 'middle';
    CX.shadowColor  = 'rgba(255,200,0,0.8)'; CX.shadowBlur = 24;
    CX.fillText('🏝  CARTEL COVE', W / 2, H / 2 - 10);
    CX.shadowBlur   = 0;
    CX.fillStyle    = 'rgba(200,230,255,0.70)';
    CX.font         = '10px monospace';
    CX.fillText('WELCOME TO CARTEL COVE — ENTER AT YOUR OWN RISK', W / 2, H / 2 + 14);
    CX.textAlign = 'left'; CX.textBaseline = 'alphabetic';
    CX.restore();
  }

  // Zone-change banner — draw above control bar
  if (_islZoneBanner > 0 && _islZoneBannerTxt) {
    const ctrlH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--ctrl-h')) || 155;
    const bannerY = H - ctrlH - 38;
    const alpha = Math.min(1, _islZoneBanner / 0.4);
    CX.save(); CX.globalAlpha = alpha;
    CX.fillStyle = 'rgba(0,0,0,0.65)'; CX.fillRect(0, bannerY - 6, W, 30);
    CX.fillStyle    = 'rgba(255,220,80,0.90)';
    CX.font         = 'bold 13px "Bebas Neue",monospace';
    CX.textAlign    = 'center'; CX.textBaseline = 'middle';
    CX.shadowColor  = 'rgba(255,200,0,0.7)'; CX.shadowBlur = 12;
    CX.fillText('ENTERING: ' + _islZoneBannerTxt, W / 2, bannerY + 9);
    CX.shadowBlur = 0;
    CX.textAlign = 'left'; CX.textBaseline = 'alphabetic';
    CX.restore();
  }
}

// ══════════════════════════════════════════════════════════════════
//  END OF island_c.js  v2  — CARTEL COVE
//  Total features: 9 zones · 4 cartel types · 6 missions ·
//  20 max cartel · fight club · dock escape · lighthouse bribe ·
//  black market · storm + ambush events · 14 pickups · 2 bridges ·
//  palm trees · full zone renders · minimap patch · island HUD
// ══════════════════════════════════════════════════════════════════
