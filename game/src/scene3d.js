// The 3D world: a low-poly seaplane, island terrain with palms, golden torus
// rings, buoy lanes and the glittering sea, all built as static meshes with
// the hand-rolled engine in engine3d.js. The flight runs along -Z: the plane
// sits at z = -distance, the destination island waits at z = -legDist.
import { Builder, M4 } from './engine3d.js';
import { mulberry32, clamp, lerp } from './util.js';

const CREAM = [0.96, 0.86, 0.64], RED = [0.80, 0.22, 0.15], TEAL = [0.09, 0.26, 0.31];

// How dark the world is right now, 0 (full day) to 1 (deep night), read
// off the phase's ambient ceiling. The clock's palettes are untouched —
// this only measures them, and every night treatment (ring glow, strip
// light spill) scales with it, so dusk fades the lamps in gradually.
export function darknessOf(env) {
  if (!env || !env.ambHi) return 0;
  const lum = 0.299 * env.ambHi[0] + 0.587 * env.ambHi[1] + 0.114 * env.ambHi[2];
  return clamp((0.42 - lum) / 0.30, 0, 1);
}

// Night ring overlays grow with distance: a fixed-size halo at 1 KM is a
// sub-pixel hairline no matter how bright, so the glow (and, more gently,
// the hot core) scale up with range to hold a minimum screen presence —
// the course reads as a chain of lights at night. At approach range the
// scale is 1 and the ring looks exactly as built.
export function nightGlowM(r, depth) {
  const s = clamp(depth / 380, 1, 3);
  return M4.compose(r.x, r.altM, -r.dist, Math.PI / 2, 0, 0, s);
}
export function nightCoreM(r, depth) {
  const s = 1 + (clamp(depth / 380, 1, 3) - 1) * 0.45;
  return M4.compose(r.x, r.altM, -r.dist, Math.PI / 2, 0, 0, s);
}
const SAND = [0.93, 0.78, 0.52], GREEN = [0.24, 0.48, 0.26], GREEN2 = [0.16, 0.38, 0.22];
const TRUNK = [0.42, 0.30, 0.18], ROCK = [0.45, 0.38, 0.36], GOLD = [1.0, 0.72, 0.18];
const PAST = [0.35, 0.95, 0.55], DARK = [0.04, 0.07, 0.09], FOAM = [0.98, 0.95, 0.88];

// A prism between two cross-sections along Z — the fuselage's taper.
function seg(b, z0, w0, h0, z1, w1, h1, cy, color, xo = 0) {
  const a = [xo - w0 / 2, cy - h0 / 2, z0], c = [xo + w0 / 2, cy - h0 / 2, z0];
  const d = [xo + w0 / 2, cy + h0 / 2, z0], e = [xo - w0 / 2, cy + h0 / 2, z0];
  const A = [xo - w1 / 2, cy - h1 / 2, z1], C = [xo + w1 / 2, cy - h1 / 2, z1];
  const D = [xo + w1 / 2, cy + h1 / 2, z1], E = [xo - w1 / 2, cy + h1 / 2, z1];
  b.quad(e, d, D, E, color); b.quad(a, A, C, c, color);
  b.quad(c, C, D, d, color); b.quad(A, a, e, E, color);
  b.quad(A, E, D, C, color); b.quad(a, c, d, e, color);
}

export function buildPlane(R) {
  const b = new Builder();
  // Fuselage: nose at -Z, tail at +Z, origin at the waterline.
  seg(b, -2.9, 0.55, 0.55, -2.2, 1.15, 1.0, 0.95, CREAM);
  seg(b, -2.2, 1.15, 1.0, 0.9, 1.45, 1.25, 0.95, CREAM);
  seg(b, 0.9, 1.45, 1.25, 2.6, 0.85, 1.0, 1.05, CREAM);
  seg(b, 2.6, 0.85, 1.0, 3.7, 0.22, 0.45, 1.25, RED);
  b.box(0, 1.78, 0.35, 1.02, 0.55, 1.7, TEAL); // canopy glass
  b.box(0, 1.42, -0.35, 10.8, 0.16, 1.55, CREAM); // main wing
  b.box(-5.15, 1.42, -0.35, 0.55, 0.18, 1.55, RED);
  b.box(5.15, 1.42, -0.35, 0.55, 0.18, 1.55, RED);
  b.box(0, 1.62, 3.35, 3.5, 0.13, 1.0, CREAM); // tailplane
  b.box(0, 2.25, 3.45, 0.15, 1.45, 1.05, RED); // fin
  // Navigation and landing lights: colours pushed past 1.0, so the lit
  // shader's emissive term takes them over as the light falls — port red,
  // starboard green, a white tail light, and the landing lamp under the nose.
  b.box(-5.48, 1.42, -0.35, 0.3, 0.13, 0.3, [1.7, 0.18, 0.12]);
  b.box(5.48, 1.42, -0.35, 0.3, 0.13, 0.3, [0.20, 1.50, 0.35]);
  b.box(0, 3.02, 3.45, 0.2, 0.12, 0.2, [1.5, 1.5, 1.4]);
  b.box(0, 0.52, -2.55, 0.34, 0.12, 0.14, [1.9, 1.8, 1.5]);
  // Twin floats on struts.
  for (const sx of [-1.18, 1.18]) {
    seg(b, -2.5, 0.18, 0.2, -1.9, 0.52, 0.46, -0.55, CREAM, sx);
    b.box(sx, -0.55, 0.35, 0.52, 0.46, 3.1, CREAM);
    seg(b, 1.9, 0.52, 0.46, 2.5, 0.16, 0.18, -0.5, CREAM, sx);
    b.box(sx, -0.12, -1.15, 0.11, 0.5, 0.11, ROCK);
    b.box(sx, -0.12, 0.95, 0.11, 0.5, 0.11, ROCK);
  }
  const plane = R.makeMesh(b);
  // Propeller: two blades in the XY plane + a spinner, spun around Z.
  const p = new Builder();
  p.box(0, 0, 0, 0.34, 3.3, 0.09, DARK);
  p.box(0, 0, 0, 3.3, 0.34, 0.09, DARK);
  p.box(0, 0, -0.12, 0.42, 0.42, 0.5, RED);
  const prop = R.makeMesh(p);
  // Translucent prop disc, drawn additively over the blades.
  const d = new Builder();
  const SEG = 20;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    d.tri([0, 0, 0], [Math.cos(a0) * 1.75, Math.sin(a0) * 1.75, 0], [Math.cos(a1) * 1.75, Math.sin(a1) * 1.75, 0], [0.25, 0.2, 0.16]);
  }
  const disc = R.makeMesh(d);
  return { plane, prop, disc };
}

function palm(b, x, z, h, rnd) {
  const lean = (rnd() - 0.5) * 0.7;
  b.box(x + lean * h * 0.3, h / 2, z, 0.22, h, 0.22, TRUNK);
  const tx = x + lean * h * 0.6;
  b.cone(tx, h - 0.55, z, 1.9, 0.85, 6, GREEN);
  b.cone(tx, h - 0.15, z, 1.25, 0.7, 6, GREEN2);
}

export function buildIsland(R, seed, scale = 1) {
  const rnd = mulberry32(seed);
  const b = new Builder();
  const r = 46 * scale;
  b.disc(0, 0.25, 0, r * 1.22, 18, SAND); // beach apron
  b.cone(0, 0.2, 0, r, 13 * scale, 9, GREEN2);
  b.cone(10 * scale, 0.2, -8 * scale, r * 0.55, 19 * scale, 8, GREEN);
  b.cone(-16 * scale, 0.2, 10 * scale, r * 0.4, 9 * scale, 7, ROCK);
  const palms = 6 + Math.floor(rnd() * 4);
  for (let i = 0; i < palms; i++) {
    const a = rnd() * Math.PI * 2, rr = r * (0.45 + rnd() * 0.4);
    palm(b, Math.cos(a) * rr, Math.sin(a) * rr, (3.6 + rnd() * 2.2) * scale, rnd);
  }
  // The settlement: a cluster of houses around the shore — scale and motion
  // cues as much as scenery, since they grow and slide past on approach.
  const houses = 4 + Math.floor(rnd() * 3);
  const baseA = rnd() * Math.PI * 2;
  for (let i = 0; i < houses; i++) {
    const a = baseA + (rnd() - 0.5) * 1.5, rr = r * (0.78 + rnd() * 0.16);
    house(b, Math.cos(a) * rr, Math.sin(a) * rr, (0.9 + rnd() * 0.5) * scale, rnd);
  }
  return R.makeMesh(b);
}

export function buildRingMeshes(R) {
  const gold = new Builder(); gold.torus(0, 0, 0, 4.4, 0.42, 22, 10, GOLD);
  const past = new Builder(); past.torus(0, 0, 0, 4.4, 0.42, 22, 10, PAST);
  // The NEXT ring burns brighter than the rest of the course (colour pushed
  // past 1.0 so it pops against sky and fog) — depth order reads at a glance:
  // bright means next, gold means later, green means done.
  const next = new Builder(); next.torus(0, 0, 0, 4.4, 0.46, 22, 10, [1.45, 1.08, 0.38]);
  // Night treatment, drawn only as darkness falls (the scene scales their
  // alpha with it; at day they are never drawn and the course looks exactly
  // as it always did). A fat translucent halo torus gives each ring a glow
  // the fog cannot eat, and hot cores — colours far past 1.0, so the lit
  // shader's emissive term carries them — replace the dim day shading that
  // left night rings as small dark-orange circles against a black sky.
  const glow = new Builder(); glow.torus(0, 0, 0, 4.4, 1.55, 22, 10, [2.0, 1.45, 0.42]);
  const goldNight = new Builder(); goldNight.torus(0, 0, 0, 4.4, 0.46, 22, 10, [2.15, 1.55, 0.48]);
  const nextNight = new Builder(); nextNight.torus(0, 0, 0, 4.4, 0.52, 22, 10, [2.9, 2.15, 0.85]);
  return {
    gold: R.makeMesh(gold), past: R.makeMesh(past), next: R.makeMesh(next),
    glow: R.makeMesh(glow), goldNight: R.makeMesh(goldNight), nextNight: R.makeMesh(nextNight),
  };
}

// The destination airport: a marked runway deck on flat ground at the
// island's shore (top exactly at water level, so a touchdown at alt 0 rests
// the floats ON it), threshold at local +Z facing the approaching plane,
// plus a small terminal and tower silhouette at its far end. The layout is
// exported so tests can check the flight model's landing zone against the
// geometry the player actually sees.
export const STRIP_LAYOUT = { width: 27, length: 200, centreZ: 89, topY: 0.02 };
export function buildStrip(R) {
  const b = new Builder();
  const DECK = [0.22, 0.23, 0.27], PAINT = [0.95, 0.93, 0.86], LAMP = [2.3, 1.85, 0.9];
  b.box(0, -0.14, 0, 48, 0.28, 232, [0.76, 0.68, 0.52]); // sand apron: the airfield reads from a kilometre out
  b.box(0, -0.26, 0, STRIP_LAYOUT.width, 0.56, STRIP_LAYOUT.length, DECK);
  b.box(-12.6, 0.05, 0, 0.9, 0.07, 196, PAINT);
  b.box(12.6, 0.05, 0, 0.9, 0.07, 196, PAINT);
  for (let i = -2; i <= 2; i++) b.box(i * 4.6, 0.05, 92, 2.4, 0.07, 10, PAINT); // threshold bars
  for (let z = -84; z <= 84; z += 21) b.box(0, 0.05, z, 0.8, 0.07, 9, PAINT); // centreline
  // Edge lights: a lamp every 14 m down both edges, colours well past 1.0
  // so at night the emissive term makes the strip read as LIT from
  // approach distance — the first version had only paint and two rows of
  // small approach posts, and a real night landing saw a plain grey deck.
  for (let z = -98; z <= 98; z += 14) {
    b.box(-13.6, 0.32, z, 0.72, 0.5, 0.72, LAMP);
    b.box(13.6, 0.32, z, 0.72, 0.5, 0.72, LAMP);
  }
  for (let z = 118; z <= 286; z += 42) { // approach lights on posts
    b.box(-17, 0.55, z, 0.85, 1.1, 0.85, LAMP);
    b.box(17, 0.55, z, 0.85, 1.1, 0.85, LAMP);
  }
  // Centreline approach light system: a row of elevated heads over the
  // water running 200 m out from the threshold, ending in a crossbar.
  // The flat strip all but vanishes at grazing angles on a real night
  // approach — a line of lights standing 5 m over the sea does not, and
  // it points straight at the threshold the way a real ALS does.
  for (let z = 132; z <= 312; z += 30) {
    b.box(0, 2.5, z, 0.4, 5, 0.4, [0.25, 0.25, 0.28]);
    b.box(0, 5.1, z, 1.15, 0.6, 1.15, [2.6, 2.2, 1.2]);
  }
  b.box(0, 5.1, 312, 13, 0.6, 1.1, [2.6, 2.2, 1.2]); // the crossbar
  b.box(0, 0.42, 104, 34, 0.85, 0.9, [2.5, 2.3, 1.3]); // threshold light bar
  return R.makeMesh(b);
}

// The strip's light spill: translucent glow ribbons hovering over the edge
// light rows and a halo bar over the threshold. A separate mesh because
// the scene draws it with alpha scaled by darkness — invisible by day,
// unmistakable on a night approach.
export function buildStripGlow(R) {
  const b = new Builder();
  const GLOW = [2.4, 1.9, 0.85];
  b.box(-13.6, 0.62, 0, 1.7, 0.16, 200, GLOW);
  b.box(13.6, 0.62, 0, 1.7, 0.16, 200, GLOW);
  b.box(0, 0.8, 104, 36, 0.28, 2.4, [2.4, 2.3, 1.4]); // threshold halo
  b.box(0, 0.5, 222, 2.4, 0.14, 200, GLOW); // centreline spill under the ALS
  return R.makeMesh(b);
}

// Terminal, tower and hangars for an airport, local origin at the runway's
// far end, buildings standing on the shore to the +X side.
export function buildAirport(R) {
  const b = new Builder();
  const WALL = [0.92, 0.88, 0.80], ROOF = [0.62, 0.25, 0.14], GLASS = [0.15, 0.35, 0.45];
  const WIN = [1.30, 1.02, 0.50]; // lit windows: emissive past 1.0, they glow at night
  b.box(34, 3, -6, 20, 6, 9, WALL); // terminal
  b.box(34, 6.6, -6, 22, 1.2, 11, ROOF);
  b.box(34, 3.4, -11.2, 14, 2.6, 0.6, GLASS); // terminal windows
  for (const wx of [28.5, 34, 39.5]) b.box(wx, 3.2, -11.55, 2.6, 1.7, 0.18, WIN); // lit panes over the glass
  b.box(46, 7.5, 8, 3.2, 15, 3.2, WALL); // tower shaft
  b.box(46, 15.8, 8, 5.4, 2.4, 5.4, GLASS); // tower cab
  b.box(46, 15.8, 5.2, 4.6, 1.8, 0.3, WIN); // the cab's lit face, watching the strip
  b.box(46, 17.4, 8, 6, 0.8, 6, ROOF);
  b.box(24, 2.5, 16, 12, 5, 8, [0.55, 0.58, 0.62]); // hangar
  b.cone(24, 5, 16, 6.4, 2.2, 4, ROOF);
  b.box(40, 1.8, 24, 8, 3.6, 6, WALL); // cargo shed
  return R.makeMesh(b);
}

// A house: walls, a pyramid roof, a door shadow, one lit window. Baked into
// island meshes so every shore carries its settlement.
function house(b, x, z, s, rnd) {
  const wall = [0.90, 0.82, 0.66], roof = [0.60 + rnd() * 0.15, 0.24, 0.13];
  b.box(x, 1.1 * s, z, 3.4 * s, 2.2 * s, 2.8 * s, wall);
  b.frustum(x, 2.9 * s, z, 4.3 * s, 1.4 * s, 3.7 * s, 0.12, roof); // hip roof, aligned with the walls
  b.box(x, 0.8 * s, z - 1.45 * s, 0.8 * s, 1.6 * s, 0.15, [0.3, 0.2, 0.14]);
  b.box(x + 0.95 * s, 1.25 * s, z - 1.44 * s, 0.55 * s, 0.6 * s, 0.1, [1.30, 1.02, 0.50]); // lit window
}

// Clouds: low-poly puffs — flattened box clusters in warm white. The field is
// laid out deterministically per leg, at flying altitude along the route, so
// passing one is an altitude/speed event, not decoration.
export function cloudField(legDist) {
  const rnd = mulberry32(Math.round(legDist) * 31 + 7);
  const out = [];
  for (let i = 0; i < 9; i++) {
    const nearRoute = rnd() < 0.3;
    out.push({
      x: nearRoute ? (rnd() * 2 - 1) * 26 : (rnd() < 0.5 ? -1 : 1) * (55 + rnd() * 175),
      y: 46 + rnd() * 52,
      z: -legDist * (0.1 + 0.85 * (i + rnd() * 0.7) / 9),
      s: 0.8 + rnd() * 1.1,
    });
  }
  return out;
}
export function buildCloud(R) {
  const b = new Builder();
  const W = [1.06, 1.02, 0.97];
  b.box(0, 0, 0, 17, 3.6, 9.5, W);
  b.box(7.5, 0.8, 1, 10.5, 3, 7.5, W);
  b.box(-7.5, 0.5, -1, 11, 2.8, 8, W);
  b.box(2, 1.9, -2, 8.5, 2.6, 6.5, W);
  b.box(-3, 1.7, 2.2, 7.5, 2.2, 5.5, W);
  return R.makeMesh(b);
}

// Low-altitude speed streaks: three foam trails streaming behind the floats.
export function buildStreaks(R) {
  const b = new Builder();
  for (const [x, z, len] of [[-1.2, 6, 10], [1.2, 6, 10], [0, 13, 14], [-0.6, 20, 9], [0.7, 24, 11]]) {
    b.box(x, 0, z, 0.75, 0.06, len, FOAM);
  }
  return R.makeMesh(b);
}

export function buildSeaMesh(R) {
  const CELL = 40, N = 40, pos = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x0 = (i - N / 2) * CELL, x1 = x0 + CELL, z0 = (j - N / 2) * CELL, z1 = z0 + CELL;
    pos.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z0, x1, 0, z1, x0, 0, z1);
  }
  return { mesh: R.makeRawMesh(pos), cell: CELL };
}

export function buildSkyMesh(R) {
  const s = 10, pos = [];
  // Six faces of a cube around the camera; the gradient shader colours them
  // by view direction, so the box itself is invisible scaffolding.
  const faces = [
    [[-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s]],
    [[s, -s, s], [-s, -s, s], [-s, s, s], [s, s, s]],
    [[-s, -s, s], [-s, -s, -s], [-s, s, -s], [-s, s, s]],
    [[s, -s, -s], [s, -s, s], [s, s, s], [s, s, -s]],
    [[-s, s, -s], [s, s, -s], [s, s, s], [-s, s, s]],
    [[-s, -s, s], [s, -s, s], [s, -s, -s], [-s, -s, -s]],
  ];
  for (const f of faces) { pos.push(...f[0], ...f[1], ...f[2], ...f[0], ...f[2], ...f[3]); }
  return R.makeRawMesh(pos);
}

export function buildBuoys(R) {
  const b = new Builder();
  b.box(0, 0.35, 0, 0.9, 0.7, 0.9, RED);
  b.cone(0, 0.7, 0, 0.42, 0.6, 6, FOAM);
  const red = R.makeMesh(b);
  const w = new Builder();
  w.box(0, 0.35, 0, 0.9, 0.7, 0.9, FOAM);
  w.cone(0, 0.7, 0, 0.42, 0.6, 6, RED);
  return { red, white: R.makeMesh(w) };
}

export function buildBlob(R, color) {
  const b = new Builder();
  b.disc(0, 0, 0, 3.4, 16, color);
  return R.makeMesh(b);
}

// The landing light's beam: a translucent cone from the nose, reaching ahead
// and down. Drawn only when the world is dark enough for it to matter; the
// colour sits past 1.0 so it reads as light, not geometry.
export function buildLightCone(R) {
  const b = new Builder();
  const SEG = 10, LEN = 17, RAD = 2.6, DROP = 3.2;
  const col = [1.25, 1.15, 0.85];
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    const p0 = [Math.cos(a0) * RAD, -DROP + Math.sin(a0) * RAD, -LEN];
    const p1 = [Math.cos(a1) * RAD, -DROP + Math.sin(a1) * RAD, -LEN];
    b.tri([0, 0, 0], p1, p0, col);
  }
  return R.makeMesh(b);
}

// The scene keeps a spring-smoothed chase camera so the plane eases through
// the frame instead of snapping with every input twitch.
export function createScene(R, assets) {
  const cam = { x: 0, alt: 6 };
  const projCache = { aspect: 0, m: null };
  let cloudCache = { leg: -1, field: [] };
  function draw(st) {
    const { canvas } = R;
    const aspect = canvas.width / canvas.height;
    // A ring pass kicks the field of view briefly — the world lurches past.
    let kick = 0;
    for (const fx of st.fx || []) kick = Math.max(kick, 1 - fx.age / 0.4);
    const fov = 1.05 * (1 + 0.075 * clamp(kick, 0, 1));
    if (aspect !== projCache.aspect || Math.abs(fov - (projCache.fov || 0)) > 0.002) {
      projCache.aspect = aspect; projCache.fov = fov; projCache.m = M4.persp(fov, aspect, 0.5, 2600);
    }
    const pz = -st.dist; // plane z
    let eye, target;
    if (st.camMode === 'cockpit') {
      // Over the nose: the camera sits in the pilot's seat — no spring lag,
      // the world answers the controls directly.
      eye = [st.x, st.alt + 2.35, pz - 0.4];
      target = [st.x - st.bank * 3, st.alt + 1.15 + st.pitchVis * 6, pz - 40];
      cam.x = st.x * 0.84; cam.alt = st.alt + 5.4; // keep the chase spring warm
    } else {
      const back = st.camMode === 'far' ? 30 : (st.camBack || 16.5);
      const up = st.camMode === 'far' ? 4.5 : (st.camUp || 0);
      cam.x = lerp(cam.x, st.x * 0.84, 0.06);
      cam.alt = lerp(cam.alt, st.alt + 5.4, 0.08);
      eye = [cam.x, cam.alt + up, pz + back];
      // The aim point rides above the plane (she sits low in frame) and swings
      // with her pitch, so pitching visibly tilts the horizon and the sea.
      target = [st.x * 0.94 - st.bank * 2.2, st.alt + (st.aimDy ?? 2.4) + st.pitchVis * 5.5, pz - 30];
    }
    const view = M4.lookAt(eye, target, [0, 1, 0]);
    R.setCamera(view, projCache.m, eye);
    // The clock's environment drives every light in the frame.
    if (st.env) R.setEnv(st.env);
    R.begin();
    R.drawSky(assets.sky, st.time);
    // Sea follows the camera in whole cells so the glitter never swims.
    const snap = assets.sea.cell;
    const origin = [Math.round(eye[0] / snap) * snap, 0, Math.round(eye[2] / snap) * snap];
    R.drawSea(assets.sea.mesh, origin, st.time);
    // Islands: home behind, destination ahead, islets scattered en route.
    R.draw(assets.isleHome, M4.compose(0, 0, 78, 0, 0, 0, 1.25));
    R.draw(assets.isleDest, M4.compose(0, 0, -st.legDist - 72, 0, Math.PI, 0, 1.35));
    for (const isl of assets.islets) {
      R.draw(isl.mesh, M4.compose(isl.x, 0, -st.legDist * isl.f, 0, isl.rot, 0, isl.s));
    }
    // Buoy lanes: the takeoff run at the start, the approach lane ending at
    // the destination strip (z = -legDist).
    drawLane(R, assets, 20);
    drawLane(R, assets, -st.legDist + 150);
    // The strip herself: a deck on the destination shore, threshold facing
    // the plane, growing out of the haze from a kilometre out.
    const stripM = M4.compose(0, 0, -st.legDist + STRIP_LAYOUT.centreZ, 0, 0, 0);
    R.draw(assets.strip, stripM);
    // Her light spill fades in with darkness: by night the lit edges and
    // the threshold halo are the approach's main landmark.
    const dark = darknessOf(st.env);
    if (assets.stripGlow && dark > 0.02) R.draw(assets.stripGlow, stripM, 0.40 * dark);
    // Airport buildings at the runway's far end (and a twin behind the start).
    R.draw(assets.airport, M4.compose(0, 0, -st.legDist - 14, 0, 0, 0));
    R.draw(assets.airport, M4.compose(0, 0, 128, 0, Math.PI, 0, 0.85));
    // Clouds at flying altitude along the route.
    if (cloudCache.leg !== st.legDist) cloudCache = { leg: st.legDist, field: cloudField(st.legDist) };
    for (const c of cloudCache.field) {
      if (Math.abs(c.z - pz) > 1000) continue;
      R.draw(assets.cloud, M4.compose(c.x, c.y, c.z, 0, 0, 0, c.s), 0.88);
    }
    // Rings: the next one bright, the rest gold (fog thins them with range),
    // green once threaded, ghosts once missed. As darkness falls each live
    // ring gains its runway-light treatment — a glow halo whose strength
    // scales with the dark, and a hot emissive core; the NEXT ring burns
    // brightest and pulses gently, so the course reads at night the way
    // the strip does. By day (dark = 0) none of this is drawn at all.
    const nextRing = st.rings.find(r => !r.passed && !r.missed);
    for (const r of st.rings) {
      const dz = -r.dist - pz;
      if (dz > 60 || dz < -1200) continue;
      const m = M4.compose(r.x, r.altM, -r.dist, Math.PI / 2, 0, 0, r.passed ? 1 : 1 + 0.05 * Math.sin(st.time * 3));
      if (r.passed) R.draw(assets.rings.past, m);
      else if (r.missed) R.draw(assets.rings.gold, m, 0.3);
      else if (r === nextRing) {
        R.draw(assets.rings.next, m);
        if (dark > 0.02) {
          const pulse = 0.85 + 0.15 * Math.sin(st.time * 3);
          R.draw(assets.rings.glow, nightGlowM(r, -dz), (0.14 + 0.30 * pulse) * dark);
          R.draw(assets.rings.nextNight, m, dark);
        }
      } else {
        R.draw(assets.rings.gold, m);
        if (dark > 0.02) {
          R.draw(assets.rings.glow, nightGlowM(r, -dz), 0.22 * dark);
          R.draw(assets.rings.goldNight, nightCoreM(r, -dz), 0.95 * dark);
        }
      }
    }
    // Ring-pass flashes: a torus blooming outward where the plane crossed.
    for (const fx of st.fx || []) {
      const m = M4.compose(fx.x, fx.altM, -fx.dist, Math.PI / 2, 0, 0, 1 + fx.age * 3.4);
      R.draw(assets.rings.next, m, clamp(0.95 * (1 - fx.age / 0.45), 0, 0.95));
    }
    // Water shadow: glued to the sea under the plane, spreading and softening
    // as she climbs — the gap between plane and shadow IS the altitude cue.
    // It spreads and holds its darkness longer than it used to, so the cue
    // survives into mid altitude; past that the chase frame's geometry puts
    // the water below the plane out of view and the sea-glitter scale takes
    // over as the altitude readout.
    const shScale = 1 + st.alt * 0.02;
    const shAlpha = clamp(0.46 - st.alt * 0.0018, 0.30, 0.46);
    R.draw(assets.shadow, M4.compose(st.x, 0.14, pz, 0, 0, 0, shScale), shAlpha);
    if (st.alt < 0.4 && st.speed > 4) {
      R.draw(assets.foam, M4.compose(st.x, 0.16, pz + 2.6, 0, 0, 0, 1 + st.speed * 0.02), clamp(st.speed / 46, 0, 0.5));
    }
    // Speed streaks stream behind the floats when she is low and fast.
    const streakA = clamp((st.speed - 16) / 34, 0, 1) * clamp(1 - st.alt / 7, 0, 1) * 0.55;
    if (streakA > 0.02) R.draw(assets.streaks, M4.compose(st.x, 0.18, pz, 0, 0, 0), streakA);
    // From the pilot's seat the airframe is not drawn: the camera sits where
    // the pilot's eyes are, and the fuselage/wing around that point would
    // fill the forward view with dark geometry (the first cockpit framing
    // stared into the wing strut). The horizon, the rings and the strip are
    // the cockpit's instruments.
    if (st.camMode !== 'cockpit') {
      const planeM = M4.compose(st.x, st.alt + 0.62, pz, st.pitchVis * 0.38, -st.bank * 0.22, -st.bank * 0.55);
      R.draw(assets.plane.plane, planeM);
      const propM = M4.mul(planeM, M4.compose(0, 0.95, -3.05, 0, 0, st.propSpin));
      R.draw(assets.plane.prop, propM);
      R.draw(assets.plane.disc, propM, 0.16);
    }
    // The landing light throws its beam when the world is dark: the cone
    // hangs off the nose, ahead and down toward the water or the strip.
    const emis = st.env ? st.env.emis : 0;
    if (assets.cone && emis > 0.9) {
      const coneM = M4.compose(st.x, st.alt + 1.1, pz - 2.4, 0, 0, -st.bank * 0.3);
      R.draw(assets.cone, coneM, clamp((emis - 0.9) / 1.3, 0, 1) * 0.13);
    }
  }
  // Settle the camera instantly (staged screenshots start from a posed frame
  // instead of waiting for the spring to converge).
  function snap(st) { cam.x = st.x * 0.84; cam.alt = st.alt + 5.4; }
  function drawLane(R2, assets, zBase) {
    for (let i = 0; i < 8; i++) {
      const z = zBase - i * 20;
      R2.draw(i % 2 ? assets.buoys.red : assets.buoys.white, M4.compose(-13, 0, z, 0, 0, 0));
      R2.draw(i % 2 ? assets.buoys.white : assets.buoys.red, M4.compose(13, 0, z, 0, 0, 0));
    }
  }
  return { draw, snap };
}
