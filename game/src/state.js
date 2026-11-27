// Campaign state and its localStorage save. Pure transitions live here so the
// logic suite can drive them; the DOM layer only renders what this returns.
import { ISLANDS, HOP_M, CUSTOMERS, ringCourse, ringCountFor } from './world.js';
import { weatherAtBlock, blockOfHour } from './clock.js';
import { mulberry32 } from './util.js';
import { planeById } from './planes.js';
import { defaultModes } from './modes.js';

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
      rescues: 0, stormRuns: 0, photos: 0, smoothRuns: 0 },
    challengesDone: [],
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
  // The weakest-setup guarantee (v17): whatever the dice dealt, at
  // least two tickets on every board are flyable by the starter plane
  // with an unworked hull — judged by ticketGate itself, so the board
  // can never promise what the gate would refuse. The stamp run
  // always qualifies; if both side jobs outgrew her, the last side
  // job is re-dealt as light, fair work (its class premium and storm
  // premium unwound) — a new pilot is never locked out of her own
  // board. A pure function of the dealt board: determinism holds.
  const weakestSave = { upgrades: { hull: 0 } };
  const weakOk = (tk) => ticketGate(tk, planeById('kutilang'), weakestSave).ok;
  if (tickets.filter(weakOk).length < 2) {
    for (let i = tickets.length - 1; i >= 0 && tickets.filter(weakOk).length < 2; i--) {
      const tk = tickets[i];
      if (tk.main || weakOk(tk)) continue;
      if ((tk.weight || 1) > 1) {
        tk.pay = Math.round(tk.pay / (1 + 0.3 * (tk.weight - 1)) / 100) * 100;
        tk.weight = 1;
      }
      if (tk.type === 'storm') {
        tk.pay = Math.round(tk.pay / 1.5 / 100) * 100;
        applyType(tk, 'cargo', daySeed);
      }
    }
  }
  return tickets;
}

// Stamp a mission type onto a ticket: its objective geometry, its par
// time, its premium. One function so the board, the staging hooks and
// the tests all deal the same jobs.
export function applyType(tk, type, daySeed) {
  tk.type = type;
  delete tk.pickup; delete tk.gate; delete tk.par;
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
// The stamp run (ticket.main) is exempt from the storm gate, exactly
// as it has always been exempt from payload class — the campaign's
// spine never waits on a purchase or an upgrade.
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
  return { ok: true };
}

// Apply a settled flight to the save. Quitting mid-flight never calls this —
// that is exactly why quitting can never erase cash, stamps or the day.
export function applyResult(save, ticket, flight, settle, challengeBonus) {
  save.stats.flights += 1;
  save.saldo += settle.total + (challengeBonus || 0);
  save.stats.rings += flight.ringsHit;
  if (settle.delivered) {
    save.stats.deliveries += 1;
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
