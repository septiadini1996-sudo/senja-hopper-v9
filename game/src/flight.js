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
// The wing's bargain (v12): lift is bought with airspeed. At LIFT_REF the
// wing exactly carries the plane at neutral pitch; slower than that the
// shortfall arrives as sink, and below the stall the shortfall is nearly
// the whole SINK_MAX — an idle plane does not hover, she comes down at
// roughly −1,000 FT/MIN and faster with the nose pushed over. Throttle is
// what buys the speed back: cut it and she descends, feed it and she
// climbs. That is the owner's playtest verdict made into physics — in
// v11 a zero-throttle plane floated at altitude forever, because VS was
// purely a pitch readout and nothing ever pulled her down.
export const LIFT_REF = 21; // m/s: lift balances weight at neutral pitch
export const SINK_MAX = 5.4; // m/s of sink at zero lift (deep stall)
export const CRASH_SINK = -6.0; // m/s: water contact harder than this ends the flight
// The explosion (v13): a crash is not always a fireball. She burns only
// when the impact carries real energy — a deep-stall arrival, or any
// crash-sink arrival after a fall FROM HEIGHT (the power-loss plunge the
// owner described). A controlled descent, a flare, a gentle settle or a
// low ditching never explodes: the trigger is physics, not outcome text.
export const EXPLODE_SINK = -7.5; // m/s at impact: deep enough to burst on its own
export const EXPLODE_MIN_ALT = 18; // m: the fall must have started from up here
export function crashExplodes(s) {
  if (!s || s.outcome !== 'splash' || !s.touchdown) return false;
  const vs = s.touchdown.vs;
  return vs <= EXPLODE_SINK || (vs <= CRASH_SINK && (s.maxAlt || 0) >= EXPLODE_MIN_ALT);
}

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
    // v12: the airframe she flies (hangar stats), the handling kit's
    // responsiveness, whether ASSISTED handling is softening the stall,
    // and the mission objective riding this leg (rescue pickup / photo
    // gate), with the smoothness ledger passenger work is graded on.
    speedMul: opts.speedMul || 1, climbMul: opts.climbMul || 1,
    accelMul: opts.accelMul || 1, // ground-roll character (the big jet spools long)
    respMul: opts.respMul || 1, assist: !!opts.assist,
    pickup: opts.pickup ? { ...opts.pickup } : null, pickedUp: false,
    gate: opts.gate ? { ...opts.gate, passed: false, missed: false } : null,
    photoTaken: false, rough: 0, stalled: false, exploded: false,
  };
}

// One fixed step. input.pitch: -1 (push down) .. +1 (pull up); input.roll: -1..1;
// input.throttle: 0..1.
export function stepFlight(s, input, dt) {
  if (s.done) return s;
  s.t += dt;
  const engPower = 1 + (s.engineLvl - 1) * 0.09;
  const targetSpeed = input.throttle * MAX_SPEED * engPower * s.speedMul;
  // On the ground the roll builds at the surface's own rate: pavement is a
  // deliberate roll (RUNWAY_ACCEL), open water keeps the old draggy run,
  // and in the air the engine answers at full rate.
  const onGround = s.alt <= 0.01;
  const accel = !onGround ? 5.2 : (s.dist < s.runwayM ? RUNWAY_ACCEL : 3.4) * s.accelMul;
  s.speed = lerp(s.speed, targetSpeed, clamp(dt * accel / 6, 0, 1));
  if (s.speed < 0.05 && input.throttle === 0) s.speed = 0;

  // Climb authority scales with airflow; the envelope test flies full throttle.
  const flow = clamp((s.speed - STALL) / (MAX_SPEED * 0.55 * s.speedMul), 0, 1);
  const maxClimb = (7.4 + (s.engineLvl - 1) * 0.7) * flow * s.climbMul;
  const maxSink = -7.6;
  let wantVs = input.pitch >= 0 ? input.pitch * maxClimb : input.pitch * -maxSink * Math.max(flow, 0.35);
  // Lift and the stall (v12): the pitch demand is only half the story —
  // the wing holds her up in proportion to the square of her airspeed,
  // and whatever lift is missing arrives as sink. ASSISTED handling
  // softens the shortfall (a damped stall, not a held-up plane); DIRECT
  // takes it whole. Below the stall the nose drops of its own accord:
  // pulling back mostly stops working until speed is bought back.
  const lift = clamp((s.speed / LIFT_REF) ** 2, 0, 1);
  s.stalled = !onGround && s.speed < STALL;
  if (s.stalled && wantVs > 0) wantVs *= 0.3;
  if (!onGround) wantVs += -SINK_MAX * (1 - lift) * (s.assist ? 0.72 : 1);
  const prevAlt = s.alt;
  // Vertical speed settles faster than it spools up: releasing the stick must
  // stop a climb promptly (a long float upward after release reads as the
  // plane ignoring the pilot and ruins approach precision), while the spool
  // keeps enough lag to feel like weight rather than a switch.
  const vsRate = (Math.abs(wantVs) < Math.abs(s.vs) ? 6.0 : 4.2) * s.respMul;
  s.vs = lerp(s.vs, wantVs, clamp(dt * vsRate, 0, 1));
  if (s.alt <= 0.01 && s.speed < LIFTOFF) s.vs = Math.min(s.vs, 0); // floats hold her down
  if (s.alt <= 0.01 && s.vs < 0) s.vs = 0;
  // A hard arrival on the water, well short of the strip, ends the flight
  // where it happens: she does not bounce off a stall and taxi on. A
  // gentle touch (a proper flare's sink rate or softer) still settles
  // onto the surface and can fly off again, exactly as before.
  if (s.airborne && s.alt + s.vs * dt <= 0 && s.vs < CRASH_SINK && s.dist < s.legDist - 40) {
    s.alt = 0;
    s.done = true;
    s.outcome = 'splash';
    s.touchdown = { vs: s.vs, x: s.x, soft: 0, centre: centreScore(s.x), approach: approachScore(s) };
    s.exploded = crashExplodes(s); // a plunge from height bursts; a ditch does not
    return s;
  }
  s.alt = Math.max(0, s.alt + s.vs * dt);
  if (s.alt > 0.05 && !s.airborne) {
    s.airborne = true;
    s.tookOffFrom = s.dist <= s.runwayM ? 'runway' : 'water';
  }
  s.maxAlt = Math.max(s.maxAlt, s.alt);
  s.vs = dt > 0 ? (s.alt - prevAlt) / dt : 0; // sampled VS: the gauge reads this
  // The surface she is on, read after the step: below the airborne
  // threshold she rests on whatever is under her (pavement inside the
  // runway's length, water beyond it); only a real climb is 'air'. A
  // porpoising rotation grazes the band without leaving the deck.
  s.surface = s.alt > 0.05 ? 'air' : (s.dist < s.runwayM ? 'runway' : 'water');

  // Lateral: banked turn drifts the plane across the route.
  const latRate = input.roll * 13 * s.respMul * clamp(s.speed / 22, 0, 1);
  s.x += latRate * dt + s.wind * dt * (s.alt > 0.05 ? 1 : 0.2);
  s.bank = lerp(s.bank, input.roll, clamp(dt * 5, 0, 1));
  // A stalled wing drops the nose on its own — the visual pitch follows
  // the stall down even while the pilot is still pulling.
  s.pitchVis = lerp(s.pitchVis, s.stalled ? -0.75 : clamp(s.vs / 8, -1, 1), clamp(dt * 4, 0, 1));

  s.dist += s.speed * dt;

  // The smoothness ledger: passenger work is graded on how the flight
  // FELT — hard vertical excursions, steep banks and stall time all
  // spend comfort, and nothing buys it back.
  if (s.airborne) {
    s.rough += dt * (Math.max(0, Math.abs(s.vs) - 4.5) * 0.55
      + Math.max(0, Math.abs(s.bank) - 0.5) * 1.3 + (s.stalled ? 1.5 : 0));
  }
  // The rescue pickup: low, slow and close over the boat's position —
  // a flypast at altitude is just a flypast.
  if (s.pickup && !s.pickedUp) {
    if (Math.abs(s.dist - s.pickup.dist) <= 26 && Math.abs(s.x - s.pickup.x) <= 26
      && s.alt <= 12 && s.speed <= 16 && s.airborne) s.pickedUp = true;
  }
  // The photo gate: a ring test like any other, flown at the gate's own
  // altitude and line — thread it and the survey camera fires.
  if (s.gate && !s.gate.passed && !s.gate.missed) {
    const dd = s.dist - s.gate.dist;
    if (Math.abs(dd) <= RING_LONG) {
      if (Math.hypot(s.alt - s.gate.altM, s.x - s.gate.x) <= 6) { s.gate.passed = true; s.photoTaken = true; }
    } else if (dd > RING_LONG) s.gate.missed = true;
  }

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
    s.exploded = crashExplodes(s);
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

// How smooth the flight felt, 0..1: the passenger grade. A clean cruise
// with a gentle approach sits near 1; stalls, yanks and dives spend it.
export function comfortOf(s) { return clamp(1 - (s.rough || 0) / 16, 0, 1); }

// The mission objective riding this leg, as plain data the HUD renders:
// what kind of job it is, and how it stands right now.
export function objectiveState(s, ticket) {
  const type = (ticket && ticket.type) || 'cargo';
  switch (type) {
    case 'passenger': return { type, comfort: comfortOf(s) };
    case 'rescue': return {
      type, pickup: s.pickup || (ticket && ticket.pickup) || null, pickedUp: !!s.pickedUp,
      stage: s.pickedUp ? 'deliver' : (s.pickup && s.dist > s.pickup.dist + 26 ? 'missed' : 'pickup'),
    };
    case 'photo': return { type, done: !!s.photoTaken };
    case 'express': return { type, par: ticket.par || 0, left: (ticket.par || 0) - s.t };
    case 'trial': return {
      type, need: Math.ceil(s.rings.length * 0.6), par: ticket.par || 0, left: (ticket.par || 0) - s.t,
    };
    default: return { type };
  }
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
  // A rescue that lands without the pickup lands empty: the boat is
  // still waiting, and an empty arrival earns no ticket.
  if (ticket.type === 'rescue' && !s.pickedUp) {
    return { lines: [{ k: 'fuel', amt: -fuelCost }], total: -fuelCost, grade: null, delivered: false };
  }
  const grade = gradeOf(s.touchdown);
  const lines = [{ k: 'ticket', amt: ticket.pay }];
  let bonusBase = ticket.pay;
  if (s.ringsHit > 0) lines.push({ k: 'rings', amt: s.ringsHit * RING_BONUS, n: s.ringsHit });
  if (Math.abs(s.touchdown.x) <= 3) lines.push({ k: 'centre', amt: CENTRE_BONUS });
  const gb = Math.round(bonusBase * gradeBonusPct(grade));
  if (gb > 0) lines.push({ k: 'gradebonus', amt: gb });
  // Mission bonuses (v12): each type pays for the thing it asked for.
  const type = ticket.type || 'cargo';
  const comfort = type === 'passenger' ? comfortOf(s) : null;
  if (comfort !== null && comfort >= 0.55) {
    lines.push({ k: 'comfort', amt: Math.round(ticket.pay * 0.25 * comfort) });
  }
  if (type === 'photo' && s.photoTaken) lines.push({ k: 'photo', amt: 25000 });
  if (type === 'express' && ticket.par && s.t <= ticket.par) {
    lines.push({ k: 'express', amt: Math.round(ticket.pay * 0.3) });
  }
  if (type === 'trial' && ticket.par && s.t <= ticket.par
    && s.ringsHit >= Math.ceil(s.rings.length * 0.6)) {
    lines.push({ k: 'trial', amt: 20000 });
  }
  lines.push({ k: 'fuel', amt: -fuelCost });
  const total = lines.reduce((a, l) => a + l.amt, 0);
  return { lines, total, grade, delivered: true, comfort };
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
  out.tooFast = s.speed > 86 * KT * (s.speedMul || 1);
  out.stalled = !!s.stalled;
  return out;
}
