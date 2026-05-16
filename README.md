# Street Crime — TTA v1.0.3
A 2D top-down open-world crime game (GTA-style), playable in the browser.  
No install. No build step. Open `index.html` via a local server and play.

---

## Quick Start

```bash
cd streetcrime
python3 -m http.server 8080
# Open http://localhost:8080
```

Or use VS Code Live Server. **Must be served over HTTP** — `file://` won't work (CORS).

---

## Controls

| Action | Keyboard | Mobile |
|--------|----------|--------|
| Move | `WASD` / Arrow keys | Left joystick |
| Shoot | `Space` | Fire button |
| Enter/Exit car | `F` | Button |
| Interact / Talk | `E` | Button |
| Full map | `M` | Button |
| Shop (in shop zone) | `B` | Button |

---

## File Structure

```
streetcrime/
├── index.html        ← HTML shell, CSS, HUD, shop UI, script loader
├── world.js          ← Map, tiles, zones, weapons, cars, entities, mvE()
├── cops.js           ← Cop grades, spawning, wanted system, raids, HQ
├── gangsters.js      ← Gang factions, turf, spawning
├── architecture.js   ← Named landmark buildings rendered over tile grid
├── assets.js         ← SVG sprites, tile textures, drawCar(), utilities
├── game.js           ← Input, shop, HUD, physics, main render + game loop
├── ai.js             ← AI v2: traffic, NPC, gangster, cop, police car AI
├── missions.js       ← Mission zones, objectives, rewards, dialogue
├── approval.js       ← City approval rating: tiers, perks, penalties
├── cartel_cove.js    ← [EXPANSION] Cartel Cove island, 6 island missions
├── island_b.js       ← [DISABLED] Events & Weather (uncomment to enable)
└── README.md
```

---

## Script Load Order

```html
<script src="world.js"></script>
<script src="cops.js"></script>
<script src="gangsters.js"></script>
<script src="architecture.js"></script>
<script src="assets.js"></script>
<script src="game.js"></script>
<script src="ai.js"></script>
<script src="missions.js"></script>
<script src="approval.js"></script>
<script src="cartel_cove.js"></script>         <!-- Cartel Cove island -->
<!-- <script src="island_b.js"></script> -->   <!-- Events & Weather (disabled) -->
```

---

## World

- **Map size:** 175×175 tiles (40px/tile) = 7,000×7,000 px world
- **Traffic cars spawned:** 38 AI traffic + 80 parked cars
- **NPC civilians:** dynamic respawn across all zones

### City Districts (Main Island)

| District | Character |
|----------|-----------|
| Downtown | Dense urban core, high NPC density |
| Midtown | Commercial mix |
| Industrial | Factories, warehouses, low density |
| Docklands | Port area, gang activity |
| East Side | East Side Crew turf |
| Suburbs | Residential, low density |
| Westgate | Transition zone |

### Special Zones

| Zone | Purpose |
|------|---------|
| Hospital | NPC spawn point |
| Gang Turf ×2 | East Side Crew & West Block territory |
| Cop HQ | Police headquarters, raid spawn point |
| Shop ×4 | Weapon/item stores (corners of map) |

### Landmarks (architecture.js)

City Hall, Meridian Tower, Commerce Plaza, Grand Hotel, Central Market,  
City Arena, First National Bank, Steelworks, Port Storage, Auto Plant,  
East Side HQ, West Side HQ, Pawn & Gun.

---

## Player Stats

| Stat | Value |
|------|-------|
| Base HP | 100 |
| Max HP (armored) | 150 |
| Base speed | 118 px/s |
| Sprint multiplier | 1.8× |

---

## Vehicles

| Name | Max Speed | Accel | Handling | Notes |
|------|-----------|-------|----------|-------|
| Sedan | 150 | 200 | 5.5 | Standard car |
| Sports | 240 | 340 | 7.0 | Fastest |
| Truck | 110 | 140 | 3.5 | Slow, wide |
| SUV | 140 | 175 | 4.5 | Balanced |
| Muscle | 220 | 290 | 6.0 | High speed |
| Taxi | 145 | 205 | 5.5 | Common traffic |
| Van | 105 | 138 | 3.0 | Slowest |
| Coupe | 200 | 265 | 6.5 | Agile |

---

## Weapons

| Weapon | DMG | Fire Rate | Ammo | Special | Shop Price |
|--------|-----|-----------|------|---------|------------|
| Fists | 22 | 0.44s | ∞ | Melee only | Free |
| Pistol | 13 | 0.27s | 30 | — | $200 |
| Shotgun | 8×5 | 0.62s | 15 | 5-pellet spread | $500 |
| Uzi | 8 | 0.09s | 60 | Full auto | $700 |
| Sniper | 80 | 1.10s | 10 | Long range, precise | $1,200 |
| RPG | 120 | 1.30s | 5 | Splash (60px radius) | $2,500 |

Weapon stats are **runtime-frozen** — cannot be edited via browser console.

---

## Shop Items

| Item | Price | Effect |
|------|-------|--------|
| Med Kit | $150 | +50 HP |
| Body Armor | varies | Max HP → 150 |
| Ammo Refill | varies | Refills current weapon |
| Weapons | $200–$2,500 | See weapon table above |

Enter any of the 4 **SHOP** zones and press `B` / shop button.

---

## Missions (Main Island)

6 missions, each triggered by entering a named zone on foot:

| ID | Zone | Type | Reward | Timer |
|----|------|------|--------|-------|
| delivery_01 | Phone Booth | Delivery | $600 | 70s |
| hit_01 | Contact | Elimination | $900 | None |
| rampage_01 | Gang Boss | Rampage ×10 | $1,400 | 90s |
| escape_01 | Safehouse | Escape | $1,600 | None |
| patrol_01 | Cop Informant | Delivery | $700 | 90s |
| delivery_02 | Northgate Job | Rampage ×5 | $2,000 | 120s |

Completing or failing a mission triggers a **3s cooldown** before the zone can re-offer it.  
Each reward fires exactly once per completion (guarded by `rewardGiven` flag).

---

## Wanted System

| Stars | Response |
|-------|----------|
| ★1 | Patrol cops on foot |
| ★2 | Patrol + Sergeant, cop cars |
| ★3 | Sergeant + Detective, more cars |
| ★4 | SWAT units |
| ★5 | SWAT + helicopter orbit |

- Max 40 total cop entities (hard cap — prevents memory leak)
- Wanted decays automatically if you evade long enough
- Cop grades: **Patrol → Sergeant → Detective → SWAT**

---

## Cop Grade Reference

| Grade | HP | Speed | Shoot CD | Vehicle | Min Stars |
|-------|----|-------|----------|---------|-----------|
| Patrol | 50 | 88 | 1.1s | Blue cruiser | ★1 |
| Sergeant | 80 | 95 | 0.9s | Blue cruiser | ★2 |
| Detective | 70 | 100 | 0.8s | On foot only | ★3 |
| SWAT | 130 | 82 | 0.7s | Black SUV | ★4 |

Cop grades, HP, and speeds are **runtime-frozen**.

---

## Gang Factions

| Faction | Name | Zone | HP | Speed | Cash Drop |
|---------|------|------|----|-------|-----------|
| east | East Side Crew | gangA | 45 | 75 | $30 |
| west | West Block | gangB | 50 | 70 | $35 |

Gangsters use **cover/peek** behavior and coordinate flanking when multiple are nearby.

---

## City Approval

Actions raise or lower a 0–100 approval rating:

| Action | Change |
|--------|--------|
| Kill gangster | +3 |
| Complete mission | +10 |
| Fail mission | −4 |
| Kill cop | −8 |
| Hit civilian with car | −2 |
| Kill civilian | −15 |

### Approval Tiers

| Tier | Range | Effect |
|------|-------|--------|
| HERO | 80–100 | Civilians tip you off, cops slower to engage |
| RESPECTED | 60–79 | Small cash bonus on kills |
| NEUTRAL | 40–59 | Default city attitude |
| CRIMINAL | 20–39 | Civilians flee faster, gang aggro increases |
| VILLAIN | 0–19 | Cops spawn faster, civilians sprint, bounty active |

Approval deltas are **runtime-frozen**.

---

## AI System (ai.js v2)

| System | Behaviour |
|--------|-----------|
| Traffic | Smooth accel/decel, stops at busy intersections |
| Civilians | Group panic contagion, rare police phone call |
| Gangsters | Cover/peek, faction patrol routes, coordinated flanking |
| Cops (foot) | Wall-steering chase, radio callout, intercept prediction |
| Police cars | Path prediction, PIT maneuver, 2-cop units (driver + passenger) |
| Helicopter | SWAT orbit at ★5, drops SWAT units |

All AI loops have **NaN/Infinity guards** — corrupted entities are removed rather than freezing the system.

---

## Expansion: Cartel Cove Island (`cartel_cove.js`)

A second island connected to the main map via bridges.  
**Active by default** — loaded last in `index.html`.

### Island Zones

Beach Resort, Cartel Mansion, Casino, Black Market, Airstrip, Drug Lab, Cartel HQ, Fight Club, Smuggler Docks.

### Island Missions

| ID | Zone | Type | Reward | Timer |
|----|------|------|--------|-------|
| casino_heist | Casino Vault | Rampage ×8 | $2,500 | 60s |
| cartel_boss | Cartel Hideout | Elimination | $3,200 | None |
| island_run | Dockmaster | Delivery | $1,600 | 80s |
| airstrip_heist | Runway Intel | Rampage ×10 | $2,200 | 70s |
| fight_champion | Fight Promoter | Escape | $2,800 | None |
| drug_bust | Undercover Op | Rampage ×12 | $3,000 | 90s |

---

## Expansion: Events & Weather (`island_b.js`)

Disabled by default. Uncomment in `index.html` and add hooks in `game.js`:

```js
if (typeof initEvents    === 'function') initEvents();
if (typeof updateEvents  === 'function') updateEvents(dt);
if (typeof renderWeather === 'function') renderWeather(CX);
```

---

## Bug Fixes (v1.0.3)

18 bugs patched across 6 files:

| # | Bug | File | Fix |
|---|-----|------|-----|
| 1 | DeltaTime teleport on tab-switch | game.js | `dt` clamped to 0.1s max |
| 2 | NaN/Infinity physics corruption | game.js, world.js, ai.js | `Number.isFinite()` guards throughout |
| 3 | Collision bypass / wall clipping | world.js | Boundary clamp in `mvE()` |
| 4 | Health overflow / underflow | game.js | HP clamped every frame |
| 5 | Money duplication across frames | missions.js | `rewardGiven` flag per mission |
| 6 | Mission retrigger spam | missions.js | Zone cooldown (3s complete / 2s fail) |
| 7 | Mission state corruption on restart | missions.js | Phase validated before `_startMission` |
| 8 | Mission complete + fail same frame | missions.js | State-machine guard in both handlers |
| 9 | AI freeze on invalid values | ai.js | NaN check at start of each AI loop |
| 10 | Infinite police spawn / memory leak | cops.js | Hard cap: max 40 cop entities |
| 11 | AI jitter / target snap | ai.js | Smoothed movement interpolation |
| 12 | Keyboard + touch input conflict | game.js | Keyboard takes priority when active |
| 13 | Touch event crash on null touch | game.js | `e.touches[0]` null-checked |
| 14 | Interaction key spam | game.js | Single-use interaction tracking |
| 15 | Array mutation skip (undead enemies) | ai.js | Reverse iteration in all entity loops |
| 16 | Floating point drift over time | game.js | Position rounded every 5s |
| 17 | Global variable pollution | world.js, cops.js, approval.js | Critical constants frozen with `Object.freeze` |
| 18 | Runtime function/stat tampering | world.js, cops.js, approval.js | `WDEFS`, `COP_GRADES`, `APR_DELTA` frozen |

---

## Module Responsibilities (Summary)

| File | Owns |
|------|------|
| `world.js` | Map, tiles, zones, `mvE()`, `WDEFS`, `PL`, entity helpers |
| `cops.js` | `COP_GRADES`, `cops[]`, `pcars[]`, spawn/wanted logic |
| `gangsters.js` | `GANG_DEFS`, `gangs[]`, turf system, spawn logic |
| `architecture.js` | Named landmark buildings, `renderArchitecture()` |
| `assets.js` | All SVGs, tile textures, `drawCar()`, sprite cache |
| `game.js` | Input, shop, HUD, physics tick, full render, game loop |
| `ai.js` | All AI movement & behaviour for every entity type |
| `missions.js` | Mission zones, objectives, dialogue, reward flow |
| `approval.js` | Approval rating, tier effects, `APR_DELTA` |
| `cartel_cove.js` | Second island: zones, 6 missions, cartel enemies |
