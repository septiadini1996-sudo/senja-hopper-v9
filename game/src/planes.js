// The fleet: every airframe the hangar can hold. Pure data plus lookups —
// the flight model takes a plane's multipliers as options, the scene
// builds its mesh from the livery, and state.js owns who has bought what.
// Stats are multipliers on the flight model's constants (top speed and
// climb), plus a payload class: heavier jobs (class 2 and 3) simply
// cannot be flown by a plane whose class is lower — the board says so
// before the pilot ever reaches the runway.
// Seats (v18): the class is no longer the whole story — every airframe
// also carries a real passenger count, and a passenger ticket names
// its group. A group bigger than the cabin is refused at the board
// exactly like an overweight hold. The bodies follow the numbers:
// len/beam stretch the fleet builder's hull (the nose stays at the
// prop's plane, the tail grows), and win is the cabin windows a side —
// a 4-seat amphibian wears four, the 24-seat stork wears ten.
export const PLANES = [
  // The starter: the cream-and-red floatplane she has always flown.
  { id: 'kutilang', callsign: 'PK-KTL', price: 0, speedMul: 1.00, climbMul: 1.00, accelMul: 1.00, capacity: 1, seats: 4,
    scale: 1.00, span: 1.00, len: 1.00, beam: 1.00, win: 4, body: [0.96, 0.86, 0.64], accent: [0.80, 0.22, 0.15], cheat: [0.09, 0.26, 0.31] },
  // A light, quick runabout: faster everywhere, carries two more people.
  { id: 'pipit', callsign: 'PK-PPT', price: 170000, speedMul: 1.10, climbMul: 1.06, accelMul: 1.05, capacity: 1, seats: 6,
    scale: 0.94, span: 0.92, len: 0.97, beam: 0.95, win: 5, body: [0.92, 0.93, 0.95], accent: [0.15, 0.35, 0.75], cheat: [0.85, 0.55, 0.10] },
  // The falcon: the fast heavy lifter — speed, a class-2 hold, twelve seats.
  { id: 'alap', callsign: 'PK-ALP', price: 340000, speedMul: 1.24, climbMul: 1.18, accelMul: 1.10, capacity: 2, seats: 12,
    scale: 1.02, span: 1.07, len: 1.10, beam: 1.06, win: 7, body: [0.25, 0.28, 0.33], accent: [0.95, 0.60, 0.12], cheat: [0.95, 0.60, 0.12] },
  // The eagle (v17): a single-seat prop fighter — a warbird's silhouette
  // on a landplane's gear, built for Sky Patrol. Fastest climb in the
  // hangar and a quick top end, but her hold is a class-1 fighter's:
  // she hunts the agility work (rescue, photo, trials) and answers no
  // class-gated freight. In the patrol she carries twin-gun damage and
  // a fighter's hull (modes.js owns those numbers).
  { id: 'rajawali', callsign: 'PK-RJW', price: 430000, speedMul: 1.30, climbMul: 1.27, accelMul: 1.14, capacity: 1, seats: 0,
    fighter: true, scale: 0.97, span: 1.00, body: [0.33, 0.36, 0.25], accent: [0.62, 0.64, 0.58], cheat: [0.78, 0.74, 0.55] },
  // The stork: slow, vast, the only class-3 hold — and twenty-four seats.
  { id: 'bangau', callsign: 'PK-BNG', price: 520000, speedMul: 0.94, climbMul: 0.95, accelMul: 0.95, capacity: 3, seats: 24,
    scale: 1.17, span: 1.20, len: 1.24, beam: 1.13, win: 10, body: [0.88, 0.90, 0.88], accent: [0.10, 0.45, 0.35], cheat: [0.55, 0.20, 0.12] },
  // The finale flagship (v13): a wide-body jet in an Emirates-inspired
  // livery — never sold; she is UNLOCKED when the campaign's last stamp
  // lands. Several times the floatplanes' size, the fastest airframe in
  // the hangar, carries anything (class 4); her ground roll is scaled
  // (accelMul) so she still lifts inside the certified deck.
  { id: 'raksasa', callsign: 'PK-RKS', price: 0, speedMul: 1.38, climbMul: 1.22, accelMul: 0.52, capacity: 4, seats: 180,
    finale: true, jet: true, camMul: 3.1, seatY: 4.6, seatZ: -11.4, scale: 1.00, span: 1.00, body: [0.94, 0.94, 0.93], accent: [0.85, 0.65, 0.25], cheat: [0.85, 0.65, 0.25] },
];
export function planeById(id) {
  return PLANES.find(p => p.id === id) || PLANES[0];
}
