// Campaign geography: eight islands west to east, the customers who write to
// each other across them, and the ring courses laid over each hop.
import { mulberry32, FT } from './util.js';

// Campaign geography: eight islands west to east, the customers who write to
// each other across them, and the ring courses laid over each hop.
//
// Island shapes (v13): every island carries a hand-simplified coastline
// of its REAL counterpart — Bali's Bukit peninsula dangling south, Rinjani
// rising over Lombok's north, Tambora's bulge on Sumbawa, Halmahera's
// mini-K for Maluku, Papua's bird's-head in the west. Coordinates are
// unit space (x east, y north, radius ~1), traced counter-clockwise.
// This ONE table feeds the 3D terrain, the sea's respect for the shore,
// and the chart — the map can never disagree with the world.
export const ISLANDS = [
  { id: 'bali', name: 'Bali', seed: 1101, lat: -8.45, anchor: [0.02, 0.02],
    veg: [[0.22, 0.47, 0.25], [0.16, 0.38, 0.22]], volcano: { at: [0.60, 0.20], r: 0.34, h: 26 },
    shape: [[-1.00, 0.05], [-0.97, -0.08], [-0.80, -0.14], [-0.55, -0.20], [-0.28, -0.24], [-0.06, -0.30], [-0.02, -0.52], [0.10, -0.62], [0.22, -0.52], [0.30, -0.30], [0.44, -0.20], [0.66, -0.16], [0.90, -0.10], [1.00, 0.06], [0.82, 0.22], [0.58, 0.30], [0.34, 0.36], [0.10, 0.33], [-0.15, 0.36], [-0.38, 0.30], [-0.62, 0.34], [-0.88, 0.28]] },
  { id: 'penida', name: 'Nusa Penida', seed: 1207, lat: -8.73, anchor: [0.0, 0.0],
    veg: [[0.35, 0.48, 0.24], [0.28, 0.42, 0.21]], volcano: null,
    shape: [[-0.62, 0.30], [-0.60, 0.14], [-0.66, -0.02], [-0.52, -0.30], [-0.28, -0.48], [0.02, -0.44], [0.30, -0.50], [0.60, -0.44], [0.78, -0.26], [0.66, 0.02], [0.48, 0.26], [0.22, 0.40], [-0.10, 0.48], [-0.40, 0.44]] },
  { id: 'lombok', name: 'Lombok', seed: 1313, lat: -8.65, anchor: [0.08, 0.0],
    veg: [[0.24, 0.48, 0.25], [0.18, 0.40, 0.22]], volcano: { at: [0.02, 0.16], r: 0.36, h: 30 },
    shape: [[-1.05, 0.02], [-1.00, -0.12], [-0.84, -0.22], [-0.88, -0.40], [-0.78, -0.52], [-0.62, -0.38], [-0.38, -0.26], [-0.05, -0.22], [0.30, -0.24], [0.60, -0.20], [0.92, -0.16], [1.08, -0.02], [0.95, 0.14], [0.68, 0.24], [0.38, 0.30], [0.05, 0.36], [-0.30, 0.34], [-0.62, 0.28], [-0.90, 0.20]] },
  { id: 'sumbawa', name: 'Sumbawa', seed: 1421, lat: -8.85, anchor: [-0.08, 0.0],
    veg: [[0.45, 0.50, 0.24], [0.36, 0.44, 0.21]], volcano: { at: [-0.25, 0.28], r: 0.30, h: 24 },
    shape: [[-1.15, -0.05], [-0.95, -0.18], [-0.70, -0.16], [-0.42, -0.20], [-0.14, -0.16], [0.14, -0.20], [0.40, -0.16], [0.66, -0.20], [0.95, -0.18], [1.16, -0.08], [1.10, 0.06], [0.88, 0.16], [0.66, 0.14], [0.44, 0.20], [0.24, 0.14], [0.06, 0.20], [0.02, 0.40], [-0.16, 0.52], [-0.34, 0.44], [-0.50, 0.22], [-0.62, 0.10], [-0.80, 0.18], [-1.02, 0.14]] },
  { id: 'flores', name: 'Flores', seed: 1529, lat: -8.65, anchor: [0.0, 0.0],
    veg: [[0.48, 0.50, 0.26], [0.38, 0.44, 0.22]], volcano: { at: [0.45, 0.04], r: 0.24, h: 16 },
    shape: [[-1.15, 0.10], [-0.98, -0.06], [-0.74, -0.10], [-0.48, -0.16], [-0.22, -0.11], [0.05, -0.15], [0.30, -0.10], [0.55, -0.14], [0.80, -0.08], [1.05, -0.10], [1.12, 0.02], [0.94, 0.10], [0.76, 0.20], [0.58, 0.12], [0.40, 0.24], [0.22, 0.14], [0.04, 0.26], [-0.14, 0.15], [-0.30, 0.28], [-0.48, 0.16], [-0.66, 0.26], [-0.82, 0.14], [-1.00, 0.22]] },
  { id: 'sulawesi', name: 'Sulawesi', seed: 1637, lat: -1.85, anchor: [0.10, 0.02],
    veg: [[0.22, 0.46, 0.24], [0.16, 0.37, 0.21]], volcano: { at: [0.52, 0.62], r: 0.22, h: 18 },
    shape: [[-0.30, 0.95], [-0.42, 0.80], [-0.44, 0.55], [-0.34, 0.30], [-0.30, 0.06], [-0.52, -0.02], [-0.66, -0.18], [-0.52, -0.30], [-0.34, -0.20], [-0.16, -0.32], [-0.12, -0.55], [-0.10, -0.86], [0.02, -0.98], [0.10, -0.88], [0.16, -0.60], [0.14, -0.34], [0.28, -0.18], [0.50, -0.22], [0.55, -0.05], [0.38, 0.08], [0.30, 0.28], [0.48, 0.42], [0.72, 0.38], [0.95, 0.45], [0.88, 0.62], [0.62, 0.78], [0.34, 0.72], [0.10, 0.88]] },
  { id: 'maluku', name: 'Maluku', seed: 1741, lat: 0.85, anchor: [0.08, 0.10],
    veg: [[0.23, 0.47, 0.25], [0.17, 0.39, 0.22]], volcano: { at: [0.28, 0.58], r: 0.20, h: 15 },
    shape: [[-0.15, 0.90], [-0.26, 0.78], [-0.30, 0.55], [-0.28, 0.28], [-0.42, 0.10], [-0.30, -0.05], [-0.10, -0.20], [-0.04, -0.45], [0.0, -0.80], [0.12, -0.92], [0.20, -0.70], [0.18, -0.40], [0.30, -0.20], [0.52, -0.28], [0.62, -0.10], [0.48, 0.08], [0.34, 0.26], [0.45, 0.44], [0.66, 0.40], [0.88, 0.52], [0.78, 0.70], [0.55, 0.66], [0.30, 0.82], [0.05, 0.75]] },
  { id: 'papua', name: 'Papua', seed: 1853, lat: -2.6, anchor: [-0.05, -0.02],
    veg: [[0.18, 0.42, 0.22], [0.13, 0.34, 0.19]], volcano: { at: [0.30, -0.02], r: 0.30, h: 20 },
    shape: [[-1.05, 0.30], [-0.98, 0.02], [-0.80, -0.20], [-0.55, -0.28], [-0.30, -0.30], [-0.02, -0.24], [0.28, -0.28], [0.60, -0.24], [0.95, -0.26], [1.18, -0.20], [1.10, -0.08], [0.85, -0.02], [0.55, 0.02], [0.25, 0.06], [-0.05, 0.02], [-0.30, -0.06], [-0.50, -0.10], [-0.62, 0.05], [-0.52, 0.22], [-0.58, 0.38], [-0.72, 0.52], [-0.92, 0.48]] },
];
// Hop distances in metres; a hop at cruise takes roughly 60–85 seconds.
export const HOP_M = [2300, 2500, 2650, 2800, 2900, 2750, 2950];

export const CUSTOMERS = [
  { name: 'Ibu Ratna', cargo: 'a crate of temple flowers', cargoId: 'sekeranjang bunga sesajen' },
  { name: 'Pak Wayan', cargo: 'spare outboard parts, wrapped twice', cargoId: 'suku cadang mesin tempel, dibungkus dua kali' },
  { name: 'Dr. Sari', cargo: 'vaccines in a cold box — keep them level', cargoId: 'vaksin dalam kotak pendingin — jaga tetap datar' },
  { name: 'Pak Haji Umar', cargo: 'letters for the whole village', cargoId: 'surat untuk seluruh desa' },
  { name: 'Ibu Made', cargo: 'a wedding dress, folded like a secret', cargoId: 'gaun pengantin, dilipat seperti rahasia' },
  { name: 'Pak Dominggus', cargo: 'coffee beans, still warm from the roast', cargoId: 'biji kopi, masih hangat dari sangrai' },
  { name: 'Ibu Fransiska', cargo: 'school books for forty children', cargoId: 'buku sekolah untuk empat puluh anak' },
  { name: 'Pak Yohanis', cargo: 'a guitar for his daughter', cargoId: 'sebuah gitar untuk putrinya' },
  { name: 'Ibu Kadek', cargo: 'medicine for her mother', cargoId: 'obat untuk ibunya' },
  { name: 'Pak La Ode', cargo: 'pearl oysters in wet sacking', cargoId: 'tiram mutiara dalam karung basah' },
];

// Lay a course of golden rings over a hop. Ring altitudes ride a climb-then-
// descend arc and are hard-capped by the plane's climb envelope, so a player
// who takes off promptly can always reach the next ring.
export function ringCourse(legDistM, count, seed) {
  const rnd = mulberry32(seed);
  const rings = [];
  for (let i = 0; i < count; i++) {
    const f = (i + 1) / (count + 1);
    const dist = legDistM * f;
    // Climb envelope: feet reachable at fraction f of the leg (takeoff, cruise, descend).
    const arc = Math.min(f * 2.4, (1 - f) * 2.6, 1);
    const ceilingFT = 26 + arc * 185;
    const altFT = 30 + rnd() * Math.max(10, ceilingFT - 44);
    rings.push({
      dist, altM: altFT * FT, x: (rnd() * 2 - 1) * 15,
      passed: false, missed: false,
    });
  }
  return rings;
}
export function ringCountFor(legDistM) { return legDistM > 2700 ? 6 : 5; }

// ---- the chart's source of truth (v13) ----
// The world map is drawn from THESE functions and nothing else: island
// positions accumulate the very hop distances the flights fly, and each
// island's outline is a deterministic blob grown from the same seed that
// builds its 3D mesh — so the chart can never drift from the world.
export function islandPositions() {
  const out = [];
  let z = 0;
  for (let i = 0; i < ISLANDS.length; i++) {
    if (i > 0) z -= HOP_M[i - 1];
    out.push({ id: ISLANDS[i].id, name: ISLANDS[i].name, seed: ISLANDS[i].seed, x: 0, z, lat: ISLANDS[i].lat });
  }
  return out;
}
// Ray-cast point-in-polygon over a unit-space coastline.
export function pointInPolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Ear-clipping triangulation of a simple polygon (either winding) —
// returns index triples. The island terrain fans and the chart both
// consume the islands' real outlines through this.
export function triangulatePoly(poly) {
  const n = poly.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) { const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % n]; area += x1 * y2 - x2 * y1; }
  const idx = [...Array(n).keys()];
  if (area < 0) idx.reverse();
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 400) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length], ib = idx[i], ic = idx[(i + 1) % idx.length];
      const a = poly[ia], b = poly[ib], c = poly[ic];
      if (cross(a, b, c) <= 1e-9) continue; // reflex or degenerate
      let ear = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        const p = poly[j];
        const d1 = cross(a, b, p), d2 = cross(b, c, p), d3 = cross(c, a, p);
        if (d1 > 1e-9 && d2 > 1e-9 && d3 > 1e-9) { ear = false; break; }
      }
      if (ear) { tris.push([ia, ib, ic]); idx.splice(i, 1); clipped = true; break; }
    }
    if (!clipped) break; // a pathological polygon: return what we have
  }
  if (idx.length === 3) tris.push([idx[0], idx[1], idx[2]]);
  return tris;
}

// The island's land height in UNIT space at a unit point: -1 for open
// sea, the beach height at the shore, rising inland by edge distance,
// with the signature volcano's dome on top. The 3D builder lays its
// terraces and landform from the same numbers, so this is the world's
// own model of its islands — the suite samples it directly.
export function islandLandHeight(isl, nx, ny) {
  if (!pointInPolygon(nx, ny, isl.shape)) return -1;
  let edge = Infinity;
  const P = isl.shape;
  for (let i = 0; i < P.length; i++) {
    const [x1, y1] = P[i], [x2, y2] = P[(i + 1) % P.length];
    const dx = x2 - x1, dy = y2 - y1, L2 = dx * dx + dy * dy || 1;
    let t = ((nx - x1) * dx + (ny - y1) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    edge = Math.min(edge, Math.hypot(nx - (x1 + dx * t), ny - (y1 + dy * t)));
  }
  let h = 0.25 + Math.min(edge / 0.30, 1) * 2.4;
  if (isl.volcano) {
    const d = Math.hypot(nx - isl.volcano.at[0], ny - isl.volcano.at[1]);
    if (d < isl.volcano.r) h += (1 - d / isl.volcano.r) * isl.volcano.h * 0.30;
  }
  return h;
}

// The chart's outline for an island: its real coastline, verbatim from
// the table (v13) — the map and the terrain read the same points, so
// the shape the player flies over is the shape on the chart.
export function islandOutline(isl) {
  return isl.shape.map(([x, y]) => ({ dx: x, dy: y }));
}
