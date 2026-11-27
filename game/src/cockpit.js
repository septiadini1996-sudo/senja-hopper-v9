// The cockpit interior's brain: pure layout + instrument math, no DOM, no
// rendering. scene3d.js builds and draws the physical cockpit (canopy frame,
// tinted glass, panel, needles, radar blips) from this layout, and the logic
// suite checks the instruments against scripted flight states here.
//
// Everything lives in CAMERA space: the pilot's eye is the origin, the view
// runs down -Z, up is +Y. The panel is a vertical bulkhead at z = PANEL.z;
// its top edge sits low enough that the strip, the rings and the horizon
// stay in view above it — the panel frames the world, it never covers it.
import { clamp, FT, KT } from './util.js';

export const PANEL = { w: 3.3, top: -0.66, bottom: -1.86, z: -2.77 };
// The four live dials, one row across the panel. frac sweeps each needle
// over 270 degrees: down-left at 0, straight up at 0.5, down-right at 1 —
// except the compass, whose needle simply points at the heading.
export const GAUGES = [
  { id: 'spd', x: -1.20, y: -0.86, r: 0.24, unit: 'KT' },
  { id: 'alt', x: -0.40, y: -0.86, r: 0.24, unit: 'FT' },
  { id: 'vs', x: 0.40, y: -0.86, r: 0.24, unit: 'FT/MIN' },
  { id: 'hdg', x: 1.20, y: -0.86, r: 0.24, unit: 'HDG' },
];
// The radar scope, centred low on the panel between the dials: a north-up
// scope like the HUD's, radius in camera-space metres on the panel face.
// It sits high enough to live entirely inside the frame — the first cut
// hung its lower rim off the bottom edge of the screen.
export const RADAR = { x: 0, y: -1.28, r: 0.22, z: -2.75 };
// Canopy glass panes (camera-space quads, corners ordered so the baked
// normal faces the pilot): the two front panes above the panel and the
// side panes sweeping back. The frame pillars stand at the pane edges.
export const GLASS_PANES = [
  [[-1.55, -0.54, -2.82], [1.55, -0.54, -2.82], [1.74, 1.32, -2.82], [-1.74, 1.32, -2.82]], // front
  [[1.55, -0.54, -2.82], [2.38, -0.34, -1.50], [2.48, 1.06, -1.50], [1.74, 1.32, -2.82]], // right
  [[-2.38, -0.34, -1.50], [-1.55, -0.54, -2.82], [-1.74, 1.32, -2.82], [-2.48, 1.06, -1.50]], // left
];
export const COCKPIT_LAYOUT = { panel: PANEL, gauges: GAUGES, radar: RADAR, glassPanes: GLASS_PANES };

// Needle rotation about the panel normal (+Z, toward the pilot): 0 points
// straight up, positive turns counter-clockwise. A 270-degree dial maps
// frac 0 to down-left and frac 1 to down-right, through up at the middle.
export function needleRad(frac) {
  return (0.75 - 1.5 * clamp(frac, 0, 1)) * Math.PI;
}

// The heading the compass shows: the route runs north on the scope (the
// campaign flies the -Z line), and the nose swings with her bank — a
// banked plane is a turning plane, and the card turns with it.
export function headingDeg(f) {
  return ((360 + (f.bank || 0) * 30) % 360 + 360) % 360;
}

// Live readings for one flight state. Every value is derived from the
// state on the call — scripted state in, needle positions out — so a
// gauge that does not move when the state moves is a failing test here,
// not a matter of opinion in the browser.
export function gaugeReadings(f) {
  const knots = (f.speed || 0) / KT;
  const altFT = (f.alt || 0) / FT;
  const vsFpm = Math.round((f.vs || 0) / FT * 60 / 10) * 10;
  const hdg = headingDeg(f);
  const dial = (value, frac) => ({ value, frac: clamp(frac, 0, 1), needle: needleRad(frac) });
  return {
    spd: dial(Math.round(knots), knots / 100),
    alt: dial(Math.round(altFT), altFT / 350),
    vs: dial(vsFpm, ((f.vs || 0) + 8) / 16),
    hdg: { value: Math.round(hdg), frac: hdg / 360, needle: -hdg * Math.PI / 180 },
  };
}

// Scope blips in normalized scope coordinates (x right, y up = ahead),
// the same north-up plot the HUD radar draws: the destination rides the
// centreline ahead, the next live ring sits at its true relative bearing,
// both clamped to the scope's rim. Returns [] entries as null when absent.
export function radarBlips(f) {
  const remain = Math.max(0, f.legDist - f.dist);
  const scale = Math.max(remain, 320); // metres mapped to the scope radius
  const plot = (dx, dz) => {
    let nx = dx / scale, ny = dz / scale;
    const len = Math.hypot(nx, ny);
    if (len > 0.92) { nx = nx / len * 0.92; ny = ny / len * 0.92; }
    return { nx, ny };
  };
  const dest = plot(0 - f.x, remain);
  const next = (f.rings || []).find(r => !r.passed && !r.missed);
  const ring = next ? plot(next.x - f.x, next.dist - f.dist) : null;
  return { dest, ring, remain };
}

// The whole cockpit as the test surface sees it: what is fitted, and what
// the instruments read right now. main.js exposes this as __senja.cockpit
// while the cockpit camera is active; the scene draws the same numbers.
export function cockpitState(f) {
  return {
    panel: { ...PANEL },
    glass: GLASS_PANES.length,
    gauges: gaugeReadings(f),
    radar: { ...RADAR, blips: radarBlips(f) },
  };
}
