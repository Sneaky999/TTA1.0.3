// ═══════════════════════════════════════════════════════════════
//  ai.js  –  AI MODULE  v2  (Improved + Bug-fixed)
//
//  Bugs fixed vs v1:
//    • Traffic double-rotation on wall hit (angle was updated twice)
//    • copIdx stale after cops.splice — cops now carry a uid, pcars
//      find their cop by uid scan (O(n) but n is small)
//    • _steerMove jitter didn't check tile validity → walls
//    • Cop chase used raw mvE → wall jamming during pursuit
//    • SWAT filter allocated array every frame at ★5
//    • Gangster wander reused stale attack angle
//
//  AI improvements vs v1:
//    Traffic  — smooth accel/decel, stop at busy intersections
//    NPCs     — group panic contagion, rare phone-police call
//    Gangsters— cover/peek between shots, faction patrol routes,
//               coordinated flanking of player
//    Cops     — chase uses wall-steering, radio callout,
//               intercept prediction (lead target)
//    Pcars    — intercept path prediction not just follow
// ═══════════════════════════════════════════════════════════════

'use strict';

// ── TUNING ────────────────────────────────────────────────────
const AI_TRAF_LOOK_DIST     = 48;
const AI_TRAF_SLOW_FACTOR   = 0.45;
const AI_TRAF_ACCEL         = 60;    // px/s² acceleration
const AI_TRAF_STOP_RADIUS   = 38;    // px — stop if something this close ahead

const AI_NPC_PANIC_RADIUS   = 260;
const AI_NPC_PANIC_COOLDOWN = 0.7;
const AI_NPC_FLEE_RANGE     = 220;
const AI_NPC_CONTAGION_R    = 80;    // px — panic spreads to nearby NPCs
const AI_NPC_CALL_CHANCE    = 0.003; // probability/s NPC calls police (adds wanted)

const AI_GANG_ALARM_RADIUS  = 200;
const AI_GANG_ALARM_CHANCE  = 0.012;
const AI_GANG_RETREAT_HP    = 0.30;
const AI_GANG_RETREAT_REGEN = 4;
const AI_GANG_BASE_RANGE    = 200;
const AI_GANG_AGGRO_BONUS   = 40;
const AI_GANG_AGGRO_CAP     = 400;
const AI_GANG_COVER_DIST    = 180;   // px — shoot from this range, take cover closer
const AI_GANG_COVER_TIME    = 1.2;   // s — how long to stay behind cover
const AI_GANG_FLANK_OFFSET  = Math.PI / 4; // 45° flanking offset between gang members

const AI_COP_FLANK_ANGLE    = Math.PI / 3.2;
const AI_COP_FLANK_BLEND    = 240;
const AI_COP_SURROUND_DIST  = 130;
const AI_COP_SURROUND_MIN   = 60;
const AI_COP_RADIO_RANGE    = 320;   // px — spotted cop radios nearby partners
const AI_COP_RADIO_CHANCE   = 0.015; // probability/s of radio callout
const AI_COP_PREDICT_T      = 0.6;   // seconds of player movement to predict

const AI_HELI_ORBIT_SPEED   = 0.75;
const AI_HELI_ORBIT_DIST    = 280;
const AI_HELI_SPAWN_CHANCE  = 0.10;
const AI_HELI_MAX_SWAT      = 2;

const AI_COP_PROBE_DIST     = 32;
const AI_COP_STEER_STEP     = Math.PI / 6;
const AI_COP_STEER_TRIES    = 6;
const AI_COP_STUCK_TIME     = 1.4;
const AI_COP_STUCK_MOVE_MIN = 4;

// ── Cop role tuning ───────────────────────────────────────────
const AI_COP_SUPPRESS_RANGE  = 185;   // suppressor holds this distance
const AI_COP_DETECT_RANGE    = 230;   // detective optimal distance
const AI_COP_RETREAT_HP      = 0.25;  // retreat threshold (non-SWAT)
const AI_COP_STRAFE_SPEED    = 0.55;  // strafe fraction of full speed
const AI_COP_FLANK_SIDE_DIST = 110;   // px offset flanker targets beside player

// ── Police car tuning ─────────────────────────────────────────
const AI_PCAR_PIT_RANGE      = 95;    // px — attempt PIT within this range
const AI_PCAR_PIT_MIN_SPEED  = 65;    // min pc speed to attempt PIT
const AI_PCAR_INTERCEPT_LEAD = 1.1;   // seconds ahead to predict for intercept car
const AI_PCAR_CHASE_BOOST    = 1.22;  // maxS multiplier when actively chasing player car
const AI_PCAR_RAM_KEEP_SPEED = 45;    // min speed so cars don't stop near player car

// ── MODULE STATE ──────────────────────────────────────────────
let _panicCooldown   = 0;
let _helicopterAng   = 0;
let _copFlankSide    = new WeakMap();
let _nextCopUid      = 1;   // monotonic cop UID counter

// ── Approval-based aggression state ───────────────────────────
// Set when player kills or directly hits a gangster.
// Decays over time so gangs go passive again after player lays low.
let _gangAlertTimer  = 0;   // seconds remaining of gang-wide alert

// ══════════════════════════════════════════
//  PUBLIC API
// ══════════════════════════════════════════

function initAI() {
  _panicCooldown  = 0;
  _helicopterAng  = 0;
  _copFlankSide   = new WeakMap();
  _nextCopUid     = 1;
  _gangAlertTimer = 0;
}

function updateAI(dt) {
  // Bug 9: Guard against invalid dt that could freeze or corrupt AI state
  if (!Number.isFinite(dt) || dt <= 0) return;
  _aiTraffic(dt);
  _aiNPCs(dt);
  _aiGangsters(dt);
  _aiPoliceCars(dt);
  _aiCops(dt);
  _aiBullets(dt);
  _aiPickups(dt);
  _aiParticles(dt);
  if (_panicCooldown > 0) _panicCooldown -= dt;
  if (_gangAlertTimer > 0) _gangAlertTimer -= dt;
}

/** Call before cops.splice(j,1) — clears all pcar back-references for this cop */
function _unlinkCopFromCar(c, copArrayIndex) {
  if (c.carIdx < 0 || c.carIdx >= pcars.length) return;
  const pc = pcars[c.carIdx];
  if (pc.copIdx      === copArrayIndex) pc.copIdx      = -1;
  if (pc.driverIdx   === copArrayIndex) { pc.driverIdx   = -1; pc.copUid      = undefined; }
  if (pc.passengerIdx=== copArrayIndex) { pc.passengerIdx= -1; pc.passengerUid= undefined; }
}

function panicNearby(x, y) {
  if (_panicCooldown > 0) return;
  _panicCooldown = AI_NPC_PANIC_COOLDOWN;
  const r2 = AI_NPC_PANIC_RADIUS * AI_NPC_PANIC_RADIUS;
  for (const n of npcs) {
    if (d2(n.x, n.y, x, y) < r2) { n.flee = true; n.state = 'scared'; }
  }
}

/** Call this whenever player directly hits (not just kills) a gangster in melee */
function provokeGang(g) {
  if (g) g.provoked = true;
  _gangAlertTimer = 18;
}

// ═════════════════════════════════════════
//  TRAFFIC  (bug-fixed + improved)
// ═════════════════════════════════════════
function _aiTraffic(dt) {
  for (const tc of traf) {
    // Bug 9: Skip corrupted traffic entities
    if (!Number.isFinite(tc.x) || !Number.isFinite(tc.y) || !Number.isFinite(tc.angle)) {
      tc.x = WW*T/2; tc.y = WH*T/2; tc.angle = 0; tc.speed = 20; continue;
    }
    tc.tT -= dt;
    if (tc.tT <= 0) {
      tc.angle += (Math.random() < 0.5 ? 1 : -1) * Math.PI / 2;
      tc.tT = 2 + Math.random() * 4;
      tc._spd = tc._spd || tc.speed; // save natural speed
    }

    // ── Vehicle-ahead scan ─────────────────────────────────────
    const lookX = tc.x + Math.cos(tc.angle) * AI_TRAF_LOOK_DIST;
    const lookY = tc.y + Math.sin(tc.angle) * AI_TRAF_LOOK_DIST;
    let blocked = false;
    for (const other of traf) {
      if (other === tc) continue;
      if (d2(lookX, lookY, other.x, other.y) < AI_TRAF_STOP_RADIUS * AI_TRAF_STOP_RADIUS) {
        blocked = true; break;
      }
    }
    if (!blocked) {
      for (const pc of pcars) {
        if (d2(lookX, lookY, pc.x, pc.y) < 28 * 28) { blocked = true; break; }
      }
    }
    if (!blocked) {
      // Only check parked cars within 2 tiles of look point — avoids O(n*m) scan
      const lTx = Math.floor(lookX / T), lTy = Math.floor(lookY / T);
      for (const sc of cars) {
        if (sc.driven) continue;
        const scTx = Math.floor(sc.x / T), scTy = Math.floor(sc.y / T);
        if (Math.abs(scTx - lTx) > 2 || Math.abs(scTy - lTy) > 2) continue;
        if (d2(lookX, lookY, sc.x, sc.y) < 24 * 24) { blocked = true; break; }
      }
    }

    // ── Smooth acceleration / deceleration ────────────────────
    const targetSpd = blocked ? 0 : (tc._spd || tc.speed);
    if (tc.speed < targetSpd) tc.speed = Math.min(targetSpd, tc.speed + AI_TRAF_ACCEL * dt);
    else if (tc.speed > targetSpd) tc.speed = Math.max(targetSpd * AI_TRAF_SLOW_FACTOR, tc.speed - AI_TRAF_ACCEL * 1.5 * dt);

    if (tc.speed < 0.5) continue; // stationary — skip movement

    // ── BUG FIX: single angle update on collision ──────────────
    // Try X movement; if blocked, rotate ONCE and bail for this frame
    const nx = tc.x + Math.cos(tc.angle) * tc.speed * dt;
    if (!tColl(nx - tc.w / 2, tc.y - tc.h / 2, tc.w, tc.h)) {
      tc.x = nx;
    } else {
      // Rotate and bail — don't also try Y with the new angle
      tc.angle += Math.PI / 2;
      tc.tT = 0.5 + Math.random() * 1.5;
      continue;
    }

    // Try Y movement; if blocked, rotate ONCE
    const ny = tc.y + Math.sin(tc.angle) * tc.speed * dt;
    if (!tColl(tc.x - tc.w / 2, ny - tc.h / 2, tc.w, tc.h)) {
      tc.y = ny;
    } else {
      tc.angle += Math.PI / 2;
      tc.tT = 0.5 + Math.random() * 1.5;
    }

    tc.x = Math.max(20, Math.min(WW * T - 20, tc.x));
    tc.y = Math.max(20, Math.min(WH * T - 20, tc.y));
  }
}

// ═════════════════════════════════════════
//  NPC CIVILIANS  (improved)
// ═════════════════════════════════════════
function _aiNPCs(dt) {
  const fleeMult = typeof approvalNPCFleeMult === 'function' ? approvalNPCFleeMult() : 1;
  for (let ni = 0; ni < npcs.length; ni++) {
    const n = npcs[ni];
    n.timer -= dt;

    // Mission contact NPCs stand still and are immune to AI
    if (n.isGiver) { n.angle = Math.atan2(PL.y - n.y, PL.x - n.x); continue; }

    // ── Mission target NPC: stays in area, faces player, doesn't flee ──
    if (n.isTarget) {
      const dx = PL.x - n.x, dy = PL.y - n.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 80) {
        n.angle = Math.atan2(n.y - PL.y, n.x - PL.x);
        mvE(n, Math.cos(n.angle) * n.spd * 0.6 * dt, Math.sin(n.angle) * n.spd * 0.6 * dt);
      } else {
        if (n.timer <= 0) { n.angle = Math.random() * Math.PI * 2; n.timer = 3 + Math.random() * 4; }
        mvE(n, Math.cos(n.angle) * n.spd * 0.35 * dt, Math.sin(n.angle) * n.spd * 0.35 * dt);
      }
      continue;
    }

    const dx   = PL.x - n.x;
    const dy   = PL.y - n.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Scare trigger: armed player on foot within range
    if (!PL.inCar && dist < 130 && curW().id !== 'fists') {
      n.state = 'scared'; n.flee = true;
    }

    // Rare: panicking NPC makes a phone call → player gets a wanted star
    if (n.flee && Math.random() < AI_NPC_CALL_CHANCE * dt && PL.wanted < 3) {
      addWanted(1);
    }

    if (n.flee) {
      if (dist < AI_NPC_FLEE_RANGE * fleeMult) {
        n.angle = Math.atan2(n.y - PL.y, n.x - PL.x);
        mvE(n, Math.cos(n.angle) * n.spd * 1.7 * dt, Math.sin(n.angle) * n.spd * 1.7 * dt);

        // Panic contagion — spread flee to nearby calm NPCs
        if (Math.random() < 0.04) {
          const cr2 = AI_NPC_CONTAGION_R * AI_NPC_CONTAGION_R;
          for (let nj = 0; nj < npcs.length; nj++) {
            if (nj === ni) continue;
            const nb = npcs[nj];
            if (!nb.flee && d2(n.x, n.y, nb.x, nb.y) < cr2) {
              nb.flee = true; nb.state = 'scared';
            }
          }
        }
        continue;
      } else {
        n.flee = false; n.state = 'idle';
      }
    }

    // Normal wander
    if (n.timer <= 0) {
      n.angle = Math.random() * Math.PI * 2;
      n.timer = 1.5 + Math.random() * 2.5;
    }
    mvE(n, Math.cos(n.angle) * n.spd * dt, Math.sin(n.angle) * n.spd * dt);
  }
}

// ═════════════════════════════════════════
//  GANGSTERS  (improved: cover, flanking)
// ═════════════════════════════════════════
function _aiGangsters(dt) {
  // ── Approval-based engagement rules ───────────────────────────
  // Read current approval once per tick (0–100)
  const _apr = typeof getApproval === 'function' ? getApproval() : 50;

  // How far a gangster will chase the player (px):
  //   VILLAIN  (0–19)  — only attack if personally provoked (hit/killed by player)
  //   CRIMINAL (20–39) — only attack if provoked; chase 1.5× normal distance
  //   NEUTRAL+ (40–100)— normal behaviour
  const _gangVillain  = _apr < 20;
  const _gangCriminal = _apr >= 20 && _apr < 40;
  const _gangNormal   = _apr >= 40;

  const maxRoam = (AI_GANG_BASE_RANGE + Math.min(AI_GANG_AGGRO_CAP, gangKills * AI_GANG_AGGRO_BONUS)) *
                  (typeof approvalGangAggroMult === 'function' ? approvalGangAggroMult() : 1);

  // Provoked-chase distance: normal for NEUTRAL, 1.5× for CRIMINAL (once provoked)
  const provokedRoam = _gangCriminal ? maxRoam * 1.5 : maxRoam;

  // Pre-compute each gang member's index-based flank offset for coordinated approach
  const gangCount = gangs.length;

  for (let i = gangs.length - 1; i >= 0; i--) {
    const g = gangs[i];
    // Bug 9: Skip/reset corrupted gangster state
    if (!Number.isFinite(g.x) || !Number.isFinite(g.y)) { gangs.splice(i, 1); continue; }
    g.atkCd   = Math.max(0, g.atkCd   - dt);
    g.shootCd = Math.max(0, g.shootCd - dt);
    g._coverT = Math.max(0, (g._coverT || 0) - dt);

    const homeDist = Math.sqrt(d2(g.x, g.y, g.homeX, g.homeY));
    const pdx = PL.x - g.x, pdy = PL.y - g.y;
    const pdd = Math.sqrt(pdx * pdx + pdy * pdy);
    const hpPct = g.hp / (g.maxHp || 45);

    // ── Wounded retreat ────────────────────────────────────────
    if (hpPct < AI_GANG_RETREAT_HP && homeDist > 55) {
      const retreatAngle = Math.atan2(g.homeY - g.y, g.homeX - g.x);
      _gangSteerMove(g, retreatAngle, g.spd * 0.85, dt);
      g.hp = Math.min(g.maxHp || 45, g.hp + AI_GANG_RETREAT_REGEN * dt);
      continue;
    }

    // ── Find nearest on-foot cop ───────────────────────────────
    let nearCopIdx = -1, nearCopD = Infinity;
    for (let ci = 0; ci < cops.length; ci++) {
      const c = cops[ci];
      if (c.state === 'in_car' || c.state === 'riding') continue;
      const cd = d2(g.x, g.y, c.x, c.y);
      if (cd < nearCopD) { nearCopD = cd; nearCopIdx = ci; }
    }
    const engageCop = nearCopIdx >= 0 && nearCopD < 200 * 200;

    if (homeDist > maxRoam && pdd > 80) {
      // ── Return to turf ─────────────────────────────────────
      const homeAngle = Math.atan2(g.homeY - g.y, g.homeX - g.x);
      _gangSteerMove(g, homeAngle, g.spd, dt);

    } else if (engageCop) {
      // ── Fight cop ──────────────────────────────────────────
      const tc    = cops[nearCopIdx];
      const gdist = Math.sqrt(nearCopD);
      g.angle = Math.atan2(tc.y - g.y, tc.x - g.x);

      if (gdist > 20) _gangSteerMove(g, g.angle, g.spd, dt);

      if (gdist < 220 && g.shootCd <= 0) {
        g.shootCd = 1.0;
        shootB(g.x, g.y, g.angle + (Math.random() - 0.5) * 0.3, false, 300, 9, 0, 'gang');
      }
      if (gdist < 20 && g.atkCd <= 0) {
        g.atkCd = 0.85; tc.hp -= 12; spawnPts(tc.x, tc.y, '#f44', 4);
        if (tc.hp <= 0) {
          spawnPts(tc.x, tc.y, '#00f', 10);
          if (tc.carIdx >= 0 && tc.carIdx < pcars.length) {
            const _dpc = pcars[tc.carIdx];
            if (_dpc.driverIdx === nearCopIdx)    _dpc.driverIdx    = -1;
            if (_dpc.passengerIdx === nearCopIdx)  _dpc.passengerIdx = -1;
            _dpc.copIdx = -1;
          }
          cops.splice(nearCopIdx, 1);
          showNotif('GANG KILLED COP!');
        }
      }

    } else if (pdd < maxRoam) {
      // ── Attack player (approval-gated) ─────────────────────

      // Determine if this gangster will engage based on approval tier
      // g.provoked = true when player has directly hit this gangster
      // _gangAlertTimer > 0 means player killed/hit a gangster recently (gang-wide alert)
      let willEngage;
      if (_gangVillain) {
        // VILLAIN: only engage if THIS gangster was personally hit
        willEngage = g.provoked === true;
      } else if (_gangCriminal) {
        // CRIMINAL: engage if provoked directly OR gang-wide alert is active
        willEngage = g.provoked === true || _gangAlertTimer > 0;
      } else {
        // NEUTRAL / RESPECTED / HERO: normal attack-on-sight
        willEngage = true;
      }

      // Chase distance: use provokedRoam when provoked in CRIMINAL, else maxRoam
      const effectiveRoam = ((_gangCriminal || _gangVillain) && g.provoked) ? provokedRoam : maxRoam;
      if (!willEngage || pdd > effectiveRoam) {
        // Not engaging — wander instead
        if (!g.wanderT || g.wanderT <= 0) {
          g.angle   = Math.random() * Math.PI * 2;
          g.wanderT = 2 + Math.random() * 2.5;
        }
        g.wanderT -= dt;
        _gangSteerMove(g, g.angle, g.spd * 0.5, dt);
        continue;
      }

      // ── Alarm call ─────────────────────────────────────────
      if (pdd < 120 && Math.random() < AI_GANG_ALARM_CHANCE) {
        const ar2 = AI_GANG_ALARM_RADIUS * AI_GANG_ALARM_RADIUS;
        for (const ally of gangs) {
          if (ally !== g && d2(ally.x, ally.y, g.x, g.y) < ar2) {
            ally.angle = Math.atan2(PL.y - ally.y, PL.x - ally.x);
            ally.wanderT = 0;
            // Spread provocation to nearby allies only in CRIMINAL/VILLAIN tiers
            if (!_gangNormal) ally.provoked = true;
          }
        }
      }

      // ── Cover / peek behaviour ────────────────────────────
      // Gangsters alternate between advancing and staying in cover.
      // Each has a flank offset so they spread out rather than stack.
      const flankAngle = Math.atan2(pdy, pdx) +
                         (i % 3 === 0 ? AI_GANG_FLANK_OFFSET :
                          i % 3 === 1 ? -AI_GANG_FLANK_OFFSET : 0);

      if (pdd > AI_GANG_COVER_DIST) {
        // Advance toward player from flank angle
        g.angle = flankAngle;
        _gangSteerMove(g, g.angle, g.spd, dt);
        g._coverT = 0;

      } else if (g._coverT > 0) {
        // ── In cover — take a shot then wait ─────────────────
        if (g.shootCd <= 0) {
          g.shootCd = 1.0;
          const aimAngle = Math.atan2(pdy, pdx) + (Math.random() - 0.5) * 0.2;
          shootB(g.x, g.y, aimAngle, false, 310, 9, 0, 'gang');
        }
        // Sidestep slightly while in cover
        const sideAngle = Math.atan2(pdy, pdx) + Math.PI / 2;
        const sideAmt = Math.sin(Date.now() / 600 + i) * 0.4;
        mvE(g, Math.cos(sideAngle) * g.spd * sideAmt * dt,
               Math.sin(sideAngle) * g.spd * sideAmt * dt);

      } else {
        // ── Advance then duck into cover ──────────────────────
        g.angle = Math.atan2(pdy, pdx);
        _gangSteerMove(g, g.angle, g.spd * 0.7, dt);
        if (pdd < AI_GANG_COVER_DIST * 0.6) {
          // Close enough — enter cover phase
          g._coverT = AI_GANG_COVER_TIME + Math.random();
        }

        // Shoot while advancing
        if (pdd < 220 && g.shootCd <= 0) {
          g.shootCd = 1.3;
          shootB(g.x, g.y, g.angle + (Math.random() - 0.5) * 0.3, false, 290, 9, 0, 'gang');
        }
      }

      // Melee
      if (pdd < 20 && g.atkCd <= 0 && PL.inv <= 0) {
        g.atkCd = 0.9; PL.hp -= 10; PL.inv = 0.3; spawnPts(PL.x, PL.y, '#f00', 5);
      }

    } else {
      // ── Wander inside turf ─────────────────────────────────
      // BUG FIX: reset angle when entering wander to avoid reusing attack angle
      if (!g.wanderT || g.wanderT <= 0) {
        g.angle   = Math.random() * Math.PI * 2;  // always pick fresh angle
        g.wanderT = 2 + Math.random() * 2.5;
      }
      g.wanderT -= dt;
      _gangSteerMove(g, g.angle, g.spd * 0.5, dt);
    }
  }
}

// ═════════════════════════════════════════
//  POLICE CARS  (bug-fixed: uid lookup + intercept)
// ═════════════════════════════════════════
function _aiPoliceCars(dt) {
  const playerInCar = PL.inCar && PL.car;

  for (let pi = pcars.length - 1; pi >= 0; pi--) {
    const pc = pcars[pi];
    pc.lightT = (pc.lightT || 0) + dt;

    // ── Resolve driver and passenger safely ───────────────────
    const driverIdx    = pc.driverIdx    ?? pc.copIdx ?? -1;

    // Driver: uid-safe lookup
    let driver = null;
    if (pc.copUid !== undefined) {
      const ci = driverIdx;
      if (ci >= 0 && ci < cops.length && cops[ci].uid === pc.copUid) {
        driver = cops[ci];
      } else {
        const found = cops.findIndex(c => c.uid === pc.copUid);
        if (found >= 0) { pc.driverIdx = found; driver = cops[found]; }
      }
    } else if (driverIdx >= 0 && driverIdx < cops.length) {
      driver = cops[driverIdx];
    }

    // Passenger: uid-safe lookup
    let passenger = null;
    if (pc.passengerUid !== undefined) {
      const found = cops.findIndex(c => c.uid === pc.passengerUid);
      if (found >= 0) { pc.passengerIdx = found; passenger = cops[found]; }
    } else if (pc.passengerIdx >= 0 && pc.passengerIdx < cops.length) {
      passenger = cops[pc.passengerIdx];
      // Assign uid for future safe lookup
      if (passenger && passenger.uid !== undefined) pc.passengerUid = passenger.uid;
    }

    // Both dead → abandoned
    if (!driver && !passenger) {
      pc.mode = 'abandoned';
      pc.speed *= 0.85;
      if (PL.inCar && PL.car && Math.abs(PL.car.speed) > 40 &&
          rR(pc.x-pc.w/2, pc.y-pc.h/2, pc.w, pc.h,
             PL.car.x-PL.car.w/2, PL.car.y-PL.car.h/2, PL.car.w, PL.car.h)) {
        pc.health -= Math.abs(PL.car.speed) * 0.04;
        PL.car.speed *= -0.4;
        spawnPts(pc.x, pc.y, '#888', 5);
        if (pc.health <= 0) pcars.splice(pi, 1);
      }
      continue;
    }

    if (!pc.mode) pc.mode = 'carrying';
    if (!pc.pursuitRole) pc.pursuitRole = pi % 3 === 0 ? 'intercept' : pi % 3 === 1 ? 'pursue' : 'flank';

    // ── Driver always welded to car ───────────────────────────
    if (driver && driver.state === 'in_car') {
      driver.x = pc.x; driver.y = pc.y; driver.angle = pc.angle;
    }

    // ── Passenger exit logic ──────────────────────────────────
    const DEPLOY_RANGE = pc.isSWAT ? 170 : 210;
    const distToPL = Math.sqrt(d2(pc.x, pc.y, PL.x, PL.y));

    if (passenger && passenger.state === 'riding') {
      // Weld passenger on top of car (offset to roof/side)
      const rideAngle = pc.angle + Math.PI / 2; // right side of car
      passenger.x = pc.x + Math.cos(rideAngle) * (pc.h * 0.55);
      passenger.y = pc.y + Math.sin(rideAngle) * (pc.h * 0.55);
      passenger.angle = pc.angle;

      // Exit when close enough to player (and player is wanted)
      if (PL.wanted > 0 && distToPL <= DEPLOY_RANGE && Math.abs(pc.speed) < 90) {
        // Jump off the side — spring out perpendicular
        const exitSide = pi % 2 === 0 ? 1 : -1;
        const exitAng  = pc.angle + exitSide * Math.PI / 2;
        passenger.x    = pc.x + Math.cos(exitAng) * (pc.w * 0.7 + 8);
        passenger.y    = pc.y + Math.sin(exitAng) * (pc.w * 0.7 + 8);
        passenger.state    = 'on_foot';
        passenger.role     = null;
        passenger.exitT    = 0.28;
        passenger.carIdx   = -1;
        pc.passengerIdx    = -1;
        pc.passengerUid    = undefined;
        if (typeof showNotif === 'function') showNotif('COP DEPLOYED!');
      }
    }

    // ═════════════════════════════════════════════════
    //  MODE: CARRYING
    // ═════════════════════════════════════════════════
    if (pc.mode === 'carrying') {
      if (PL.wanted === 0) {
        // No heat — drive to patrol waypoint like a normal cruiser
        if (pc._patrolX === undefined || Math.sqrt(d2(pc.x, pc.y, pc._patrolX, pc._patrolY)) < 40) {
          const wp = typeof randRoadPt === 'function' ? randRoadPt() : { x: pc.x, y: pc.y };
          pc._patrolX = wp.x; pc._patrolY = wp.y;
        }
        _pcDriveTo(pc, pc._patrolX, pc._patrolY, dt, 0.6, true);
      } else if (playerInCar) {
        pc.mode = 'ramming';
      } else if (distToPL <= DEPLOY_RANGE && Math.abs(pc.speed) < 12 && !passenger) {
        pc.mode = 'blocking';
        pc.blockTargetAngle = pc.angle + Math.PI / 2 + (pc.blockAngle || 0) * 0.4;
      } else if (distToPL <= DEPLOY_RANGE) {
        // Brake to drop passenger
        pc.speed *= 0.6;
        if (Math.abs(pc.speed) < 8 && !passenger) {
          pc.mode = 'blocking';
          pc.blockTargetAngle = pc.angle + Math.PI / 2 + (pc.blockAngle || 0) * 0.4;
        }
      } else {
        // Wanted + not close yet — drive toward player
        _pcDriveTo(pc, PL.x, PL.y, dt, 1.0);
      }
    }

    // ═════════════════════════════════════════════════
    //  MODE: BLOCKING
    // ═════════════════════════════════════════════════
    else if (pc.mode === 'blocking') {
      if (PL.wanted === 0) {
        // Heat cleared — resume patrol
        pc.mode = 'carrying';
        pc._patrolX = undefined;
      } else if (playerInCar && PL.wanted >= 1) {
        pc.mode = 'ramming';
      } else {
        if (pc.blockTargetAngle !== undefined) {
          let diff = pc.blockTargetAngle - pc.angle;
          while (diff >  Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          pc.angle += diff * 4 * dt;
        }
        pc.speed *= 0.80;
      }
    }

    // ═════════════════════════════════════════════════
    //  MODE: RAMMING
    // ═════════════════════════════════════════════════
    else if (pc.mode === 'ramming') {
      if (PL.wanted === 0) {
        pc.mode = 'carrying';
        pc._patrolX = undefined;
      } else if (!playerInCar) {
        pc.mode = 'blocking';
      } else if (PL.wanted > 0) {
        const plAng = PL.car.angle;

        // PIT for flankers
        if (pc.pursuitRole === 'flank') {
          const dist = Math.sqrt(d2(pc.x, pc.y, PL.x, PL.y));
          if (dist < AI_PCAR_PIT_RANGE && Math.abs(pc.speed) >= AI_PCAR_PIT_MIN_SPEED) {
            let angDiff = Math.atan2(PL.y - pc.y, PL.x - pc.x) - plAng;
            while (angDiff >  Math.PI) angDiff -= Math.PI * 2;
            while (angDiff < -Math.PI) angDiff += Math.PI * 2;
            if (Math.abs(Math.abs(angDiff) - Math.PI / 2) < 0.65) {
              const ramAng = Math.atan2(PL.y - pc.y, PL.x - pc.x);
              let rDiff = ramAng - pc.angle;
              while (rDiff >  Math.PI) rDiff -= Math.PI * 2;
              while (rDiff < -Math.PI) rDiff += Math.PI * 2;
              pc.angle += rDiff * 14 * dt;
              pc.speed  = Math.min(pc.speed + pc.acc * 1.6 * dt, pc.maxS * AI_PCAR_CHASE_BOOST);
              if (rR(pc.x-pc.w/2, pc.y-pc.h/2, pc.w, pc.h,
                     PL.car.x-PL.car.w/2, PL.car.y-PL.car.h/2, PL.car.w, PL.car.h)) {
                PL.car.angle += (pi % 2 === 0 ? 1 : -1) * 0.75;
                PL.car.speed *= 0.45;
                pc.health -= 10;
                if (PL.inv <= 0) { PL.hp -= 10; PL.inv = 0.35; spawnPts(PL.x, PL.y, '#f00', 6); }
                spawnPts(pc.x, pc.y, '#88f', 10);
                showNotif('PIT MANEUVER!');
              }
              const pnx = pc.x + Math.cos(pc.angle) * pc.speed * dt;
              const pny = pc.y + Math.sin(pc.angle) * pc.speed * dt;
              if (!tColl(pnx-pc.w/2, pc.y-pc.h/2, pc.w, pc.h)) pc.x = pnx; else pc.speed *= -0.3;
              if (!tColl(pc.x-pc.w/2, pny-pc.h/2, pc.w, pc.h)) pc.y = pny; else pc.speed *= -0.3;
              _pcCollidePlayerCar(pc, driver, pi, pcars, passenger);
              continue;
            }
          }
        }

        let targetX, targetY;
        const plSpd = Math.abs(PL.car.speed);
        if (pc.pursuitRole === 'intercept') {
          const leadDist = Math.max(220, plSpd * AI_PCAR_INTERCEPT_LEAD);
          targetX = Math.max(T, Math.min((WW-1)*T, PL.x + Math.cos(plAng) * leadDist));
          targetY = Math.max(T, Math.min((WH-1)*T, PL.y + Math.sin(plAng) * leadDist));
        } else if (pc.pursuitRole === 'flank') {
          const side = pi % 2 === 0 ? 1 : -1;
          targetX = PL.x + Math.cos(plAng + side * Math.PI * 0.5) * 90;
          targetY = PL.y + Math.sin(plAng + side * Math.PI * 0.5) * 90;
        } else {
          targetX = PL.x; targetY = PL.y;
        }
        _pcDriveTo(pc, targetX, targetY, dt, AI_PCAR_CHASE_BOOST);
      }
    }

    // Run over player on foot
    if (PL.wanted > 0 && !PL.inCar && pc.mode !== 'blocking' && pc.mode !== 'abandoned' &&
        Math.abs(pc.speed) > 40 &&
        rR(pc.x-pc.w/2, pc.y-pc.h/2, pc.w, pc.h, PL.x-8, PL.y-8, 16, 16)) {
      if (PL.inv <= 0) { PL.hp -= 18; PL.inv = 0.5; spawnPts(PL.x, PL.y, '#f00', 8); }
    }

    _pcCollidePlayerCar(pc, driver, pi, pcars, passenger);
  }
}

function _pcDriveTo(pc, tx, ty, dt, speedMult, stopAtDest) {
  const fdx = tx - pc.x, fdy = ty - pc.y;
  const fDist = Math.sqrt(fdx*fdx + fdy*fdy);
  const topSpeed = pc.maxS * (speedMult || 1);
  if (fDist > (pc.isSWAT ? 45 : 32)) {
    const ta = Math.atan2(fdy, fdx);
    let diff = ta - pc.angle;
    while (diff >  Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    pc.angle += diff * pc.trn * dt;
    pc.speed  = Math.min(pc.speed + pc.acc * dt, topSpeed);
  } else {
    // Stop cleanly at waypoint during patrol; keep minimum speed when chasing
    pc.speed = stopAtDest ? pc.speed * 0.75 : Math.max(pc.speed * 0.92, AI_PCAR_RAM_KEEP_SPEED);
  }
  const nx = pc.x + Math.cos(pc.angle) * pc.speed * dt;
  const ny = pc.y + Math.sin(pc.angle) * pc.speed * dt;
  if (!tColl(nx-pc.w/2, pc.y-pc.h/2, pc.w, pc.h)) pc.x = nx; else pc.speed *= -0.3;
  if (!tColl(pc.x-pc.w/2, ny-pc.h/2, pc.w, pc.h)) pc.y = ny; else pc.speed *= -0.3;
}

function _pcCollidePlayerCar(pc, driver, pi, pcarArr, passenger) {
  if (!PL.inCar || !PL.car) return;
  if (Math.abs(PL.car.speed) > 40 &&
      rR(pc.x-pc.w/2, pc.y-pc.h/2, pc.w, pc.h,
         PL.car.x-PL.car.w/2, PL.car.y-PL.car.h/2, PL.car.w, PL.car.h)) {
    pc.health -= Math.abs(PL.car.speed) * 0.05;
    spawnPts(pc.x, pc.y, '#88f', 5);
    PL.car.speed *= -0.4;
    if (pc.health <= 0) {
      spawnPts(pc.x, pc.y, '#f80', 14); spawnPts(pc.x, pc.y, '#f00', 10);
      // Eject driver if still inside
      if (driver && driver.state === 'in_car') {
        driver.state = 'on_foot'; driver.role = null; driver.raiding = false;
        driver.hp = Math.max(1, driver.hp - 35);
        driver.exitT = 0.6; driver.x = pc.x; driver.y = pc.y; driver.carIdx = -1;
      }
      // Eject passenger if still riding
      if (passenger && passenger.state === 'riding') {
        passenger.state = 'on_foot'; passenger.role = null; passenger.raiding = false;
        passenger.hp = Math.max(1, passenger.hp - 20);
        passenger.exitT = 0.4; passenger.x = pc.x; passenger.y = pc.y; passenger.carIdx = -1;
      }
      const pcReward = COP_GRADES[pc.grade].reward;
      PL.score += pcReward * 2; PL.cash += pcReward * 2; // bonus for taking out the whole unit
      addWanted(1);
      showNotif('UNIT DESTROYED  +$' + (pcReward * 2));
      if (driver)    driver.carIdx    = -1;
      if (passenger) passenger.carIdx = -1;
      if (pcarArr) pcarArr.splice(pi, 1);
    }
  }
}


// ═════════════════════════════════════════
//  SHARED NAVIGATION HELPER
function _steerMove(e, wantAngle, speed, dt, onStuck) {
  if (e._checkX === undefined) {
    e._checkX = e.x; e._checkY = e.y; e._stuckT = 0;
  }
  e._stuckT += dt;
  if (e._stuckT >= AI_COP_STUCK_TIME) {
    const moved = Math.sqrt(d2(e.x, e.y, e._checkX, e._checkY));
    if (moved < AI_COP_STUCK_MOVE_MIN) {
      // BUG FIX: jitter uses mvE so it respects collision
      const jx = (Math.random() - 0.5) * T * 0.5;
      const jy = (Math.random() - 0.5) * T * 0.5;
      mvE(e, jx, jy);
      if (onStuck) onStuck(e);
    }
    e._checkX = e.x; e._checkY = e.y; e._stuckT = 0;
  }

  const step = speed * dt;
  for (let t = 0; t < AI_COP_STEER_TRIES; t++) {
    const sign  = t === 0 ? 0 : (t % 2 === 1 ? 1 : -1);
    const side  = Math.ceil(t / 2);
    const angle = wantAngle + sign * side * AI_COP_STEER_STEP;

    const probeX  = e.x + Math.cos(angle) * AI_COP_PROBE_DIST;
    const probeY  = e.y + Math.sin(angle) * AI_COP_PROBE_DIST;
    const probeTX = Math.floor(probeX / T);
    const probeTY = Math.floor(probeY / T);

    if (probeTX >= 0 && probeTX < WW && probeTY >= 0 && probeTY < WH && isW(probeTX, probeTY)) {
      e.angle = angle;
      mvE(e, Math.cos(angle) * step, Math.sin(angle) * step);
      return true;
    }
  }
  e.angle = wantAngle + Math.PI / 2;
  return false;
}

function _copSteerMove(c, wantAngle, speed, dt) {
  return _steerMove(c, wantAngle, speed, dt, e => {
    const wp = safePatrolPt();
    e.px = wp.px; e.py = wp.py;
    e.patrolT = 12 + Math.random() * 8;
  });
}

function _gangSteerMove(g, wantAngle, speed, dt) {
  return _steerMove(g, wantAngle, speed, dt, e => {
    e.wanderT = 0;
    e.angle   = Math.random() * Math.PI * 2;
  });
}

// ═════════════════════════════════════════
//  COPS  (bug-fixed chase + radio callout)
// ═════════════════════════════════════════
function _aiCops(dt) {

  // ── Approval-based cop aggression ─────────────────────────────
  // Converse of gang rules:
  //   VILLAIN  (0–19)  — cops attack from much further, pursue relentlessly
  //   CRIMINAL (20–39) — cops slightly more aggressive range
  //   NEUTRAL  (40–59) — default
  //   RESPECTED(60–79) — cops give slightly more space
  //   HERO     (80–100)— cops hold off unless player shoots first
  const _apr2 = typeof getApproval === 'function' ? getApproval() : 50;
  // Multiplier applied to every cop's shoot/engage range
  // (>1 = engage from farther; <1 = shorter range)
  const _copRangeMult =
    _apr2 < 20  ? 1.70 :   // VILLAIN  — 70% extra range
    _apr2 < 40  ? 1.35 :   // CRIMINAL — 35% extra range
    _apr2 < 60  ? 1.00 :   // NEUTRAL
    _apr2 < 80  ? 0.82 :   // RESPECTED — shorter range
                  0.60;    // HERO      — cops barely engage

  // At HERO tier cops won't shoot first — they only shoot back after being hit
  const _copPassive = _apr2 >= 80;

  // SWAT helicopter at ★5
  if (PL.wanted >= 5) {
    _helicopterAng += AI_HELI_ORBIT_SPEED * dt;
    let swatCount = 0;
    for (const c of cops) if (c.grade === 3) swatCount++;
    if (swatCount < AI_HELI_MAX_SWAT && Math.random() < AI_HELI_SPAWN_CHANCE * dt) {
      const hx = PL.x + Math.cos(_helicopterAng) * AI_HELI_ORBIT_DIST;
      const hy = PL.y + Math.sin(_helicopterAng) * AI_HELI_ORBIT_DIST;
      const snapped = snapToRoad(
        Math.max((MAP_EDGE_MARGIN + 1) * T, Math.min((WW - MAP_EDGE_MARGIN - 1) * T, hx)),
        Math.max((MAP_EDGE_MARGIN + 1) * T, Math.min((WH - MAP_EDGE_MARGIN - 1) * T, hy))
      );
      spawnCop(snapped.x, snapped.y, 3);
      showNotif('[ SWAT DROP ] HELICOPTER INBOUND');
    }
  }

  // Assign uid to new cops; only the driver syncs copUid to the pcar
  for (const c of cops) {
    if (c.uid === undefined) {
      c.uid = _nextCopUid++;
      if (c.role === 'driver' && c.carIdx >= 0 && c.carIdx < pcars.length) {
        pcars[c.carIdx].copUid = c.uid;
      }
    }
  }

  for (let i = cops.length - 1; i >= 0; i--) {
    const c  = cops[i];
    // Bug 9: Remove corrupted cop entities
    if (!Number.isFinite(c.x) || !Number.isFinite(c.y) || !Number.isFinite(c.hp)) {
      if (typeof _unlinkCopFromCar === 'function') _unlinkCopFromCar(c, i);
      cops.splice(i, 1); continue;
    }
    const gd = COP_GRADES[c.grade || 0];
    c.atkCd   = Math.max(0, c.atkCd   - dt);
    c.shootCd = Math.max(0, c.shootCd - dt);
    c.patrolT = Math.max(0, (c.patrolT || 0) - dt);

    // Skip cops still inside or on top of their car
    if (c.state === 'in_car' || c.state === 'riding') continue;

    // Brief stagger after exiting car — can't act yet
    if (c.exitT > 0) { c.exitT -= dt; continue; }

    // ── Assign role once (grade-aware) ────────────────────────
    if (!c.role) {
      if (c.grade === 3)      c.role = 'swat';
      else if (c.grade === 2) c.role = 'suppressor';
      else                    c.role = (['suppressor','flanker','closer'])[i % 3];
    }

    const inGangZone = isTileInGangZone(Math.floor(c.x / T), Math.floor(c.y / T), 0);
    const pdx        = PL.x - c.x, pdy = PL.y - c.y;
    const pdd        = Math.sqrt(pdx * pdx + pdy * pdy);
    const directAim  = Math.atan2(pdy, pdx);
    const hpPct      = c.hp / (c.maxHp || gd.hp);

    if (PL.wanted > 0) {

      // ── Radio callout ──────────────────────────────────────
      if (pdd < 280 && Math.random() < AI_COP_RADIO_CHANCE * dt) {
        const rr2 = AI_COP_RADIO_RANGE * AI_COP_RADIO_RANGE;
        for (const other of cops) {
          if (other === c) continue;
          if (d2(other.x, other.y, c.x, c.y) < rr2) {
            other.px = PL.x + (Math.random() - 0.5) * 60;
            other.py = PL.y + (Math.random() - 0.5) * 60;
            other.patrolT = 8;
          }
        }
      }

      // ── Instant alert when cop is shot ────────────────────
      // c._shotAt is set to true in _aiBullets when a player bullet hits this cop
      if (c._shotAt) {
        c._shotAt = false;
        const alert2 = 250 * 250;
        for (const other of cops) {
          if (other === c) continue;
          if (d2(other.x, other.y, c.x, c.y) < alert2) {
            other.px = PL.x; other.py = PL.y; other.patrolT = 10;
            other._shotAt = true; // propagate: nearby cops return fire too
          }
        }
      }

      // ── Low-HP retreat (all grades except SWAT) ───────────
      if (hpPct < AI_COP_RETREAT_HP && c.role !== 'swat') {
        const retreatAng = directAim + Math.PI;
        _copSteerMove(c, retreatAng, gd.spd * 1.05, dt);
        c.angle = directAim;
        if (pdd < 260 * _copRangeMult && c.shootCd <= 0) {
          c.shootCd = gd.shootCd * 1.8;
          shootB(c.x, c.y, directAim + (Math.random() - 0.5) * 0.55, false, 300, gd.dmg, 0, 'cop');
        }
        continue;
      }

      // ── Role: SUPPRESSOR ──────────────────────────────────
      if (c.role === 'suppressor') {
        const optRange = (c.grade === 2 ? AI_COP_DETECT_RANGE : AI_COP_SUPPRESS_RANGE) * _copRangeMult;

        if (pdd > optRange + 45) {
          _copSteerMove(c, directAim, gd.spd * 0.78, dt);
        } else if (pdd < optRange - 45) {
          _copSteerMove(c, directAim + Math.PI, gd.spd * 0.65, dt);
        } else {
          const strafeSign = Math.sin(Date.now() / 750 + i * 1.8) > 0 ? 1 : -1;
          _copSteerMove(c, directAim + strafeSign * Math.PI / 2, gd.spd * AI_COP_STRAFE_SPEED, dt);
        }
        c.angle = directAim;

        // HERO tier: don't shoot first — only fire if recently shot (hp dropped)
        const canShoot  = !_copPassive || c._shotAt;
        if (pdd < (optRange + 70) && c.shootCd <= 0 && canShoot) {
          const rapidCd = c.grade === 2 ? gd.shootCd * 0.55 : gd.shootCd * 0.70;
          const spread  = c.grade === 2 ? 0.05 : 0.26;
          const bspd    = c.grade === 2 ? 540  : 340;
          c.shootCd = rapidCd;
          shootB(c.x, c.y, directAim + (Math.random() - 0.5) * spread, false, bspd, gd.dmg, 0, 'cop');
        }
        if (c.grade !== 2 && pdd < 22 && c.atkCd <= 0 && PL.inv <= 0) {
          c.atkCd = 1.2; PL.hp -= gd.atkDmg; PL.inv = 0.4;
          spawnPts(PL.x, PL.y, '#f00', 5);
        }

      // ── Role: FLANKER ────────────────────────────────────
      } else if (c.role === 'flanker') {
        if (!_copFlankSide.has(c)) _copFlankSide.set(c, i % 2 === 0 ? 1 : -1);
        const side      = _copFlankSide.get(c);
        const sideAng   = directAim + side * Math.PI * 0.5;
        const flankTX   = PL.x + Math.cos(sideAng) * AI_COP_FLANK_SIDE_DIST;
        const flankTY   = PL.y + Math.sin(sideAng) * AI_COP_FLANK_SIDE_DIST;
        const flankDX   = flankTX - c.x, flankDY = flankTY - c.y;
        const flankDist = Math.sqrt(flankDX * flankDX + flankDY * flankDY);

        if (flankDist > 35) {
          const moveAng = Math.atan2(flankDY, flankDX);
          _copSteerMove(c, moveAng, gd.spd * 0.95, dt);
        }
        c.angle = directAim;

        const canShootF = !_copPassive || c._shotAt;
        if (pdd < 230 * _copRangeMult && c.shootCd <= 0 && canShootF) {
          c.shootCd = gd.shootCd * 0.82;
          shootB(c.x, c.y, directAim + (Math.random() - 0.5) * 0.20, false, 370, gd.dmg, 0, 'cop');
        }
        if (pdd < 22 && c.atkCd <= 0 && PL.inv <= 0) {
          c.atkCd = 1.0; PL.hp -= gd.atkDmg; PL.inv = 0.4;
          spawnPts(PL.x, PL.y, '#f00', 5);
        }

      // ── Role: CLOSER ─────────────────────────────────────
      } else if (c.role === 'closer') {
        // HERO tier: closer holds position rather than charging
        if (!_copPassive) {
          const rushSpd = gd.spd * (pdd > 120 ? 1.18 : 0.95);
          _copSteerMove(c, directAim, rushSpd, dt);
        }
        c.angle = directAim;

        const canShootC = !_copPassive || c._shotAt;
        if (pdd < 150 * _copRangeMult && c.shootCd <= 0 && canShootC) {
          c.shootCd = gd.shootCd * 0.78;
          shootB(c.x, c.y, directAim + (Math.random() - 0.5) * 0.32, false, 340, gd.dmg, 0, 'cop');
        }
        if (pdd < 22 && c.atkCd <= 0 && PL.inv <= 0) {
          c.atkCd = 0.88; PL.hp -= gd.atkDmg + 4; PL.inv = 0.4;
          spawnPts(PL.x, PL.y, '#f00', 7);
        }

      // ── Role: SWAT ────────────────────────────────────────
      } else if (c.role === 'swat') {
        // SWAT always charges — approval doesn't soften them
        if (pdd > 50) {
          _copSteerMove(c, directAim, gd.spd * 1.08, dt);
        }
        c.angle = directAim;

        if (pdd < 210 * _copRangeMult && c.shootCd <= 0) {
          c.shootCd = gd.shootCd;
          shootB(c.x, c.y, directAim + (Math.random() - 0.5) * 0.05, false, 510, gd.dmg, 0, 'cop');
          shootB(c.x, c.y, directAim + (Math.random() - 0.5) * 0.09, false, 510, gd.dmg, 0, 'cop');
        }
        if (pdd < 22 && c.atkCd <= 0 && PL.inv <= 0) {
          c.atkCd = 0.78; PL.hp -= gd.atkDmg + 7; PL.inv = 0.48;
          spawnPts(PL.x, PL.y, '#f00', 9);
          showNotif('SWAT HIT!');
        }
      }

    } else if (c.raiding) {
      // ── Gang raid ─────────────────────────────────────────
      let nearGangIdx = -1, nearGangD = Infinity;
      for (let gi = 0; gi < gangs.length; gi++) {
        const gd2 = d2(c.x, c.y, gangs[gi].x, gangs[gi].y);
        if (gd2 < nearGangD) { nearGangD = gd2; nearGangIdx = gi; }
      }

      if (nearGangIdx >= 0 && nearGangD < 200 * 200) {
        const g     = gangs[nearGangIdx];
        const gdist = Math.sqrt(nearGangD);
        c.angle = Math.atan2(g.y - c.y, g.x - c.x);
        if (gdist > 20) _copSteerMove(c, c.angle, gd.spd, dt);
        if (gdist < 200 && c.shootCd <= 0) {
          c.shootCd = gd.shootCd * 0.85;
          shootB(c.x, c.y, c.angle + (Math.random() - 0.5) * 0.25, false, 360, gd.dmg, 0, 'cop');
        }
        if (gdist < 20 && c.atkCd <= 0) {
          c.atkCd = 0.9; g.hp -= gd.atkDmg + 6; spawnPts(g.x, g.y, '#f80', 5);
          if (g.hp <= 0) {
            spawnPts(g.x, g.y, '#f00', 10);
            gangs.splice(nearGangIdx, 1);
            showNotif('COP KILLED GANGSTER!');
          }
        }
      } else {
        const wdx = c.px - c.x, wdy = c.py - c.y;
        if (Math.sqrt(wdx * wdx + wdy * wdy) < 40 || c.patrolT <= 0) {
          if (c.patrolT <= 0) {
            c.raiding = false;
            const wp = safePatrolPt(); c.px = wp.px; c.py = wp.py; c.patrolT = 15;
          } else {
            const zone = GANG_ZONES_AVOID[Math.floor(Math.random() * GANG_ZONES_AVOID.length)];
            const wp   = raidPt(zone); c.px = wp.px; c.py = wp.py;
          }
        }
        c.angle = Math.atan2(wdy, wdx);
        _copSteerMove(c, c.angle, gd.spd, dt);
      }

    } else {
      // ── Patrol ────────────────────────────────────────────
      if (inGangZone) {
        const wp = safePatrolPt(); c.px = wp.px; c.py = wp.py; c.patrolT = 15;
        const evacAngle = Math.atan2(c.py - c.y, c.px - c.x);
        _copSteerMove(c, evacAngle, gd.spd, dt);
      } else {
        const wdx   = c.px - c.x, wdy = c.py - c.y;
        const wDist = Math.sqrt(wdx * wdx + wdy * wdy);
        const wpTX  = Math.floor(c.px / T), wpTY = Math.floor(c.py / T);

        if (isTileInGangZone(wpTX, wpTY, GANG_AVOID_MARGIN) || wDist < 32 || c.patrolT <= 0) {
          const wp = safePatrolPt(); c.px = wp.px; c.py = wp.py;
          c.patrolT = 14 + Math.random() * 10;
          c._stuckT = 0; c._checkX = c.x; c._checkY = c.y;
        }

        const toWP = Math.atan2(wdy, wdx);
        _copSteerMove(c, toWP, gd.spd * 0.65, dt);
      }
    }
  }
}

// ═════════════════════════════════════════
//  BULLETS  (unchanged — correct routing)
// ═════════════════════════════════════════
function _aiBullets(dt) {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    // Bug 9: Remove corrupted bullets
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx)) {
      bullets.splice(i, 1); continue;
    }
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;

    const hitWall = !isW(Math.floor(b.x / T), Math.floor(b.y / T));
    if (b.life <= 0 || hitWall) {
      if (b.spl > 0) explode(b.x, b.y, b.spl, b.dmg);
      bullets.splice(i, 1);
      continue;
    }

    if (b.fp) {
      let gone = false;
      for (let j = npcs.length - 1; j >= 0; j--) {
        const n = npcs[j];
        if (!n.isGiver && d2(b.x, b.y, n.x, n.y) < n.w * n.w) {
          n.hp -= b.dmg; n.flee = true; spawnPts(n.x, n.y, '#f80', 4);
          if (b.spl > 0) explode(b.x, b.y, b.spl, b.dmg);
          bullets.splice(i, 1);
          if (n.hp <= 0) {
            PL.score += 30; PL.cash += n.cash; addWanted(1);
            recordKill('npc');
            spawnPts(n.x, n.y, n.col, 12);
            npcs.splice(j, 1);
            showNotif('+$' + n.cash);
          }
          gone = true; break;
        }
      }
      if (!gone) for (let j = gangs.length - 1; j >= 0; j--) {
        const g = gangs[j];
        if (d2(b.x, b.y, g.x, g.y) < g.w * g.w) {
          g.hp -= b.dmg; spawnPts(g.x, g.y, '#f00', 4);
          // Mark this gangster as provoked — approval system uses this
          g.provoked = true;
          _gangAlertTimer = 18; // 18s gang-wide alert on any player hit
          if (b.spl > 0) explode(b.x, b.y, b.spl, b.dmg);
          bullets.splice(i, 1);
          if (g.hp <= 0) {
            PL.score += 80; PL.cash += 30; recordKill('gang');
            gangs.splice(j, 1);
            showNotif('GANGSTER +$30');
          }
          gone = true; break;
        }
      }
      if (!gone) for (let j = cops.length - 1; j >= 0; j--) {
        const c = cops[j];
        if (c.state === 'in_car' || c.state === 'riding') continue; // cop inside/on car
        if (d2(b.x, b.y, c.x, c.y) < c.w * c.w) {
          c.hp -= b.dmg; c._shotAt = true; spawnPts(c.x, c.y, '#00f', 4);
          if (b.spl > 0) explode(b.x, b.y, b.spl, b.dmg);
          bullets.splice(i, 1);
          if (c.hp <= 0) {
            const gr = COP_GRADES[c.grade || 0];
            PL.score += gr.reward; PL.cash += gr.reward; addWanted(2);
            recordKill('cop');
            spawnPts(c.x, c.y, '#00f', 14);
            showNotif(gr.name + ' +$' + gr.reward);
            _unlinkCopFromCar(c, j);
            cops.splice(j, 1);
          }
          continue; // bullet was spliced — skip to next bullet iteration
        }
      }
    } else if (b.src === 'gang') {
      let gone = false;
      for (let j = cops.length - 1; j >= 0; j--) {
        const c = cops[j];
        if (c.state === 'in_car') continue;
        if (d2(b.x, b.y, c.x, c.y) < c.w * c.w) {
          c.hp -= b.dmg; spawnPts(c.x, c.y, '#f44', 3); bullets.splice(i, 1);
          if (c.hp <= 0) {
            spawnPts(c.x, c.y, '#00f', 10);
            _unlinkCopFromCar(c, j);
            cops.splice(j, 1);
            showNotif('GANG KILLED COP!');
          }
          gone = true; break;
        }
      }
      if (!gone && !PL.inCar && PL.inv <= 0 && d2(b.x, b.y, PL.x, PL.y) < 12 * 12) {
        PL.hp -= b.dmg; PL.inv = 0.3; spawnPts(PL.x, PL.y, '#f00', 5);
        bullets.splice(i, 1);
      }
    } else {
      let gone = false;
      for (let j = gangs.length - 1; j >= 0; j--) {
        const g = gangs[j];
        if (d2(b.x, b.y, g.x, g.y) < g.w * g.w) {
          g.hp -= b.dmg; spawnPts(g.x, g.y, '#f80', 3); bullets.splice(i, 1);
          if (g.hp <= 0) {
            spawnPts(g.x, g.y, '#f00', 10);
            gangs.splice(j, 1);
            showNotif('COP KILLED GANGSTER!');
          }
          gone = true; break;
        }
      }
      if (!gone && !PL.inCar && PL.inv <= 0 && d2(b.x, b.y, PL.x, PL.y) < 12 * 12) {
        PL.hp -= b.dmg; PL.inv = 0.3; spawnPts(PL.x, PL.y, '#f00', 5);
        bullets.splice(i, 1);
      }
    }
  }
}

// ═════════════════════════════════════════
//  PICKUPS & PARTICLES
// ═════════════════════════════════════════
function _aiPickups(dt) {
  for (let i = picks.length - 1; i >= 0; i--) {
    const p = picks[i];
    p.bob += dt;
    if (d2(p.x, p.y, PL.x, PL.y) < 22 * 22) {
      if (p.t === 'hp') {
        PL.hp = Math.min(PL.maxHp, PL.hp + 25);
        showNotif('+25 HP');
      } else if (p.t === 'gun') {
        const gunPool = ['pistol', 'shotgun', 'uzi'];
        const wid = gunPool[Math.floor(Math.random() * gunPool.length)];
        const isNew = giveW(wid);
        showNotif(isNew ? WDEFS[wid].name + ' FOUND!' : WDEFS[wid].name + ' AMMO REFILLED');
        if (typeof buildWHUD === 'function') buildWHUD();
      } else {
        const a = 20 + Math.floor(Math.random() * 80);
        PL.cash += a; PL.score += 10;
        showNotif('+$' + a);
      }
      spawnPts(p.x, p.y, p.t === 'hp' ? '#f44' : p.t === 'gun' ? '#0ff' : '#ff0', 8);
      picks.splice(i, 1);
    }
  }
}

function _aiParticles(dt) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vx *= 0.87; p.vy *= 0.87;
    p.life -= dt;
    if (p.life <= 0) parts.splice(i, 1);
  }
}
