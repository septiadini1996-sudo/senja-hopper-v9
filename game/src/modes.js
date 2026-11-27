// The four extra ways to fly (v15): SKY PATROL, RING RUSH, FREE FLIGHT
// and AIR RACE. Everything in here is pure logic over plain data — the
// wave tables, the drone movement and gunnery, the rush combo ledger,
// the race standings and rubber band — so the logic suite can pin every
// rule without a browser. main.js owns the DOM, the scene and the clock;
// this module owns only the judgement of what the modes DO.
import { mulberry32, clamp } from './util.js';

// ---------- shared ----------
// A mode sortie's clock: three minutes, the length of a campaign hop
// flown hard. Patrol and Rush both live inside it.
export const MODE_SECONDS = 180;

// ---------- SKY PATROL ----------
// Smuggler drones over the sea lanes. They come in waves that grow
// teeth: more airframes, quicker weaving, a faster flee. The drones
// never shoot back — but from wave 2 the smugglers send escort planes
// that do (v15.2): the patrol stops being a hunt and becomes a fight,
// with a lock-on sight, tracer fire both ways, and hull on both sides.
export function patrolWaveSpec(wave) {
  return {
    count: Math.min(2 + wave, 7),              // wave 1: 3, then +1 a wave
    flee: 9 + wave * 1.6,                      // m/s they run at, once spooked
    weaveAmp: 7 + wave * 1.5,                  // metres of lateral weave
    weaveFreq: 0.55 + wave * 0.09,             // Hz of the weave
    altAmp: 2.2 + wave * 0.5,                  // metres of vertical bob
    points: 100 + (wave - 1) * 25,             // a later drone is worth more
  };
}

// Lay one wave ahead of the patrol (v15.1 visibility fix): the first
// sky the patrol met dealt its quarry 650–1,050 m out in a fixed low
// band, and a human pilot flew a whole sortie without ever finding
// one. A wave now deals INTO the patrol's own sky — a cone in front of
// her heading, 300–600 m out, stacked within a wing's climb of the
// altitude she already holds — so a patrol that simply flies straight
// meets its targets, and the guide (below) only has to finish the
// interception. Deterministic in (seed, wave) so a staged frame and a
// test see the same sky. `origin` is the patrol's own state {dist, x,
// alt}; a bare number still reads as a distance on the centreline in
// the old band, for the callers that deal a sky before she is airborne.
export const SPAWN_MIN = 300, SPAWN_MAX = 600;   // metres ahead of the nose
export const SPAWN_CONE = 0.16;                  // lateral half-spread, × range
export const SPAWN_ALT_BAND = 150;               // metres either side of her altitude
export function spawnPatrolWave(seed, wave, origin) {
  const o = typeof origin === 'number' ? { dist: origin, x: 0, alt: 30 } : origin;
  const spec = patrolWaveSpec(wave);
  const rnd = mulberry32(seed * 100003 + wave * 7919);
  const drones = [];
  for (let i = 0; i < spec.count; i++) {
    const range = Math.min(SPAWN_MAX, SPAWN_MIN + rnd() * 270 + i * 8);
    const baseDist = o.dist + range;
    const baseX = o.x + (rnd() * 2 - 1) * range * SPAWN_CONE;
    const baseAlt = clamp(o.alt + (rnd() * 2 - 1) * 45, 9, o.alt + SPAWN_ALT_BAND);
    drones.push({
      id: wave * 100 + i, wave, kind: 'drone',
      baseDist, baseX, baseAlt,
      dist: baseDist, x: baseX, altM: baseAlt,
      phase: rnd() * Math.PI * 2,
      flee: 0, alive: true, escaped: false,
      hp: DRONE_HP, vDist: 0, vX: 0, vAlt: 0,
    });
  }
  return drones;
}

// The patrol's guide (v15.1): the nearest live drone, named in the
// plane's own numbers — how far right, how far ahead, how far above,
// and the slant range the HUD prints. A drone already sliding past
// the nose is no target at all (the guns only speak forward), so the
// guide prefers quarry still ahead of her and only falls back to any
// live drone when nothing ahead remains. Pure, so the logic suite can
// pin the choice and the flow pilot can fly by the same numbers the
// player's marker shows.
export function patrolGuide(drones, f) {
  let ahead = null, any = null;
  for (const d of drones) {
    if (!d.alive || d.escaped) continue;
    const dx = d.x - f.x, dz = d.dist - f.dist, dAlt = d.altM - f.alt;
    const cand = { drone: d, dx, dz, dAlt, range: Math.hypot(dx, dz, dAlt) };
    if (!any || cand.range < any.range) any = cand;
    if (dz > -10 && (!ahead || cand.range < ahead.range)) ahead = cand;
  }
  return ahead || any;
}

// Advance every live drone one step. A drone weaves around its base
// point; once the patrol closes inside 420 m it runs — its base point
// slides forward at the wave's flee speed — and if it still gets past
// the plane's nose (or the plane passes it), it is gone for good.
// Each drone also reports its velocity (v15.2): the lock-on sight
// leads its target by these numbers, so they are part of the model.
export function stepDrones(drones, playerDist, dt, t) {
  for (const d of drones) {
    if (!d.alive || d.escaped) continue;
    const spec = patrolWaveSpec(d.wave);
    const gap = d.baseDist - playerDist;
    if (gap < 420 && gap > -40) d.flee = Math.min(1, d.flee + dt * 1.4);
    d.baseDist += spec.flee * d.flee * dt;
    const px = d.x, pz = d.dist, pa = d.altM;
    d.dist = d.baseDist;
    d.x = d.baseX + Math.sin(t * spec.weaveFreq * Math.PI * 2 + d.phase) * spec.weaveAmp;
    d.altM = Math.max(6, d.baseAlt + Math.sin(t * spec.weaveFreq * 1.7 * Math.PI * 2 + d.phase * 1.3) * spec.altAmp);
    if (dt > 0) {
      d.vX = (d.x - px) / dt; d.vDist = (d.dist - pz) / dt; d.vAlt = (d.altM - pa) / dt;
    }
    if (d.dist < playerDist - 45) d.escaped = true;
  }
  return drones;
}

// One trigger pull, judged: the guns are fixed to the nose, so a hit is
// a drone inside the sight's cone ahead — near enough to matter, close
// enough to the line the nose points along. The cone widens with range
// the way a real burst spreads. Returns the drone hit (nearest first)
// or null; the caller owns the effects and the ledger.
export const GUN_RANGE = 300;
export function patrolShot(drones, f) {
  let best = null, bestDz = Infinity;
  for (const d of drones) {
    if (!d.alive || d.escaped) continue;
    const dz = d.dist - f.dist;
    if (dz < 12 || dz > GUN_RANGE) continue;
    const tol = 3.2 + dz * 0.028; // the cone: ±3.2 m at the muzzle, ±11.6 m at full range
    if (Math.abs(d.x - f.x) <= tol && Math.abs(d.altM - f.alt) <= tol && dz < bestDz) {
      best = d; bestDz = dz;
    }
  }
  return best;
}

// The patrol ledger: what the receipt reads and the best remembers.
// v15.2 adds the fight's own state: the player's hull, the escort
// list, the lock the sight holds, and the bandit bookkeeping.
export function createPatrol() {
  return {
    wave: 0, drones: [], downed: 0, shots: 0, hits: 0, score: 0, left: MODE_SECONDS, over: false,
    hp: PLAYER_HP, maxHp: PLAYER_HP, escorts: [], lock: createLock(),
    banditsDown: 0, banditSeen: false, hurtAge: Infinity, stickHeat: 0,
  };
}
export function patrolAccuracy(st) {
  return st.shots > 0 ? st.hits / st.shots : 0;
}

// ---------- SKY PATROL: the fight (v15.2) ----------
// Hull and gun damage, both sides of the fight. One solid burst hit
// is worth GUN_DMG everywhere the patrol's guns speak: a drone's
// 30 HP falls to three of them, an escort's 90 HP to eight — the
// drone stays a quick kill, the bandit is a commitment. The player's
// own hull is 100 for the sortie and never heals mid-flight.
export const GUN_DMG = 12;
export const DRONE_HP = 30;
export const ESCORT_HP = 90;
export const ESCORT_POINTS = 300; // a bandit is worth three wave-1 drones
export const PLAYER_HP = 100;

// One hit's bookkeeping: returns true when this hit is the kill.
export function applyGunDamage(t, dmg) {
  if (!t.alive) return false;
  t.hp -= dmg;
  if (t.hp <= 0) { t.alive = false; return true; }
  return false;
}

// ----- lock-on -----
// The sight thinks in the nose's own frame: a target is lockable
// while it sits inside a ±25° cone off the nose and inside 800 m.
// Held in the cone for LOCK_ACQUIRE_S the lock bites; out of the cone
// for LOCK_BREAK_S it lets go. While locked, fire is judged against
// the target's LEAD point (where it will be when the burst arrives,
// at a 320 m/s projectile) with a dispersion that tightens as the
// lock is held — full tight after LOCK_FULL_S. Unlocked fire is
// untouched: patrolShot above still judges it, exactly as v15 did.
export const LOCK_RANGE = 800;
export const LOCK_CONE_TAN = Math.tan(25 * Math.PI / 180); // ≈ 0.466
export const LOCK_ACQUIRE_S = 0.5;
export const LOCK_BREAK_S = 0.8;
export const LOCK_FULL_S = 1.5;
export const HIT_RADIUS = { drone: 2.6, escort: 5.0 }; // metres of airframe to strike

export function inLockCone(t, f) {
  const dz = t.dist - f.dist;
  if (dz <= 0) return false;
  const dx = t.x - f.x, dAlt = t.altM - f.alt;
  const range = Math.hypot(dx, dz, dAlt);
  if (range > LOCK_RANGE) return false;
  return Math.hypot(dx, dAlt) <= dz * LOCK_CONE_TAN;
}

// The nearest lockable target — what the sight offers next.
export function lockCandidate(targets, f) {
  let best = null, bestRange = Infinity;
  for (const t of targets) {
    if (!t.alive || t.escaped || !inLockCone(t, f)) continue;
    const range = Math.hypot(t.x - f.x, t.dist - f.dist, t.altM - f.alt);
    if (range < bestRange) { best = t; bestRange = range; }
  }
  return best;
}

export function createLock() {
  return { target: null, tIn: 0, tOut: 0, held: 0, locked: false };
}

export function stepLock(lock, targets, f, dt) {
  let t = lock.target;
  if (t && (!t.alive || t.escaped)) t = null;
  if (t && inLockCone(t, f)) {
    lock.target = t;
    lock.tIn += dt;
    lock.tOut = 0;
    if (lock.tIn >= LOCK_ACQUIRE_S) {
      if (!lock.locked) { lock.locked = true; lock.held = 0; }
      else lock.held += dt;
    }
    return lock;
  }
  if (t) {
    // Out of the cone: the lock holds its breath, then lets go.
    lock.tOut += dt;
    if (lock.locked) lock.held += dt;
    if (lock.tOut <= LOCK_BREAK_S) return lock;
  }
  // Dropped (or never held): offer the nearest target in the cone.
  const cand = lockCandidate(targets, f);
  lock.target = cand;
  lock.tIn = cand ? dt : 0;
  lock.tOut = 0;
  lock.held = 0;
  lock.locked = false;
  return lock;
}

// Where the target will be when the burst gets there: its own motion
// chased by the relative geometry, at a 320 m/s projectile.
export function leadPoint(t, f) {
  const range = Math.hypot(t.x - f.x, t.dist - f.dist, t.altM - f.alt);
  const tt = range / 320;
  return {
    x: t.x + ((t.vX || 0)) * tt,
    altM: t.altM + ((t.vAlt || 0) - (f.vs || 0)) * tt,
    dist: t.dist + ((t.vDist || 0) - (f.speed || 0)) * tt,
    range,
  };
}

// The burst's spread at the target, in metres: wide on a fresh lock,
// tight once the lock has been held LOCK_FULL_S, and wider again the
// farther the burst has to travel.
export function lockDispersion(lock, range) {
  const settle = clamp((lock.held || 0) / LOCK_FULL_S, 0, 1);
  return (5.5 + (1.1 - 5.5) * settle) * (1 + range / 600);
}

// One locked trigger pull, judged: the burst is centred on the lead
// point and scattered by the lock's dispersion; it strikes when the
// scattered aim still lands inside the target's airframe radius of
// where the target will be when the burst arrives. Returns
// { hit, aim, target } or null when there is no lock to fire.
export function resolveLockedShot(lock, f, rnd) {
  const t = lock.target;
  if (!t || !lock.locked || !t.alive || t.escaped) return null;
  const lead = leadPoint(t, f);
  const disp = lockDispersion(lock, lead.range);
  const aim = {
    x: lead.x + (rnd() * 2 - 1) * disp,
    altM: lead.altM + (rnd() * 2 - 1) * disp,
    dist: lead.dist,
  };
  const off = Math.hypot(aim.x - lead.x, aim.altM - lead.altM);
  return { hit: off <= (HIT_RADIUS[t.kind] || 2.6), aim, target: t };
}

// ----- the escorts: bandits that shoot back -----
// From wave 2 the smugglers fly cover: one escort, two from wave 4.
// They wear the game's own airframes in smuggler colours — a dark-red
// Pipit and a black Alap-Alap — and they fly real flight states under
// banditFrame below (main.js steps them through the flight model).
export const ESCORTS = [
  { planeId: 'pipit', name: 'BANDIT 1',
    spec: { body: [0.30, 0.07, 0.06], accent: [0.08, 0.08, 0.09], cheat: [0.55, 0.10, 0.08], span: 0.92, scale: 0.98 } },
  { planeId: 'alap', name: 'BANDIT 2',
    spec: { body: [0.10, 0.10, 0.12], accent: [0.62, 0.08, 0.07], cheat: [0.62, 0.08, 0.07], span: 1.07, scale: 1.04 } },
];
export function escortCountForWave(wave) {
  return wave >= 4 ? 2 : wave >= 2 ? 1 : 0;
}
export function createEscort(id, slot) {
  return {
    id, kind: 'escort', slot, hp: ESCORT_HP, maxHp: ESCORT_HP,
    alive: true, escaped: false, phase: 'close', side: slot % 2 === 0 ? -1 : 1,
    cool: 0, burstCd: 1.4 + slot * 0.6,
    dist: 0, x: 0, altM: 30, vDist: 0, vX: 0, vAlt: 0, propSpin: 0,
    flight: null, mesh: null,
  };
}

// The bandit's flying brain, in the demo pilot's idiom: steer the
// flight model's stick toward the intercept, throttle for the geometry.
// Behind her it closes at a margin over her speed; ahead of her it
// throttles back and drifts wide and high, letting her run into its
// next pass. Between passes it simply comes around again.
export function banditFrame(esc, p, dt) {
  const e = esc.flight;
  const rel = e.dist - p.dist; // negative: the bandit is behind her
  let tgtX = p.x, tgtAlt = clamp(p.alt, 16, 95), thr;
  if (rel > 60) {
    // Overshot: get out of her sky, wide and high, and let her pass.
    esc.phase = 'reposition';
    tgtX = p.x + esc.side * (rel > 320 ? 120 : 55);
    tgtAlt = clamp(p.alt + (rel > 320 ? 14 : 6), 20, 110);
    thr = rel > 320 ? 0.42 : 0.55;
  } else if (rel < -260) {
    esc.phase = 'close';
    thr = 1.0;
  } else {
    esc.phase = rel < -40 ? 'close' : 'pass';
    thr = clamp(0.8 + (p.speed * 1.10 - e.speed) / 30, 0.62, 0.97);
  }
  const wantVs = clamp((tgtAlt - e.alt) * 0.22, -5.5, 6.2);
  return {
    pitch: clamp(wantVs / 7, -1, 1),
    roll: clamp((tgtX - e.x) * 0.055, -1, 1),
    throttle: thr,
  };
}

// The firing judgement: a burst leaves when she is inside ~500 m,
// ahead of the bandit's nose, and near enough its line that the
// tracers mean something — the same cone the player's guide reads.
export const BANDIT_RANGE = 500;
export const BANDIT_CONE_TAN = Math.tan(20 * Math.PI / 180); // ≈ 0.364
export function banditFireSolution(esc, p) {
  const e = esc.flight;
  if (!e || !esc.alive) return null;
  const dz = p.dist - e.dist;
  if (dz <= 0) return null;
  const dx = p.x - e.x, dAlt = p.alt - e.alt;
  const perp = Math.hypot(dx, dAlt);
  const range = Math.hypot(perp, dz);
  if (range > BANDIT_RANGE || perp > dz * BANDIT_CONE_TAN) return null;
  return { range, perp, dz };
}

// What one burst costs her — the damage model, stated plainly:
//   base 10, the full weight of a burst dead astern at point blank.
//   × range: full to 120 m, fading to 0.45 at the 500 m limit —
//     distance spreads a burst the way it spreads hers.
//   × aspect: dead astern (perp ≈ 0) takes the full weight; the
//     wider the bandit sits off her tail line, the less lands,
//     floored at 0.35 so a crossing shot still stings.
//   × evasion: HALVED while she holds a hard bank (|bank| > 0.5),
//     and cut to 0.65 while she is manoeuvring (a big stick input in
//     the last moments) — a jinking patrol is hard to hit, and the
//     way out of a firing pass is to fly, not to soak.
export function banditBurstDamage(sol, evade) {
  const rangeF = 1 - 0.55 * clamp((sol.range - 120) / 380, 0, 1);
  const aspectF = Math.max(0.35, 1 - (sol.perp / Math.max(1, sol.dz)) * 1.15);
  let dmg = 10 * rangeF * aspectF;
  if (Math.abs(evade.bank || 0) > 0.5) dmg *= 0.5;
  if (evade.manoeuvring) dmg *= 0.65;
  return Math.round(dmg * 10) / 10;
}

// ---------- RING RUSH ----------
// Three minutes of rings that never stop coming. The ledger is the
// whole game: a threaded ring pays 100 × the combo it extends, and the
// combo is a promise the next ring can break.
export const RUSH_BASE = 100;
export function createRush() {
  return { score: 0, combo: 0, streak: 0, bestStreak: 0, threaded: 0, missed: 0, left: MODE_SECONDS, over: false };
}
export function rushRingPassed(st) {
  st.combo += 1;
  st.threaded += 1;
  st.streak += 1;
  st.bestStreak = Math.max(st.bestStreak, st.streak);
  const pts = RUSH_BASE * st.combo;
  st.score += pts;
  return pts;
}
export function rushRingMissed(st) {
  st.combo = 0;
  st.streak = 0;
  st.missed += 1;
  return 0;
}

// The rush course: rings dealt ahead forever, spaced for a ring every
// six or seven seconds at cruise, altitudes wandering a smooth band the
// wing can always reach from the last one. Deterministic per index, so
// appended batches continue the same course the first batch began.
export function rushRing(seed, index, afterDist) {
  const rnd = mulberry32(seed * 31 + index * 1013904223);
  const gap = 265 + rnd() * 70;
  const wave = Math.sin(index * 0.55) * 16 + Math.sin(index * 0.23 + 1.7) * 10;
  const altM = clamp(34 + wave + (rnd() * 2 - 1) * 7, 13, 62);
  return {
    dist: afterDist + gap, altM, x: (rnd() * 2 - 1) * 17,
    passed: false, missed: false,
  };
}

// ---------- FREE FLIGHT ----------
// No job, no clock, no way to lose. A leg runs from the island she
// stands on to the next one along the chain — east until Papua, then
// the chain turns and runs west, so the flying never has to stop.
export function freeLeg(at, islandCount) {
  if (at < islandCount - 1) return { from: at, to: at + 1 };
  return { from: at, to: at - 1 };
}

// ---------- FREE FLIGHT: stunt scoring (v15.3) ----------
// The DIRECT handling's aerobatics (flight.js detects the completed
// turns) are Free Flight's second harvest: a loop is worth more
// than a barrel roll — it costs more height and more nerve — and
// the sortie's stunt score banks a best in the mode ledger. The
// motion itself is available in every mode under DIRECT; only
// Free Flight scores it.
export const STUNT_POINTS = { loop: 250, roll: 150 };
export function stuntScoreOf(loops, rolls) {
  return (loops || 0) * STUNT_POINTS.loop + (rolls || 0) * STUNT_POINTS.roll;
}
export function recordStunts(modes, loops, rolls) {
  const score = stuntScoreOf(loops, rolls);
  const best = score > (modes.stuntBest || 0);
  if (best) modes.stuntBest = score;
  return { score, best };
}

// ---------- AIR RACE ----------
// Lombok → Sumbawa: a mid-chain hop with room to run. Two rivals fly
// it against her, driven by the game's own demo pilot (main.js wires
// pilotFrame to their flight states) — this module owns only the
// race's arithmetic: progress, standings, the rubber band, and the
// projected finish for a rival still flying when she crosses.
export const RACE_FROM = 2; // Lombok
export const RACE_TO = 3;   // Sumbawa
export const RACE_GATE_BONUS = 25; // metres of progress each threaded gate is worth

// The rivals: the game's own airframes in liveries she does not wear —
// a teal-and-white Pipit and a black-and-gold Alap-Alap, quick enough
// to matter, neither one the flagship.
export const RIVALS = [
  { name: 'Sinta', callsign: 'PK-SNT', planeId: 'pipit',
    spec: { body: [0.88, 0.94, 0.95], accent: [0.10, 0.55, 0.55], cheat: [0.10, 0.55, 0.55], span: 0.92, scale: 0.94 } },
  { name: 'Bagas', callsign: 'PK-BGS', planeId: 'alap',
    spec: { body: [0.16, 0.17, 0.20], accent: [0.95, 0.70, 0.15], cheat: [0.95, 0.70, 0.15], span: 1.07, scale: 1.02 } },
];

export function raceProgress(f) {
  return (f ? f.dist : 0) + (f ? f.ringsHit : 0) * RACE_GATE_BONUS;
}

// 1st, 2nd or 3rd: her place among the rivals by course progress.
export function racePosition(player, rivals) {
  const p = raceProgress(player);
  let pos = 1;
  for (const r of rivals) if (raceProgress(r) > p) pos += 1;
  return pos;
}

// The rubber band, capped at ±8%: a rival behind her is lent a little
// speed, a rival ahead is quietly taxed the same — races stay close
// without ever turning into a tow. Measured on raw distance: gates are
// flavour on the line, not a tow rope.
export const BAND_CAP = 0.08;
export function raceBand(playerDist, aiDist) {
  return clamp(1 + (playerDist - aiDist) * 0.00045, 1 - BAND_CAP, 1 + BAND_CAP);
}

// A rival's finish, real or projected: one who has crossed reads his
// own clock; one still flying is projected at the speed he holds now,
// never slower than a walking pace so the estimate stays finite.
export function raceFinishTime(rivalFlight, nowT) {
  if (!rivalFlight) return null;
  if (rivalFlight.done) return rivalFlight.t;
  const remain = Math.max(0, rivalFlight.legDist - rivalFlight.dist);
  const v = Math.max(6, rivalFlight.speed || 0);
  return nowT + remain / v;
}

// ---------- mode bests ----------
// The save's mode ledger: a finished sortie writes its line here, and
// the title's mode cards read the bests back. Pure over the modes
// object so the migration and the bookkeeping test without a browser.
export function defaultModes() {
  return { patrolBest: 0, patrolDowned: 0, rushBest: 0, rushStreak: 0, raceBest: null, raceWins: 0, freeVisits: [], stuntBest: 0 };
}
export function recordPatrol(modes, score, downed) {
  const best = score > (modes.patrolBest || 0);
  if (best) modes.patrolBest = score;
  if (downed > (modes.patrolDowned || 0)) modes.patrolDowned = downed;
  return best;
}
export function recordRush(modes, score, bestStreak) {
  const best = score > (modes.rushBest || 0);
  if (best) modes.rushBest = score;
  if (bestStreak > (modes.rushStreak || 0)) modes.rushStreak = bestStreak;
  return best;
}
export function recordRace(modes, position) {
  const best = modes.raceBest === null || modes.raceBest === undefined || position < modes.raceBest;
  if (best) modes.raceBest = position;
  if (position === 1) modes.raceWins = (modes.raceWins || 0) + 1;
  return best;
}
export function recordFreeVisit(modes, islandId) {
  if (!Array.isArray(modes.freeVisits)) modes.freeVisits = [];
  if (modes.freeVisits.includes(islandId)) return false;
  modes.freeVisits.push(islandId);
  return true;
}
