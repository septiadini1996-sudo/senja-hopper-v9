// Campaign state and its localStorage save. Pure transitions live here so the
// logic suite can drive them; the DOM layer only renders what this returns.
import { ISLANDS, HOP_M, CUSTOMERS, ringCourse, ringCountFor } from './world.js';
import { weatherAtBlock, blockOfHour } from './clock.js';
import { mulberry32 } from './util.js';
import { planeById } from './planes.js';
import { defaultModes } from './modes.js';
import { MISSIONS } from './missions.js';

export const SAVE_KEY = 'senja-hopper-save-v9';
export const UPGRADE_COST = { engine: [0, 120000, 300000], fuel: [0, 90000, 220000], hull: [0, 100000, 260000], handling: [0, 80000, 190000] };
export const CHALLENGES = [
  { id: 'rings4', kind: 'rings', n: 4, bonus: 40000 },
  { id: 'gradeA', kind: 'grade', g: 'A', bonus: 35000 },
  { id: 'centre', kind: 'centre', bonus: 30000 },
  { id: 'fast70', kind: 'fast', n: 70, bonus: 30000 },
  { id: 'storm1', kind: 'storm', bonus: 30000 },
  { id: 'rescue1', kind: 'rescue', bonus: 35000 },
  { id: 'smooth5', kind: 'smooth', n: 5, bonus: 40000 },
];

export function defaultSave() {
  return {
    saldo: 50000, day: 1, clockH: 6.5, islandIdx: 0, stamps: [],
    upgrades: { engine: 1, fuel: 1, hull: 1, handling: 1 },
    planes: { owned: ['kutilang'], active: 'kutilang' },
    stats: { flights: 0, deliveries: 0, rings: 0, earned: 0, bestGrade: null,
      rescues: 0, stormRuns: 0, photos: 0, smoothRuns: 0, star5Runs: 0, jetRuns: 0 },
    challengesDone: [],
    // The catalogue ledger (v18): authored missions delivered, by id.
    // Additive — an older save simply has none done yet.
    missionsDone: [],
    // Achievements (v18): id → true once claimed on a receipt. The
    // panel's lit state derives from the counters; this map exists so
    // the unlock toast fires exactly once per achievement.
    achievements: {},
    // The mode ledger (v15): bests and free-flight visits for the four
    // extra ways to fly. A NEW section, apart from the campaign's own
    // fields, so a campaign save from any earlier version loads whole.
    modes: defaultModes(),
    settings: { music: 3, sfx: 4, radio: 4, master: true, season: 'breezy', lang: 'en' },
    scheme: null, // null = auto (touch-first on coarse pointers)
    handling: 'assisted', // 'assisted' (damped, self-levelling) or 'direct' (raw)
    camMode: 'near', // 'near' | 'far' | 'cockpit'
    started: false,
  };
}

export function loadSave(storage) {
  try {
    const raw = storage.getItem(SAVE_KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw);
    const base = defaultSave();
    // Migration (v12): a v11 save has no fleet and no handling kit — the
    // merge below defaults both, and every older field (campaign,
    // balance, day, clock) rides through untouched.
    const planes = { ...base.planes, ...(parsed.planes || {}) };
    if (!Array.isArray(planes.owned) || planes.owned.length === 0) planes.owned = [...base.planes.owned];
    if (!planes.owned.includes(planes.active)) planes.active = planes.owned[0];
    // Finale grant on load (v13): a save that already holds every stamp
    // (a finished v12 campaign, say) owns the flagship too — she was
    // earned before the hangar knew her name.
    const mergedStamps = Array.isArray(parsed.stamps) ? parsed.stamps : [];
    if (mergedStamps.length >= ISLANDS.length - 1 && !planes.owned.includes('raksasa')) {
      planes.owned.push('raksasa');
    }
    return { ...base, ...parsed, settings: { ...base.settings, ...(parsed.settings || {}) },
      upgrades: { ...base.upgrades, ...(parsed.upgrades || {}) }, stats: { ...base.stats, ...(parsed.stats || {}) },
      modes: { ...base.modes, ...(parsed.modes || {}),
        freeVisits: Array.isArray(parsed.modes && parsed.modes.freeVisits) ? [...parsed.modes.freeVisits] : [] },
      missionsDone: Array.isArray(parsed.missionsDone) ? [...parsed.missionsDone] : [],
      achievements: (parsed.achievements && typeof parsed.achievements === 'object') ? { ...parsed.achievements } : {},
      planes };
  } catch { return defaultSave(); }
}

// The hangar's till: buying a plane deducts and persists in the caller's
// storeSave; switching is free but only to a plane she owns.
export function buyPlane(save, id) {
  const p = planeById(id);
  if (!p || p.id !== id || p.finale || save.planes.owned.includes(id) || save.saldo < p.price) return false;
  save.saldo -= p.price;
  save.planes.owned.push(id);
  return true;
}
export function switchPlane(save, id) {
  if (!save.planes.owned.includes(id)) return false;
  save.planes.active = id;
  return true;
}
export function storeSave(storage, save) {
  try { storage.setItem(SAVE_KEY, JSON.stringify(save)); } catch { /* private mode: play on unsaved */ }
}

// ---------- shared pay math (v18) ----------
// ONE set of formulas prices everything that flies: generated
// tickets, catalogue missions, the board's quotes and the settle.
// If a number here moves, every ticket in the game moves with it —
// that is what keeps the economy one economy.
export const roundRp = (n) => Math.round(n / 100) * 100;
// Freight's face: a flagfall plus a per-metre rate, before premiums.
export function baseTicketPay(dist) { return roundRp(26000 + dist * 26); }
// Heavier work pays more: +30% per payload class above 1.
export function weightPremium(weight) { return 1 + 0.3 * ((weight || 1) - 1); }
// Passenger work pays PER PERSON (v18): a flagfall of Rp 3.400 plus
// Rp 2.800 per passenger-kilometre — Rp 9.800 a head on the home hop,
// Rp 11.700 at the far end of the chain. The v17 comfort/fit money
// still multiplies on top at settle time; this is the face value.
export const FARE_BASE = 3400;
export const FARE_PER_KM = 2800;
export function farePerPax(dist) { return roundRp(FARE_BASE + FARE_PER_KM * dist / 1000); }
export function passengerCorePay(dist, pax, weight) {
  return roundRp(pax * farePerPax(dist) * weightPremium(weight));
}
// How big a group a leg deals, by the furthest island it touches:
// families near home, crowds at the far end. The starter's four
// seats cover the first two bands whole — by design.
export const PAX_BANDS = [[2, 4], [2, 4], [3, 8], [3, 8], [6, 16], [6, 16], [10, 24], [10, 24]];

// ---------- difficulty (v18) ----------
// Every ticket wears 1–5 stars, derived from its own fields and
// nothing else — same ticket, same stars, on the board, in the
// catalogue and in the tests. Harder work pays more: the multiplier
// folds into the ticket's face at deal time (morningBoard keeps the
// pre-difficulty face in payCore, so the guarantee's re-deals can
// re-derive cleanly).
export const DIFFICULTY_MULT = { 1: 1.00, 2: 1.10, 3: 1.20, 4: 1.35, 5: 1.50 };
export function difficultyOf(tk) {
  const typePts = { cargo: 0, passenger: 1, photo: 1, rescue: 2, express: 2, trial: 4, storm: 4 }[tk.type || 'cargo'] || 0;
  let pts = typePts;
  if ((tk.dist || 0) >= 2750) pts += 1;                    // the long legs
  if (tk.weather === 'rain') pts += 1;                     // the day's sky
  else if (tk.weather === 'storm') pts += 2;
  if ((tk.weight || 1) >= 3) pts += 1;                     // a class-3 gate
  if ((tk.pax || 0) >= 25) pts += 1;                       // a crowd to keep smooth
  if (Math.max(tk.from || 0, tk.to || 0) >= 6) pts += 1;   // the far country: the long eastern legs compound everything
  if (typeof tk.depHour === 'number' && (tk.depHour >= 18.25 || tk.depHour < 5.75)) pts += 1; // night work
  return Math.min(5, Math.max(1, 1 + Math.floor(pts / 2)));
}

// Build one catalogue mission into a flyable ticket (v18): the hop,
// the rings, the type's geometry — and a face priced by the shared
// math above (weight premium in, storm premium and per-pax fare via
// applyType). Weather, departure and difficulty are the board's to
// deal, exactly as for generated work.
export function buildPoolTicket(m, daySeed) {
  const from = m.band, to = m.band >= ISLANDS.length - 1 ? m.band - 1 : m.band + 1;
  const dist = HOP_M[Math.min(from, to)];
  let salt = 0; for (const ch of m.id) salt += ch.charCodeAt(0);
  const tk = {
    from, to, main: false, dist,
    customer: m.customer, cargo: m.cargo, cargoId: m.cargoId,
    pay: roundRp(baseTicketPay(dist) * weightPremium(m.weight)),
    rings: ringCourse(dist, ringCountFor(dist), 5000 + from * 131 + to * 17 + daySeed + salt * 977),
    missionId: m.id, missionName: m.name, missionNameId: m.nameId,
    weight: m.weight || 1,
  };
  if (typeof m.pax === 'number') tk.pax = m.pax; // authored group size wins over the draw
  applyType(tk, m.type, daySeed);
  return tk;
}

// The morning board: the stamp run to the next island (once any remain) plus
// two side jobs among unlocked islands, each with a named customer.
export function morningBoard(save, daySeed) {
  const rnd = mulberry32(daySeed * 7919 + 13);
  const unlocked = save.islandIdx + 1; // islands 0..islandIdx can be departed from
  const tickets = [];
  const mk = (from, to, main) => {
    // Every ticket is a single hop between neighbouring islands: one hop is
    // 60–85 seconds of flying, the length a sortie is designed to be.
    const dist = HOP_M[Math.min(from, to)];
    const c = CUSTOMERS[Math.floor(rnd() * CUSTOMERS.length)];
    return {
      from, to, main, dist,
      customer: c.name, cargo: c.cargo, cargoId: c.cargoId,
      pay: Math.round((26000 + dist * 26) / 100) * 100,
      // The salt keeps two jobs on the same hop from sharing one ring course.
      rings: ringCourse(dist, ringCountFor(dist), 5000 + from * 131 + to * 17 + daySeed + tickets.length * 977),
    };
  };
  if (save.islandIdx < ISLANDS.length - 1) tickets.push(mk(save.islandIdx, save.islandIdx + 1, true));
  // The catalogue (v18): side slots prefer unflown authored missions
  // from the band the campaign has reached. A delivered mission is
  // stamped in the save and never deals again; when the band runs
  // dry, the generated stream below fills the board as it always has.
  const doneSet = new Set(save.missionsDone || []);
  const band = save.islandIdx;
  const poolCandidates = MISSIONS.filter(m => m.band === band && !doneSet.has(m.id));
  while (tickets.length < 3 && poolCandidates.length) {
    const pick = poolCandidates.splice(Math.floor(rnd() * poolCandidates.length), 1)[0];
    tickets.push(buildPoolTicket(pick, daySeed));
  }
  const maxIdx = Math.min(save.islandIdx + 1, ISLANDS.length - 1);
  let guard = 0;
  while (tickets.length < 3 && guard++ < 60) {
    const from = Math.floor(rnd() * unlocked);
    const to = from + (rnd() < 0.5 ? -1 : 1);
    if (to < 0 || to > maxIdx) continue;
    const cand = mk(from, to, false);
    // Early on only one hop exists, so a second job on the same hop is fine —
    // what must differ is the customer (and with them the ring course).
    if (tickets.some(tk => tk.from === from && tk.to === to && tk.customer === cand.customer)) continue;
    tickets.push(cand);
  }
  // Payload class (v12): side work sometimes outgrows the starter's hold.
  // The class rides the ticket from creation, the pay grows with it, and
  // the hangar's bigger planes exist to answer it. The stamp run is
  // always class 1 — the campaign never waits on a purchase.
  const wrnd2 = mulberry32(daySeed * 31337 + 5);
  for (const tk of tickets) {
    if (tk.missionId) continue; // catalogue work: authored class, premium already in the face
    tk.weight = 1;
    if (!tk.main) {
      const w = wrnd2();
      if (w < 0.13 && save.islandIdx >= 3) tk.weight = 3;
      else if (w < 0.42) tk.weight = 2;
    }
    if (tk.weight > 1) tk.pay = Math.round(tk.pay * (1 + 0.3 * (tk.weight - 1)) / 100) * 100;
  }
  // Departures spread across the day — dawn, mid-morning, midday, afternoon,
  // senja, night — three slots a third of the day apart, rotated by the day
  // seed. Each ticket's weather is the clock table's word for the 4-hour
  // block containing its departure hour: the forecast printed on the board
  // is the sky the flight will get, and keep getting for the whole block.
  const SLOTS = [5.75, 8.25, 10.75, 13.25, 15.75, 18.25, 20.75, 23.0];
  const wrnd = mulberry32(daySeed * 104729 + 7);
  const start = Math.floor(wrnd() * SLOTS.length);
  tickets.forEach((tk, i) => {
    tk.depHour = SLOTS[(start + i * 3) % SLOTS.length];
    tk.weather = weatherAtBlock(daySeed, blockOfHour(tk.depHour));
  });
  // Mission types (v12): the board's jobs are not all mail any more. The
  // type is dealt after the weather, because a storm departure is its
  // own kind of work; the stamp run keeps the gentler set (cargo,
  // passenger, storm) so the campaign's spine never hinges on a boat.
  const trnd = mulberry32(daySeed * 331 + 97);
  for (const tk of tickets) {
    if (tk.missionId) continue; // catalogue work keeps its authored type
    const roll = trnd();
    let type = 'cargo';
    if ((tk.weather === 'storm' || tk.weather === 'rain') && roll < 0.55) type = 'storm';
    else if (!tk.main) {
      if (roll < 0.16) type = 'rescue';
      else if (roll < 0.32) type = 'photo';
      else if (roll < 0.46) type = 'express';
      else if (roll < 0.58) type = 'trial';
      else if (roll < 0.78) type = 'passenger';
    } else if (roll < 0.30) type = 'passenger';
    applyType(tk, type, daySeed);
  }
  // The pre-difficulty face (v18): difficulty folds in LAST, after
  // the guarantee below has settled what the board really offers —
  // and a re-deal can always rebuild the face from this core.
  for (const tk of tickets) tk.payCore = tk.pay;
  // The weakest-setup guarantee (v17, hardened v18): whatever the
  // dice dealt, the board always offers the starter real work — at
  // least TWO tickets she can fly, and at least ONE of them a side
  // job, so a broke pilot can always earn, not only progress. The
  // stamp run always qualifies (it is never gated — see ticketGate
  // and the pax cap in applyType). A gated GENERATED job is re-dealt
  // light; a gated CATALOGUE job is never rewritten — it swaps out
  // for another unflown mission the starter can fly, or, failing
  // that, a generated light job on the same hop. The gated mission
  // stays in the pool and deals again another day: aspiration on the
  // board, never a wall in front of income.
  const weakestSave = { upgrades: { hull: 0 } };
  const starter = planeById('kutilang');
  const weakOk = (tk) => ticketGate(tk, starter, weakestSave).ok;
  const okTotal = () => tickets.filter(weakOk).length;
  const okSide = () => tickets.filter(tk => !tk.main && weakOk(tk)).length;
  const lighten = (tk) => {
    if ((tk.weight || 1) > 1) {
      tk.pay = roundRp(tk.pay / weightPremium(tk.weight));
      tk.weight = 1;
    }
    if (tk.type === 'storm') {
      tk.pay = roundRp(tk.pay / 1.5);
      applyType(tk, 'cargo', daySeed);
    }
    if (tk.type === 'passenger' && (tk.pax || 0) > starter.seats) {
      tk.pax = starter.seats; // a group her cabin CAN hold, at the same fare
      tk.pay = passengerCorePay(tk.dist, tk.pax, tk.weight);
    }
    tk.payCore = tk.pay;
  };
  let guard2 = 0;
  while ((okTotal() < 2 || okSide() < 1) && guard2++ < 8) {
    let idx = -1;
    for (let i = tickets.length - 1; i >= 0; i--) {
      if (!tickets[i].main && !weakOk(tickets[i])) { idx = i; break; }
    }
    if (idx < 0) break; // nothing left to fix (the stamp run alone cannot fail)
    const tk = tickets[idx];
    if (tk.missionId) {
      const onBoard = new Set(tickets.map(x => x.missionId).filter(Boolean));
      const alt = MISSIONS.find(m => m.band === band && !doneSet.has(m.id) && !onBoard.has(m.id)
        && weakOk(buildPoolTicket(m, daySeed)));
      let nt;
      if (alt) nt = buildPoolTicket(alt, daySeed);
      else { nt = mk(tk.from, tk.to, false); nt.weight = 1; applyType(nt, 'cargo', daySeed); }
      nt.depHour = tk.depHour; nt.weather = tk.weather;
      nt.payCore = nt.pay;
      tickets[idx] = nt;
    } else {
      lighten(tk);
    }
  }
  // Difficulty (v18): the stars are read off the finished ticket —
  // type, distance, the dealt sky, the gates it carries — and the
  // multiplier folds into the face the player is quoted.
  for (const tk of tickets) {
    tk.stars = difficultyOf(tk);
    tk.pay = roundRp(tk.payCore * DIFFICULTY_MULT[tk.stars]);
  }
  return tickets;
}

// Stamp a mission type onto a ticket: its objective geometry, its par
// time, its premium. One function so the board, the staging hooks and
// the tests all deal the same jobs.
export function applyType(tk, type, daySeed) {
  tk.type = type;
  delete tk.pickup; delete tk.gate; delete tk.par;
  if (type !== 'passenger') { delete tk.pax; delete tk.fare; }
  if (type === 'storm') tk.pay = Math.round(tk.pay * 1.5 / 100) * 100;
  if (type === 'express') tk.par = Math.round(tk.dist / 29);
  if (type === 'trial') tk.par = Math.round(tk.dist / 23);
  if (type === 'rescue') {
    const r2 = mulberry32(daySeed * 7717 + tk.from * 131 + tk.to * 17);
    tk.pickup = { dist: Math.round(tk.dist * 0.45), x: Math.round((r2() * 2 - 1) * 46) };
  }
  if (type === 'photo') {
    const r2 = mulberry32(daySeed * 6151 + tk.from * 57 + tk.to * 29);
    tk.gate = { dist: Math.round(tk.dist * 0.55), altM: 14 + r2() * 14, x: Math.round((r2() * 2 - 1) * 18) };
  }
  if (type === 'passenger') {
    tk.cargo = 'passengers, travelling light';
    tk.cargoId = 'penumpang, bagasi ringan';
    // The group (v18): drawn from the leg's own band on its own
    // stream, so no other dealt field shifts. An authored group
    // (catalogue work) is already aboard and is never redrawn.
    if (typeof tk.pax !== 'number') {
      const bandIdx = Math.max(tk.from, tk.to);
      const [lo, hi] = PAX_BANDS[bandIdx] || PAX_BANDS[0];
      const r2 = mulberry32(daySeed * 523 + tk.from * 131 + tk.to * 17 + Math.round((tk.depHour || 6) * 4));
      let pax = lo + Math.floor(r2() * (hi - lo + 1));
      // The far-end charter: a rare side job touching Papua is a
      // whole village on the move — work only the flagship can lift.
      if (!tk.main && bandIdx === ISLANDS.length - 1 && r2() < 0.18) {
        pax = 40 + Math.floor(r2() * 111); // 40..150
      }
      tk.pax = pax;
    }
    // The stamp run is NEVER gated (owner's rule, v18): a passenger
    // stamp leg deals a group the starter's cabin holds, full stop.
    if (tk.main) tk.pax = Math.min(tk.pax, planeById('kutilang').seats);
    tk.fare = farePerPax(tk.dist);
    tk.pay = passengerCorePay(tk.dist, tk.pax, tk.weight);
  }
  return tk;
}

// ---------- v17: the gate between a ticket and a plane ----------
// Plane ↔ mission matching, judged in ONE place: the board reads this
// verdict to badge and refuse, the tests pin it, and the board's own
// weakest-setup guarantee above is dealt against it. Returns
// { ok: true } or { ok: false, reason, need, have } with reason:
//   'capacity' — the ticket's payload class outgrows the plane's hold
//     (the v12 weight rule, now one verdict among three);
//   'storm'    — storm work wants a class-2+ airframe OR a hull worked
//     to level 2+ (the hangar's hull line is the other key);
//   'flagship' — RAKSASA cannot work a boat pickup: a wide-body jet
//     does not settle onto the sea beside a fishing boat.
//   'seats'    — (v18) a passenger group bigger than the cabin: the
//     count is real now, and so is the refusal. RAJAWALI, a single-
//     seat fighter with seats 0, refuses every passenger ticket by
//     this same path.
// The stamp run (ticket.main) is exempt from the storm gate, exactly
// as it has always been exempt from payload class — the campaign's
// spine never waits on a purchase or an upgrade. Its passenger legs
// are dealt starter-sized groups (applyType), so it is exempt from
// the seat gate by construction, not by exception.
export const STORM_MIN_CLASS = 2;
export const STORM_MIN_HULL = 2;
export function ticketGate(ticket, plane, save) {
  const need = ticket.weight || 1;
  if (need > plane.capacity) return { ok: false, reason: 'capacity', need, have: plane.capacity };
  if (ticket.type === 'storm' && !ticket.main
      && plane.capacity < STORM_MIN_CLASS
      && (((save && save.upgrades) || {}).hull || 0) < STORM_MIN_HULL) {
    return { ok: false, reason: 'storm', need: STORM_MIN_CLASS, have: plane.capacity };
  }
  if (ticket.type === 'rescue' && plane.id === 'raksasa') {
    return { ok: false, reason: 'flagship', need: 0, have: plane.capacity };
  }
  if (ticket.type === 'passenger' && typeof ticket.pax === 'number' && ticket.pax > (plane.seats || 0)) {
    return { ok: false, reason: 'seats', need: ticket.pax, have: plane.seats || 0 };
  }
  return { ok: true };
}

// Apply a settled flight to the save. Quitting mid-flight never calls this —
// that is exactly why quitting can never erase cash, stamps or the day.
// The last argument (v18) names the airframe flown, for the ledger's
// sake; older callers omit it and lose nothing but those two counters.
export function applyResult(save, ticket, flight, settle, challengeBonus, planeId) {
  save.stats.flights += 1;
  save.saldo += settle.total + (challengeBonus || 0);
  save.stats.rings += flight.ringsHit;
  if (settle.delivered) {
    save.stats.deliveries += 1;
    // The catalogue ledger (v18): a delivered authored mission is
    // done, once, and never deals again.
    if (ticket.missionId && !(save.missionsDone || []).includes(ticket.missionId)) {
      (save.missionsDone = save.missionsDone || []).push(ticket.missionId);
    }
    if ((ticket.stars || 0) >= 5) save.stats.star5Runs = (save.stats.star5Runs || 0) + 1;
    if (planeId === 'raksasa') save.stats.jetRuns = (save.stats.jetRuns || 0) + 1;
    if (ticket.type === 'rescue') save.stats.rescues += 1;
    if (ticket.type === 'storm') save.stats.stormRuns += 1;
    if (ticket.type === 'photo' && flight.photoTaken) save.stats.photos += 1;
    if (ticket.type === 'passenger' && settle.comfort !== null && settle.comfort !== undefined && settle.comfort >= 0.8) save.stats.smoothRuns += 1;
    save.stats.earned += settle.total + (challengeBonus || 0);
    const order = ['D', 'C', 'B', 'A', 'S'];
    if (!save.stats.bestGrade || order.indexOf(settle.grade) > order.indexOf(save.stats.bestGrade)) {
      save.stats.bestGrade = settle.grade;
    }
    if (ticket.main && ticket.to === save.islandIdx + 1) {
      if (!save.stamps.includes(ISLANDS[ticket.to].id)) save.stamps.push(ISLANDS[ticket.to].id);
      save.islandIdx = ticket.to;
      // The finale (v13): the last stamp of the chain unlocks the
      // flagship in the hangar — the campaign's own reward, no price.
      if (save.stamps.length >= ISLANDS.length - 1 && !save.planes.owned.includes('raksasa')) {
        save.planes.owned.push('raksasa');
        save.jetUnlocked = true; // the receipt screen celebrates once
      }
    }
  }
  save.day += 1;
  return save;
}

export function challengeResult(save, flight, settle, ticket) {
  // Returns the first not-yet-done challenge this flight completes, or null.
  if (!settle.delivered) return null;
  for (const ch of CHALLENGES) {
    if (save.challengesDone.includes(ch.id)) continue;
    if (ch.kind === 'rings' && flight.ringsHit >= ch.n) return ch;
    if (ch.kind === 'grade' && settle.grade && 'DCBAS'.indexOf(settle.grade) >= 'DCBAS'.indexOf(ch.g)) return ch;
    if (ch.kind === 'centre' && Math.abs(flight.touchdown.x) <= 3) return ch;
    if (ch.kind === 'fast' && flight.t <= ch.n) return ch;
    if (ch.kind === 'storm' && ticket && ticket.type === 'storm') return ch;
    if (ch.kind === 'rescue' && ticket && ticket.type === 'rescue') return ch;
    // The smooth counter increments in applyResult, after this check —
    // so the fifth silky run reads as the four banked plus this one.
    if (ch.kind === 'smooth' && settle.comfort !== null && settle.comfort !== undefined
      && settle.comfort >= 0.8 && save.stats.smoothRuns + 1 >= ch.n) return ch;
  }
  return null;
}
export function windForSeason(season) {
  return { calm: 0, breezy: 0.55, fresh: 1.15 }[season] ?? 0.55;
}

// ---------- achievements (v18) ----------
// Fourteen mission honours, read off counters the game already
// keeps — deliveries, storms, rescues, photos and silky runs from
// stats; catalogue completions from missionsDone; patrol downs from
// the mode ledger; lifetime earnings from stats.earned. The two
// counters that did not exist (5★ completions, flagship missions)
// ride stats as star5Runs / jetRuns, banked by applyResult. Nothing
// here keeps a second set of books: achievementState derives, and
// claimAchievements only stamps what has been celebrated, so an
// unlock can never fire twice.
export const ACHIEVEMENTS = [
  { id: 'first_delivery', target: 1, get: s => (s.stats || {}).deliveries || 0 },
  { id: 'missions_10', target: 10, get: s => (s.stats || {}).deliveries || 0 },
  { id: 'missions_25', target: 25, get: s => (s.stats || {}).deliveries || 0 },
  { id: 'missions_50', target: 50, get: s => (s.missionsDone || []).length },
  { id: 'stamps_7', target: 7, get: s => (s.stamps || []).length },
  { id: 'storm_1', target: 1, get: s => (s.stats || {}).stormRuns || 0 },
  { id: 'storm_3', target: 3, get: s => (s.stats || {}).stormRuns || 0 },
  { id: 'silky_5', target: 5, get: s => (s.stats || {}).smoothRuns || 0 },
  { id: 'rescues_5', target: 5, get: s => (s.stats || {}).rescues || 0 },
  { id: 'photos_5', target: 5, get: s => (s.stats || {}).photos || 0 },
  { id: 'star5_1', target: 1, get: s => (s.stats || {}).star5Runs || 0 },
  { id: 'raksasa_1', target: 1, get: s => (s.stats || {}).jetRuns || 0 },
  { id: 'patrol_10', target: 10, get: s => (s.modes || {}).patrolDowns || 0 },
  { id: 'millionaire', target: 1000000, get: s => (s.stats || {}).earned || 0 },
];
export function achievementState(save) {
  return ACHIEVEMENTS.map(a => {
    const raw = a.get(save) || 0;
    return { id: a.id, target: a.target, progress: Math.min(raw, a.target), unlocked: raw >= a.target };
  });
}
// Stamp every currently-earned achievement into the save and return
// the ids that were NEW — the receipt celebrates exactly those, and
// a second call returns nothing.
export function claimAchievements(save) {
  if (!save.achievements || typeof save.achievements !== 'object') save.achievements = {};
  const fresh = [];
  for (const st of achievementState(save)) {
    if (st.unlocked && !save.achievements[st.id]) {
      save.achievements[st.id] = true;
      fresh.push(st.id);
    }
  }
  return fresh;
}
