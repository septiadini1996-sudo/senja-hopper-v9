// The 3D world: a low-poly seaplane, island terrain with palms, golden torus
// rings, buoy lanes and the glittering sea, all built as static meshes with
// the hand-rolled engine in engine3d.js. The flight runs along -Z: the plane
// sits at z = -distance, the destination island waits at z = -legDist.
import { Builder, M4, sub3, cross3, norm3 } from './engine3d.js';
import { mulberry32, clamp, lerp } from './util.js';
import { PANEL, GAUGES, RADAR, GLASS_PANES, gaugeReadings, radarBlips } from './cockpit.js';

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
  seg2(b, z0, w0, h0, cy, z1, w1, h1, cy, color, xo, xo);
}

// The general prism: each end has its own width, height, centre height and
// lateral offset, so a body can taper AND rise AND drift in one section —
// the upswept tail cone, the drooped nose and the slanted struts are all
// this one shape.
function seg2(b, z0, w0, h0, cy0, z1, w1, h1, cy1, color, xo0 = 0, xo1 = xo0) {
  const a = [xo0 - w0 / 2, cy0 - h0 / 2, z0], c = [xo0 + w0 / 2, cy0 - h0 / 2, z0];
  const d = [xo0 + w0 / 2, cy0 + h0 / 2, z0], e = [xo0 - w0 / 2, cy0 + h0 / 2, z0];
  const A = [xo1 - w1 / 2, cy1 - h1 / 2, z1], C = [xo1 + w1 / 2, cy1 - h1 / 2, z1];
  const D = [xo1 + w1 / 2, cy1 + h1 / 2, z1], E = [xo1 - w1 / 2, cy1 + h1 / 2, z1];
  b.quad(e, d, D, E, color); b.quad(a, A, C, c, color);
  b.quad(c, C, D, d, color); b.quad(A, a, e, E, color);
  b.quad(A, E, D, C, color); b.quad(a, c, d, e, color);
}

// A prism between two cross-sections along X: wings and tailplanes with
// taper (chord shrinks), sweep (the chord's centre slides back) and
// dihedral (the tip rises) in one piece.
function segX(b, x0, ch0, th0, cy0, zc0, x1, ch1, th1, cy1, zc1, color) {
  const a = [x0, cy0 - th0 / 2, zc0 - ch0 / 2], c = [x0, cy0 - th0 / 2, zc0 + ch0 / 2];
  const d = [x0, cy0 + th0 / 2, zc0 + ch0 / 2], e = [x0, cy0 + th0 / 2, zc0 - ch0 / 2];
  const A = [x1, cy1 - th1 / 2, zc1 - ch1 / 2], C = [x1, cy1 - th1 / 2, zc1 + ch1 / 2];
  const D = [x1, cy1 + th1 / 2, zc1 + ch1 / 2], E = [x1, cy1 + th1 / 2, zc1 - ch1 / 2];
  b.quad(e, d, D, E, color); b.quad(a, A, C, c, color);
  b.quad(c, C, D, d, color); b.quad(A, a, e, E, color);
  b.quad(A, E, D, C, color); b.quad(a, c, d, e, color);
}

// A square beam between two points in space — struts, spreader bars,
// poles. The cross-section is a square of side w facing the beam's axis.
function beam(b, p0, p1, w, color) {
  const d = norm3(sub3(p1, p0));
  const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const s1 = norm3(cross3(d, up)), s2 = cross3(d, s1);
  const corner = (p, a, c) => [
    p[0] + (s1[0] * a + s2[0] * c) * w / 2,
    p[1] + (s1[1] * a + s2[1] * c) * w / 2,
    p[2] + (s1[2] * a + s2[2] * c) * w / 2,
  ];
  const A = corner(p0, -1, -1), B = corner(p0, 1, -1), C = corner(p0, 1, 1), D = corner(p0, -1, 1);
  const E = corner(p1, -1, -1), F = corner(p1, 1, -1), G = corner(p1, 1, 1), H = corner(p1, -1, 1);
  b.quad(A, B, F, E, color); b.quad(B, C, G, F, color);
  b.quad(C, D, H, G, color); b.quad(D, A, E, H, color);
  b.quad(E, F, G, H, color); b.quad(A, D, C, B, color);
}

const GLASS = [0.07, 0.13, 0.18], METAL = [0.58, 0.60, 0.63], RUBBER = [0.16, 0.13, 0.11];

export function buildPlane(R) {
  const b = new Builder();
  // Fuselage: nose at -Z, tail at +Z, origin at the waterline. Seven
  // sections now, each with its own centre height, so the nose droops
  // slightly, the cabin swells, and the tail cone sweeps UP toward the
  // fin the way a real airframe does — the old four boxes read as a
  // crate; these read as a shaped body.
  seg2(b, -3.30, 0.30, 0.30, 1.00, -2.95, 0.80, 0.74, 1.00, CREAM); // nose tip
  seg2(b, -2.95, 0.80, 0.74, 1.00, -2.30, 1.10, 0.97, 1.02, CREAM); // cowling
  seg2(b, -2.30, 1.10, 0.97, 1.02, -1.20, 1.34, 1.20, 1.04, CREAM); // forward cabin
  seg2(b, -1.20, 1.34, 1.20, 1.04, 0.90, 1.46, 1.30, 1.06, CREAM); // main cabin, widest
  seg2(b, 0.90, 1.46, 1.30, 1.06, 2.30, 1.06, 1.06, 1.15, CREAM); // taper + rise
  seg2(b, 2.30, 1.06, 1.06, 1.15, 3.30, 0.56, 0.72, 1.33, CREAM); // tail cone, upswept
  seg2(b, 3.30, 0.56, 0.72, 1.33, 3.95, 0.16, 0.34, 1.49, RED); // tail tip
  // Cowling detail: a darker top panel and two exhaust stubs.
  b.box(0, 1.44, -2.62, 0.66, 0.09, 0.95, [0.42, 0.34, 0.28]);
  b.box(-0.52, 0.60, -2.45, 0.13, 0.13, 0.5, RUBBER);
  b.box(0.52, 0.60, -2.45, 0.13, 0.13, 0.5, RUBBER);
  // The glasshouse: a tapered prism of dark glossy glazing over the cabin,
  // with a cream roof spine and a centre pillar breaking the glass into
  // windscreens — flat-shaded dark reads as gloss against the cream.
  seg2(b, -1.58, 0.96, 0.60, 1.60, 0.58, 1.05, 0.64, 1.64, GLASS);
  b.box(0, 1.97, -0.50, 0.46, 0.07, 2.05, CREAM); // roof spine
  b.box(0, 1.78, -1.56, 0.07, 0.42, 0.07, CREAM); // windscreen pillar
  // Livery: a teal cheatline hugging each flank of the cabin, and the
  // registration as micro-bars on the tail cone — the engine has no text,
  // so lettering is faked with five small dark blocks that read as
  // characters at chase distance.
  for (const sx of [-1, 1]) {
    b.box(sx * 0.715, 1.10, 0, 0.03, 0.17, 2.2, TEAL);
    for (let i = 0; i < 5; i++) b.box(sx * 0.335, 1.38, 2.58 + i * 0.115, 0.02, 0.15, 0.055, [0.25, 0.16, 0.12]);
  }
  // Main wing: tapered, swept and dihedralled in two sections a side,
  // red outer panels, winglets standing at the tips.
  for (const sx of [-1, 1]) {
    segX(b, 0, 1.85, 0.17, 1.52, -0.30, sx * 3.2, 1.55, 0.135, 1.64, -0.40, CREAM);
    segX(b, sx * 3.2, 1.55, 0.135, 1.64, -0.40, sx * 5.05, 1.22, 0.11, 1.76, -0.50, CREAM);
    segX(b, sx * 5.05, 1.22, 0.11, 1.76, -0.50, sx * 5.60, 1.02, 0.095, 1.82, -0.56, RED);
    b.box(sx * 5.62, 2.06, -0.58, 0.055, 0.52, 0.78, RED); // winglet
    // Wing struts: a slanted pair per side, fuselage low to wing underside.
    beam(b, [sx * 0.52, 0.52, -0.95], [sx * 2.25, 1.50, -0.62], 0.09, METAL);
    beam(b, [sx * 0.52, 0.52, 0.35], [sx * 2.25, 1.50, 0.02], 0.09, METAL);
  }
  // Tail unit: a tapered tailplane with red tips, and a two-piece fin
  // with a cream flash and a darker rudder behind its hinge line.
  for (const sx of [-1, 1]) {
    segX(b, 0, 1.02, 0.12, 1.60, 3.38, sx * 1.45, 0.82, 0.10, 1.66, 3.44, CREAM);
    segX(b, sx * 1.45, 0.82, 0.10, 1.66, 3.44, sx * 1.88, 0.66, 0.085, 1.70, 3.48, RED);
  }
  b.frustum(0, 2.02, 3.32, 0.15, 1.15, 1.18, 0.52, RED); // fin, lower
  b.frustum(0, 2.86, 3.44, 0.13, 0.62, 0.78, 0.30, RED); // fin, upper
  b.box(0, 2.30, 3.36, 0.165, 0.20, 1.02, CREAM); // fin flash
  b.box(0, 2.10, 3.86, 0.10, 1.05, 0.34, [0.55, 0.16, 0.11]); // rudder
  // Navigation and landing lights: colours pushed past 1.0, so the lit
  // shader's emissive term takes them over as the light falls — port red,
  // starboard green, a white tail light, and the landing lamp under the nose.
  b.box(-5.66, 1.82, -0.56, 0.26, 0.12, 0.26, [1.7, 0.18, 0.12]);
  b.box(5.66, 1.82, -0.56, 0.26, 0.12, 0.26, [0.20, 1.50, 0.35]);
  b.box(0, 3.22, 3.50, 0.18, 0.11, 0.18, [1.5, 1.5, 1.4]);
  b.box(0, 0.52, -2.90, 0.34, 0.12, 0.14, [1.9, 1.8, 1.5]);
  // Twin floats, refined: a planing step amidships and an upswept tail,
  // slanted struts in an N arrangement, and spreader bars between them.
  // Their keels sit at y = -0.62, so with the scene's +0.62 draw offset
  // the floats rest exactly ON the deck (and ON the water) at alt 0.
  for (const sx of [-1.18, 1.18]) {
    seg2(b, -2.60, 0.16, 0.16, -0.36, -1.95, 0.50, 0.44, -0.40, CREAM, sx);
    b.box(sx, -0.40, -0.30, 0.50, 0.44, 2.65, CREAM); // planing bottom, step at the back
    seg2(b, 1.02, 0.50, 0.44, -0.38, 2.55, 0.14, 0.16, -0.24, CREAM, sx); // upswept tail
    b.box(sx, -0.155, -0.30, 0.54, 0.05, 2.7, RED); // float top stripe
    beam(b, [sx * 0.72, 0.45, -1.25], [sx, -0.22, -1.55], 0.10, METAL);
    beam(b, [sx * 0.72, 0.45, 0.55], [sx, -0.22, 0.95], 0.10, METAL);
    beam(b, [sx, -0.22, -1.55], [sx * 0.72, 0.45, 0.55], 0.08, METAL); // the N's diagonal
  }
  beam(b, [-1.18, -0.30, -1.10], [1.18, -0.30, -1.10], 0.09, METAL);
  beam(b, [-1.18, -0.30, 0.75], [1.18, -0.30, 0.75], 0.09, METAL);
  const plane = R.makeMesh(b);
  // Propeller: tapered blades (a wide root pair and a narrower tip pair
  // on each axis), a metal backplate and a proper spinner cone, all spun
  // around Z by the scene.
  const prop = buildPropMesh(R);
  // Translucent prop disc, drawn over the blades; the scene scales its
  // alpha with the throttle, so the blur arrives with the power.
  const d = new Builder();
  const SEG = 24;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    d.tri([0, 0, 0], [Math.cos(a0) * 2.18, Math.sin(a0) * 2.18, 0], [Math.cos(a1) * 2.18, Math.sin(a1) * 2.18, 0], [0.25, 0.2, 0.16]);
  }
  const disc = R.makeMesh(d);
  return { plane, prop, disc };
}

// The propeller as its own builder so the blade layout reads plainly:
// two tapered blades on the vertical axis, two on the horizontal, a
// backplate disc and a spinner that cones to a point ahead of the nose.
function buildPropMesh(R) {
  const p = new Builder();
  p.box(0, 0, -0.06, 0.30, 2.90, 0.075, DARK); // root blades, vertical pair
  p.box(0, 0, -0.06, 2.90, 0.30, 0.075, DARK); // root blades, horizontal pair
  for (const s of [-1, 1]) {
    p.box(0, s * 1.78, -0.05, 0.22, 0.72, 0.06, DARK); // blade tips, vertical
    p.box(s * 1.78, 0, -0.05, 0.72, 0.22, 0.06, DARK); // blade tips, horizontal
    p.box(0, s * 2.12, -0.05, 0.13, 0.10, 0.05, RED); // tip marks
    p.box(s * 2.12, 0, -0.05, 0.10, 0.13, 0.05, RED);
  }
  seg2(p, -0.02, 0.50, 0.50, 0, 0.16, 0.56, 0.56, 0, METAL); // backplate
  seg2(p, -0.62, 0.05, 0.05, 0, -0.02, 0.50, 0.50, 0, RED); // spinner cone
  return R.makeMesh(p);
}

function palm(b, x, z, h, rnd) {
  const lean = (rnd() - 0.5) * 0.7;
  b.box(x + lean * h * 0.3, h / 2, z, 0.22, h, 0.22, TRUNK);
  const tx = x + lean * h * 0.6;
  b.cone(tx, h - 0.55, z, 1.9, 0.85, 6, GREEN);
  b.cone(tx, h - 0.15, z, 1.25, 0.7, 6, GREEN2);
  // Variety from a stable position hash (deterministic, no extra rnd
  // draws to disturb the island's layout): some crowns carry a third,
  // wider frond layer, and the taller palms carry coconuts.
  const v = Math.abs(Math.sin(x * 12.9898 + z * 78.233)) % 1;
  if (v < 0.45) b.cone(tx, h - 0.95, z, 2.45, 0.7, 6, GREEN);
  if (h > 4.4) for (const [ox, oz] of [[-0.3, 0.15], [0.25, -0.2], [0.05, 0.35]]) {
    b.box(tx + ox, h - 0.95, z + oz, 0.26, 0.26, 0.26, [0.30, 0.22, 0.12]);
  }
}

export function buildIsland(R, seed, scale = 1) {
  const rnd = mulberry32(seed);
  const b = new Builder();
  const r = 46 * scale;
  b.disc(0, 0.10, 0, r * 1.31, 20, FOAM); // the surf line: a pale rim where sea meets beach
  b.disc(0, 0.25, 0, r * 1.22, 18, SAND); // beach apron
  b.cone(0, 0.2, 0, r, 13 * scale, 9, GREEN2);
  b.cone(10 * scale, 0.2, -8 * scale, r * 0.55, 19 * scale, 8, GREEN);
  b.cone(-16 * scale, 0.2, 10 * scale, r * 0.4, 9 * scale, 7, ROCK);
  // Rock outcrops standing in the surf at the shore.
  const ra = rnd() * Math.PI * 2;
  b.cone(Math.cos(ra) * r * 1.04, 0.05, Math.sin(ra) * r * 1.04, r * 0.15, 2.0 * scale, 6, ROCK);
  b.cone(Math.cos(ra + 2.4) * r * 1.02, 0.05, Math.sin(ra + 2.4) * r * 1.02, r * 0.10, 1.3 * scale, 6, ROCK);
  const palms = 8 + Math.floor(rnd() * 5);
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
  // A longhouse warehouse anchors most settlements: wide, low, a gabled
  // roof and a dark loading door — a different silhouette from the homes.
  if (rnd() < 0.75) {
    const a = baseA + 1.9, wx = Math.cos(a) * r * 0.82, wz = Math.sin(a) * r * 0.82, s = scale;
    b.box(wx, 1.15 * s, wz, 7.5 * s, 2.3 * s, 4.2 * s, [0.74, 0.68, 0.58]);
    b.frustum(wx, 2.95 * s, wz, 8.3 * s, 1.3 * s, 5.0 * s, 0.10, [0.50, 0.30, 0.18]);
    b.box(wx, 0.95 * s, wz - 2.15 * s, 1.7 * s, 1.9 * s, 0.15, [0.28, 0.20, 0.14]);
  }
  // A jetty reaches into the shallows near the settlement: a deck on
  // posts with a crate stack, aligned to whichever shore axis is nearer.
  const px = Math.cos(baseA), pz = Math.sin(baseA);
  if (Math.abs(px) > Math.abs(pz)) {
    const jx = px * r * 1.08, jz = pz * r * 0.8;
    b.box(jx, 0.55, jz, r * 0.5, 0.18, 3.0, [0.45, 0.36, 0.26]);
    for (const off of [-0.2, 0, 0.2]) b.box(px * r * (1.08 + off), 0.1, jz, 0.3, 0.9, 0.3, [0.35, 0.28, 0.20]);
    b.box(px * r * 0.92, 1.05, jz, 1.1, 0.85, 1.1, [0.62, 0.52, 0.38]);
  } else {
    const jx = px * r * 0.8, jz = pz * r * 1.08;
    b.box(jx, 0.55, jz, 3.0, 0.18, r * 0.5, [0.45, 0.36, 0.26]);
    for (const off of [-0.2, 0, 0.2]) b.box(jx, 0.1, pz * r * (1.08 + off), 0.3, 0.9, 0.3, [0.35, 0.28, 0.20]);
    b.box(jx, 1.05, pz * r * 0.92, 1.1, 0.85, 1.1, [0.62, 0.52, 0.38]);
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
// The ground the destination strip stands on (v11): a wide sand apron
// with grass shoulders, so the deck meets LAND at its edges — the same
// complaint the owner made at the departure end applied here too.
export const DEST_APRON = { width: 88, length: 264 };
export function buildStrip(R) {
  const b = new Builder();
  b.box(0, -0.14, 0, DEST_APRON.width, 0.28, DEST_APRON.length, [0.76, 0.68, 0.52]); // sand apron: the airfield reads from a kilometre out
  // Grass shoulders flank the pavement the apron's whole length.
  b.box(-33, 0.02, 0, 38, 0.08, 250, GREEN);
  b.box(33, 0.02, 0, 38, 0.08, 250, GREEN2);
  b.box(-33, 0.075, 0, 26, 0.03, 210, [0.30, 0.54, 0.29]); // a mowed inner band
  b.box(33, 0.075, 0, 26, 0.03, 210, [0.27, 0.50, 0.27]);
  // Palms frame the apron corners, well clear of the strip itself.
  const rnd = mulberry32(9182);
  palm(b, 38, -120, 5.0, rnd); palm(b, -38, -118, 4.5, rnd);
  palm(b, 38, 122, 4.7, rnd); palm(b, -38, 120, 5.3, rnd);
  b.box(0, -0.26, 0, STRIP_LAYOUT.width, 0.56, STRIP_LAYOUT.length, DECK);
  b.box(-12.6, 0.05, 0, 0.9, 0.07, 196, PAINT);
  b.box(12.6, 0.05, 0, 0.9, 0.07, 196, PAINT);
  for (let i = -2; i <= 2; i++) b.box(i * 4.6, 0.05, 92, 2.4, 0.07, 10, PAINT); // threshold bars
  for (let i = -2; i <= 2; i++) b.box(i * 4.6, 0.05, -92, 2.4, 0.07, 10, PAINT); // far-end bars
  // Touchdown-zone pairs just past the threshold, in the direction of travel.
  for (const tz of [58, 74]) for (const sx of [-5.2, 5.2]) b.box(sx, 0.05, tz, 1.6, 0.07, 7, PAINT);
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

// The departure runway (v10): every flight now starts lined up on a
// paved strip at the home island, not on the water. The flight model
// owns the length (RUNWAY_M in flight.js); this layout mirrors it — the
// logic suite asserts the two agree. Geometry is built directly in world
// coordinates: the deck runs from z = +behindM (behind the spawn, where
// the airport buildings stand) to z = -aheadM (the far threshold, past
// which a plane that never rotates runs out of pavement).
export const DEPT_RUNWAY = { aheadM: 260, behindM: 90, width: 27, deckZ: -85 };
// One airfield palette, shared by the landing strip and the departure
// runway so both read as the same paved-and-marked standard.
const DECK = [0.22, 0.23, 0.27], DECK2 = [0.26, 0.27, 0.31], PAINT = [0.95, 0.93, 0.86];
const LAMP = [2.3, 1.85, 0.9];

export function buildDepartureRunway(R) {
  const b = new Builder();
  const { aheadM, behindM, width, deckZ } = DEPT_RUNWAY;
  const len = aheadM + behindM, nearZ = behindM, farZ = -aheadM;
  b.box(0, -0.11, deckZ, 46, 0.22, len + 4, SAND); // reclaimed ground slab
  b.box(0, -0.02, deckZ, width, 0.06, len, DECK); // the pavement, top at y 0.01
  for (const sx of [-1, 1]) b.box(sx * (width / 2 - 1.2), 0.03, deckZ, 0.9, 0.03, len, PAINT); // edge paint
  // Threshold bars at the near end (the end she lines up behind) and at
  // the far end, so the strip reads as a runway from both directions.
  for (let i = 0; i < 6; i++) {
    b.box(-10 + i * 4, 0.035, nearZ - 10, 1.6, 0.03, 12, PAINT);
    b.box(-10 + i * 4, 0.035, farZ + 8, 1.6, 0.03, 12, PAINT);
  }
  // Touchdown-zone pairs just past the near threshold.
  for (const tz of [40, 58]) for (const sx of [-5.2, 5.2]) b.box(sx, 0.035, tz, 1.6, 0.03, 7, PAINT);
  // Centreline dashes the whole roll.
  for (let z = 66; z > farZ + 14; z -= 18) b.box(0, 0.035, z, 0.55, 0.03, 6, PAINT);
  // Edge lamps, the same lit treatment as the landing strip.
  for (let z = nearZ - 6; z >= farZ + 4; z -= 20) for (const sx of [-1, 1]) b.box(sx * (width / 2 + 0.8), 0.28, z, 0.34, 0.56, 0.34, LAMP);
  // A taxiway stub leaves the threshold corner for the apron, with its
  // own centreline, and a windsock stands where the pilot can see it.
  b.box(24, -0.015, 96, 21, 0.05, 14, DECK2);
  for (let x = 16; x <= 32; x += 4) b.box(x, 0.03, 96, 2, 0.02, 0.5, [0.95, 0.75, 0.2]);
  b.box(38, -0.01, 118, 26, 0.05, 30, DECK2); // apron pad under the buildings
  beam(b, [20, 0, 64], [20, 6.5, 64], 0.18, ROCK);
  seg2(b, 62.5, 0.55, 0.55, 5.6, 64.2, 0.16, 0.16, 5.6, [0.98, 0.48, 0.12], 20, 20);
  return R.makeMesh(b);
}

export function buildDepartureGlow(R) {
  const b = new Builder();
  const { aheadM, behindM, width } = DEPT_RUNWAY;
  // Warm ribbons hovering over the two lamp rows and a green halo at the
  // threshold she lines up behind — the departure strip's night signature.
  for (const sx of [-1, 1]) {
    const x = sx * (width / 2 + 0.8);
    b.quad([x - 0.9, 0.35, behindM - 2], [x + 0.9, 0.35, behindM - 2], [x + 0.9, 0.35, -aheadM + 2], [x - 0.9, 0.35, -aheadM + 2], [1.0, 0.82, 0.42]);
  }
  b.quad([-width / 2, 0.3, behindM - 2], [width / 2, 0.3, behindM - 2], [width / 2, 0.3, behindM - 14], [-width / 2, 0.3, behindM - 14], [0.5, 1.1, 0.55]);
  return R.makeMesh(b);
}

// The home island (v11): the departure airfield stands ON LAND. The v10
// runway sat on a 46 m sand slab in open sea — from the pilot's seat the
// strip read as a pier, and the owner called it: "landasan jangan laut
// semua". The terrain is data first (discs and cones with heights), so
// the logic suite can assert the land is really under the airfield and
// that nothing raised ever buries the pavement: every shape's top stays
// at or below the deck's top (y 0.01) wherever it crosses the deck
// footprint, and the raised grass and hills live in the safe zones
// beside, behind and beyond the strip. The mesh is built from the same
// table, so what the test measures is what the player sees.
export const HOME_TERRAIN = {
  discs: [
    // The island base: three sand lobes along the runway axis, tops a
    // few millimetres over the sea and under the deck.
    { x: 0, z: 95, r: 150, y: 0.004, kind: 'sand' },
    { x: 0, z: -70, r: 175, y: 0.006, kind: 'sand' },
    { x: 0, z: -235, r: 140, y: 0.008, kind: 'sand' },
    // Grass lobes: the island's body, kept out of the strip corridor.
    { x: -98, z: 55, r: 78, y: 0.016, kind: 'grass' },
    { x: -100, z: -85, r: 82, y: 0.018, kind: 'grass' },
    { x: -95, z: -215, r: 72, y: 0.016, kind: 'grass' },
    { x: 100, z: -60, r: 82, y: 0.018, kind: 'grass' },
    { x: 98, z: -195, r: 74, y: 0.016, kind: 'grass' },
    { x: 0, z: -352, r: 88, y: 0.017, kind: 'grass' },
    { x: -30, z: 195, r: 85, y: 0.017, kind: 'grass' },
  ],
  cones: [
    { x: -150, z: -300, r: 55, h: 15, kind: 'hill' },
    { x: 150, z: -275, r: 48, h: 11, kind: 'hill' },
    { x: -145, z: 185, r: 50, h: 9, kind: 'hill' },
    { x: 120, z: 150, r: 40, h: 6, kind: 'grass' },
    { x: -70, z: -330, r: 34, h: 4, kind: 'grass' },
  ],
};
// The terrain's top height at a point: the highest shape covering it,
// or -1 for open sea. Cones stand on a 0.01 base (their skirts meet the
// sand lobes) and rise linearly to the apex.
export function terrainHeightAt(x, z) {
  let top = -1;
  for (const d of HOME_TERRAIN.discs) {
    if (Math.hypot(x - d.x, z - d.z) <= d.r) top = Math.max(top, d.y);
  }
  for (const c of HOME_TERRAIN.cones) {
    const dist = Math.hypot(x - c.x, z - c.z);
    if (dist <= c.r) top = Math.max(top, 0.01 + c.h * (1 - dist / c.r));
  }
  return top;
}

export function buildHomeTerrain(R) {
  const b = new Builder();
  const SANDS = [SAND, [0.90, 0.74, 0.48], SAND];
  const GREENS = [GREEN, GREEN2, [0.30, 0.54, 0.29]];
  let si = 0, gi = 0;
  for (const d of HOME_TERRAIN.discs) {
    b.disc(d.x, d.y, d.z, d.r, 30, d.kind === 'sand' ? SANDS[si++ % SANDS.length] : GREENS[gi++ % GREENS.length]);
  }
  for (const c of HOME_TERRAIN.cones) {
    b.cone(c.x, 0.01, c.z, c.r, c.h, 10, c.kind === 'hill' ? [0.36, 0.46, 0.30] : GREEN2);
  }
  // Palms dress the grass lobes — never the corridor, never the apron.
  const rnd = mulberry32(4242);
  for (const [x, z, h] of [[-120, 30, 4.6], [-80, -160, 5.4], [-130, -240, 4.2], [120, -120, 5.0],
    [80, -230, 4.4], [130, 40, 5.6], [-60, -350, 4.8], [40, -375, 4.1], [-160, 120, 5.2],
    [150, 175, 4.5], [-45, 235, 5.0], [95, 215, 4.3], [165, -320, 5.3], [-185, -60, 4.7]]) {
    palm(b, x, z, h, rnd);
  }
  // Rock outcrops where the lobes meet the sea.
  b.cone(170, 0.02, -50, 9, 2.6, 6, ROCK);
  b.cone(-178, 0.02, -160, 11, 3.4, 6, ROCK);
  b.cone(-60, 0.02, -415, 10, 3.0, 6, ROCK);
  return R.makeMesh(b);
}

// The shallow-water shelf around an island group: pale aqua discs a
// hair over the sea, drawn translucent — the water lightens toward the
// shore the way a real lagoon shallows, so land announces itself before
// the beach arrives. One mesh serves both the home island (at the
// origin) and the destination (offset to its island).
export function buildShallows(R) {
  const b = new Builder();
  const AQUA = [0.40, 0.76, 0.72];
  b.disc(0, 0.0015, 95, 172, 30, AQUA);
  b.disc(0, 0.0015, -70, 196, 30, AQUA);
  b.disc(0, 0.0015, -235, 164, 30, AQUA);
  b.disc(0, 0.0015, -352, 110, 30, AQUA);
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
  for (const wz of [-9, -6, -3]) b.box(44.15, 3.4, wz, 0.18, 1.6, 2.2, WIN); // lit panes on the flank too
  b.box(46, 7.5, 8, 3.2, 15, 3.2, WALL); // tower shaft
  b.box(46, 15.8, 8, 5.4, 2.4, 5.4, GLASS); // tower cab
  b.box(46, 15.8, 5.2, 4.6, 1.8, 0.3, WIN); // the cab's lit face, watching the strip
  b.box(46, 17.4, 8, 6, 0.8, 6, ROOF);
  b.box(46, 18.1, 8, 0.55, 0.55, 0.55, [2.3, 0.35, 0.30]); // the tower beacon, burning red
  b.box(24, 2.5, 16, 12, 5, 8, [0.55, 0.58, 0.62]); // hangar
  b.cone(24, 5, 16, 6.4, 2.2, 4, ROOF);
  b.box(16, 1.7, 31, 8, 3.4, 6, [0.60, 0.62, 0.66]); // a second, smaller hangar
  b.cone(16, 3.4, 31, 4.6, 1.6, 4, ROOF);
  b.box(40, 1.8, 24, 8, 3.6, 6, WALL); // cargo shed
  // Freight waiting on the apron: crates and fuel drums by the shed.
  b.box(37.5, 0.55, 29.5, 1.1, 1.1, 1.1, [0.62, 0.52, 0.38]);
  b.box(38.8, 0.45, 29.8, 0.9, 0.9, 0.9, [0.55, 0.45, 0.33]);
  b.box(37.9, 1.45, 29.6, 0.8, 0.7, 0.8, [0.58, 0.48, 0.35]);
  for (const [dx, dz] of [[0, 0], [0.75, 0.3], [0.3, 0.8]]) b.box(33.5 + dx, 0.5, 28.5 + dz, 0.55, 1.0, 0.55, [0.45, 0.50, 0.55]);
  // A service road ties the buildings together and spurs to the strip's
  // edge; a fuel van waits by the terminal. Ground life, cheaply.
  b.box(19, 0.045, 8, 6, 0.09, 64, [0.30, 0.30, 0.33]);
  b.box(15.5, 0.045, -6, 7, 0.09, 5, [0.30, 0.30, 0.33]);
  b.box(28, 0.85, 12, 4.8, 1.7, 2.1, [0.85, 0.83, 0.78]); // van body
  b.box(28, 1.15, 9.7, 4.3, 0.9, 1.4, [0.30, 0.36, 0.42]); // van cab
  return R.makeMesh(b);
}

// A house: walls, a pyramid roof, a door shadow, one lit window. Baked into
// island meshes so every shore carries its settlement.
function house(b, x, z, s, rnd) {
  const wall = [0.90, 0.82, 0.66], roof = [0.60 + rnd() * 0.15, 0.24, 0.13];
  const v = rnd();
  if (v < 0.22) {
    // The shop: a flat canopy awning over a wide lit front — the
    // settlement's one commercial silhouette among the homes.
    b.box(x, 1.15 * s, z, 3.6 * s, 2.3 * s, 2.8 * s, wall);
    b.box(x, 2.42 * s, z, 3.9 * s, 0.22 * s, 3.1 * s, [0.45, 0.38, 0.32]);
    b.box(x, 1.95 * s, z - 1.75 * s, 3.8 * s, 0.14 * s, 1.15 * s, roof); // awning
    b.box(x - 0.7 * s, 1.15 * s, z - 1.44 * s, 1.7 * s, 1.1 * s, 0.1, [1.30, 1.02, 0.50]); // lit shopfront
    b.box(x + 1.15 * s, 0.8 * s, z - 1.45 * s, 0.8 * s, 1.6 * s, 0.15, [0.3, 0.2, 0.14]);
    return;
  }
  if (v < 0.48) {
    // The two-storey variant: taller walls, a flat slab roof with a
    // parapet lip, and a lit window on each floor.
    b.box(x, 1.7 * s, z, 3.2 * s, 3.4 * s, 2.8 * s, wall);
    b.box(x, 3.5 * s, z, 3.7 * s, 0.25 * s, 3.3 * s, [0.45, 0.38, 0.32]);
    b.box(x, 0.8 * s, z - 1.45 * s, 0.8 * s, 1.6 * s, 0.15, [0.3, 0.2, 0.14]);
    b.box(x + 0.9 * s, 1.1 * s, z - 1.44 * s, 0.55 * s, 0.6 * s, 0.1, [1.30, 1.02, 0.50]);
    b.box(x - 0.9 * s, 2.6 * s, z - 1.44 * s, 0.55 * s, 0.6 * s, 0.1, [1.30, 1.02, 0.50]);
    return;
  }
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
      s: 0.8 + rnd() * 1.5,
      v: i % 2, // two silhouettes alternate down the route
    });
  }
  return out;
}
// Baked cloud shading: sunlit crowns, cooler shadowed undersides — the
// lit shader multiplies these by the phase light, so a cloud at senja
// glows amber on top and sinks violet below without any keyframe change.
const CLOUD_SHADE = { top: [1.16, 1.12, 1.05], bottom: [0.78, 0.82, 0.89] };
export function buildCloud(R) {
  const b = new Builder();
  const W = [1.06, 1.02, 0.97];
  // A wide flat base, puffs stacked into a crown, wisps trailing at the
  // edges — a shaped mass with a silhouette, not a pile of boxes.
  b.box(0, 0, 0, 18, 1.6, 7.0, W, CLOUD_SHADE);
  b.box(-5.2, 1.2, 0.3, 8.0, 2.0, 5.6, W, CLOUD_SHADE);
  b.box(3.8, 1.5, -0.3, 8.6, 2.4, 6.0, W, CLOUD_SHADE);
  b.box(0.2, 2.5, 0.1, 6.0, 1.9, 4.8, W, CLOUD_SHADE);
  b.box(0.6, 3.35, 0, 3.6, 1.4, 3.4, W, CLOUD_SHADE);
  b.box(-8.6, 0.6, -0.6, 5.0, 1.2, 4.4, W, CLOUD_SHADE);
  b.box(8.8, 0.55, 0.7, 5.4, 1.1, 4.2, W, CLOUD_SHADE);
  b.box(1.6, 1.0, 2.6, 5.6, 1.3, 3.2, W, CLOUD_SHADE);
  b.box(-2.8, 0.9, -2.5, 5.0, 1.2, 3.0, W, CLOUD_SHADE);
  b.box(-11.5, 0.25, -0.4, 4.4, 0.8, 3.4, W, CLOUD_SHADE); // trailing wisps
  b.box(12.0, 0.3, 0.4, 4.0, 0.8, 3.0, W, CLOUD_SHADE);
  return R.makeMesh(b);
}
export function buildCloudB(R) {
  const b = new Builder();
  const W = [1.04, 1.01, 0.97];
  // The tower silhouette: a narrower base with the mass stacked high —
  // a cumulus turret, so the route's clouds vary in kind, not just size.
  b.box(0, 0, 0, 13, 1.7, 6.2, W, CLOUD_SHADE);
  b.box(-0.4, 1.6, 0.2, 7.2, 2.2, 5.2, W, CLOUD_SHADE);
  b.box(-0.6, 3.2, 0, 5.4, 2.0, 4.4, W, CLOUD_SHADE);
  b.box(0.3, 4.6, -0.2, 3.8, 1.6, 3.4, W, CLOUD_SHADE);
  b.box(-6.4, 0.9, -0.4, 5.6, 1.5, 4.2, W, CLOUD_SHADE);
  b.box(6.2, 0.8, 0.5, 5.2, 1.4, 4.0, W, CLOUD_SHADE);
  b.box(0.8, 1.1, -2.6, 5.0, 1.3, 3.0, W, CLOUD_SHADE);
  b.box(2.8, 2.2, 2.2, 4.2, 1.2, 2.8, W, CLOUD_SHADE);
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

// ---- the cockpit interior (v11) ----
// The owner asked for a real cockpit in COCKPIT camera mode: "tambah
// cokpit dari pesawat seperti kaca layar dan radar". The interior is
// built in CAMERA space (layout in cockpit.js) and drawn as a second
// pass over the finished world with the depth buffer cleared, so the
// panel, canopy frame and glass ride exactly with the pilot's eyes and
// nothing of the airframe can ever block them. Only the needles and the
// radar blips move per frame; everything else is one static mesh.
// XY-plane helpers: the panel faces +Z, toward the pilot. (The engine
// never culls backfaces, so these fans read from the pilot's side.)
function discXY(b, cx, cy, cz, r, seg, color) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    b.tri([cx, cy, cz], [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r, cz], [cx + Math.cos(a1) * r, cy + Math.sin(a1) * r, cz], color);
  }
}
function ringXY(b, cx, cy, cz, rIn, rOut, seg, color) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = (a, r) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz];
    b.quad(p(a0, rOut), p(a1, rOut), p(a1, rIn), p(a0, rIn), color);
  }
}
function tickXY(b, cx, cy, cz, r, ang, len, wid, color) {
  // A tick at needle-angle `ang` (0 = up, counter-clockwise positive,
  // matching cockpit.js needleRad): a small quad along that direction.
  const dx = -Math.sin(ang), dy = Math.cos(ang), px = -dy, py = dx;
  const c = (rr, off) => [cx + dx * rr + px * off, cy + dy * rr + py * off, cz];
  b.quad(c(r, -wid), c(r, wid), c(r + len, wid), c(r + len, -wid), color);
}

export function buildCockpit(R) {
  const FRAME = [0.16, 0.13, 0.11], PANELC = [0.09, 0.10, 0.12];
  const FACE = [0.05, 0.06, 0.075], RIM = [0.52, 0.49, 0.44], TICK = [0.92, 0.87, 0.72];
  const fz = PANEL.z + 0.02; // instrument faces sit a hair proud of the panel
  const fb = new Builder();
  // The panel bulkhead and its glare shield.
  fb.box(0, (PANEL.top + PANEL.bottom) / 2, PANEL.z - 0.09, PANEL.w, PANEL.top - PANEL.bottom, 0.18, PANELC);
  fb.box(0, PANEL.top + 0.03, PANEL.z + 0.02, PANEL.w + 0.15, 0.09, 0.30, FRAME);
  // Canopy frame: two slanted pillars, a top bar, and the rear posts the
  // side panes hang from. The glass (a separate translucent mesh) fills
  // the openings; the forward view above the panel stays open.
  beam(fb, [-1.58, PANEL.top, -2.80], [-1.80, 1.38, -2.80], 0.15, FRAME);
  beam(fb, [1.58, PANEL.top, -2.80], [1.80, 1.38, -2.80], 0.15, FRAME);
  beam(fb, [-1.80, 1.38, -2.80], [1.80, 1.38, -2.80], 0.14, FRAME);
  beam(fb, [2.38, -0.34, -1.50], [2.48, 1.06, -1.50], 0.12, FRAME);
  beam(fb, [-2.38, -0.34, -1.50], [-2.48, 1.06, -1.50], 0.12, FRAME);
  // The four dials: dark faces, metal rims, cream ticks at every eighth
  // of the sweep, a hub each. Needles are separate (they move).
  for (const g of GAUGES) {
    discXY(fb, g.x, g.y, fz, g.r, 24, FACE);
    ringXY(fb, g.x, g.y, fz, g.r - 0.018, g.r + 0.006, 24, RIM);
    for (let k = 0; k <= 8; k++) tickXY(fb, g.x, g.y, fz + 0.002, g.r * 0.72, (0.75 - 1.5 * (k / 8)) * Math.PI, g.r * 0.20, 0.008, TICK);
    discXY(fb, g.x, g.y, fz + 0.004, 0.028, 12, RIM);
  }
  // The radar scope: a dark green face, a glowing rim and range ring,
  // cross hairs, and the own-ship wedge at its heart. Blips are separate.
  discXY(fb, RADAR.x, RADAR.y, RADAR.z, RADAR.r, 28, [0.08, 0.22, 0.13]);
  ringXY(fb, RADAR.x, RADAR.y, RADAR.z, RADAR.r - 0.016, RADAR.r + 0.004, 28, [0.35, 1.15, 0.55]);
  ringXY(fb, RADAR.x, RADAR.y, RADAR.z, RADAR.r * 0.52 - 0.006, RADAR.r * 0.52 + 0.006, 28, [0.20, 0.60, 0.32]);
  fb.quad([RADAR.x - RADAR.r, RADAR.y - 0.004, RADAR.z + 0.002], [RADAR.x + RADAR.r, RADAR.y - 0.004, RADAR.z + 0.002], [RADAR.x + RADAR.r, RADAR.y + 0.004, RADAR.z + 0.002], [RADAR.x - RADAR.r, RADAR.y + 0.004, RADAR.z + 0.002], [0.20, 0.60, 0.32]);
  fb.quad([RADAR.x - 0.004, RADAR.y - RADAR.r, RADAR.z + 0.002], [RADAR.x + 0.004, RADAR.y - RADAR.r, RADAR.z + 0.002], [RADAR.x + 0.004, RADAR.y + RADAR.r, RADAR.z + 0.002], [RADAR.x - 0.004, RADAR.y + RADAR.r, RADAR.z + 0.002], [0.20, 0.60, 0.32]);
  fb.tri([RADAR.x, RADAR.y + 0.055, RADAR.z + 0.004], [RADAR.x + 0.042, RADAR.y - 0.038, RADAR.z + 0.004], [RADAR.x - 0.042, RADAR.y - 0.038, RADAR.z + 0.004], [1.45, 1.28, 0.95]);
  fb.box(RADAR.x, RADAR.y + RADAR.r + 0.035, RADAR.z, 0.05, 0.05, 0.02, [1.45, 1.28, 0.95]); // the N tick
  const frame = R.makeMesh(fb);
  // One needle, built pointing up from its hub: the scene rotates it per
  // gauge per frame from cockpit.js readings.
  const nb = new Builder();
  nb.box(0, 0.105, 0, 0.034, 0.25, 0.018, [1.35, 1.25, 1.00]);
  nb.box(0, -0.045, 0, 0.05, 0.07, 0.018, [0.90, 0.30, 0.20]);
  const needle = R.makeMesh(nb);
  // Scope blips: the destination in warm cream, the next ring in gold.
  const bd = new Builder(); discXY(bd, 0, 0, 0, 0.042, 12, [1.50, 1.35, 1.05]);
  const br = new Builder(); discXY(br, 0, 0, 0, 0.050, 12, [2.20, 1.70, 0.50]);
  // The canopy glass: tinted panes from the layout, plus one brighter
  // reflection streak laid diagonally across the front pane.
  const gb = new Builder();
  for (const pane of GLASS_PANES) gb.quad(pane[0], pane[1], pane[2], pane[3], [0.55, 0.70, 0.82]);
  const glass = R.makeMesh(gb);
  const sb = new Builder();
  sb.quad([0.30, 1.30, -2.83], [0.88, 1.30, -2.83], [0.12, -0.46, -2.83], [-0.42, -0.46, -2.83], [1.15, 1.20, 1.25]);
  const streak = R.makeMesh(sb);
  return { frame, needle, blipDest: R.makeMesh(bd), blipRing: R.makeMesh(br), glass, streak };
}

// Draw the cockpit over the finished world: depth cleared, camera set
// to the identity (the geometry already lives in camera space), needles
// and blips placed from the live readings, glass last so it tints what
// is behind it. Called only in cockpit mode, only during a flight.
function drawCockpit(R, ck, st, proj) {
  R.clearDepth();
  R.setCamera(M4.ident(), proj, [0, 0, 0]);
  R.draw(ck.frame, M4.ident());
  const rd = gaugeReadings(st);
  for (const g of GAUGES) {
    R.draw(ck.needle, M4.compose(g.x, g.y, PANEL.z + 0.035, 0, 0, rd[g.id].needle));
  }
  const bl = radarBlips(st);
  R.draw(ck.blipDest, M4.compose(RADAR.x + bl.dest.nx * RADAR.r, RADAR.y + bl.dest.ny * RADAR.r, RADAR.z + 0.010, 0, 0, 0));
  if (bl.ring) R.draw(ck.blipRing, M4.compose(RADAR.x + bl.ring.nx * RADAR.r, RADAR.y + bl.ring.ny * RADAR.r, RADAR.z + 0.012, 0, 0, 0));
  R.draw(ck.glass, M4.ident(), 0.16);
  R.draw(ck.streak, M4.ident(), 0.10);
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
    // Islands: destination ahead, islets scattered en route. The home
    // island and the departure airport's twin are NOT drawn: every camera
    // in this game (chase near/far, cockpit, and the title backdrop)
    // looks forward along -Z, and both sit at +Z behind the plane, so
    // they have never been inside a single rendered frame — the scene
    // used to pay their triangles on every frame of every flight for
    // nothing. (The departure runway below IS drawn: it is ahead of the
    // plane, under her, for the whole roll.)
    R.draw(assets.isleDest, M4.compose(0, 0, -st.legDist - 72, 0, Math.PI, 0, 1.35));
    for (const isl of assets.islets) {
      if (Math.abs(-st.legDist * isl.f - pz) > 1600) continue;
      R.draw(isl.mesh, M4.compose(isl.x, 0, -st.legDist * isl.f, 0, isl.rot, 0, isl.s));
    }
    // The home island's land (v11): the terrain the airfield stands on.
    // Drawn while the departure end can still be in frame — the roll,
    // the climb-out, the first stretch of the leg — and culled after, on
    // the engine's standing distance idiom. It is drawn BEFORE the sea
    // (see the sea note below): the ground writes its depth first, so
    // the sea's costly fragment work is rejected wherever land covers it
    // instead of being shaded and then painted over.
    if (assets.homeTerrain && st.dist < 1000) {
      R.draw(assets.homeTerrain, M4.compose(0, 0, 0, 0, 0, 0));
    }
    // The departure runway: a paved strip on its own spit at the start of
    // every leg — she lines up on it, rolls it, and climbs out over the
    // sea. Once she is a few hundred metres out it is behind and below
    // the frame, so it is drawn only while it can still be seen. (The old
    // takeoff buoy lane is gone: departures are from land now. The
    // approach lane at the destination remains, drawn on approach.)
    if (assets.deptStrip && st.dist < 550) R.draw(assets.deptStrip, M4.compose(0, 0, 0, 0, 0, 0));
    if (st.legDist - st.dist < 1200) drawLane(R, assets, -st.legDist + 150);
    // The strip herself: a deck on the destination shore, threshold facing
    // the plane, growing out of the haze from a kilometre out.
    // The destination strip and its airport join the frame inside
    // 1,600 / 1,400 m — before that they are smaller than the haze that
    // hides them, and the island's silhouette carries the landmark.
    const stripM = M4.compose(0, 0, -st.legDist + STRIP_LAYOUT.centreZ, 0, 0, 0);
    if (st.legDist - st.dist < 1600) R.draw(assets.strip, stripM);
    // Airport buildings at the destination runway's far end. (No twin is
    // drawn at the departure end: like the home island, it would stand
    // behind every camera for the whole flight.)
    if (st.legDist - st.dist < 1400) R.draw(assets.airport, M4.compose(0, 0, -st.legDist - 14, 0, 0, 0));
    // The sea comes AFTER the opaque world (v11 reorder): it follows the
    // camera in whole cells so the glitter never swims, and wherever
    // land, strips or buildings already wrote depth, its fragments are
    // rejected instead of shaded-then-covered — the v11 terrain made the
    // old sea-first order shade the same pixels two and three times.
    const snap = assets.sea.cell;
    const origin = [Math.round(eye[0] / snap) * snap, 0, Math.round(eye[2] / snap) * snap];
    R.drawSea(assets.sea.mesh, origin, st.time);
    // The shallow shelves (v11) blend over the sea around both islands;
    // drawn in the transparent phase, the parts tucked under the terrain
    // fail the depth test against it and cost nothing.
    if (assets.shallows && st.dist < 1000) {
      R.draw(assets.shallows, M4.compose(0, 0, 0, 0, 0, 0), 0.35);
    }
    if (assets.shallows && st.legDist - st.dist < 1600) {
      R.draw(assets.shallows, M4.compose(0, 0, -st.legDist - 72, 0, 0, 0), 0.35);
    }
    // Her light spill fades in with darkness: by night the lit edges and
    // the threshold halo are the approach's main landmark.
    const dark = darknessOf(st.env);
    if (assets.stripGlow && dark > 0.02 && st.legDist - st.dist < 1600) R.draw(assets.stripGlow, stripM, 0.40 * dark);
    if (assets.deptGlow && dark > 0.02 && st.dist < 550) R.draw(assets.deptGlow, M4.compose(0, 0, 0, 0, 0, 0), 0.40 * dark);
    // Clouds at flying altitude along the route.
    if (cloudCache.leg !== st.legDist) cloudCache = { leg: st.legDist, field: cloudField(st.legDist) };
    for (const c of cloudCache.field) {
      if (Math.abs(c.z - pz) > 1000) continue;
      R.draw(c.v && assets.cloudB ? assets.cloudB : assets.cloud, M4.compose(c.x, c.y, c.z, 0, 0, 0, c.s), 0.88);
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
    // Foam and streaks are WATER effects: on the paved departure roll
    // they stay off (the surface says so), and they return the moment
    // she is back on the sea — a splashdown still throws spray.
    if (st.alt < 0.4 && st.speed > 4 && st.surface !== 'runway') {
      R.draw(assets.foam, M4.compose(st.x, 0.16, pz + 2.6, 0, 0, 0, 1 + st.speed * 0.02), clamp(st.speed / 46, 0, 0.5));
    }
    // Speed streaks stream behind the floats when she is low and fast.
    const streakA = st.surface === 'runway' ? 0 : clamp((st.speed - 16) / 34, 0, 1) * clamp(1 - st.alt / 7, 0, 1) * 0.55;
    if (streakA > 0.02) R.draw(assets.streaks, M4.compose(st.x, 0.18, pz, 0, 0, 0), streakA);
    // From the pilot's seat the airframe is not drawn: the camera sits where
    // the pilot's eyes are, and the fuselage/wing around that point would
    // fill the forward view with dark geometry (the first cockpit framing
    // stared into the wing strut). The horizon, the rings and the strip are
    // the cockpit's instruments.
    if (st.camMode !== 'cockpit') {
      const planeM = M4.compose(st.x, st.alt + 0.62, pz, st.pitchVis * 0.38, -st.bank * 0.22, -st.bank * 0.55);
      R.draw(assets.plane.plane, planeM);
      const propM = M4.mul(planeM, M4.compose(0, 1.00, -3.42, 0, 0, st.propSpin));
      R.draw(assets.plane.prop, propM);
      // The blurred disc deepens with the throttle (stageState supplies
      // discA); staged states without it keep the old fixed sheen.
      R.draw(assets.plane.disc, propM, st.discA != null ? st.discA : 0.16);
    }
    // The landing light throws its beam when the world is dark: the cone
    // hangs off the nose, ahead and down toward the water or the strip.
    const emis = st.env ? st.env.emis : 0;
    if (assets.cone && emis > 0.9) {
      const coneM = M4.compose(st.x, st.alt + 1.1, pz - 2.4, 0, 0, -st.bank * 0.3);
      R.draw(assets.cone, coneM, clamp((emis - 0.9) / 1.3, 0, 1) * 0.13);
    }
    // The cockpit interior (v11): in cockpit mode, during a flight (the
    // staged title state carries no surface), the pilot's own cockpit —
    // frame, glass, panel, live needles, radar — is drawn over the world.
    if (st.camMode === 'cockpit' && assets.cockpit && st.surface !== undefined) {
      drawCockpit(R, assets.cockpit, st, projCache.m);
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
