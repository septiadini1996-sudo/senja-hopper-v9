// The 3D world: a low-poly seaplane, island terrain with palms, golden torus
// rings, buoy lanes and the glittering sea, all built as static meshes with
// the hand-rolled engine in engine3d.js. The flight runs along -Z: the plane
// sits at z = -distance, the destination island waits at z = -legDist.
import { Builder, M4, sub3, cross3, norm3 } from './engine3d.js';
import { mulberry32, clamp, lerp } from './util.js';
import { triangulatePoly } from './world.js';
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

// Reshape a finished builder (v18): scale X by sx and Z about the
// prop pivot by sz, then recompute every flat face normal from the
// scaled geometry (each primitive emits whole triangles, so the
// vertex triples group exactly). The fleet's bodies differ by
// capacity; the pivot keeps every nose on the shared prop plane.
function reshape(b, sx, sz, pivotZ) {
  const p = b.pos, n = b.nor;
  for (let i = 0; i < p.length; i += 3) {
    p[i] *= sx;
    p[i + 2] = pivotZ + (p[i + 2] - pivotZ) * sz;
  }
  for (let v = 0; v + 9 <= p.length; v += 9) {
    const a = [p[v], p[v + 1], p[v + 2]], c = [p[v + 3], p[v + 4], p[v + 5]], d = [p[v + 6], p[v + 7], p[v + 8]];
    const nn = norm3(cross3(sub3(c, a), sub3(d, a)));
    for (let k = 0; k < 3; k++) { n[v + k * 3] = nn[0]; n[v + k * 3 + 1] = nn[1]; n[v + k * 3 + 2] = nn[2]; }
  }
}

// One airframe builder, four liveries (v12): the fleet's planes are the
// same shaped body wearing different paint, spans and cheatlines — the
// spec comes from planes.js (body / accent / cheat colours, wing span).
// With no spec it builds the starter exactly as she has always looked.
export function buildPlane(R, spec) {
  const CREAM = spec ? spec.body : [0.96, 0.86, 0.64];
  const RED = spec ? spec.accent : [0.80, 0.22, 0.15];
  const TEAL = spec ? spec.cheat : [0.09, 0.26, 0.31];
  const SPAN = spec ? spec.span : 1;
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
  // Livery: a teal cheatline band hugging each flank of the cabin —
  // widened in v18 to run UNDER the window line, so the scheme
  // reads through the panes the way a real livery does — and the
  // registration as micro-bars on the tail cone — the engine has no
  // text, so lettering is faked with five small dark blocks that
  // read as characters at chase distance.
  for (const sx of [-1, 1]) {
    b.box(sx * 0.715, 1.17, 0, 0.03, 0.26, 2.2, TEAL);
    for (let i = 0; i < 5; i++) b.box(sx * 0.335, 1.38, 2.58 + i * 0.115, 0.02, 0.15, 0.055, [0.25, 0.16, 0.12]);
  }
  // Main wing: tapered, swept and dihedralled in two sections a side,
  // red outer panels, winglets standing at the tips.
  for (const sx of [-1, 1]) {
    segX(b, 0, 1.85, 0.17, 1.52, -0.30, sx * 3.2 * SPAN, 1.55, 0.135, 1.64, -0.40, CREAM);
    segX(b, sx * 3.2 * SPAN, 1.55, 0.135, 1.64, -0.40, sx * 5.05 * SPAN, 1.22, 0.11, 1.76, -0.50, CREAM);
    segX(b, sx * 5.05 * SPAN, 1.22, 0.11, 1.76, -0.50, sx * 5.60 * SPAN, 1.02, 0.095, 1.82, -0.56, RED);
    b.box(sx * 5.62 * SPAN, 2.06, -0.58, 0.055, 0.52, 0.78, RED); // winglet
    // Wing struts: a slanted pair per side, fuselage low to wing underside.
    beam(b, [sx * 0.52, 0.52, -0.95], [sx * 2.25 * SPAN, 1.50, -0.62], 0.09, METAL);
    beam(b, [sx * 0.52, 0.52, 0.35], [sx * 2.25 * SPAN, 1.50, 0.02], 0.09, METAL);
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
  b.box(-5.66 * SPAN, 1.82, -0.56, 0.26, 0.12, 0.26, [1.7, 0.18, 0.12]);
  b.box(5.66 * SPAN, 1.82, -0.56, 0.26, 0.12, 0.26, [0.20, 1.50, 0.35]);
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
  // Detailing (v14): the small truths a real airframe carries. An
  // aerial wire from the cabin roof to the fin top, a pitot tube under
  // the port wing, water rudders at the float tails, exhaust staining
  // behind the stubs, a dark walkway strip on each wing root, and
  // panel-line seams across the wing tops so the light has something
  // to catch on the big flat surfaces.
  b.box(0, 2.14, 0.62, 0.05, 0.30, 0.05, METAL); // aerial mast
  beam(b, [0, 2.28, 0.62], [0, 3.10, 3.42], 0.016, [0.10, 0.10, 0.11]); // the wire itself
  b.box(-1.85 * SPAN, 1.30, -0.95, 0.05, 0.05, 0.55, METAL); // pitot, port wing
  for (const sx of [-1.18, 1.18]) {
    b.box(sx, -0.52, 2.62, 0.30, 0.34, 0.07, RED); // water rudder
    b.box(sx * 0.44, 0.62, -2.30, 0.30, 0.20, 0.55, [0.30, 0.26, 0.22]); // exhaust stain
    b.box(sx * 1.05, 1.615, -0.32, 1.05, 0.025, 1.30, [0.36, 0.32, 0.28]); // wing-root walkway
  }
  // Panel-line seams, chordwise at two span stations a side, laid at
  // each wing section's own top height so they sit flush on the skin.
  for (const sx of [-1, 1]) {
    b.box(sx * 1.6 * SPAN, 1.66, -0.30, 0.045, 0.018, 1.55, [0.55, 0.48, 0.38]);
    b.box(sx * 4.1 * SPAN, 1.762, -0.46, 0.045, 0.018, 1.15, [0.55, 0.48, 0.38]);
  }
  // Detailing (v16): the airframe finished like a product, not a
  // prototype. A rivet row stitches the lower flank, dot by dot at
  // the interpolated skin line; two pale sheen plates step up the
  // glasshouse roof so the canopy catches the sky the way the
  // cockpit glass does; the wings gain polished leading-edge strips
  // and a third seam.
  const SEAM16 = [0.55, 0.48, 0.38];
  // The window line (v18): as many panes as her seats say — the
  // count comes from the airframe spec (4 on the starter, 10 on
  // the Bangau), each pane framed in lightened body colour, glazed
  // in blue-tinted glass with a glint along its top edge, seated on
  // the flank's own half width at its station. The gold pinstripe
  // rides just above the line now and the cheatline band below it,
  // so the livery reads THROUGH the windows like a real scheme.
  const WINN = Math.max(2, Math.round(spec ? (spec.win || 4) : 4));
  const halfW = (z) => {
    const S = [[-2.30, 0.55], [-1.20, 0.67], [0.90, 0.73], [2.30, 0.53]];
    for (let i = 1; i < S.length; i++) {
      if (z <= S[i][0]) { const [z0, w0] = S[i - 1], [z1, w1] = S[i]; return w0 + (w1 - w0) * ((z - z0) / (z1 - z0)); }
    }
    return 0.53;
  };
  const frameC = CREAM.map(c => Math.min(1, c * 1.14 + 0.03));
  const paneD = Math.min(0.36, (1.8 / WINN) * 0.55);
  for (const sx of [-1, 1]) {
    b.box(sx * 0.715, 1.52, 0, 0.03, 0.035, 2.2, [1.18, 0.88, 0.30]); // pinstripe, above the line
    for (let i = 0; i < WINN; i++) {
      const wz = -1.05 + (1.8 * i) / (WINN - 1);
      const hx = halfW(wz);
      b.box(sx * (hx + 0.001), 1.37, wz, 0.03, 0.31, paneD + 0.07, frameC); // the frame
      b.box(sx * (hx + 0.008), 1.37, wz, 0.04, 0.24, paneD, [0.15, 0.26, 0.37]); // the glass
      b.box(sx * (hx + 0.010), 1.475, wz, 0.045, 0.03, paneD * 0.9, [0.62, 0.78, 0.92]); // the glint
    }
    const rivW = (z) => z < -0.1 ? 1.36 + (z + 1.2) * 0.055 : z < 0.9 ? 1.42 + (z + 0.1) * 0.04 : 1.46 - (z - 0.9) * 0.286;
    for (let i = 0; i < 12; i++) {
      const rz = -1.05 + i * 0.30;
      b.box(sx * (rivW(rz) / 2 + 0.004), 0.88, rz, 0.02, 0.045, 0.045, [0.45, 0.36, 0.28]); // rivet
    }
    // Polished leading edges: a thin bright prism wrapped over each
    // wing section's nose, and a spanwise seam stitched behind it.
    segX(b, 0, 0.14, 0.185, 1.52, -1.155, sx * 3.2 * SPAN, 0.14, 0.155, 1.64, -1.105, [1.05, 0.98, 0.82]);
    segX(b, sx * 3.2 * SPAN, 0.14, 0.155, 1.64, -1.105, sx * 5.05 * SPAN, 0.14, 0.13, 1.76, -1.04, [1.05, 0.98, 0.82]);
    segX(b, sx * 0.3 * SPAN, 0.05, 0.018, 1.615, -0.18, sx * 3.15 * SPAN, 0.05, 0.018, 1.715, -0.28, SEAM16);
    b.box(sx * 2.9 * SPAN, 1.70, -0.39, 0.045, 0.018, 1.42, SEAM16);
  }
  b.box(0.16, 1.918, -1.02, 0.30, 0.022, 0.78, [0.58, 0.72, 0.86]); // canopy sheen, front plate
  b.box(0.16, 1.950, -0.10, 0.30, 0.022, 0.78, [0.58, 0.72, 0.86]); // canopy sheen, rear plate
  // Detailing (v18): the amphibious truths. A keel band along the
  // belly in darkened body colour, the red belly beacon, a ventral
  // antenna blade, a pitot under the STARBOARD wing to mirror the
  // port one, and a rear door outlined on each flank — frame proud
  // of the skin, panel inset, handle bright.
  const BELLY = CREAM.map(c => c * 0.78);
  b.box(0, 0.44, 0.10, 1.02, 0.10, 2.60, BELLY); // keel band
  b.box(0, 0.40, 0.55, 0.10, 0.06, 0.10, [1.7, 0.25, 0.15]); // belly beacon
  b.frustum(0, 0.42, -0.55, 0.05, 0.22, 0.16, 2.0, METAL); // ventral antenna
  b.box(1.85 * SPAN, 1.30, -0.95, 0.05, 0.05, 0.55, METAL); // pitot, starboard wing
  for (const sx of [-1, 1]) {
    const dhx = halfW(1.35);
    b.box(sx * (dhx + 0.004), 1.05, 1.35, 0.025, 0.78, 0.62, frameC); // door frame
    b.box(sx * (dhx + 0.008), 1.05, 1.35, 0.02, 0.70, 0.54, BELLY); // door panel
    b.box(sx * (dhx + 0.014), 1.05, 1.02, 0.02, 0.05, 0.16, METAL); // door handle
  }
  // WHEELS (v18): she is an amphibian — each float carries a main
  // wheel on a short strut at the planing step and a smaller bow
  // wheel forward, dark tyres with metal hub discs on the outer
  // faces, every sole resting exactly on the fleet ground line
  // (float keel −0.62), so she stands on the apron on rubber AND
  // floats on the water on her hulls, the way the real ones do.
  const TYRE = [0.13, 0.12, 0.11];
  for (const sx of [-1.18, 1.18]) {
    const out = sx + Math.sign(sx) * 0.16;
    beam(b, [sx, -0.18, -0.05], [out, -0.33, -0.05], 0.09, METAL); // main strut
    b.box(out, -0.35, -0.05, 0.20, 0.54, 0.54, TYRE); // main wheel, sole at −0.62
    b.box(out + Math.sign(sx) * 0.085, -0.35, -0.05, 0.05, 0.24, 0.24, METAL); // main hub
    beam(b, [sx, -0.20, -1.55], [out, -0.42, -1.55], 0.07, METAL); // bow strut
    b.box(out, -0.44, -1.55, 0.16, 0.36, 0.36, TYRE); // bow wheel, sole at −0.62
    b.box(out + Math.sign(sx) * 0.065, -0.44, -1.55, 0.04, 0.16, 0.16, METAL); // bow hub
  }
  // The body's measure (v18): length and beam from the airframe
  // spec, scaled about the prop pivot — the fleet's size ladder is
  // geometry, not paint. Applied last so every part above, wheels
  // and windows included, takes the same measure.
  reshape(b, spec ? (spec.beam || 1) : 1, spec ? (spec.len || 1) : 1, -3.42);
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
  // The blur's rim (v16): a brighter annulus where the blade tips
  // sweep — a spinning prop reads by its tip arc, and the flat disc
  // alone read as a grey plate at dossier distance.
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    const p = (a, r) => [Math.cos(a) * r, Math.sin(a) * r, 0];
    d.quad(p(a0, 1.98), p(a1, 1.98), p(a1, 2.18), p(a0, 2.18), [0.46, 0.38, 0.28]);
  }
  const disc = R.makeMesh(d);
  return { plane, prop, disc };
}

// The fighter (v17): RAJAWALI, a single-seat prop warbird — a sleeker,
// longer-nosed body on a LOW cantilever wing, a bubble canopy, and
// fixed landing gear where the floatplanes wear floats. No insignia,
// no borrowed markings: olive drab over grey, a pale cheatline, and
// her registration as micro-bars on the fin. Her wheels' soles sit at
// y = -0.62, the fleet's ground line, so she stands on the runway
// exactly where the floatplanes' keels rest. Same return contract as
// buildPlane: { plane, prop, disc }, prop hub at the fleet's point.
export function buildFighter(R, spec) {
  const BODY = spec ? spec.body : [0.33, 0.36, 0.25];   // olive drab
  const ACCENT = spec ? spec.accent : [0.62, 0.64, 0.58]; // grey
  const CHEAT = spec ? spec.cheat : [0.78, 0.74, 0.55];  // pale stripe
  const SPAN = spec ? spec.span : 1;
  const b = new Builder();
  // Fuselage: a longer, slimmer run than the mail planes — the nose
  // stretches ahead of the wing, the tail cone rises to the fin.
  seg2(b, -3.55, 0.20, 0.24, 1.00, -3.05, 0.66, 0.70, 1.00, BODY); // nose tip
  seg2(b, -3.05, 0.66, 0.70, 1.00, -2.15, 0.98, 0.92, 1.01, BODY); // radial cowling
  seg2(b, -2.15, 0.98, 0.92, 1.01, -0.95, 1.06, 1.00, 1.03, BODY); // forward fuselage
  seg2(b, -0.95, 1.06, 1.00, 1.03, 0.85, 0.94, 0.90, 1.06, BODY);  // cockpit section
  seg2(b, 0.85, 0.94, 0.90, 1.06, 2.35, 0.58, 0.62, 1.20, BODY);   // taper
  seg2(b, 2.35, 0.58, 0.62, 1.20, 3.35, 0.26, 0.40, 1.36, BODY);   // tail cone, upswept
  seg2(b, 3.35, 0.26, 0.40, 1.36, 3.90, 0.10, 0.22, 1.48, ACCENT); // tail tip
  // Cowling detail: a dark chin intake and two exhaust stubs a side.
  b.box(0, 0.52, -2.80, 0.44, 0.16, 0.60, [0.16, 0.15, 0.13]);
  for (const sx of [-1, 1]) {
    b.box(sx * 0.52, 0.72, -2.35, 0.11, 0.11, 0.44, RUBBER);
    b.box(sx * 0.47, 0.74, -2.05, 0.26, 0.16, 0.50, [0.25, 0.22, 0.18]); // exhaust stain
  }
  // The bubble canopy: one clear teardrop over the single seat, a
  // slim spine running back from it — a fighter's glasshouse, not a
  // mail cabin's.
  seg2(b, -0.82, 0.58, 0.40, 1.64, 0.58, 0.62, 0.44, 1.67, GLASS);
  b.box(0, 1.62, 0.95, 0.20, 0.10, 0.85, BODY); // spine behind the bubble
  // Livery: the pale cheatline low on each flank, and the fin flash.
  for (const sx of [-1, 1]) b.box(sx * 0.485, 0.92, 0.35, 0.03, 0.13, 2.6, CHEAT);
  // The low wing: cantilevered from the fuselage's belly, tapered
  // and gently swept, grey tips — no struts, this wing carries
  // itself. Gun barrels ride the leading edge, two a side, and the
  // pitot stands under the port wing.
  for (const sx of [-1, 1]) {
    segX(b, 0, 1.80, 0.15, 0.62, -0.40, sx * 3.1 * SPAN, 1.52, 0.125, 0.66, -0.48, BODY);
    segX(b, sx * 3.1 * SPAN, 1.52, 0.125, 0.66, -0.48, sx * 5.05 * SPAN, 1.16, 0.10, 0.74, -0.56, BODY);
    segX(b, sx * 5.05 * SPAN, 1.16, 0.10, 0.74, -0.56, sx * 5.55 * SPAN, 0.98, 0.09, 0.78, -0.60, ACCENT);
    b.box(sx * 1.55 * SPAN, 0.60, -1.28, 0.07, 0.07, 0.52, [0.12, 0.12, 0.12]); // gun barrel
    b.box(sx * 2.15 * SPAN, 0.615, -1.24, 0.07, 0.07, 0.52, [0.12, 0.12, 0.12]); // gun barrel
    b.box(sx * 1.05, 0.685, -0.40, 1.00, 0.025, 1.25, [0.28, 0.29, 0.24]); // wing-root walkway
  }
  b.box(-1.85 * SPAN, 0.44, -0.95, 0.05, 0.05, 0.55, METAL); // pitot, port wing
  // Tail unit: a tapered tailplane with grey tips, a two-piece fin
  // in grey with an olive flash, the rudder behind its hinge.
  for (const sx of [-1, 1]) {
    segX(b, 0, 1.00, 0.11, 1.56, 3.36, sx * 1.42, 0.80, 0.095, 1.62, 3.42, BODY);
    segX(b, sx * 1.42, 0.80, 0.095, 1.62, 3.42, sx * 1.84, 0.64, 0.08, 1.66, 3.46, ACCENT);
  }
  b.frustum(0, 1.98, 3.30, 0.14, 1.10, 1.14, 0.50, ACCENT); // fin, lower
  b.frustum(0, 2.80, 3.42, 0.12, 0.58, 0.74, 0.28, ACCENT); // fin, upper
  b.box(0, 2.26, 3.34, 0.155, 0.20, 0.98, BODY); // fin flash
  b.box(0, 2.06, 3.84, 0.09, 1.00, 0.32, [0.42, 0.44, 0.40]); // rudder
  for (let i = 0; i < 4; i++) b.box(0.085, 2.42, 3.28 + i * 0.115, 0.02, 0.14, 0.05, [0.20, 0.20, 0.17]); // registration bars
  // Navigation lights at the tips, landing lamp under the nose.
  b.box(-5.60 * SPAN, 0.78, -0.60, 0.26, 0.12, 0.26, [1.7, 0.18, 0.12]);
  b.box(5.60 * SPAN, 0.78, -0.60, 0.26, 0.12, 0.26, [0.20, 1.50, 0.35]);
  b.box(0, 3.14, 3.48, 0.18, 0.11, 0.18, [1.5, 1.5, 1.4]);
  b.box(0, 0.50, -3.30, 0.30, 0.12, 0.14, [1.9, 1.8, 1.5]);
  // Fixed gear (v18): bigger mains with hub caps and spats, and
  // the tail wheel finally STANDING on the ground line — the v17
  // wheel hovered (its box bottom sat at +0.10, three-quarters of
  // a metre over the strip); a longer leg and a taller wheel put
  // its sole at −0.62 with the mains, a proper taildragger stance.
  for (const sx of [-1, 1]) {
    beam(b, [sx * 0.52, 0.58, -0.72], [sx * 1.04, -0.28, -0.80], 0.13, BODY);
    b.box(sx * 1.04, -0.34, -0.80, 0.24, 0.56, 0.58, RUBBER); // main wheel, sole at −0.62
    b.box(sx * 1.04 + sx * 0.10, -0.34, -0.80, 0.06, 0.26, 0.26, METAL); // hub cap
    b.box(sx * 0.98, -0.02, -0.80, 0.10, 0.34, 0.46, BODY); // spat over the leg's foot
  }
  beam(b, [0, 1.02, 3.30], [0, -0.36, 3.44], 0.07, METAL); // tail-wheel leg, reaching down
  b.box(0, -0.50, 3.44, 0.13, 0.24, 0.26, RUBBER); // tail wheel, sole at −0.62
  // Aerial mast and wire, pitot's mirror: the small truths.
  b.box(0, 1.86, 1.55, 0.05, 0.26, 0.05, METAL);
  beam(b, [0, 1.98, 1.55], [0, 3.02, 3.40], 0.016, [0.10, 0.10, 0.11]);
  // Canopy framing and the gunsight (v18): a hoop over the bubble
  // at each end in body colour, a gunsight nub on the nose at the
  // windscreen's base, and a ventral antenna blade under the tail.
  b.box(0, 1.86, -0.80, 0.64, 0.06, 0.07, BODY); // canopy front hoop
  b.box(0, 1.90, 0.55, 0.66, 0.06, 0.07, BODY); // canopy rear hoop
  b.box(0, 1.54, -1.05, 0.07, 0.16, 0.07, [0.12, 0.12, 0.12]); // gunsight nub
  b.frustum(0, 0.78, 2.20, 0.05, 0.20, 0.15, 2.0, METAL); // ventral antenna
  const plane = R.makeMesh(b);
  const prop = buildPropMesh(R);
  const d = new Builder();
  const SEG = 24;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    d.tri([0, 0, 0], [Math.cos(a0) * 2.18, Math.sin(a0) * 2.18, 0], [Math.cos(a1) * 2.18, Math.sin(a1) * 2.18, 0], [0.25, 0.2, 0.16]);
  }
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    const p = (a, r) => [Math.cos(a) * r, Math.sin(a) * r, 0];
    d.quad(p(a0, 1.98), p(a1, 1.98), p(a1, 2.18), p(a0, 2.18), [0.46, 0.38, 0.28]);
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

function palm(b, x, z, h, rnd, y0 = 0) {
  const lean = (rnd() - 0.5) * 0.7;
  b.box(x + lean * h * 0.3, y0 + h / 2, z, 0.22, h, 0.22, TRUNK);
  const tx = x + lean * h * 0.6;
  b.cone(tx, y0 + h - 0.55, z, 1.9, 0.85, 6, GREEN);
  b.cone(tx, y0 + h - 0.15, z, 1.25, 0.7, 6, GREEN2);
  // Variety from a stable position hash (deterministic, no extra rnd
  // draws to disturb the island's layout): some crowns carry a third,
  // wider frond layer, and the taller palms carry coconuts.
  const v = Math.abs(Math.sin(x * 12.9898 + z * 78.233)) % 1;
  if (v < 0.45) b.cone(tx, y0 + h - 0.95, z, 2.45, 0.7, 6, GREEN);
  if (h > 4.4) for (const [ox, oz] of [[-0.3, 0.15], [0.25, -0.2], [0.05, 0.35]]) {
    b.box(tx + ox, y0 + h - 0.95, z + oz, 0.26, 0.26, 0.26, [0.30, 0.22, 0.12]);
  }
}

// ---- natural landforms (v13) ----
// The owner called the old hills strange: bare cones parked on discs.
// A landform is a smooth multi-lobe dome instead — a cosine profile
// softened at the skirt, its footprint wobbled by two angular harmonics
// so no two slopes match, and (for volcanoes) a crater bowl dipped into
// the crown. ONE function gives the height everywhere: the logic suite
// reads it through terrainHeightAt, the mesh builder samples it per
// vertex, so the ground the tests measure is the ground the player sees.
export function landformProfile(u) { // u = distance / radius, 0..1 → 1..0
  if (u >= 1) return 0;
  const c = 0.5 + 0.5 * Math.cos(Math.PI * u);
  return Math.pow(c, 1.25);
}
export function landformWobble(th, seed) {
  return 1 + 0.16 * Math.sin(th * 3 + seed) + 0.10 * Math.sin(th * 5 + seed * 1.7);
}
// Height of one landform entry {x, z, r, h, seed, kind} at a point, or
// -1 outside its footprint. Volcanoes ('mountain') carry the crater:
// inside 30% of the radius the profile is pinned to the rim's height
// and dipped toward the centre, so the crown reads as a bowl.
export function landformHeightAt(x, z, c) {
  const dx = x - c.x, dz = z - c.z;
  const d = Math.hypot(dx, dz);
  const dd = d / landformWobble(Math.atan2(dz, dx), c.seed || 0);
  if (dd >= c.r) return -1;
  let p = landformProfile(dd / c.r);
  if (c.kind === 'mountain') {
    const rimU = 0.30, rimP = landformProfile(rimU);
    const u = dd / c.r;
    if (u < rimU) p = rimP * (0.80 + 0.20 * (u / rimU));
  }
  return 0.01 + c.h * p;
}
// A flat ring between two radii — foam lines and wet-sand bands that hug
// a shoreline instead of the old full foam disc that paved the beach.
export function shoreRing(b, cx, cz, rIn, rOut, y, color, seg = 40) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const p = (a, r) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
    b.quad(p(a0, rIn), p(a1, rIn), p(a1, rOut), p(a0, rOut), color);
  }
}
// A bank wall from a landmass's top edge down into the sea: the side
// of the island, so land reads as a solid body with depth at its edge.
export function skirtRing(b, cx, cz, r, yTop, yBot, color, seg = 36) {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
    const t = (a) => [cx + Math.cos(a) * r, yTop, cz + Math.sin(a) * r];
    const bt = (a) => [cx + Math.cos(a) * r * 1.04, yBot, cz + Math.sin(a) * r * 1.04];
    b.quad(t(a0), t(a1), bt(a1), bt(a0), color);
  }
}
// low, soil breaking through the mid slopes, rock where it steepens or
// climbs, a pale cap on the great peaks and dark ash in the crater.
function landformColor(hf, slope, hash, kind) {
  if (kind === 'mountain' && hf > 0.86) return [0.80, 0.82, 0.85];
  if (kind === 'mountain' && hf > 0.68 && slope < 0.35) return [0.30, 0.26, 0.23]; // crater ash
  if (slope > 0.62 || hf > 0.78) return [0.44, 0.40, 0.37];
  if (hf > 0.42 && hash < (hf - 0.42) * 1.9) return [0.45, 0.36, 0.24]; // worn soil
  return hash < 0.5 ? [0.23, 0.46, 0.25] : [0.28, 0.52, 0.28];
}
// Build one landform as a radial heightfield: rings × sectors of flat
// facets, heights from landformHeightAt itself (base-relative), colours
// from height and slope. baseY is where its skirt meets the ground.
export function buildLandform(b, cx, cz, r, h, seed, kind, baseY = 0.01) {
  const entry = { x: cx, z: cz, r, h, seed, kind };
  const NS = 16, rings = [0, 0.16, 0.32, 0.48, 0.63, 0.77, 0.88, 0.96, 1.0];
  const H = (x, z) => Math.max(0, landformHeightAt(x, z, entry) - 0.01) + baseY;
  const pt = (a, u) => {
    const wob = landformWobble(a, seed);
    const x = cx + Math.cos(a) * r * u * wob, z = cz + Math.sin(a) * r * u * wob;
    return [x, H(x, z), z];
  };
  for (let ri = 0; ri < rings.length - 1; ri++) {
    for (let si = 0; si < NS; si++) {
      const a0 = (si / NS) * Math.PI * 2, a1 = ((si + 1) / NS) * Math.PI * 2;
      const p00 = pt(a0, rings[ri]), p10 = pt(a1, rings[ri]);
      const p01 = pt(a0, rings[ri + 1]), p11 = pt(a1, rings[ri + 1]);
      const cen = [(p00[0] + p11[0]) / 2, (p00[2] + p11[2]) / 2];
      const hf = clamp((H(cen[0], cen[1]) - baseY) / h, 0, 1);
      const slope = clamp(Math.abs(p01[1] - p00[1]) / Math.max(1, (rings[ri + 1] - rings[ri]) * r) * 1.6, 0, 1);
      const hash = Math.abs(Math.sin(cen[0] * 12.9898 + cen[1] * 78.233) * 43758.5453) % 1;
      const col = landformColor(hf, slope, hash, kind);
      if (ri === 0) { b.tri(p00, p10, p11, col); b.tri(p00, p11, p01, col); }
      else { b.quad(p00, p10, p11, p01, col); }
    }
  }
}

// An island, built from its REAL coastline (v13): the polygon in the
// world table — Bali with its Bukit peninsula, Lombok under Rinjani,
// Tambora's bulge on Sumbawa — triangulated for the beach, terraced
// upward in its own vegetation tones, and crowned with its signature
// volcano where the real island has one. The chart draws these same
// points; the sea's land mask respects the same shore. One shape,
// three readers. Unit (x, y-north) maps to world (x·R0, −y·R0): the
// island's north coast lies at −Z, as it does on the chart.
export function buildIsland(R, isl, scale = 1) {
  const rnd = mulberry32(isl.seed);
  const b = new Builder();
  const R0 = 54 * scale;
  const [ax, ay] = isl.anchor;
  const scaled = (k) => isl.shape.map(([x, y]) => [ax + (x - ax) * k, ay + (y - ay) * k]);
  const W = ([x, y]) => [x * R0, -y * R0]; // unit → world (x, z)
  const fan = (pts, y, color) => {
    for (const [ia, ib, ic] of triangulatePoly(pts)) {
      const A = W(pts[ia]), B = W(pts[ib]), C = W(pts[ic]);
      b.tri([A[0], y, A[1]], [C[0], y, C[1]], [B[0], y, B[1]], color);
    }
  };
  const strip = (p1, y1, p2, y2, color) => {
    for (let i = 0; i < p1.length; i++) {
      const A = W(p1[i]), B = W(p1[(i + 1) % p1.length]);
      const C = W(p2[(i + 1) % p2.length]), D = W(p2[i]);
      b.quad([A[0], y1, A[1]], [B[0], y1, B[1]], [C[0], y2, C[1]], [D[0], y2, D[1]], color);
    }
  };
  const shore = scaled(1), wet = scaled(1.07), foamL = scaled(1.16);
  fan(shore, 0.25, SAND);                                   // the beach itself
  strip(shore, 0.16, wet, 0.10, [0.80, 0.64, 0.42]);         // wet sand at the waterline
  strip(wet, 0.05, foamL, 0.02, FOAM);                      // the foam line, in the water
  strip(foamL, 0.018, scaled(1.24), 0.012, [0.90, 0.90, 0.84]); // a second, fainter foam skiff further out (v18)
  strip(shore, 0.25, scaled(1.03), -1.3, [0.72, 0.58, 0.38]); // the island's bank into the sea
  // Terraces climb inland in the island's own greens — lush in the
  // west of the chain, dry savanna toward the east (isl.veg).
  const [g1, g2] = isl.veg;
  const t1 = scaled(0.84), t2 = scaled(0.66), t3 = scaled(0.46);
  strip(shore, 0.25, t1, 0.80, g2);
  strip(t1, 0.80, t2, 1.65, g1);
  strip(t2, 1.65, t3, 2.70, g2);
  fan(t3, 2.70, g1);
  // The signature volcano, a true landform where the real island keeps
  // one (Agung, Rinjani, Tambora…); islands without one get a broad
  // interior highland instead.
  if (isl.volcano) {
    const v = isl.volcano;
    buildLandform(b, v.at[0] * R0, -v.at[1] * R0, v.r * R0, v.h * scale, isl.seed * 0.91 + 3, v.h >= 20 ? 'mountain' : 'hill', 0.2);
  }
  buildLandform(b, ax * R0, -ay * R0, 0.42 * R0, 4.5 * scale, isl.seed * 0.37 + 1, 'hill', 0.2);
  // Palms dress the first terrace; the settlement clusters on the
  // second, around one seeded stretch of coast — regional rhythm from
  // the same seed that lays out everything else.
  const shorePts = scaled(0.88), townPts = scaled(0.76);
  for (let i = 0; i < shorePts.length; i += 2) {
    if (rnd() < 0.35) continue;
    const [wx, wz] = W(shorePts[i]);
    palm(b, wx, wz, (3.6 + rnd() * 2.2) * scale, rnd, 0.55);
  }
  const start = Math.floor(rnd() * townPts.length);
  const houses = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < houses; i++) {
    const [wx, wz] = W(townPts[(start + i * 2) % townPts.length]);
    house(b, wx, wz, (0.9 + rnd() * 0.5) * scale, rnd, 1.15);
  }
  if (rnd() < 0.75) { // the longhouse warehouse anchors most settlements
    const [wx, wz] = W(townPts[(start + houses * 2 + 3) % townPts.length]);
    const s = scale;
    b.box(wx, 1.15 + 1.15 * s, wz, 7.5 * s, 2.3 * s, 4.2 * s, [0.74, 0.68, 0.58]);
    b.frustum(wx, 1.15 + 2.95 * s, wz, 8.3 * s, 1.3 * s, 5.0 * s, 0.10, [0.50, 0.30, 0.18]);
    b.box(wx, 1.15 + 0.95 * s, wz - 2.15 * s, 1.7 * s, 1.9 * s, 0.15, [0.28, 0.20, 0.14]);
  }
  if (rnd() < 0.7) { // a lighthouse watches one point of the coast
    const [wx, wz] = W(scaled(1.0)[Math.floor(rnd() * isl.shape.length)]);
    const ls = scale;
    b.box(wx, 0.25 + 1.6 * ls, wz, 1.7 * ls, 3.2 * ls, 1.7 * ls, [0.92, 0.90, 0.86]);
    b.box(wx, 0.25 + 4.4 * ls, wz, 1.5 * ls, 2.4 * ls, 1.5 * ls, [0.72, 0.22, 0.16]);
    b.box(wx, 0.25 + 6.8 * ls, wz, 1.3 * ls, 2.4 * ls, 1.3 * ls, [0.92, 0.90, 0.86]);
    b.box(wx, 0.25 + 8.6 * ls, wz, 1.6 * ls, 1.2 * ls, 1.6 * ls, [2.2, 1.9, 1.2]); // the lamp
    b.cone(wx, 0.25 + 9.2 * ls, wz, 1.35 * ls, 1.1 * ls, 6, [0.30, 0.30, 0.34]);
  }
  // Surf rocks stand off one seeded shore point.
  const ri = Math.floor(rnd() * isl.shape.length);
  const [rx, rz] = W(scaled(1.13)[ri]);
  b.cone(rx, 0.02, rz, 4.5 * scale, 2.0 * scale, 6, ROCK);
  const [rx2, rz2] = W(scaled(1.10)[(ri + 5) % isl.shape.length]);
  b.cone(rx2, 0.02, rz2, 3.2 * scale, 1.3 * scale, 6, ROCK);
  // Detailing (v14) on an INDEPENDENT seed stream, so everything laid
  // out above keeps its exact place: scrub bushes thicken the two
  // terrace rings in the island's own greens, beach umbrellas and
  // driftwood dress the sand, a third surf rock joins the pair, and a
  // plank jetty reaches into the shallows with a fishing boat tied up
  // at its end — every settlement works its shore.
  const drnd = mulberry32(isl.seed * 7 + 11);
  const bushA = [g1[0] * 0.72, g1[1] * 0.78, g1[2] * 0.72], bushB = [g2[0] * 0.8, g2[1] * 0.85, g2[2] * 0.8];
  for (const [ringK, ringY] of [[0.80, 0.99], [0.58, 2.07]]) {
    const ring = scaled(ringK);
    for (let i = 0; i < ring.length; i += 2) {
      if (drnd() < 0.45) continue;
      const [bx, bz] = W(ring[i]);
      b.cone(bx, ringY, bz, (0.9 + drnd() * 0.7) * scale, (0.8 + drnd() * 0.6) * scale, 6, drnd() < 0.5 ? bushA : bushB);
    }
  }
  const sandPts = scaled(0.97);
  for (const off of [3, 9]) {
    const [ux, uz] = W(sandPts[(start + off) % sandPts.length]);
    b.box(ux, 0.25 + 0.55 * scale, uz, 0.09 * scale, 1.1 * scale, 0.09 * scale, [0.45, 0.38, 0.32]); // umbrella pole
    // Canopies fully saturated and a touch wider (v15.1): two gates in
    // a row flew the approach without spotting the shore dressing —
    // muted cloth at 1.25 m across simply does not read from altitude.
    b.cone(ux, 0.25 + 1.05 * scale, uz, 1.55 * scale, 0.55 * scale, 7, off === 3 ? [1.0, 0.16, 0.08] : [0.0, 0.72, 0.72]); // its canopy
  }
  const [dx, dz] = W(scaled(1.0)[(start + 6) % isl.shape.length]);
  b.box(dx, 0.30, dz, 2.6 * scale, 0.22, 0.5 * scale, [0.55, 0.45, 0.34]); // driftwood
  const [rx3, rz3] = W(scaled(1.16)[(ri + 11) % isl.shape.length]);
  b.cone(rx3, 0.02, rz3, 2.2 * scale, 0.9 * scale, 6, ROCK);
  const ji = (ri + 8) % isl.shape.length;
  const jp = isl.shape[ji];
  // The jetty reaches half again as far as it did (v15.1): five
  // platforms stepping down to 1.32 radii, the posts and the boat
  // moved out with its end. Same shore point, same seed stream.
  for (const [jk, jy] of [[1.0, 0.30], [1.08, 0.235], [1.16, 0.175], [1.24, 0.12], [1.32, 0.07]]) {
    const [jx, jz] = W([ax + (jp[0] - ax) * jk, ay + (jp[1] - ay) * jk]);
    b.box(jx, jy, jz, 1.5 * scale, 0.14, 1.5 * scale, [0.58, 0.47, 0.35]); // jetty platform
  }
  const [px2, pz2] = W([ax + (jp[0] - ax) * 1.32, ay + (jp[1] - ay) * 1.32]);
  b.box(px2 - 0.55 * scale, -0.10, pz2, 0.15 * scale, 0.5, 0.15 * scale, [0.45, 0.37, 0.29]);
  b.box(px2 + 0.55 * scale, -0.10, pz2, 0.15 * scale, 0.5, 0.15 * scale, [0.45, 0.37, 0.29]); // jetty posts into the water
  const [ex, ez] = W([ax + (jp[0] - ax) * 1.41, ay + (jp[1] - ay) * 1.41]);
  b.box(ex, 0.16, ez, 2.8 * scale, 0.5 * scale, 1.05 * scale, [0.92, 0.22, 0.12]); // the tied-up boat's hull, bright red now
  b.box(ex, 0.48, ez, 1.1 * scale, 0.35 * scale, 0.8 * scale, [0.92, 0.90, 0.86]); // its cabin
  b.box(ex, 0.95, ez, 0.07 * scale, 1.1 * scale, 0.07 * scale, [0.45, 0.38, 0.32]); // its mast
  // The approach shore (v15 gate fix): the lane meets every island on
  // its south coast (local −y — the chart's north lies at −Z), but the
  // seeded town, and with it the jetty above, can sit on any arc of
  // the coast, often the far side from an arriving pilot, who then
  // never sees either. A second, smaller jetty with a teal-hulled
  // boat and two more umbrellas dress the southernmost shore itself,
  // so the settlement's working edge reads on a normal approach. All
  // of it is laid from the shape alone, after every seeded item, so
  // no house, palm or rock moves.
  // The anchor point (v15.1 correction): the southernmost point near
  // the centreline, not the southernmost point outright. Penida's
  // outright southernmost point stands inside the destination
  // airport's footprint — its jetty ran into the terminal's south
  // wall and its boat ended up inside the terminal block, invisible
  // on every approach ever flown at it. The near-centre south point
  // stands clear of the apron, just past the deck's far end, in the
  // pilot's eye line on short final. Same shore, same parts; only
  // the anchor moved along the coast. (Islands whose southernmost
  // point already sits near the centreline keep it.)
  let si = -1;
  for (let i = 0; i < isl.shape.length; i++) {
    if (Math.abs(isl.shape[i][0] - ax) > 0.17) continue;
    if (si < 0 || isl.shape[i][1] < isl.shape[si][1]) si = i;
  }
  if (si < 0) { si = 0; for (let i = 1; i < isl.shape.length; i++) if (isl.shape[i][1] < isl.shape[si][1]) si = i; }
  const sp = isl.shape[si];
  // The south jetty reaches half again as far too (v15.1), its boat
  // bright teal and its umbrellas saturated like the town pair.
  for (const [jk, jy] of [[1.0, 0.30], [1.08, 0.23], [1.16, 0.17], [1.24, 0.12]]) {
    const [jx, jz] = W([ax + (sp[0] - ax) * jk, ay + (sp[1] - ay) * jk]);
    b.box(jx, jy, jz, 1.4 * scale, 0.14, 1.4 * scale, [0.58, 0.47, 0.35]); // south jetty platform
  }
  const [qx, qz] = W([ax + (sp[0] - ax) * 1.24, ay + (sp[1] - ay) * 1.24]);
  b.box(qx - 0.5 * scale, -0.10, qz, 0.15 * scale, 0.5, 0.15 * scale, [0.45, 0.37, 0.29]);
  b.box(qx + 0.5 * scale, -0.10, qz, 0.15 * scale, 0.5, 0.15 * scale, [0.45, 0.37, 0.29]); // its posts
  const [tx, tz] = W([ax + (sp[0] - ax) * 1.33, ay + (sp[1] - ay) * 1.33]);
  b.box(tx, 0.16, tz, 2.6 * scale, 0.5 * scale, 1.0 * scale, [0.05, 0.72, 0.78]); // the south boat, bright teal now
  b.box(tx, 0.46, tz, 1.0 * scale, 0.32 * scale, 0.75 * scale, [0.92, 0.90, 0.86]); // its cabin
  b.box(tx, 0.88, tz, 0.07 * scale, 1.0 * scale, 0.07 * scale, [0.45, 0.38, 0.32]); // its mast
  for (const off of [-1, 1]) {
    const [ux, uz] = W(sandPts[(si + off + sandPts.length) % sandPts.length]);
    b.box(ux, 0.25 + 0.55 * scale, uz, 0.09 * scale, 1.1 * scale, 0.09 * scale, [0.45, 0.38, 0.32]); // umbrella pole
    b.cone(ux, 0.25 + 1.05 * scale, uz, 1.55 * scale, 0.55 * scale, 7, off < 0 ? [1.0, 0.72, 0.0] : [1.0, 0.25, 0.55]); // its canopy
  }
  // Detailing (v16) on its OWN seed stream again, so every palm,
  // house and rock above keeps its exact place: a second palm ring
  // climbs to the middle terrace, grass tufts stitch the terrace
  // edges, beach scrub thickens along the sand, and two cargo crates
  // wait by the town jetty — the islands read inhabited and grown,
  // not landscaped, on the approach.
  const vrnd = mulberry32(isl.seed * 13 + 5);
  const tuftA = [g1[0] * 0.85 + 0.08, g1[1] * 0.92, g1[2] * 0.8], tuftB = [g2[0] * 0.9 + 0.06, g2[1] * 0.95, g2[2] * 0.85];
  const midPts = scaled(0.66);
  // Vegetation density varies by island (v18): the ring's skip
  // chance is hashed from the island's own seed on a THIRD stream,
  // so some islands climb lush and others stay sparse — and still
  // no palm, house or rock on the main stream moves.
  const palmSkip = 0.40 + mulberry32(isl.seed * 29 + 11)() * 0.30;
  for (let i = 0; i < midPts.length; i += 2) {
    if (vrnd() < palmSkip) continue;
    const [wx, wz] = W(midPts[i]);
    palm(b, wx, wz, (3.0 + vrnd() * 1.8) * scale, vrnd, 1.65);
  }
  for (const [ringK, ringY] of [[0.90, 0.42], [0.72, 1.28], [0.52, 2.28]]) {
    const ring = scaled(ringK);
    for (let i = 0; i < ring.length; i++) {
      if (vrnd() < 0.62) continue;
      const [tx, tz] = W(ring[i]);
      b.cone(tx, ringY, tz, (0.30 + vrnd() * 0.22) * scale, (0.42 + vrnd() * 0.3) * scale, 5, vrnd() < 0.5 ? tuftA : tuftB); // grass tuft
    }
  }
  const beachPts = scaled(0.95);
  for (let i = 0; i < beachPts.length; i += 2) {
    if (vrnd() < 0.5) continue;
    const [bx, bz] = W(beachPts[i]);
    b.cone(bx, 0.25, bz, (0.7 + vrnd() * 0.5) * scale, (0.6 + vrnd() * 0.45) * scale, 6, vrnd() < 0.5 ? bushA : bushB); // beach scrub
  }
  const [cx2, cz2] = W([ax + (jp[0] - ax) * 1.06, ay + (jp[1] - ay) * 1.06]);
  b.box(cx2 + 1.1 * scale, 0.55, cz2, 1.0 * scale, 0.6 * scale, 1.0 * scale, [0.62, 0.45, 0.28]); // jetty crate
  b.box(cx2 + 1.05 * scale, 1.12, cz2, 0.8 * scale, 0.5 * scale, 0.8 * scale, [0.50, 0.38, 0.24]); // crate stacked
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
  // Ground cover on the shoulders (v13): tufts in the grass and worn
  // soil where the service track crosses — the far field lives too.
  const trnd = mulberry32(5150);
  for (const sx of [-1, 1]) for (let i = 0; i < 16; i++) {
    const x = sx * (24 + trnd() * 18), z = -120 + trnd() * 240;
    b.cone(x, 0.06, z, 0.34 + trnd() * 0.2, 0.5 + trnd() * 0.3, 4, [0.17, 0.36, 0.19]);
  }
  for (const [x, z, r] of [[-30, 40, 5], [31, -64, 4], [-28, -110, 6], [29, 96, 4.5]]) {
    b.disc(x, 0.045, z, r, 9, [0.47, 0.38, 0.25]);
  }
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
  b.box(0, -0.11, deckZ, 68, 0.22, len + 4, SAND); // reclaimed ground slab, widened (v13)
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
  b.box(42, -0.01, 122, 42, 0.05, 46, DECK2); // apron pad under the buildings, enlarged (v13)
  // A second pad across the strip for the fuel farm's home side, and a
  // row of ground cones marking the taxiway's working edge.
  b.box(-38, -0.01, 108, 24, 0.05, 30, DECK2);
  for (let z = 84; z <= 132; z += 12) b.cone(-24.5, 0.02, z, 0.42, 0.75, 6, [0.95, 0.48, 0.12]);
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
    { x: -150, z: -300, r: 55, h: 15, kind: 'hill', seed: 3.1 },
    { x: 150, z: -275, r: 48, h: 11, kind: 'hill', seed: 5.7 },
    { x: -145, z: 185, r: 50, h: 9, kind: 'hill', seed: 8.3 },
    { x: 120, z: 150, r: 40, h: 6, kind: 'grass', seed: 2.9 },
    { x: -70, z: -330, r: 34, h: 4, kind: 'grass', seed: 6.1 },
    // Real mountains (v12, reshaped v13): volcanic landforms two to
    // three times the hills' height, standing well clear of the strip
    // corridor and the climb-out line — landmarks on the horizon, never
    // obstacles in it. The deck-burial rule still holds: none of them
    // reaches the footprint.
    { x: -265, z: -430, r: 95, h: 36, kind: 'mountain', seed: 4.7 },
    { x: 245, z: -395, r: 85, h: 30, kind: 'mountain', seed: 9.2 },
    { x: -240, z: 275, r: 75, h: 24, kind: 'mountain', seed: 1.3 },
    { x: 210, z: 300, r: 60, h: 18, kind: 'hill', seed: 7.9 },
  ],
};
// The terrain's top height at a point: the highest shape covering it,
// or -1 for open sea. Discs are flat at their table height; landforms
// rise on the shared landform curve (landformHeightAt), so the height
// the logic reads is the height the mesh draws.
export function terrainHeightAt(x, z) {
  let top = -1;
  for (const d of HOME_TERRAIN.discs) {
    if (Math.hypot(x - d.x, z - d.z) <= d.r) top = Math.max(top, d.y);
  }
  for (const c of HOME_TERRAIN.cones) {
    const h = landformHeightAt(x, z, c);
    if (h > 0) top = Math.max(top, h);
  }
  return top;
}

// The sea's land mask (v13): every shoreline circle the swell must
// respect, in world coordinates, for a given leg — the home island's
// discs and landform skirts, the destination island and its apron, and
// the en-route islets (positions mirroring the scene's islet table).
// The sea shader sinks and calms inside these circles, so waves exist
// only where water actually is. Exported pure so the logic suite can
// prove the airfield and the aprons sit fully inside the mask.
export function seaLandCircles(legDist) {
  const cs = [];
  for (const d of HOME_TERRAIN.discs) cs.push([d.x, d.z, d.r]);
  for (const c of HOME_TERRAIN.cones) cs.push([c.x, c.z, c.r * 1.18]);
  const dz = -legDist - 72; // the destination island's drawn centre
  cs.push([0, dz, 84]);
  cs.push([0, -legDist + 20, 62]);
  cs.push([0, -legDist + 105, 62]);
  cs.push([0, -legDist + 190, 62]);
  cs.push([-170, -legDist * 0.3, 19]);
  cs.push([210, -legDist * 0.55, 24]);
  cs.push([-240, -legDist * 0.78, 18]);
  return cs;
}

export function buildHomeTerrain(R) {
  const b = new Builder();
  const SANDS = [SAND, [0.90, 0.74, 0.48], SAND];
  const GREENS = [GREEN, GREEN2, [0.30, 0.54, 0.29]];
  const SKIRT_SAND = [0.72, 0.58, 0.38], SKIRT_SOIL = [0.40, 0.33, 0.22];
  let si = 0, gi = 0;
  for (const d of HOME_TERRAIN.discs) {
    const isSand = d.kind === 'sand';
    b.disc(d.x, d.y, d.z, d.r, 30, isSand ? SANDS[si++ % SANDS.length] : GREENS[gi++ % GREENS.length]);
    // The skirt (v13): every lobe is a solid landmass with a bank down
    // into the sea, not a paper sheet floating on the swell — from the
    // cockpit's grazing angle the island now has an edge with depth.
    skirtRing(b, d.x, d.z, d.r, d.y, -1.25, isSand ? SKIRT_SAND : SKIRT_SOIL, 30);
  }
  // The hills and mountains are landforms now (v13): smooth multi-lobe
  // domes and cratered volcanoes built from the same table the height
  // function reads — no more bare cones parked on the grass.
  for (const c of HOME_TERRAIN.cones) {
    buildLandform(b, c.x, c.z, c.r, c.h, c.seed, c.kind, 0.01);
  }
  // Foam lines (v13): a segment of pale surf survives only where it
  // truly borders open water — on the UNION shoreline of the sand
  // lobes. A segment whose midpoint lies deep inside another lobe is
  // inland and is skipped, so no foam ever crosses the airfield.
  const sandLobes = HOME_TERRAIN.discs.filter(d => d.kind === 'sand');
  for (const d of sandLobes) {
    const SEG = 44, rr = d.r + 1.2;
    for (let i = 0; i < SEG; i++) {
      const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
      const am = (a0 + a1) / 2, mx = d.x + Math.cos(am) * rr, mz = d.z + Math.sin(am) * rr;
      let inland = false;
      for (const o of HOME_TERRAIN.discs) {
        if (o !== d && Math.hypot(mx - o.x, mz - o.z) < o.r - 3) { inland = true; break; }
      }
      if (inland) continue;
      const p = (a, r) => [d.x + Math.cos(a) * r, 0.045, d.z + Math.sin(a) * r];
      b.quad(p(a0, rr), p(a1, rr), p(a1, rr + 3.2), p(a0, rr + 3.2), FOAM);
    }
  }
  // Mow bands (v13): lighter stripes mown into the grass shoulders
  // flanking the strip, the way a real field is kept — they run the
  // strip's whole working length and stop at its corridor.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      b.box(sx * 41, 0.024, -215 + i * 46, 34, 0.028, 23, i % 2 ? [0.31, 0.55, 0.29] : [0.26, 0.49, 0.26]);
    }
  }
  // Palms dress the grass lobes — never the corridor, never the apron.
  const rnd = mulberry32(4242);
  for (const [x, z, h] of [[-120, 30, 4.6], [-80, -160, 5.4], [-130, -240, 4.2], [120, -120, 5.0],
    [80, -230, 4.4], [130, 40, 5.6], [-60, -350, 4.8], [40, -375, 4.1], [-160, 120, 5.2],
    [150, 175, 4.5], [-45, 235, 5.0], [95, 215, 4.3], [165, -320, 5.3], [-185, -60, 4.7]]) {
    palm(b, x, z, h, rnd);
  }
  // Grass tufts and worn soil (v13): the field's ground cover — small
  // dark tufts scattered over the grass lobes by a stable hash, and
  // bare-earth patches where feet and wheels wear the turf. All placed
  // clear of the strip corridor and the apron.
  const trnd = mulberry32(777001);
  for (const d of HOME_TERRAIN.discs) {
    if (d.kind !== 'grass') continue;
    for (let i = 0; i < 13; i++) {
      const a = trnd() * Math.PI * 2, fr = 0.25 + trnd() * 0.62;
      const x = d.x + Math.cos(a) * d.r * fr, z = d.z + Math.sin(a) * d.r * fr;
      if (Math.abs(x) < 24 && z > -285 && z < 115) continue; // the corridor stays clean
      b.cone(x, d.y + 0.004, z, 0.34 + trnd() * 0.2, 0.5 + trnd() * 0.35, 4, [0.17, 0.36, 0.19]);
    }
    for (let i = 0; i < 2; i++) {
      const a = trnd() * Math.PI * 2, fr = 0.3 + trnd() * 0.5;
      const x = d.x + Math.cos(a) * d.r * fr, z = d.z + Math.sin(a) * d.r * fr;
      if (Math.abs(x) < 26 && z > -285 && z < 115) continue;
      b.disc(x, d.y + 0.003, z, 3.5 + trnd() * 4.5, 9, [0.47, 0.38, 0.25]); // worn soil
    }
  }
  // Rock outcrops where the lobes meet the sea.
  b.cone(170, 0.02, -50, 9, 2.6, 6, ROCK);
  b.cone(-178, 0.02, -160, 11, 3.4, 6, ROCK);
  b.cone(-60, 0.02, -415, 10, 3.0, 6, ROCK);
  // The field's own harbour (v15 gate fix): the home shore east of the
  // strip had no working edge at all — no jetty, no boat, no shade —
  // so the settlement dressing the islands wear was nowhere to be seen
  // from the runway or the climb-out. A plank jetty reaches east from
  // the sand beside the airport with a fishing boat tied at its end,
  // and umbrellas dress both shores at the field's latitude. Mesh
  // only: the height table the flight model reads is untouched.
  // Both home jetties reach half again as far as they did, their
  // boats bright and their umbrellas saturated (v15.1) — the same
  // readability pass the islands got, on the field she sees most.
  for (const [jx, jy] of [[163, 0.30], [174, 0.24], [185, 0.18], [196, 0.13], [207, 0.09], [218, 0.06]]) {
    b.box(jx, jy, -30, 11, 0.16, 3.2, [0.58, 0.47, 0.35]); // jetty deck sections
  }
  b.box(218, -0.10, -31.8, 0.35, 0.55, 0.35, [0.45, 0.37, 0.29]);
  b.box(218, -0.10, -28.2, 0.35, 0.55, 0.35, [0.45, 0.37, 0.29]); // jetty posts
  b.box(228, 0.17, -30, 3.4, 0.55, 1.25, [0.96, 0.95, 0.92]); // the tied-up boat, bright white hull now
  b.box(228, 0.52, -30, 1.25, 0.36, 0.9, [0.92, 0.90, 0.86]); // its cabin
  b.box(228, 0.98, -30, 0.08, 1.15, 0.08, [0.45, 0.38, 0.32]); // its mast
  for (const [ux, uz, col] of [[150, 18, [1.0, 0.16, 0.08]], [154, -88, [0.0, 0.72, 0.72]], [-152, -40, [1.0, 0.72, 0.0]]]) {
    b.box(ux, 0.62, uz, 0.10, 1.15, 0.10, [0.45, 0.38, 0.32]); // umbrella pole
    b.cone(ux, 1.32, uz, 1.6, 0.55, 7, col); // its canopy
  }
  // A second, smaller jetty on the north shore, dead ahead of every
  // climb-out: the far sand ends at z ≈ −375, and she overflies this
  // harbour on each departure, so the field's working edge is in the
  // frame even for a pilot who never looks sideways.
  for (const [jz, jy] of [[-380, 0.28], [-389, 0.22], [-398, 0.16], [-407, 0.12], [-416, 0.08]]) {
    b.box(40, jy, jz, 3.0, 0.15, 9, [0.58, 0.47, 0.35]); // north jetty deck
  }
  b.box(38.2, -0.10, -416, 0.35, 0.55, 0.35, [0.45, 0.37, 0.29]);
  b.box(41.8, -0.10, -416, 0.35, 0.55, 0.35, [0.45, 0.37, 0.29]); // its posts
  b.box(40, 0.17, -425, 1.15, 0.52, 3.1, [0.92, 0.22, 0.12]); // the north boat, bright red hull now
  b.box(40, 0.50, -425, 0.85, 0.34, 1.15, [0.92, 0.90, 0.86]); // its cabin
  for (const [ux, uz, col] of [[18, -366, [1.0, 0.25, 0.55]], [66, -370, [1.0, 0.72, 0.0]]]) {
    b.box(ux, 0.62, uz, 0.10, 1.15, 0.10, [0.45, 0.38, 0.32]);
    b.cone(ux, 1.32, uz, 1.6, 0.55, 7, col);
  }
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
  // The shelf hugs the land (v13): radii only ~12 m past the sand lobes
  // they serve, and the sea beneath is pinned calm by the land mask, so
  // the pale water reads as shallows — never as a sheet over the swell.
  b.disc(0, 0.0015, 95, 163, 30, AQUA);
  b.disc(0, 0.0015, -70, 188, 30, AQUA);
  b.disc(0, 0.0015, -235, 153, 30, AQUA);
  b.disc(0, 0.0015, -352, 101, 30, AQUA);
  return R.makeMesh(b);
}

// The destination's own shelf (v13): one lagoon disc around the island
// and one along its apron — shaped for THAT shore, not borrowed from
// the home island's lobes the way v11 shipped it.
export function buildDestShallows(R) {
  const b = new Builder();
  const AQUA = [0.40, 0.76, 0.72];
  // Local origin = the island's drawn centre (the scene composes this
  // mesh there); the strip apron lies ~160 m along +Z of it.
  b.disc(0, 0.0015, 0, 96, 30, AQUA);
  b.disc(0, 0.0015, 120, 62, 24, AQUA);
  b.disc(0, 0.0015, 195, 56, 24, AQUA);
  return R.makeMesh(b);
}

// Terminal, tower and hangars for an airport, local origin at the runway's
// far end, buildings standing on the shore to the +X side.
export function buildAirport(R) {
  const b = new Builder();
  const WALL = [0.92, 0.88, 0.80], ROOF = [0.62, 0.25, 0.14], GLASS = [0.15, 0.35, 0.45];
  const WIN = [1.30, 1.02, 0.50]; // lit windows: emissive past 1.0, they glow at night
  // The terminal (v13): a real airport building now — a long two-storey
  // block with a full glass band facing the apron, a roof overhang, an
  // entrance canopy, and a sign band whose micro-bars fake the lettering
  // the way the plane's registration does.
  b.box(34, 3.75, -6, 30, 7.5, 11, WALL); // terminal block
  b.box(34, 7.9, -6, 32, 0.9, 13, ROOF); // roof slab with overhang
  b.box(34, 4.6, -11.7, 26, 3.0, 0.5, GLASS); // the glass band
  for (const wx of [24, 29.5, 35, 40.5]) b.box(wx, 4.6, -12.0, 3.4, 2.2, 0.18, WIN); // lit panes
  for (const wx of [25.5, 31, 36.5, 42]) b.box(wx, 6.6, -11.55, 2.2, 1.0, 0.16, WIN); // upper lit row
  b.box(34, 6.9, -11.62, 24, 0.85, 0.14, [0.16, 0.30, 0.44]); // sign band
  for (let i = 0; i < 11; i++) b.box(23.4 + i * 1.95, 6.9, -11.72, 1.05, 0.5, 0.06, [1.15, 1.02, 0.72]); // sign lettering, faked
  b.box(34, 2.6, -13.6, 16, 0.35, 4.2, [0.45, 0.38, 0.32]); // entrance canopy
  for (const px of [27, 41]) b.box(px, 1.2, -15.2, 0.35, 2.4, 0.35, [0.55, 0.56, 0.60]); // canopy posts
  for (const wz of [-9, -6, -3]) b.box(49.15, 3.6, wz, 0.18, 1.7, 2.4, WIN); // lit panes on the flank too
  b.box(46, 8.5, 8, 3.4, 17, 3.4, WALL); // tower shaft, taller (v13)
  b.box(46, 17.8, 8, 5.8, 2.6, 5.8, GLASS); // tower cab
  b.box(46, 17.8, 5.0, 4.8, 1.9, 0.3, WIN); // the cab's lit face, watching the strip
  b.box(46, 19.5, 8, 6.4, 0.8, 6.4, ROOF);
  // (The tower beacon is a separate scene-drawn mesh now — it blinks.)
  b.box(24, 2.5, 16, 12, 5, 8, [0.55, 0.58, 0.62]); // hangar
  b.cone(24, 5, 16, 6.4, 2.2, 4, ROOF);
  b.box(24, 1.9, 11.8, 9.5, 3.8, 0.3, [0.30, 0.33, 0.38]); // hangar door face (v13)
  b.box(14, 2.1, 33, 10, 4.2, 7, [0.60, 0.62, 0.66]); // the second hangar, grown (v13)
  b.cone(14, 4.2, 33, 5.6, 1.9, 4, ROOF);
  b.box(14, 1.7, 29.3, 7.5, 3.4, 0.3, [0.30, 0.33, 0.38]); // its door face
  b.box(40, 1.8, 24, 8, 3.6, 6, WALL); // cargo shed
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
  // A depot wing and fuel farm (v12): a third building on the apron, two
  // squat fuel tanks on a pad, and apron light poles whose heads burn
  // warm past 1.0 — so the home field glows as a place at night.
  b.box(52, 2.2, 26, 10, 4.4, 7, WALL); // depot wing
  b.box(52, 4.7, 26, 11, 0.9, 8, ROOF);
  for (const wx of [48.5, 52, 55.5]) b.box(wx, 2.4, 22.4, 2.0, 1.3, 0.18, WIN);
  b.box(58, 0.45, -34, 15, 0.9, 9, [0.42, 0.42, 0.44]); // tank pad
  for (const tx of [53.5, 62]) {
    b.box(tx, 2.5, -34, 6.2, 4.1, 6.2, [0.78, 0.76, 0.72]);
    b.box(tx, 4.75, -34, 6.4, 0.4, 6.4, [0.62, 0.60, 0.57]);
    b.box(tx, 5.2, -34, 1.0, 0.6, 1.0, [0.50, 0.50, 0.52]);
  }
  for (const [lx, lz] of [[16, 6], [16, 44], [44, 40]]) {
    b.box(lx, 3.4, lz, 0.24, 6.8, 0.24, [0.55, 0.56, 0.60]);
    b.box(lx, 7.0, lz, 1.1, 0.5, 1.1, [2.3, 1.9, 1.1]); // the apron lamp
  }
  // Ground life (v13): a baggage-cart train waiting by the terminal, a
  // fuel truck at the farm, traffic cones on the working apron, and a
  // car park slab with three little cars by the depot wing.
  for (let i = 0; i < 3; i++) {
    b.box(28 + i * 2.6, 0.55, -16.5, 2.2, 1.1, 1.5, [0.62, 0.52, 0.38]);
    b.box(28 + i * 2.6, 0.18, -16.5, 2.3, 0.3, 1.6, [0.25, 0.25, 0.28]);
  }
  b.box(56, 1.0, -28, 5.4, 2.0, 2.2, [0.85, 0.83, 0.78]); // fuel truck tank
  b.box(56, 1.1, -24.9, 4.4, 1.1, 1.6, [0.30, 0.36, 0.42]); // fuel truck cab
  for (const [cx, cz] of [[20, 26], [30, 30], [48, 18], [52, 30]]) b.cone(cx, 0.02, cz, 0.42, 0.8, 6, [0.95, 0.48, 0.12]);
  b.box(56, 0.04, 38, 13, 0.08, 8, [0.30, 0.30, 0.33]); // car park slab
  for (const [cx, cc] of [[52, [0.70, 0.25, 0.18]], [56.5, [0.25, 0.40, 0.65]], [61, [0.85, 0.83, 0.78]]]) {
    b.box(cx, 0.55, 38, 3.4, 0.9, 1.7, cc);
    b.box(cx, 1.15, 38, 1.9, 0.5, 1.55, [0.20, 0.26, 0.32]);
  }
  // Detailing (v14): the working-airport layer. Painted apron
  // markings — a yellow taxiway centreline down the service road and
  // white stand lines by the terminal — light pools under the apron
  // lamps (pale discs that stay readable after dark), tarped pallet
  // stacks by the cargo shed, a fuel bowser at the farm, chocks and a
  // tow bar waiting at the hangar door, plant boxes on the terminal
  // roof, and a blinking-tip antenna mast on the tower.
  b.box(19, 0.10, 24, 0.35, 0.02, 30, [0.95, 0.78, 0.25]); // taxiway centreline
  for (const px of [26, 34, 42]) { b.box(px, 0.06, -16, 0.28, 0.02, 5.5, [0.92, 0.92, 0.90]); b.box(px, 0.06, -18.6, 3.4, 0.02, 0.28, [0.92, 0.92, 0.90]); } // stand T-lines
  for (const [lx, lz] of [[16, 6], [16, 44], [44, 40]]) b.disc(lx, 0.055, lz, 3.4, 12, [0.98, 0.85, 0.55]); // lamp light pools
  for (const [px, pz] of [[44.5, 29], [46.3, 29.4]]) {
    b.box(px, 0.18, pz, 1.7, 0.36, 1.3, [0.55, 0.45, 0.33]); // pallet
    b.box(px, 0.85, pz, 1.6, 1.0, 1.2, [0.32, 0.42, 0.55]); // blue tarp load
  }
  b.box(50, 0.72, -27, 2.6, 1.1, 1.25, [0.80, 0.78, 0.74]); // fuel bowser tank
  b.box(49.2, 0.3, -27, 0.5, 0.6, 0.9, [0.22, 0.22, 0.24]); b.box(50.8, 0.3, -27, 0.5, 0.6, 0.9, [0.22, 0.22, 0.24]); // its wheels
  b.box(22.6, 0.14, 8.5, 0.5, 0.28, 0.34, [0.95, 0.75, 0.20]); b.box(25.4, 0.14, 8.5, 0.5, 0.28, 0.34, [0.95, 0.75, 0.20]); // chocks
  b.box(24, 0.10, 9.6, 0.16, 0.12, 2.2, [0.55, 0.56, 0.60]); // tow bar
  b.box(28, 8.78, -6, 3.0, 0.85, 2.0, [0.60, 0.62, 0.65]); b.box(40, 8.78, -4, 2.2, 0.85, 1.6, [0.60, 0.62, 0.65]); // roof plant
  b.box(46, 20.45, 8, 0.12, 1.3, 0.12, [0.40, 0.40, 0.44]); b.box(46, 21.15, 8, 0.3, 0.22, 0.3, [1.9, 0.35, 0.28]); // tower antenna + tip light
  // Detailing (v16): the apron's edge learns its manners — a row of
  // small warm edge lights along the terminal front so the stand
  // line glows after dark, lit windows in both hangar doors, a
  // windsock-orange cone pair marking the fuel farm's corner, and
  // a second service van parked at the cargo shed, so the field's
  // working fleet is not one van doing every job.
  for (let i = 0; i < 7; i++) b.box(21 + i * 4.3, 0.28, -17.8, 0.34, 0.34, 0.34, [2.2, 1.75, 0.95]); // apron edge lights
  b.box(21.5, 2.6, 11.62, 1.6, 1.1, 0.16, WIN); b.box(26.5, 2.6, 11.62, 1.6, 1.1, 0.16, WIN); // hangar 1 door windows
  b.box(14, 2.5, 29.12, 1.6, 1.1, 0.16, WIN); // hangar 2 door window
  b.cone(51.5, 0.02, -29.5, 0.42, 0.8, 6, [0.95, 0.48, 0.12]); b.cone(64.5, 0.02, -29.5, 0.42, 0.8, 6, [0.95, 0.48, 0.12]); // fuel farm corner cones
  b.box(44.5, 0.85, 27.5, 4.8, 1.7, 2.1, [0.85, 0.83, 0.78]); // the second van, at the shed
  b.box(44.5, 1.15, 25.2, 4.3, 0.9, 1.4, [0.30, 0.36, 0.42]); // its cab
  return R.makeMesh(b);
}

// The rescue boat (v12): a small open launch that waits at sea with a
// lantern burning — the rescue ticket's mark in the world. Hull, cabin,
// a mast light, and a pale pickup ring floating on the water around her.
export function buildBoat(R) {
  const b = new Builder();
  b.box(0, 0.35, 0, 2.2, 0.7, 6.4, [0.85, 0.40, 0.18]); // hull
  b.box(0, 0.85, -0.6, 1.7, 0.5, 3.4, [0.92, 0.90, 0.84]); // deckhouse
  b.box(0, 1.35, -0.4, 0.16, 1.4, 0.16, [0.45, 0.42, 0.40]); // mast
  b.box(0, 2.2, -0.4, 0.5, 0.5, 0.5, [2.4, 1.8, 0.9]); // the lantern
  b.disc(0, 0.12, 0, 24, 20, [0.45, 1.25, 1.35]); // the pickup ring on the water
  return R.makeMesh(b);
}

// The survey-photo gate (v12): a sky-blue ring standing over the water,
// kin to the golden course rings but its own colour and smaller — the
// photo ticket's mark in the world.
export function buildGateMesh(R) {
  const b = new Builder();
  b.torus(0, 0, 0, 6, 0.55, 10, [0.35, 0.85, 2.0]);
  b.torus(0, 0, 0, 4.6, 0.30, 10, [0.55, 1.15, 2.2]);
  return R.makeMesh(b);
}

// The explosion (v13): presentation for the high-energy crash only —
// flight.js decides (crashExplodes); the scene merely shows it. A hot
// emissive core that blooms and dies in the first second, a smoke
// column that keeps rising and thinning after it, and debris chunks
// scattered on ballistic arcs by the draw code. Flat-shaded and
// emissive, in the game's own visual language.
export function buildExplosion(R) {
  const core = new Builder();
  core.disc(0, 0.4, 0, 3.2, 12, [2.6, 1.5, 0.45]);
  core.cone(0, 0.2, 0, 2.6, 4.6, 10, [2.4, 1.1, 0.30]);
  core.cone(0, 0.2, 0, 1.7, 7.2, 8, [2.2, 0.75, 0.22]);
  const smoke = new Builder();
  smoke.cone(0, 0, 0, 3.4, 9, 9, [0.16, 0.15, 0.16]);
  smoke.cone(0, 6.5, 0, 2.5, 8, 8, [0.22, 0.21, 0.22]);
  smoke.cone(0, 13, 0, 1.7, 7, 7, [0.28, 0.27, 0.28]);
  const debris = new Builder();
  const rnd = mulberry32(31337);
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, rr = 1 + rnd() * 3;
    debris.box(Math.cos(a) * rr, 0.4 + rnd() * 1.4, Math.sin(a) * rr,
      0.5 + rnd() * 0.8, 0.35 + rnd() * 0.5, 0.5 + rnd() * 0.8,
      i % 3 ? [0.30, 0.16, 0.10] : [1.9, 0.9, 0.30]);
  }
  return { core: R.makeMesh(core), smoke: R.makeMesh(smoke), debris: R.makeMesh(debris) };
}

// Gunfire light (v15.2, SKY PATROL): a tracer is a unit cube the scene
// stretches along the shot's line with a hand-built basis (the engine's
// compose only scales uniformly) — one mesh per side of the fight, the
// colour baked in: hers burn warm amber, the bandits' burn red. The
// muzzle flash is a small crossed star of hot boxes, drawn at the nose
// for a few frames per shot and scaled up as it dies.
export function buildTracer(R, colour) {
  const b = new Builder();
  b.box(0, 0, 0, 1, 1, 1, colour);
  return R.makeMesh(b);
}
export function buildFlash(R) {
  const b = new Builder();
  const HOT = [3.9, 3.1, 1.5], CORE = [4.2, 3.9, 3.0];
  b.box(0, 0, 0, 1.9, 0.16, 0.16, HOT);
  b.box(0, 0, 0, 0.16, 1.9, 0.16, HOT);
  b.box(0, 0, -0.3, 0.5, 0.5, 1.1, CORE);
  // The bloom grows (v16): longer arms, a fatter core and four
  // diagonal sparklets thrown off the star — a muzzle flash that
  // reads at chase distance instead of winking at the nose.
  b.box(0, 0, 0, 2.7, 0.11, 0.11, HOT);
  b.box(0, 0, 0, 0.11, 2.7, 0.11, HOT);
  b.box(0, 0, -0.3, 0.68, 0.68, 1.5, CORE);
  for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    b.box(sx * 0.85, sy * 0.85, -0.1, 0.30, 0.30, 0.30, HOT);
  }
  return R.makeMesh(b);
}

// A beam's model matrix: the unit cube laid along the segment a→b,
// `thick` across and |b−a| long, centred on the segment's midpoint.
export function beamM(a, b, thick) {
  const d = sub3(b, a);
  const len = Math.hypot(d[0], d[1], d[2]) || 1;
  const z = [d[0] / len, d[1] / len, d[2] / len];
  let x = cross3([0, 1, 0], z);
  const xl = Math.hypot(x[0], x[1], x[2]);
  x = xl < 1e-4 ? [1, 0, 0] : [x[0] / xl, x[1] / xl, x[2] / xl];
  const y = cross3(z, x);
  return new Float32Array([
    x[0] * thick, x[1] * thick, x[2] * thick, 0,
    y[0] * thick, y[1] * thick, y[2] * thick, 0,
    z[0] * len, z[1] * len, z[2] * len, 0,
    (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, 1,
  ]);
}

// ---- small living-world props (v13), drawn dynamic by the scene ----
// A bird: two wing quads and a body sliver — a suggestion at distance,
// flapped by rolling the whole mesh as it circles its thermal.
export function buildBird(R) {
  const b = new Builder();
  const C = [0.20, 0.18, 0.20];
  b.quad([-1.5, 0, -0.25], [0, 0.12, 0], [0, 0.12, 0.35], [-1.5, 0, 0.45], C);
  b.quad([0, 0.12, 0], [1.5, 0, -0.25], [1.5, 0, 0.45], [0, 0.12, 0.35], C);
  b.box(0, 0, 0.05, 0.22, 0.16, 1.1, C);
  return R.makeMesh(b);
}
// The tower beacon: one emissive cube, blinked by the scene's alpha.
export function buildBeacon(R) {
  const b = new Builder();
  b.box(0, 0, 0, 0.62, 0.62, 0.62, [2.6, 0.40, 0.32]);
  return R.makeMesh(b);
}
// The smuggler drone (v15, SKY PATROL): a dark quadcopter built to read
// as a machine, not a blob — a faceted carbon pod with hazard chevrons,
// four arms with motor bells and spinning rotor discs, a gimbal camera
// eye slung under the nose, and a red beacon bar that blinks it alive.
// The rotors are their own mesh so the scene can spin them at speed.
// Colours stay near-black with orange hazard trim: it should look like
// something that does not want to be seen, flown by someone in a hurry.
export function buildDrone(R) {
  const body = new Builder();
  const CARBON = [0.10, 0.11, 0.13], CARBON2 = [0.16, 0.17, 0.20];
  // The hazard trim runs fully saturated now (v15.1): at hunting range
  // the airframe is a dark speck by design, and the orange is the one
  // thing on it that must still shout.
  const HAZARD = [1.0, 0.36, 0.02], EYE = [0.25, 0.75, 0.95];
  // The pod: a tapered hull, a domed top shell, and a darker belly pan.
  body.box(0, 0, 0, 0.95, 0.42, 1.7, CARBON);
  body.box(0, 0.30, -0.1, 0.7, 0.22, 1.1, CARBON2);
  body.box(0, -0.28, 0.1, 0.8, 0.14, 1.3, [0.06, 0.07, 0.08]);
  // Hazard chevrons across the top shell — the one loud thing on it.
  body.box(-0.18, 0.43, -0.35, 0.20, 0.03, 0.30, HAZARD);
  body.box(0.18, 0.43, -0.35, 0.20, 0.03, 0.30, HAZARD);
  body.box(-0.18, 0.43, 0.25, 0.20, 0.03, 0.30, HAZARD);
  body.box(0.18, 0.43, 0.25, 0.20, 0.03, 0.30, HAZARD);
  // The gimbal eye under the nose, and the beacon bar across the tail.
  body.box(0, -0.42, -0.62, 0.30, 0.26, 0.30, CARBON2);
  body.box(0, -0.44, -0.80, 0.16, 0.14, 0.06, EYE);
  body.box(0, 0.12, 0.92, 0.62, 0.12, 0.10, [2.4, 0.35, 0.30]);
  // Four arms on the diagonal, motor bells at their tips, skids below.
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    body.box(sx * 0.72, 0.10, sz * 0.72, 0.95, 0.12, 0.20, CARBON);
    body.box(sx * 1.12, 0.20, sz * 1.12, 0.30, 0.24, 0.30, CARBON2);
    body.box(sx * 0.55, -0.52, sz * 0.30, 0.08, 0.55, 0.08, CARBON2);
  }
  body.box(0, -0.80, 0, 1.45, 0.07, 0.16, CARBON2);
  const rotors = new Builder();
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    rotors.disc(sx * 1.12, 0.36, sz * 1.12, 0.62, 10, [0.55, 0.58, 0.62]);
  }
  // The strobe (v15.1): a white bulb on the pod's crown and a red one
  // under the tail, colours pushed far past 1.0 like the tower beacon.
  // They are their own mesh because the scene blinks them by alpha —
  // a double flash a second, the one light a smuggler cannot switch
  // off, readable at hunting range day and night.
  const strobe = new Builder();
  strobe.box(0, 0.52, -0.1, 0.34, 0.30, 0.34, [3.4, 3.4, 3.2]);
  strobe.box(0, -0.18, 0.95, 0.30, 0.26, 0.30, [3.4, 0.35, 0.28]);
  return { body: R.makeMesh(body), rotors: R.makeMesh(rotors), strobe: R.makeMesh(strobe) };
}
// The terminal flag: an Indonesian red-over-white on its pole, waved by
// the scene rocking it on its hoist.
export function buildFlag(R) {
  const b = new Builder();
  b.box(0, 4.5, 0, 0.14, 9, 0.14, [0.55, 0.56, 0.60]);
  b.quad([0.07, 9.0, 0], [0.07, 9.0, 2.6], [0.07, 8.05, 2.6], [0.07, 8.05, 0], [0.82, 0.16, 0.14]);
  b.quad([0.07, 8.05, 0], [0.07, 8.05, 2.6], [0.07, 7.1, 2.6], [0.07, 7.1, 0], [0.94, 0.93, 0.90]);
  return R.makeMesh(b);
}
// A service van with lit headlamps, driven around the apron by the scene.
export function buildVan(R) {
  const b = new Builder();
  b.box(0, 0.85, 0, 2.1, 1.7, 4.8, [0.85, 0.83, 0.78]);
  b.box(0, 1.15, -3.1, 1.9, 0.9, 1.4, [0.30, 0.36, 0.42]);
  b.box(-0.7, 0.75, -3.85, 0.45, 0.3, 0.1, [2.2, 1.9, 1.2]);
  b.box(0.7, 0.75, -3.85, 0.45, 0.3, 0.1, [2.2, 1.9, 1.2]);
  return R.makeMesh(b);
}
// The windsock's cone alone: the pole is baked into the runway mesh;
// the scene hangs this cone on it and lets the wind swing and lift it.
// Built pointing +X (length along X, rings in the YZ plane) so a Z
// rotation droops it and a Y rotation swings it downwind.
export function buildSock(R) {
  const b = new Builder();
  const SEG = 8;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
    b.quad([0, Math.cos(a0) * 0.55, Math.sin(a0) * 0.55], [0, Math.cos(a1) * 0.55, Math.sin(a1) * 0.55],
      [1.7, Math.cos(a1) * 0.16, Math.sin(a1) * 0.16], [1.7, Math.cos(a0) * 0.16, Math.sin(a0) * 0.16],
      i % 2 ? [0.95, 0.93, 0.88] : [0.98, 0.48, 0.12]);
  }
  return R.makeMesh(b);
}

// The finale jet (v13): a wide-body airliner in an Emirates-inspired
// livery — white fuselage, a gold cheatline, and a tail wearing the
// UAE flag's green, red and black (inspired-by; no brand marks). She is
// built at true airliner size next to the floatplanes: a ~26 m fuselage
// on a ~24 m wing, four engines under the wing, a double-deck nose hump.
// Same low-poly language as the fleet — shaped prisms, flat facets.
export function buildJet(R) {
  const b = new Builder();
  const WHITE = [0.94, 0.94, 0.93], GOLD = [0.85, 0.65, 0.25], BELLY = [0.82, 0.82, 0.80];
  const DARKWIN = [0.10, 0.14, 0.20];
  const cy = 2.5; // fuselage centre height (gear bottoms rest at the -0.62 keel line)
  // Fuselage: nose at -Z, eight sections swelling to a constant tube.
  seg2(b, -13.2, 0.4, 0.4, cy - 0.3, -11.8, 1.9, 2.0, cy - 0.1, WHITE);
  seg2(b, -11.8, 1.9, 2.0, cy - 0.1, -9.6, 3.1, 3.3, cy + 0.15, WHITE);
  seg2(b, -9.6, 3.1, 3.3, cy + 0.15, -6.0, 3.9, 4.1, cy + 0.3, WHITE);
  seg2(b, -6.0, 3.9, 4.1, cy + 0.3, 4.5, 4.1, 4.3, cy + 0.3, WHITE);
  seg2(b, 4.5, 4.1, 4.3, cy + 0.3, 8.6, 3.6, 3.9, cy + 0.55, WHITE);
  seg2(b, 8.6, 3.6, 3.9, cy + 0.55, 11.6, 2.2, 2.6, cy + 1.15, WHITE);
  seg2(b, 11.6, 2.2, 2.6, cy + 1.15, 13.4, 0.7, 1.1, cy + 1.75, WHITE);
  // The double-deck hump: a long fairing over the forward crown.
  seg2(b, -11.4, 1.7, 1.1, cy + 1.85, -5.4, 2.6, 1.5, cy + 2.15, WHITE);
  // Cockpit glass: a dark band wrapped over the nose.
  seg2(b, -12.15, 2.05, 0.85, cy + 0.95, -10.9, 2.5, 0.95, cy + 1.05, DARKWIN);
  // The window band: a long dark strip each side, and the gold cheatline
  // running the fuselage's whole length beneath it.
  for (const sx of [-1, 1]) {
    b.box(sx * 2.03, cy + 0.95, -0.6, 0.05, 0.62, 17.5, DARKWIN);
    b.box(sx * 2.04, cy + 0.28, -0.4, 0.05, 0.42, 19.5, GOLD);
    b.box(sx * 1.55, cy + 1.9, 9.9, 0.04, 0.5, 2.6, GOLD); // gold sweeps up the tail cone
  }
  b.box(0, cy - 2.02, -0.4, 3.6, 0.18, 19.0, BELLY); // belly fairing line
  // Wing: one great swept wing per side, two sections, gold-tipped.
  for (const sx of [-1, 1]) {
    segX(b, sx * 1.2, 5.6, 0.55, cy - 1.15, 0.8, sx * 7.2, 3.6, 0.38, cy - 0.75, 2.6, WHITE);
    segX(b, sx * 7.2, 3.6, 0.38, cy - 0.75, 2.6, sx * 12.2, 1.9, 0.26, cy - 0.30, 4.3, WHITE);
    b.box(sx * 12.35, cy + 0.25, 4.45, 0.14, 1.15, 1.5, GOLD); // winglet
    // Four engines in all, two a side slung under the wing — big
    // nacelles, dark intakes, gold lips.
    for (const [ex, ez] of [[3.8, 1.0], [7.6, 2.6]]) {
      b.box(sx * ex, cy - 2.0, ez - 0.6, 1.5, 1.5, 3.6, WHITE);
      discXY(b, sx * ex, cy - 2.0, ez - 2.42, 0.68, 10, [0.06, 0.07, 0.09]);
      b.box(sx * ex, cy - 1.18, ez - 0.6, 1.55, 0.16, 3.6, GOLD);
    }
  }
  // Tailplane: swept, at the upswept cone's base.
  for (const sx of [-1, 1]) {
    segX(b, 0, 2.6, 0.3, cy + 1.35, 10.6, sx * 4.6, 1.6, 0.22, cy + 1.55, 11.4, WHITE);
    segX(b, sx * 4.6, 1.6, 0.22, cy + 1.55, 11.4, sx * 6.4, 1.0, 0.16, cy + 1.70, 12.0, GOLD);
  }
  // The fin: tall, and wearing the flag — green at the leading top,
  // red through the middle, black at the trailing base, on white.
  b.frustum(0, cy + 4.6, 10.9, 0.34, 5.6, 4.4, 0.45, WHITE);
  for (const sx of [-1, 1]) {
    b.box(sx * 0.19, cy + 6.35, 10.15, 0.03, 1.55, 1.9, [0.10, 0.48, 0.28]); // green
    b.box(sx * 0.19, cy + 5.30, 10.95, 0.03, 1.30, 2.6, [0.78, 0.14, 0.16]); // red
    b.box(sx * 0.19, cy + 3.95, 11.95, 0.03, 1.15, 1.7, [0.08, 0.08, 0.09]); // black
  }
  // Gear (v18): a real tricycle where the early builds suggested
  // bogies with plain boxes — a nose strut carrying twin wheels,
  // and two main bogies, each a beam on two axles of twin wheels.
  // Every sole rests on the fleet ground line −0.62.
  const JTYRE = [0.13, 0.12, 0.11];
  beam(b, [0, 0.48, -8.6], [0, -0.30, -8.6], 0.16, METAL); // nose strut
  b.box(-0.14, -0.44, -8.6, 0.16, 0.36, 0.36, JTYRE); // nose wheel, port
  b.box(0.14, -0.44, -8.6, 0.16, 0.36, 0.36, JTYRE); // nose wheel, starboard
  for (const sx of [-1.15, 1.15]) {
    beam(b, [sx, 0.48, 1.4], [sx, -0.18, 1.4], 0.20, METAL); // main strut
    b.box(sx, -0.20, 1.4, 0.14, 0.10, 1.70, METAL); // bogie beam
    for (const az of [0.85, 1.95]) {
      b.box(sx - 0.15, -0.43, az, 0.15, 0.38, 0.38, JTYRE); // twin wheel, inboard
      b.box(sx + 0.15, -0.43, az, 0.15, 0.38, 0.38, JTYRE); // twin wheel, outboard
    }
  }
  // Detailing (v14): a wing-root fairing, a nose-gear door, the APU
  // exhaust at the tail cone and a darker radome tip. The cues that
  // separate an airliner from a white tube at dossier distance.
  // (The window panes that began here are v18's now — one unbroken
  // line of twenty-one a side, in the block below.)
  for (const sx of [-1, 1]) {
    b.box(sx * 2.6, 1.05, 0.6, 3.2, 0.5, 4.2, WHITE); // wing-root fairing
  }
  b.box(0, 0.42, -8.6, 0.62, 0.22, 1.7, [0.88, 0.88, 0.90]); // nose gear door
  b.box(0, cy + 1.6, 13.15, 0.4, 0.32, 0.45, [0.25, 0.24, 0.26]); // APU exhaust
  b.box(0, cy - 0.3, -13.35, 0.52, 0.52, 0.4, [0.30, 0.30, 0.34]); // radome tip
  // Detailing (v16, extended v18): the flagship finished to
  // airliner standard. Intake lip rings and spinner dots (v16),
  // flap-track canoes, the registration micro-barred on the tail
  // cone — and the v18 window and door work: TWENTY-ONE panes a
  // side on the main deck (her 180 seats made visible — the v14/
  // v16 loops drew fifteen boxes over eleven stations), six small
  // panes on the upper deck placed on the hump's own crown line,
  // and THREE doors a side, their slabs recessed a hair under the
  // pane line so the windows read over them.
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 21; i++) b.box(sx * 2.06, cy + 0.95, -8.3 + i * 0.83, 0.06, 0.34, 0.52, [0.85, 0.92, 1.05]); // main-deck panes
    for (let i = 0; i < 6; i++) {
      const uz = -10.2 + i * 0.9, t = (uz + 11.4) / 6;
      b.box(sx * (0.855 + 0.45 * t), cy + 2.02 + 0.50 * t, uz, 0.05, 0.26, 0.42, [0.85, 0.92, 1.05]); // upper-deck pane, on the crown
    }
    for (const dz of [-9.4, -0.6, 8.8]) {
      b.box(sx * 2.02, cy + 0.30, dz, 0.05, 1.55, 0.85, [0.84, 0.84, 0.86]); // door slab
      b.box(sx * 2.05, cy + 0.78, dz, 0.04, 0.30, 0.40, [0.85, 0.92, 1.05]); // its window
    }
    for (const [ex, ez] of [[3.8, 1.0], [7.6, 2.6]]) {
      ringXY(b, sx * ex, cy - 2.0, ez - 2.44, 0.50, 0.66, 12, [0.38, 0.41, 0.46]); // intake lip ring
      discXY(b, sx * ex, cy - 2.0, ez - 2.44, 0.17, 10, [0.55, 0.58, 0.63]); // fan spinner
    }
    for (const [fx, fz] of [[5.5, 3.6], [7.5, 3.9], [9.5, 4.4]]) {
      b.box(sx * fx, cy - 1.02, fz, 0.28, 0.22, 1.25, WHITE); // flap-track canoe
    }
    for (let i = 0; i < 5; i++) b.box(sx * 1.38, cy + 1.30, 10.35 + i * 0.15, 0.03, 0.20, 0.07, [0.30, 0.28, 0.30]); // registration bars
  }
  // The crown furniture (v18): a satcom dome fairing over the main
  // cabin and two antenna blades along the tail cone — the roofline
  // a bare white tube is missing.
  b.frustum(0, cy + 2.62, -1.5, 1.5, 0.5, 2.6, 0.55, WHITE); // satcom dome
  b.frustum(0, cy + 2.45, 6.5, 0.08, 0.7, 0.9, 0.4, WHITE); // tail antenna blade, forward
  b.frustum(0, cy + 2.45, 9.0, 0.08, 0.6, 0.8, 0.4, WHITE); // tail antenna blade, aft
  const plane = R.makeMesh(b);
  // No propeller: an empty mesh keeps the scene's prop draws harmless.
  const empty = R.makeMesh(new Builder());
  return { plane, prop: empty, disc: empty };
}

// The RAKSASA's fan blur for the hangar preview: a pale translucent
// disc with two crossed blade streaks, spun per intake. Built once,
// drawn four times; the flight scene never uses it (her fans are the
// dark intake faces already in the airframe mesh).
export function buildJetFanBlur(R) {
  const b = new Builder();
  discXY(b, 0, 0, 0, 0.62, 14, [0.78, 0.86, 0.96]);
  b.box(0, 0, 0.012, 1.16, 0.13, 0.02, [0.45, 0.52, 0.62]);
  b.box(0, 0, 0.012, 0.13, 1.16, 0.02, [0.45, 0.52, 0.62]);
  return R.makeMesh(b);
}
// island meshes so every shore carries its settlement.
function house(b, x, z, s, rnd, y0 = 0) {
  const wall = [0.90, 0.82, 0.66], roof = [0.60 + rnd() * 0.15, 0.24, 0.13];
  const v = rnd();
  if (v < 0.22) {
    // The shop: a flat canopy awning over a wide lit front — the
    // settlement's one commercial silhouette among the homes.
    b.box(x, y0 + 1.15 * s, z, 3.6 * s, 2.3 * s, 2.8 * s, wall);
    b.box(x, y0 + 2.42 * s, z, 3.9 * s, 0.22 * s, 3.1 * s, [0.45, 0.38, 0.32]);
    b.box(x, y0 + 1.95 * s, z - 1.75 * s, 3.8 * s, 0.14 * s, 1.15 * s, roof); // awning
    b.box(x - 0.7 * s, y0 + 1.15 * s, z - 1.44 * s, 1.7 * s, 1.1 * s, 0.1, [1.30, 1.02, 0.50]); // lit shopfront
    b.box(x + 1.15 * s, y0 + 0.8 * s, z - 1.45 * s, 0.8 * s, 1.6 * s, 0.15, [0.3, 0.2, 0.14]);
    return;
  }
  if (v < 0.48) {
    // The two-storey variant: taller walls, a flat slab roof with a
    // parapet lip, and a lit window on each floor.
    b.box(x, y0 + 1.7 * s, z, 3.2 * s, 3.4 * s, 2.8 * s, wall);
    b.box(x, y0 + 3.5 * s, z, 3.7 * s, 0.25 * s, 3.3 * s, [0.45, 0.38, 0.32]);
    b.box(x, y0 + 0.8 * s, z - 1.45 * s, 0.8 * s, 1.6 * s, 0.15, [0.3, 0.2, 0.14]);
    b.box(x + 0.9 * s, y0 + 1.1 * s, z - 1.44 * s, 0.55 * s, 0.6 * s, 0.1, [1.30, 1.02, 0.50]);
    b.box(x - 0.9 * s, y0 + 2.6 * s, z - 1.44 * s, 0.55 * s, 0.6 * s, 0.1, [1.30, 1.02, 0.50]);
    return;
  }
  b.box(x, y0 + 1.1 * s, z, 3.4 * s, 2.2 * s, 2.8 * s, wall);
  b.frustum(x, y0 + 2.9 * s, z, 4.3 * s, 1.4 * s, 3.7 * s, 0.12, roof); // hip roof, aligned with the walls
  b.box(x, y0 + 0.8 * s, z - 1.45 * s, 0.8 * s, 1.6 * s, 0.15, [0.3, 0.2, 0.14]);
  b.box(x + 0.95 * s, y0 + 1.25 * s, z - 1.44 * s, 0.55 * s, 0.6 * s, 0.1, [1.30, 1.02, 0.50]); // lit window
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
      v: i % 3, // three silhouettes alternate down the route
    });
  }
  return out;
}
// Baked cloud shading: sunlit crowns, cooler shadowed undersides — the
// lit shader multiplies these by the phase light, so a cloud at senja
// glows amber on top and sinks violet below without any keyframe change.
const CLOUD_SHADE = { top: [1.24, 1.19, 1.11], bottom: [0.68, 0.74, 0.84] };
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
  b.box(-3.4, 1.9, 1.8, 4.6, 1.5, 3.6, W, CLOUD_SHADE); // a second crown shoulder
  b.box(5.9, 2.6, 1.2, 3.8, 1.3, 3.0, W, CLOUD_SHADE);
  b.box(-14.5, -0.5, 2.2, 3.2, 0.7, 2.4, W, CLOUD_SHADE); // a detached fragment, trailing low (v14)
  b.box(-1.2, 4.15, -0.4, 2.6, 1.1, 2.4, W, CLOUD_SHADE); // the crown's dome (v16): the puff tops out round, not flat
  b.box(3.4, 0.45, -3.4, 4.4, 0.9, 2.2, W, CLOUD_SHADE); // a low skirt trailing off the back (v16)
  return R.makeMesh(b);
}
export function buildCloudC(R) {
  const b = new Builder();
  const W = [1.03, 1.00, 0.97];
  // The shelf (v12): a stratocumulus deck — broad, layered, long in the
  // wind — so the route's sky varies in kind: towers, puffs and shelves.
  b.box(0, 0, 0, 30, 1.3, 8.5, W, CLOUD_SHADE);
  b.box(-7.5, 0.85, 0.5, 13, 1.1, 6.5, W, CLOUD_SHADE);
  b.box(8.0, 0.8, -0.5, 12, 1.1, 6.0, W, CLOUD_SHADE);
  b.box(0.5, 1.55, 0, 10, 0.9, 5.0, W, CLOUD_SHADE);
  b.box(-16.5, 0.35, -0.8, 7.5, 0.8, 5.0, W, CLOUD_SHADE);
  b.box(17.0, 0.3, 0.8, 7.0, 0.8, 4.6, W, CLOUD_SHADE);
  b.box(3.5, -0.8, 1.5, 16, 0.6, 5.5, W, CLOUD_SHADE); // a lower shelf layer, offset in the wind (v14)
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
  b.box(9.5, 2.8, -1.5, 3.0, 1.0, 2.6, W, CLOUD_SHADE); // a satellite turret, breaking away (v14)
  b.box(-0.1, 5.55, -0.3, 2.4, 0.9, 2.2, W, CLOUD_SHADE); // the turret's cap (v16)
  b.box(-3.1, 4.05, 1.4, 2.6, 1.0, 2.2, W, CLOUD_SHADE); // a shoulder boiling off the stack (v16)
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
  const FACE = [0.05, 0.06, 0.075], RIM = [0.52, 0.49, 0.44], TICK = [1.10, 1.04, 0.86];
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
    for (let k = 0; k <= 8; k++) { const major = k % 4 === 0; tickXY(fb, g.x, g.y, fz + 0.002, g.r * (major ? 0.66 : 0.74), (0.75 - 1.5 * (k / 8)) * Math.PI, g.r * (major ? 0.30 : 0.19), major ? 0.013 : 0.008, TICK); }
    discXY(fb, g.x, g.y, fz + 0.004, 0.028, 12, RIM);
  }
  // The radar scope: a dark green face, a glowing rim and range ring,
  // cross hairs, and the own-ship wedge at its heart. Blips are separate.
  discXY(fb, RADAR.x, RADAR.y, RADAR.z, RADAR.r, 28, [0.08, 0.22, 0.13]);
  ringXY(fb, RADAR.x, RADAR.y, RADAR.z, RADAR.r - 0.016, RADAR.r + 0.004, 28, [0.35, 1.15, 0.55]);
  ringXY(fb, RADAR.x, RADAR.y, RADAR.z, RADAR.r * 0.52 - 0.006, RADAR.r * 0.52 + 0.006, 28, [0.32, 0.98, 0.50]);
  fb.quad([RADAR.x - RADAR.r, RADAR.y - 0.004, RADAR.z + 0.002], [RADAR.x + RADAR.r, RADAR.y - 0.004, RADAR.z + 0.002], [RADAR.x + RADAR.r, RADAR.y + 0.004, RADAR.z + 0.002], [RADAR.x - RADAR.r, RADAR.y + 0.004, RADAR.z + 0.002], [0.32, 0.98, 0.50]);
  fb.quad([RADAR.x - 0.004, RADAR.y - RADAR.r, RADAR.z + 0.002], [RADAR.x + 0.004, RADAR.y - RADAR.r, RADAR.z + 0.002], [RADAR.x + 0.004, RADAR.y + RADAR.r, RADAR.z + 0.002], [RADAR.x - 0.004, RADAR.y + RADAR.r, RADAR.z + 0.002], [0.32, 0.98, 0.50]);
  fb.tri([RADAR.x, RADAR.y + 0.055, RADAR.z + 0.004], [RADAR.x + 0.042, RADAR.y - 0.038, RADAR.z + 0.004], [RADAR.x - 0.042, RADAR.y - 0.038, RADAR.z + 0.004], [1.45, 1.28, 0.95]);
  fb.box(RADAR.x, RADAR.y + RADAR.r + 0.035, RADAR.z, 0.05, 0.05, 0.02, [1.45, 1.28, 0.95]); // the N tick
  const frame = R.makeMesh(fb);
  // One needle, built pointing up from its hub: the scene rotates it per
  // gauge per frame from cockpit.js readings.
  const nb = new Builder();
  nb.box(0, 0.105, 0, 0.046, 0.25, 0.018, [1.55, 1.42, 1.08]);
  nb.box(0, -0.045, 0, 0.05, 0.07, 0.018, [0.90, 0.30, 0.20]);
  const needle = R.makeMesh(nb);
  // Scope blips: the destination in warm cream, the next ring in gold.
  const bd = new Builder(); discXY(bd, 0, 0, 0, 0.052, 12, [1.50, 1.35, 1.05]); ringXY(bd, 0, 0, 0, 0.064, 0.078, 14, [0.85, 0.74, 0.52]);
  const br = new Builder(); discXY(br, 0, 0, 0, 0.060, 12, [2.20, 1.70, 0.50]);
  // A patrol contact (v15.1): a small hot-red disc, the scope's one
  // hostile colour — a drone on the glass is a drone she can hunt.
  const bx = new Builder(); discXY(bx, 0, 0, 0, 0.046, 10, [2.60, 0.50, 0.35]);
  // The canopy glass: tinted panes from the layout, plus one brighter
  // reflection streak laid diagonally across the front pane.
  const gb = new Builder();
  for (const pane of GLASS_PANES) gb.quad(pane[0], pane[1], pane[2], pane[3], [0.55, 0.70, 0.82]);
  const glass = R.makeMesh(gb);
  const sb = new Builder();
  sb.quad([0.30, 1.30, -2.83], [0.88, 1.30, -2.83], [0.12, -0.46, -2.83], [-0.42, -0.46, -2.83], [1.15, 1.20, 1.25]);
  // A second, thinner streak low on the front pane and a short one on
  // the left pane: real canopy glass never reflects in just one place.
  sb.quad([-0.62, 0.28, -2.83], [-0.10, 0.28, -2.83], [-0.30, -0.10, -2.83], [-0.80, -0.10, -2.83], [1.05, 1.10, 1.16]);
  sb.quad([-2.44, 0.55, -1.50], [-1.95, 0.72, -2.35], [-1.80, 0.10, -2.45], [-2.30, -0.05, -1.55], [1.05, 1.10, 1.16]);
  // Gauge glints (v16): a soft diagonal sheen across the upper face
  // of every dial, riding the streak mesh's translucency — glass
  // over the instruments, not just over the view. The needle hub
  // sits a hair prouder (PANEL.z + 0.035), so the sheen never
  // covers the reading.
  for (const g of GAUGES) {
    sb.quad([g.x - g.r * 0.58, g.y + g.r * 0.60, fz + 0.006], [g.x + g.r * 0.28, g.y + g.r * 0.60, fz + 0.006],
      [g.x - g.r * 0.02, g.y + g.r * 0.02, fz + 0.006], [g.x - g.r * 0.84, g.y + g.r * 0.02, fz + 0.006], [1.10, 1.16, 1.22]);
  }
  const streak = R.makeMesh(sb);
  // The radar sweep (v16): a pale green wedge the scene rotates
  // around the scope — a working radar breathes, and a still scope
  // read as a sticker next to four live needles.
  const swb = new Builder();
  swb.tri([0, 0, 0], [0, RADAR.r * 0.96, 0], [RADAR.r * 0.32, RADAR.r * 0.90, 0], [0.40, 1.25, 0.62]);
  const sweep = R.makeMesh(swb);
  return { frame, needle, blipDest: R.makeMesh(bd), blipRing: R.makeMesh(br), blipDrone: R.makeMesh(bx), glass, streak, sweep };
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
  if (ck.sweep) R.draw(ck.sweep, M4.compose(RADAR.x, RADAR.y, RADAR.z + 0.006, 0, 0, -(st.time || 0) * 0.9), 0.50);
  const bl = radarBlips(st);
  R.draw(ck.blipDest, M4.compose(RADAR.x + bl.dest.nx * RADAR.r, RADAR.y + bl.dest.ny * RADAR.r, RADAR.z + 0.010, 0, 0, 0));
  if (bl.ring) R.draw(ck.blipRing, M4.compose(RADAR.x + bl.ring.nx * RADAR.r, RADAR.y + bl.ring.ny * RADAR.r, RADAR.z + 0.012, 0, 0, 0));
  if (ck.blipDrone && bl.drones) for (const db of bl.drones) {
    R.draw(ck.blipDrone, M4.compose(RADAR.x + db.nx * RADAR.r, RADAR.y + db.ny * RADAR.r, RADAR.z + 0.014, 0, 0, 0));
  }
  R.draw(ck.glass, M4.ident(), 0.16);
  R.draw(ck.streak, M4.ident(), 0.17);
}

// The scene keeps a spring-smoothed chase camera so the plane eases through
// the frame instead of snapping with every input twitch.
export function createScene(R, assets) {
  const cam = { x: 0, alt: 6 };
  const projCache = { aspect: 0, m: null };
  let cloudCache = { leg: -1, field: [] };
  let seaCache = { leg: -1, land: null };
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
    // Free-look (v12): the pilot's head turns inside the frame the
    // camera mode built — yaw the full circle, pitch to a neck's reach.
    // Only the VIEW moves; the plane's course, heading and controls are
    // untouched, and the cockpit overlay below is drawn in camera space,
    // so the panel stays bolted to the plane while the eyes wander.
    const lookYaw = st.lookYaw || 0, lookPitch = st.lookPitch || 0;
    if (st.camMode === 'cockpit') {
      // Over the nose: the camera sits in the pilot's seat — no spring lag,
      // the world answers the controls directly. The seat is the
      // airframe's own (v13): the flagship's deck sits far forward.
      eye = [st.x, st.alt + (st.seatY ?? 2.52), pz + (st.seatZ ?? -0.4)];
      target = [st.x - st.bank * 3, st.alt + 1.15 + st.pitchVis * 6, pz - 40];
      cam.x = st.x * 0.84; cam.alt = st.alt + 5.4; // keep the chase spring warm
      if (lookYaw || lookPitch) {
        let d = norm3(sub3(target, eye));
        const cy = Math.cos(lookYaw), sy = Math.sin(lookYaw);
        d = [d[0] * cy + d[2] * sy, d[1], -d[0] * sy + d[2] * cy];
        const r = norm3(cross3(d, [0, 1, 0]));
        const cp = Math.cos(lookPitch), sp = Math.sin(lookPitch);
        const rxd = cross3(r, d);
        d = [d[0] * cp + rxd[0] * sp, d[1] * cp + rxd[1] * sp, d[2] * cp + rxd[2] * sp];
        target = [eye[0] + d[0] * 40, eye[1] + d[1] * 40, eye[2] + d[2] * 40];
      }
    } else {
      // The boom scales with the airframe (v13): the flagship is nearly
      // four times the seaplanes' length, and a seaplane's camera distance
      // puts the eye inside her tail.
      const cm = st.camMul || 1;
      const back = (st.camMode === 'far' ? 30 : (st.camBack || 16.5)) * cm;
      const up = st.camMode === 'far' ? 4.5 : (st.camUp || 0);
      cam.x = lerp(cam.x, st.x * 0.84, 0.06);
      cam.alt = lerp(cam.alt, st.alt + 5.4 * cm, 0.08);
      eye = [cam.x, cam.alt + up, pz + back];
      // The aim point rides above the plane (she sits low in frame) and swings
      // with her pitch, so pitching visibly tilts the horizon and the sea.
      target = [st.x * 0.94 - st.bank * 2.2, st.alt + (st.aimDy ?? 2.4) + st.pitchVis * 5.5, pz - 30];
      if (lookYaw || lookPitch) {
        // The camera swings around the plane on its own boom: the eye
        // orbits the airframe, the aim stays on her.
        const anchor = [st.x, st.alt + 0.62, pz];
        let off = sub3(eye, anchor);
        const cy = Math.cos(lookYaw), sy = Math.sin(lookYaw);
        off = [off[0] * cy + off[2] * sy, off[1], -off[0] * sy + off[2] * cy];
        const ax = norm3(cross3([0, 1, 0], off));
        const pa = lookPitch * 0.7, cp = Math.cos(pa), sp = Math.sin(pa);
        const axo = cross3(ax, off);
        off = [off[0] * cp + axo[0] * sp, off[1] * cp + axo[1] * sp, off[2] * cp + axo[2] * sp];
        eye = [anchor[0] + off[0], anchor[1] + off[1], anchor[2] + off[2]];
        target = anchor;
      }
    }
    // Camera shake (v13): a fresh explosion nearby rocks the frame —
    // the boom's first two-thirds of a second only, decaying fast.
    if (st.boom && st.boom.age < 0.7) {
      const amp = (0.7 - st.boom.age) * 1.15;
      eye = [eye[0] + Math.sin(st.time * 47) * amp * 0.35,
        eye[1] + Math.sin(st.time * 39 + 1) * amp * 0.28, eye[2]];
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
    R.draw(assets.isleDest, M4.compose(0, 0, -st.legDist - 72, 0, 0, 0, 1.35));
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
    // The home airport (v13): the same complex the destination wears,
    // standing beside the departure strip's near end — visible down the
    // right side during the roll and in every look back over the field.
    if (assets.airport && st.dist < 1000) {
      R.draw(assets.airport, M4.compose(4, 0, 88, 0, 0, 0));
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
    // Airport buildings at the destination runway's far end, and the
    // home twin beside the departure strip (drawn above).
    if (st.legDist - st.dist < 1400) R.draw(assets.airport, M4.compose(0, 0, -st.legDist - 14, 0, 0, 0));
    // Living props at both airports (v13): the tower beacon blinks, the
    // terminal flag stirs, and a service van works its apron loop.
    drawAirportLife(R, assets, st, [4, 0, 88], st.dist < 1000);
    drawAirportLife(R, assets, st, [0, 0, -st.legDist - 14], st.legDist - st.dist < 1400);
    // The sea comes AFTER the opaque world (v11 reorder): it follows the
    // camera in whole cells so the glitter never swims, and wherever
    // land, strips or buildings already wrote depth, its fragments are
    // rejected instead of shaded-then-covered — the v11 terrain made the
    // old sea-first order shade the same pixels two and three times.
    const snap = assets.sea.cell;
    const origin = [Math.round(eye[0] / snap) * snap, 0, Math.round(eye[2] / snap) * snap];
    // The sea respects the land (v13): the shoreline mask for this leg,
    // rebuilt when the leg changes, and whitecaps while the weather is
    // rough. Inside the mask the swell dies and sinks — waves belong
    // to the water, never to the field.
    if (seaCache.leg !== st.legDist) seaCache = { leg: st.legDist, land: seaLandCircles(st.legDist) };
    const caps = st.env && st.env.state === 'storm' ? 1 : st.env && st.env.state === 'rain' ? 0.5
      : st.env && st.env.state === 'overcast' ? 0.18 : 0;
    R.drawSea(assets.sea.mesh, origin, st.time, { land: seaCache.land, caps });
    // The shallow shelves (v11) blend over the sea around both islands;
    // drawn in the transparent phase, the parts tucked under the terrain
    // fail the depth test against it and cost nothing. Each shore wears
    // its OWN shelf shape (v13).
    if (assets.shallows && st.dist < 1000) {
      R.draw(assets.shallows, M4.compose(0, 0, 0, 0, 0, 0), 0.35);
    }
    if (assets.destShallows && st.legDist - st.dist < 1600) {
      R.draw(assets.destShallows, M4.compose(0, 0, -st.legDist - 72, 0, 0, 0), 0.35);
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
      const cm = c.v === 2 && assets.cloudC ? assets.cloudC : (c.v === 1 && assets.cloudB ? assets.cloudB : assets.cloud);
      R.draw(cm, M4.compose(c.x, c.y, c.z, 0, 0, 0, c.s), 0.88);
    }
    // The mission marks (v12): the rescue boat waits at her point with a
    // lantern and a pale pickup ring on the water; the survey gate
    // stands at its own point until the camera has fired through it.
    if (st.pickup && assets.boat) {
      R.draw(assets.boat, M4.compose(st.pickup.x, 0, -st.pickup.dist, 0, 0.7, 0));
    }
    // Ambient sea traffic (v13): two launches working the lanes across
    // the route, slow enough to read as life, far enough to never matter.
    if (assets.boat) {
      const b1x = -130 + ((st.time * 3.1) % 260), b1z = -st.legDist * 0.32;
      if (Math.abs(b1z - pz) < 1300) R.draw(assets.boat, M4.compose(b1x, 0, b1z, 0, Math.PI / 2, 0));
      const b2x = 140 - ((st.time * 2.3 + 90) % 280), b2z = -st.legDist * 0.68;
      if (Math.abs(b2z - pz) < 1300) R.draw(assets.boat, M4.compose(b2x, 0, b2z, 0, -Math.PI / 2, 0));
    }
    // Birds (v13): a small flock circling a thermal beside the route,
    // wings rocking as they ride it — the sky is not empty any more.
    if (assets.bird) {
      const bx = -85 + Math.sin(st.time * 0.10) * 22, by = 37 + Math.sin(st.time * 0.37) * 2.5;
      const bz = -st.legDist * 0.45 + Math.sin(st.time * 0.06) * 45;
      if (Math.abs(bz - pz) < 1100) {
        const offs = [[0, 0, 0], [6, 1.5, 7], [-6, 1.5, 7], [12, 3, 14], [-12, 3, 14]];
        for (let i = 0; i < offs.length; i++) {
          const o = offs[i];
          R.draw(assets.bird, M4.compose(bx + o[0], by + o[1], bz + o[2], 0, 0.3, Math.sin(st.time * 5.2 + i * 1.7) * 0.45));
        }
      }
    }
    // The windsock (v13) hangs on its pole by the departure threshold:
    // it swings downwind and lifts as the weather's wind rises, and
    // hangs limp when the air is still.
    if (assets.sock && st.dist < 700) {
      const wind = st.env ? (st.env.windMul || 0) : 0;
      const lift = clamp(wind / 2.2, 0, 1);
      const droop = -0.78 + lift * 0.66 + Math.sin(st.time * 1.7) * 0.05;
      const swing = 0.7 + Math.sin(st.time * 0.9) * 0.16;
      R.draw(assets.sock, M4.compose(20, 5.9, 64, 0, swing, droop));
    }
    // The explosion (v13): only a high-energy crash earns one (flight.js
    // decided). The core blooms and dies inside a second; the smoke
    // keeps climbing and thinning long after, over the receipt too.
    if (st.boom && assets.boom) {
      const age = st.boom.age, bx = st.boom.x, bz = -st.boom.dist;
      if (age < 0.9) {
        R.draw(assets.boom.core, M4.compose(bx, 0.3, bz, 0, st.time * 0.7, 0, 0.7 + age * 3.4), 0.95 * (1 - age / 0.9));
        R.draw(assets.boom.debris, M4.compose(bx, Math.max(0, Math.sin(Math.min(age, 1.4) / 1.4 * Math.PI) * 2.4), bz, 0, 0, 0, 1 + age * 0.9), clamp(1 - age / 1.2, 0, 1));
      }
      if (age > 0.2 && age < 8) {
        const sa = clamp(0.72 - (age - 0.2) * 0.075, 0.14, 0.72);
        R.draw(assets.boom.smoke, M4.compose(bx, Math.min((age - 0.2) * 1.7, 4.5), bz, 0, 0, 0, 0.8 + age * 0.5), sa);
      }
    }
    // Mode explosions (v15): a downed drone burns where it fell — the
    // same fireball-and-smoke presentation as the crash, smaller, and
    // several can be on the water at once, so the stage carries a list.
    if (st.booms && assets.boom) {
      for (const bm of st.booms) {
        const age = bm.age, bx = bm.x, bz = -bm.dist, by = bm.altM || 0;
        if (age < 0.9) {
          R.draw(assets.boom.core, M4.compose(bx, by + 0.3, bz, 0, st.time * 0.9, 0, (0.7 + age * 3.4) * 0.55), 0.95 * (1 - age / 0.9));
          R.draw(assets.boom.debris, M4.compose(bx, by + Math.max(0, Math.sin(Math.min(age, 1.4) / 1.4 * Math.PI) * 1.6), bz, 0, 0, 0, (1 + age * 0.9) * 0.6), clamp(1 - age / 1.2, 0, 1));
        }
        if (age > 0.2 && age < 5) {
          const sa = clamp(0.6 - (age - 0.2) * 0.1, 0.12, 0.6);
          R.draw(assets.boom.smoke, M4.compose(bx, by + Math.min((age - 0.2) * 1.4, 3.2), bz, 0, 0, 0, (0.8 + age * 0.5) * 0.6), sa);
        }
      }
    }
    if (st.gate && assets.gate && !st.gate.passed) {
      R.draw(assets.gate, M4.compose(st.gate.x, st.gate.altM, -st.gate.dist, Math.PI / 2, 0, 0));
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
    if (st.camMode !== 'cockpit' && !st.noPlane) {
      // Aerobatics (v15.3): a DIRECT flight carries its true attitude
      // — the mesh rotates by attPitch/attRoll themselves, so a loop
      // is a loop and a barrel roll rolls all the way around. Every
      // other state keeps the pitchVis/bank dress it has always worn.
      const rx = st.attPitch != null ? st.attPitch : st.pitchVis * 0.38;
      const rz = st.attRoll != null ? -st.attRoll : -st.bank * 0.55;
      const planeM = M4.compose(st.x, st.alt + 0.62, pz, rx, -st.bank * 0.22, rz, st.planeScale || 1);
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
    // The race rivals (v15, AIR RACE): two more airframes in the world,
    // flown by the demo pilot — drawn exactly as the player's own plane
    // is, prop spinning with their throttle, in liveries she never wears.
    if (st.rivals && assets.plane) {
      for (const rv of st.rivals) {
        if (!rv.mesh) continue;
        const m = M4.compose(rv.x, rv.alt + 0.62, -rv.dist, rv.pitchVis * 0.38, -rv.bank * 0.22, -rv.bank * 0.55, rv.mesh.scale);
        R.draw(rv.mesh.set.plane, m);
        const pm = M4.mul(m, M4.compose(0, 1.00, -3.42, 0, 0, rv.propSpin || 0));
        R.draw(rv.mesh.set.prop, pm);
        R.draw(rv.mesh.set.disc, pm, 0.10 + 0.20 * (rv.throttle || 0));
        R.draw(assets.shadow, M4.compose(rv.x, 0.15, -rv.dist, 0, 0, 0, 1 + rv.alt * 0.02), clamp(0.40 - rv.alt * 0.0018, 0.26, 0.40));
      }
    }
    // The bandits (v15.2, SKY PATROL): smuggler escort planes flown
    // against her — drawn exactly as the race rivals are, real
    // airframes in liveries she never wears, props spinning.
    if (st.bandits) {
      for (const rv of st.bandits) {
        if (!rv.mesh) continue;
        const m = M4.compose(rv.x, rv.alt + 0.62, -rv.dist, rv.pitchVis * 0.38, -rv.bank * 0.22, -rv.bank * 0.55, rv.mesh.scale);
        R.draw(rv.mesh.set.plane, m);
        const pm = M4.mul(m, M4.compose(0, 1.00, -3.42, 0, 0, rv.propSpin || 0));
        R.draw(rv.mesh.set.prop, pm);
        R.draw(rv.mesh.set.disc, pm, 0.10 + 0.20 * (rv.throttle || 0));
        R.draw(assets.shadow, M4.compose(rv.x, 0.15, -rv.dist, 0, 0, 0, 1 + rv.alt * 0.02), clamp(0.40 - rv.alt * 0.0018, 0.26, 0.40));
      }
    }
    // The patrol's quarry (v15, SKY PATROL): smuggler drones weaving and
    // running ahead of the nose. The body banks with its weave; the
    // rotor discs spin at a blur and catch what light there is, so a
    // drone reads as a machine at range, not a speck.
    if (st.drones && assets.drone) {
      for (const d of st.drones) {
        if (!d.alive || d.escaped) continue;
        const bank = Math.sin(st.time * 3.4 + d.phase) * 0.35;
        const yaw = Math.sin(st.time * 1.3 + d.phase) * 0.22;
        // A third larger on the sky than it was dealt (v15.1): at
        // 300–600 m the original airframe was a speck even flown
        // straight at, and a hunt the eyes cannot join is no hunt.
        const m = M4.compose(d.x, d.altM, -d.dist, 0.06, yaw, bank, 1.35);
        R.draw(assets.drone.body, m);
        R.draw(assets.drone.rotors, M4.mul(m, M4.compose(0, 0, 0, 0, st.time * 26 + d.phase, 0)), 0.5);
        // The strobe's double flash: two short burns a cycle, dark
        // between — the rhythm reads as a light, not a glow.
        if (assets.drone.strobe) {
          const ph = (st.time * 0.85 + d.phase * 0.37) % 1;
          const lit = ph < 0.07 || (ph >= 0.18 && ph < 0.25);
          R.draw(assets.drone.strobe, m, lit ? 1 : 0.05);
        }
      }
    }
    // Gunfire light (v15.2, made unmissable v16): the owner's word
    // was that a burst must read as a STREAM of light, not a blink —
    // the v15.2 beams lived 0.11 s at 0.16 m across and two gates in
    // a row never caught one in a screenshot. Now each tracer lives
    // 0.27 s and is drawn twice, additively: a wide soft halo (0.62 m)
    // under a hard bright core (0.24 m), holding full brightness for
    // the first half of its life before it fades — at the patrol's
    // 0.16 s fire cadence two or three beams hang in the air at once
    // and the burst's line is simply THERE. Muzzle flashes bloom
    // bigger and a breath longer; hit sparks burn larger, denser
    // (three cores a strike, staged by main.js) and longer.
    if (st.tracers) {
      for (const tr of st.tracers) {
        if (tr.age > 0.27) continue;
        const mesh = tr.enemy ? assets.tracerEnemy : assets.tracerOwn;
        if (!mesh) continue;
        const u = tr.age / 0.27;
        const fade = u < 0.5 ? 1 : 1 - (u - 0.5) / 0.5;
        R.draw(mesh, beamM(tr.a, tr.b, 0.62), 0.30 * fade, true);
        R.draw(mesh, beamM(tr.a, tr.b, 0.24), 0.98 * fade, true);
      }
    }
    if (st.flashes && assets.flash) {
      for (const fl of st.flashes) {
        if (fl.age > 0.14) continue;
        R.draw(assets.flash, M4.compose(fl.p[0], fl.p[1], fl.p[2], 0, 0, st.time * 9 + fl.p[0], 0.9 + fl.age * 6.5), clamp(1 - fl.age / 0.14, 0, 1), true);
      }
    }
    if (st.sparks && assets.boom) {
      for (const sp of st.sparks) {
        if (sp.age > 0.45) continue;
        R.draw(assets.boom.core, M4.compose(sp.x, sp.altM + 0.3, -sp.dist, 0, st.time * 2.1, 0, 0.20 + sp.age * 0.6), clamp(0.95 * (1 - sp.age / 0.45), 0, 0.95), true);
      }
    }
    if (st.smokes && assets.boom) {
      for (const sm of st.smokes) {
        if (sm.age > 1.6) continue;
        const a = clamp(0.34 * (1 - sm.age / 1.6), 0, 0.34) * (sm.heavy ? 1.5 : 1);
        R.draw(assets.boom.smoke, M4.compose(sm.x, sm.altM + 0.4 + sm.age * 0.8, -sm.dist, 0, sm.age * 0.7, 0, (0.16 + sm.age * 0.22) * (sm.heavy ? 1.5 : 1)), a);
      }
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

// The airports' small life (v13), drawn per airport base transform:
// the tower beacon flashes its short blink, the terminal flag rocks on
// its hoist in the wind, and a service van drives a slow rectangle
// around the apron with its headlamps lit. All cheap transforms of
// three small meshes; nothing here touches the flight.
function drawAirportLife(R, assets, st, base, inRange) {
  if (!inRange) return;
  const [bx, , bz] = base;
  if (assets.beacon) {
    const phase = (st.time * 0.7) % 1;
    const a = phase < 0.14 ? 0.98 : 0.10;
    R.draw(assets.beacon, M4.compose(bx + 46, 20.35, bz + 8, 0, 0, 0), a);
  }
  if (assets.flag) {
    const sway = Math.sin(st.time * 1.9) * 0.10 + Math.sin(st.time * 3.7) * 0.04;
    R.draw(assets.flag, M4.compose(bx + 24, 0, bz - 14, 0, sway, 0));
  }
  if (assets.van) {
    // A rounded-rectangle loop on the apron, ~50 s a lap.
    const per = [[16, 14], [54, 14], [54, 36], [16, 36]];
    const segLen = [38, 22, 38, 22], total = 120;
    let u = ((st.time * 2.4) % total + total) % total;
    let i = 0;
    while (u > segLen[i]) { u -= segLen[i]; i = (i + 1) % 4; }
    const [x0, z0] = per[i], [x1, z1] = per[(i + 1) % 4];
    const f = u / segLen[i];
    const x = x0 + (x1 - x0) * f, z = z0 + (z1 - z0) * f;
    const ry = Math.atan2(-(x1 - x0), -(z1 - z0));
    R.draw(assets.van, M4.compose(bx + x, 0, bz + z, 0, ry, 0));
  }
}
