// Campaign state and its localStorage save. Pure transitions live here so the
// logic suite can drive them; the DOM layer only renders what this returns.
import { ISLANDS, HOP_M, CUSTOMERS, ringCourse, ringCountFor } from './world.js';
import { weatherAtHour } from './clock.js';
import { mulberry32 } from './util.js';

export const SAVE_KEY = 'senja-hopper-save-v9';
export const UPGRADE_COST = { engine: [0, 120000, 300000], fuel: [0, 90000, 220000], hull: [0, 100000, 260000] };
export const CHALLENGES = [
  { id: 'rings4', kind: 'rings', n: 4, bonus: 40000 },
  { id: 'gradeA', kind: 'grade', g: 'A', bonus: 35000 },
  { id: 'centre', kind: 'centre', bonus: 30000 },
  { id: 'fast70', kind: 'fast', n: 70, bonus: 30000 },
];

export function defaultSave() {
  return {
    saldo: 50000, day: 1, clockH: 6.5, islandIdx: 0, stamps: [],
    upgrades: { engine: 1, fuel: 1, hull: 1 },
    stats: { flights: 0, deliveries: 0, rings: 0, earned: 0, bestGrade: null },
    challengesDone: [],
    settings: { music: 3, sfx: 4, master: true, season: 'breezy', lang: 'en' },
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
    return { ...base, ...parsed, settings: { ...base.settings, ...(parsed.settings || {}) },
      upgrades: { ...base.upgrades, ...(parsed.upgrades || {}) }, stats: { ...base.stats, ...(parsed.stats || {}) } };
  } catch { return defaultSave(); }
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
  // Departures spread across the day — dawn, mid-morning, midday, afternoon,
  // senja, night — three slots a third of the day apart, rotated by the day
  // seed. Each ticket's weather is the clock table's word for its departure
  // hour: the forecast printed on the board is the sky the flight will get.
  const SLOTS = [5.75, 8.25, 10.75, 13.25, 15.75, 18.25, 20.75, 23.0];
  const wrnd = mulberry32(daySeed * 104729 + 7);
  const start = Math.floor(wrnd() * SLOTS.length);
  tickets.forEach((tk, i) => {
    tk.depHour = SLOTS[(start + i * 3) % SLOTS.length];
    tk.weather = weatherAtHour(daySeed, Math.floor(tk.depHour));
  });
  return tickets;
}

// Apply a settled flight to the save. Quitting mid-flight never calls this —
// that is exactly why quitting can never erase cash, stamps or the day.
export function applyResult(save, ticket, flight, settle, challengeBonus) {
  save.stats.flights += 1;
  save.saldo += settle.total + (challengeBonus || 0);
  save.stats.rings += flight.ringsHit;
  if (settle.delivered) {
    save.stats.deliveries += 1;
    save.stats.earned += settle.total + (challengeBonus || 0);
    const order = ['D', 'C', 'B', 'A', 'S'];
    if (!save.stats.bestGrade || order.indexOf(settle.grade) > order.indexOf(save.stats.bestGrade)) {
      save.stats.bestGrade = settle.grade;
    }
    if (ticket.main && ticket.to === save.islandIdx + 1) {
      if (!save.stamps.includes(ISLANDS[ticket.to].id)) save.stamps.push(ISLANDS[ticket.to].id);
      save.islandIdx = ticket.to;
    }
  }
  save.day += 1;
  return save;
}

export function challengeResult(save, flight, settle) {
  // Returns the first not-yet-done challenge this flight completes, or null.
  if (!settle.delivered) return null;
  for (const ch of CHALLENGES) {
    if (save.challengesDone.includes(ch.id)) continue;
    if (ch.kind === 'rings' && flight.ringsHit >= ch.n) return ch;
    if (ch.kind === 'grade' && settle.grade && 'DCBAS'.indexOf(settle.grade) >= 'DCBAS'.indexOf(ch.g)) return ch;
    if (ch.kind === 'centre' && Math.abs(flight.touchdown.x) <= 3) return ch;
    if (ch.kind === 'fast' && flight.t <= ch.n) return ch;
  }
  return null;
}
export function windForSeason(season) {
  return { calm: 0, breezy: 0.55, fresh: 1.15 }[season] ?? 0.55;
}
