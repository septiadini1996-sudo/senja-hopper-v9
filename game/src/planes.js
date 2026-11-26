// The fleet: every airframe the hangar can hold. Pure data plus lookups —
// the flight model takes a plane's multipliers as options, the scene
// builds its mesh from the livery, and state.js owns who has bought what.
// Stats are multipliers on the flight model's constants (top speed and
// climb), plus a payload class: heavier jobs (class 2 and 3) simply
// cannot be flown by a plane whose class is lower — the board says so
// before the pilot ever reaches the runway.
export const PLANES = [
  // The starter: the cream-and-red floatplane she has always flown.
  { id: 'kutilang', price: 0, speedMul: 1.00, climbMul: 1.00, capacity: 1,
    scale: 1.00, span: 1.00, body: [0.96, 0.86, 0.64], accent: [0.80, 0.22, 0.15], cheat: [0.09, 0.26, 0.31] },
  // A light, quick runabout: faster everywhere, carries no more.
  { id: 'pipit', price: 170000, speedMul: 1.10, climbMul: 1.06, capacity: 1,
    scale: 0.94, span: 0.92, body: [0.92, 0.93, 0.95], accent: [0.15, 0.35, 0.75], cheat: [0.85, 0.55, 0.10] },
  // The falcon: the fast heavy lifter — speed and a class-2 hold.
  { id: 'alap', price: 340000, speedMul: 1.24, climbMul: 1.18, capacity: 2,
    scale: 1.02, span: 1.07, body: [0.25, 0.28, 0.33], accent: [0.95, 0.60, 0.12], cheat: [0.95, 0.60, 0.12] },
  // The stork: slow, vast, and the only class-3 hold in the islands.
  { id: 'bangau', price: 520000, speedMul: 0.94, climbMul: 0.95, capacity: 3,
    scale: 1.17, span: 1.20, body: [0.88, 0.90, 0.88], accent: [0.10, 0.45, 0.35], cheat: [0.55, 0.20, 0.12] },
];
export function planeById(id) {
  return PLANES.find(p => p.id === id) || PLANES[0];
}
