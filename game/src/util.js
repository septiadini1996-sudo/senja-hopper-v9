// Small shared helpers: seeded RNG (deterministic worlds), clamps, formatting.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const FT = 0.3048; // metres per foot
export const KT = 0.514444; // metres per second per knot
export function fmtInt(n) { return String(Math.round(n)); }
// The one and only airspeed formatter: integer knots, never decimals, never negative.
export function fmtKnots(ms) { return fmtInt(Math.max(0, ms / KT)); }
export function fmtFeet(m) { return fmtInt(m / FT); }
export function fmtRp(n) {
  const v = Math.round(n);
  return 'Rp ' + v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
export function fmtClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
