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
// teeth: more airframes, quicker weaving, a faster flee. They never
// shoot back — the patrol is a hunt, not a dogfight.
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

// Lay one wave ahead of the patrol: a loose gaggle 650–1,050 m in front
// of the plane, spread across the lane and stacked through the band a
// seaplane hunts in. Deterministic in (seed, wave) so a staged frame
// and a test see the same sky.
export function spawnPatrolWave(seed, wave, aheadOfDist) {
  const spec = patrolWaveSpec(wave);
  const rnd = mulberry32(seed * 100003 + wave * 7919);
  const drones = [];
  for (let i = 0; i < spec.count; i++) {
    const baseDist = aheadOfDist + 650 + rnd() * 400 + i * 55;
    const baseX = (rnd() * 2 - 1) * 55;
    const baseAlt = 16 + rnd() * 34; // the 16–50 m band seaplanes hunt in
    drones.push({
      id: wave * 100 + i, wave,
      baseDist, baseX, baseAlt,
      dist: baseDist, x: baseX, altM: baseAlt,
      phase: rnd() * Math.PI * 2,
      flee: 0, alive: true, escaped: false,
    });
  }
  return drones;
}

// Advance every live drone one step. A drone weaves around its base
// point; once the patrol closes inside 420 m it runs — its base point
// slides forward at the wave's flee speed — and if it still gets past
// the plane's nose (or the plane passes it), it is gone for good.
export function stepDrones(drones, playerDist, dt, t) {
  for (const d of drones) {
    if (!d.alive || d.escaped) continue;
    const spec = patrolWaveSpec(d.wave);
    const gap = d.baseDist - playerDist;
    if (gap < 420 && gap > -40) d.flee = Math.min(1, d.flee + dt * 1.4);
    d.baseDist += spec.flee * d.flee * dt;
    d.dist = d.baseDist;
    d.x = d.baseX + Math.sin(t * spec.weaveFreq * Math.PI * 2 + d.phase) * spec.weaveAmp;
    d.altM = Math.max(6, d.baseAlt + Math.sin(t * spec.weaveFreq * 1.7 * Math.PI * 2 + d.phase * 1.3) * spec.altAmp);
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
export function createPatrol() {
  return { wave: 0, drones: [], downed: 0, shots: 0, hits: 0, score: 0, left: MODE_SECONDS, over: false };
}
export function patrolAccuracy(st) {
  return st.shots > 0 ? st.hits / st.shots : 0;
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
  return { patrolBest: 0, patrolDowned: 0, rushBest: 0, rushStreak: 0, raceBest: null, raceWins: 0, freeVisits: [] };
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
