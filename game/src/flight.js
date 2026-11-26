// The flight model: pure logic, no DOM, no rendering. A flight state advances
// in fixed steps from one normalized input frame {pitch, roll, throttle}.
// Deterministic: same inputs, same outcome — the logic suite leans on that.
import { clamp, lerp, FT, KT } from './util.js';

export const MAX_SPEED = 89 * KT; // m/s, ~89 knots flat out
const LIFTOFF = 14.5; // m/s; below this the floats hold her on the water
const STALL = 11; // m/s; climb authority fades toward the stall
export const STRIP_HALF = 45; // metres either side of the buoy lane centreline
export const RING_R = 4.4; // pass-through radius in metres: the rendered torus
// centreline radius (its visible hole is 4.4 - 0.42 tube = 3.98 m across the
// radius, and the tube itself is the grace beyond it). The scoring circle
// matches the ring the player sees: a pass through the visible hole counts.
export const RING_LONG = 7; // longitudinal window in metres
export const RING_BONUS = 15000;
export const CENTRE_BONUS = 10000;
export const AIRFIELD_FEE = 400;
export const HARBOUR_FEE = AIRFIELD_FEE; // legacy alias: the fee's name changed with the runway
// Departures happen from a paved runway now: the plane lines up on the
// strip at the departure island and rolls RUNWAY_M of pavement before the
// water. The ground roll on asphalt is a real phase of the flight — the
// speed builds at RUNWAY_ACCEL (the lerp constant below), so rotation is
// a moment the pilot chooses, not the first second of the leg.
export const RUNWAY_M = 260;
export const RUNWAY_ACCEL = 0.55;

export function createFlight(opts) {
  const legDist = opts.legDist;
  const runwayM = opts.runwayM || 0;
  return {
    t: 0, dist: 0, legDist, x: 0, alt: 0, speed: 0, vs: 0,
    maxAlt: 0, airborne: false, done: false, outcome: null,
    rings: opts.rings.map(r => ({ ...r, passed: false, missed: false })),
    ringsHit: 0, engineLvl: opts.engineLvl || 1, hullLvl: opts.hullLvl || 1,
    wind: opts.wind || 0, approachTime: 0, approachGood: 0,
    touchdown: null, bank: 0, pitchVis: 0,
    runwayM, surface: runwayM > 0 ? 'runway' : 'water',
    tookOffFrom: null, overrun: false,
  };
}

// One fixed step. input.pitch: -1 (push down) .. +1 (pull up); input.roll: -1..1;
// input.throttle: 0..1.
export function stepFlight(s, input, dt) {
  if (s.done) return s;
  s.t += dt;
  const engPower = 1 + (s.engineLvl - 1) * 0.09;
  const targetSpeed = input.throttle * MAX_SPEED * engPower;
  // On the ground the roll builds at the surface's own rate: pavement is a
  // deliberate roll (RUNWAY_ACCEL), open water keeps the old draggy run,
  // and in the air the engine answers at full rate.
  const onGround = s.alt <= 0.01;
  const accel = !onGround ? 5.2 : (s.dist < s.runwayM ? RUNWAY_ACCEL : 3.4);
  s.speed = lerp(s.speed, targetSpeed, clamp(dt * accel / 6, 0, 1));
  s.surface = !onGround ? 'air' : (s.dist < s.runwayM ? 'runway' : 'water');
  if (s.speed < 0.05 && input.throttle === 0) s.speed = 0;

  // Climb authority scales with airflow; the envelope test flies full throttle.
  const flow = clamp((s.speed - STALL) / (MAX_SPEED * 0.55), 0, 1);
  const maxClimb = (7.4 + (s.engineLvl - 1) * 0.7) * flow;
  const maxSink = -7.6;
  const wantVs = input.pitch >= 0 ? input.pitch * maxClimb : input.pitch * -maxSink * Math.max(flow, 0.35);
  const prevAlt = s.alt;
  // Vertical speed settles faster than it spools up: releasing the stick must
  // stop a climb promptly (a long float upward after release reads as the
  // plane ignoring the pilot and ruins approach precision), while the spool
  // keeps enough lag to feel like weight rather than a switch.
  const vsRate = Math.abs(wantVs) < Math.abs(s.vs) ? 6.0 : 4.2;
  s.vs = lerp(s.vs, wantVs, clamp(dt * vsRate, 0, 1));
  if (s.alt <= 0.01 && s.speed < LIFTOFF) s.vs = Math.min(s.vs, 0); // floats hold her down
  if (s.alt <= 0.01 && s.vs < 0) s.vs = 0;
  s.alt = Math.max(0, s.alt + s.vs * dt);
  if (s.alt > 0.05 && !s.airborne) {
    s.airborne = true;
    s.tookOffFrom = s.dist <= s.runwayM ? 'runway' : 'water';
  }
  s.maxAlt = Math.max(s.maxAlt, s.alt);
  s.vs = dt > 0 ? (s.alt - prevAlt) / dt : 0; // sampled VS: the gauge reads this

  // Lateral: banked turn drifts the plane across the route.
  const latRate = input.roll * 13 * clamp(s.speed / 22, 0, 1);
  s.x += latRate * dt + s.wind * dt * (s.alt > 0.05 ? 1 : 0.2);
  s.bank = lerp(s.bank, input.roll, clamp(dt * 5, 0, 1));
  s.pitchVis = lerp(s.pitchVis, clamp(s.vs / 8, -1, 1), clamp(dt * 4, 0, 1));

  s.dist += s.speed * dt;

  // Rings: a true pass-through puts the plane inside the torus circle as it
  // crosses the ring's distance — a radial test in the altitude/lateral
  // plane, matched to the rendered torus (see RING_R). The old square window
  // was smaller than the visible hole on-axis, so passes a player could see
  // were scored as misses.
  for (const r of s.rings) {
    if (r.passed || r.missed) continue;
    const dd = s.dist - r.dist;
    if (Math.abs(dd) <= RING_LONG) {
      if (Math.hypot(s.alt - r.altM, s.x - r.x) <= RING_R) {
        r.passed = true; s.ringsHit++;
      }
    } else if (dd > RING_LONG) r.missed = true;
  }

  // Approach quality: fraction of the last 600 m spent inside the target band.
  const remain = s.legDist - s.dist;
  if (remain <= 600 && s.airborne) {
    s.approachTime += dt;
    if (Math.abs(s.alt - approachTargetM(remain)) <= 8) s.approachGood += dt;
  }

  // The aborted departure: a plane that never rotates rolls off the end
  // of the runway into the overrun, and the departure is over right there
  // — she does not taxi the whole leg on the water. (A staged state placed
  // on the ground past the runway reads the same way: no flight happened.)
  if (!s.airborne && s.runwayM > 0 && s.dist > s.runwayM) {
    s.overrun = true;
    finishFlight(s);
  } else if (s.dist >= s.legDist) finishFlight(s);
  return s;
}

// The approach target altitude (metres) for a given distance-to-go.
export function approachTargetM(remainM) {
  return Math.max(0, (remainM / 600) * 120 * FT);
}

function finishFlight(s) {
  s.done = true;
  if (s.overrun || !s.airborne || s.maxAlt < 3) {
    // No flight happened: either she ran off the runway's end still on
    // the ground, or she never truly left it. The departure is aborted.
    s.outcome = 'aborted';
    s.touchdown = { vs: 0, x: s.x, soft: 0, centre: 0, approach: 0 };
    return;
  }
  if (s.alt > 4) { s.outcome = 'missed'; s.touchdown = null; return; }
  if (Math.abs(s.x) > STRIP_HALF) { s.outcome = 'missed'; s.touchdown = null; return; }
  const vs = s.vs;
  const roughLimit = -(10 + (s.hullLvl - 1) * 1.6);
  if (vs < roughLimit) {
    s.outcome = 'splash';
    s.touchdown = { vs, x: s.x, soft: 0, centre: centreScore(s.x), approach: approachScore(s) };
    return;
  }
  s.outcome = 'landed';
  s.touchdown = {
    vs, x: s.x,
    soft: softScore(vs), centre: centreScore(s.x), approach: approachScore(s),
  };
}
export function softScore(vs) { return clamp(1 - Math.abs(vs + 1.1) / 5.4, 0, 1); }
export function centreScore(x) { return clamp(1 - Math.abs(x) / STRIP_HALF, 0, 1); }
export function approachScore(s) { return s.approachTime > 0.5 ? clamp(s.approachGood / s.approachTime, 0, 1) : 0.4; }

export const GRADES = ['D', 'C', 'B', 'A', 'S'];
export function gradeOf(td) {
  if (!td) return null;
  const score = td.soft * 0.45 + td.centre * 0.3 + td.approach * 0.25;
  if (score >= 0.86) return 'S';
  if (score >= 0.72) return 'A';
  if (score >= 0.56) return 'B';
  if (score >= 0.4) return 'C';
  return 'D';
}
export function gradeBonusPct(grade) {
  return { S: 0.4, A: 0.25, B: 0.12, C: 0.05, D: 0 }[grade] ?? 0;
}
export function gradeAtLeast(grade, min) {
  return GRADES.indexOf(grade) >= GRADES.indexOf(min);
}

// Money: settle a finished flight against a ticket. Pure and testable.
export function settleFlight(s, ticket, fuelLvl) {
  // Fuel burns with time aloft as well as distance: over the same hop, a
  // fast crossing costs less than a slow one.
  const fuelCost = Math.round((s.legDist * 3.0 + s.t * 110) * (1 - (fuelLvl - 1) * 0.22));
  if (s.outcome === 'aborted') {
    return { lines: [{ k: 'fee', amt: -AIRFIELD_FEE }], total: -AIRFIELD_FEE, grade: null, delivered: false };
  }
  if (s.outcome !== 'landed') {
    return { lines: [{ k: 'fuel', amt: -fuelCost }], total: -fuelCost, grade: null, delivered: false };
  }
  const grade = gradeOf(s.touchdown);
  const lines = [{ k: 'ticket', amt: ticket.pay }];
  let bonusBase = ticket.pay;
  if (s.ringsHit > 0) lines.push({ k: 'rings', amt: s.ringsHit * RING_BONUS, n: s.ringsHit });
  if (Math.abs(s.touchdown.x) <= 3) lines.push({ k: 'centre', amt: CENTRE_BONUS });
  const gb = Math.round(bonusBase * gradeBonusPct(grade));
  if (gb > 0) lines.push({ k: 'gradebonus', amt: gb });
  lines.push({ k: 'fuel', amt: -fuelCost });
  const total = lines.reduce((a, l) => a + l.amt, 0);
  return { lines, total, grade, delivered: true };
}

// Guidance for the HUD chip: where is the next ring, and what should the pilot
// do on approach? Returns plain data; the UI turns it into strings.
export function guidance(s) {
  const remain = s.legDist - s.dist;
  const next = s.rings.find(r => !r.passed && !r.missed);
  const out = { remain };
  if (remain <= 600 && s.airborne) {
    const targetM = approachTargetM(remain);
    out.mode = 'approach';
    out.targetFT = Math.round(targetM / FT);
    const dAlt = s.alt - targetM;
    out.approach = remain < 130 && s.alt < 26 * FT ? 'flare' : dAlt > 8 ? 'descend' : 'on';
  } else if (next) {
    out.mode = 'ring';
    out.dAltFT = Math.round((next.altM - s.alt) / FT);
    out.dX = Math.round(next.x - s.x);
    out.centred = Math.abs(next.x - s.x) <= RING_R;
  } else if (s.rings.length > 0 && s.ringsHit >= s.rings.length) {
    out.mode = 'done'; // every ring threaded — and ONLY then
  } else {
    // No live ring ahead, but not all collected: the rest were missed (or
    // the course has none). The old code fell through to 'done' here, so a
    // water taxi that rolled past every ring plane unread announced
    // "ALL RINGS DONE" at 0/5. Head for the strip instead.
    out.mode = 'none';
  }
  out.tooFast = s.speed > 86 * KT;
  return out;
}
