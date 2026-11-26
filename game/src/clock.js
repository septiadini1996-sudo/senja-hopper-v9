// The game clock and the weather it carries: pure logic, no DOM, no rendering.
// Time runs compressed — one game hour per GAME_HOUR_SECONDS of real play —
// and everything the sky does is a smooth function of the game hour: sun and
// moon position, sky gradient, fog, sea tone, starlight. Weather is a
// separate deterministic table over (campaign day, 4-hour block): a block
// of hours shares one sky, so a day has weather character that lasts and
// the morning board's forecast is a promise a whole leg can fly inside.
import { mulberry32, clamp, lerp } from './util.js';

export const GAME_HOUR_SECONDS = 30; // real seconds per game hour (a day ≈ 12 min)

const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// Phase keyframes: the day's light, hour by hour. Every field is a rendering
// input — sky gradient (skyLow/skyMid/skyTop), fog colour and base density,
// sun/moon direction and tint, the sky disc and halo, ambient light for the
// lit shader, sea tones and glitter, star visibility, and the emissive gain
// that makes lamps and lit windows glow as darkness falls (emis).
// The 18.25 keyframe IS the game's original golden-hour palette, kept exact:
// senja is now one hour of the day instead of the whole sky.
// Night (v12 brightening): the owner's playtest verdict was that the
// night was too dark to fly by. The moon now does real work — ambient
// roughly doubled, the sky a readable moonlit blue, the sea lifted, and
// the emissive gain raised so windows, lamps and ring cores carry
// further. It still reads as night (stars full, sun a cool moon), just
// a night a pilot can see in.
const NIGHT = {
  skyLow: [0.10, 0.14, 0.24], skyMid: [0.06, 0.10, 0.20], skyTop: [0.03, 0.05, 0.12],
  fog: [0.08, 0.11, 0.19], fogD: 0.00042,
  sunDir: [0.42, 0.68, -0.55], sunCol: [0.62, 0.74, 1.00], sunI: 0.50,
  discCol: [0.88, 0.93, 1.00], haloCol: [0.40, 0.52, 0.82], discI: 0.85,
  ambLo: [0.10, 0.13, 0.20], ambHi: [0.20, 0.24, 0.33],
  seaDeep: [0.015, 0.05, 0.10], seaLift: [0.05, 0.11, 0.19],
  sparkle: [0.70, 0.82, 1.00], glitter: 0.9, sheen: [0.40, 0.52, 0.82], sheenI: 0.20,
  stars: 1.0, emis: 2.7,
};
export const PHASE_KEYS = [
  { h: 0.0, ...NIGHT },
  { h: 4.5, ...NIGHT, fogD: 0.00048, stars: 0.9, emis: 2.3 },
  { h: 5.0, // pre-dawn: the east warms before the sun does
    skyLow: [0.16, 0.13, 0.22], skyMid: [0.08, 0.08, 0.16], skyTop: [0.03, 0.04, 0.10],
    fog: [0.14, 0.12, 0.18], fogD: 0.00055,
    sunDir: [0.42, 0.68, -0.55], sunCol: [0.50, 0.60, 0.90], sunI: 0.30,
    discCol: [0.80, 0.85, 1.00], haloCol: [0.35, 0.45, 0.75], discI: 0.40,
    ambLo: [0.10, 0.10, 0.16], ambHi: [0.17, 0.17, 0.25],
    seaDeep: [0.02, 0.06, 0.12], seaLift: [0.05, 0.12, 0.20],
    sparkle: [0.70, 0.75, 0.95], glitter: 0.7, sheen: [0.50, 0.50, 0.70], sheenI: 0.10,
    stars: 0.55, emis: 1.9 },
  { h: 6.25, // fajar: pale orange horizon, mist on the water
    skyLow: [0.98, 0.62, 0.38], skyMid: [0.62, 0.50, 0.55], skyTop: [0.25, 0.32, 0.55],
    fog: [0.85, 0.60, 0.45], fogD: 0.00062,
    sunDir: [0.78, 0.14, -0.55], sunCol: [1.00, 0.66, 0.42], sunI: 0.55,
    discCol: [1.00, 0.72, 0.45], haloCol: [1.00, 0.55, 0.30], discI: 1.0,
    ambLo: [0.20, 0.15, 0.18], ambHi: [0.38, 0.33, 0.33],
    seaDeep: [0.04, 0.16, 0.26], seaLift: [0.10, 0.34, 0.44],
    sparkle: [1.00, 0.70, 0.40], glitter: 1.0, sheen: [0.95, 0.50, 0.28], sheenI: 0.30,
    stars: 0.0, emis: 0.6 },
  { h: 8.0, // morning: fresh, clear, blue
    skyLow: [0.72, 0.82, 0.90], skyMid: [0.55, 0.72, 0.92], skyTop: [0.25, 0.45, 0.85],
    fog: [0.78, 0.84, 0.88], fogD: 0.00045,
    sunDir: [0.50, 0.55, -0.62], sunCol: [1.00, 0.92, 0.80], sunI: 0.90,
    discCol: [1.00, 0.95, 0.80], haloCol: [0.90, 0.80, 0.60], discI: 0.8,
    ambLo: [0.30, 0.32, 0.36], ambHi: [0.50, 0.52, 0.52],
    seaDeep: [0.04, 0.24, 0.36], seaLift: [0.13, 0.47, 0.58],
    sparkle: [1.00, 0.95, 0.80], glitter: 1.1, sheen: [0.70, 0.80, 0.90], sheenI: 0.18,
    stars: 0.0, emis: 0.25 },
  { h: 11.0,
    skyLow: [0.75, 0.85, 0.92], skyMid: [0.50, 0.70, 0.95], skyTop: [0.20, 0.42, 0.90],
    fog: [0.80, 0.86, 0.90], fogD: 0.00040,
    sunDir: [0.25, 0.85, -0.45], sunCol: [1.02, 0.99, 0.94], sunI: 1.00,
    discCol: [1.00, 0.97, 0.88], haloCol: [0.92, 0.85, 0.68], discI: 0.7,
    ambLo: [0.36, 0.37, 0.40], ambHi: [0.56, 0.56, 0.55],
    seaDeep: [0.04, 0.25, 0.38], seaLift: [0.15, 0.50, 0.60],
    sparkle: [1.00, 0.98, 0.90], glitter: 1.3, sheen: [0.75, 0.84, 0.92], sheenI: 0.15,
    stars: 0.0, emis: 0.25 },
  { h: 13.5, // terik: harsh white midday, high contrast, glitter everywhere
    skyLow: [0.80, 0.88, 0.93], skyMid: [0.45, 0.68, 0.97], skyTop: [0.16, 0.40, 0.92],
    fog: [0.84, 0.88, 0.90], fogD: 0.00036,
    sunDir: [0.02, 1.00, -0.30], sunCol: [1.05, 1.02, 0.97], sunI: 1.12,
    discCol: [1.00, 0.99, 0.95], haloCol: [0.95, 0.92, 0.85], discI: 0.65,
    ambLo: [0.40, 0.41, 0.43], ambHi: [0.60, 0.60, 0.58],
    seaDeep: [0.03, 0.26, 0.40], seaLift: [0.16, 0.53, 0.63],
    sparkle: [1.00, 1.00, 0.95], glitter: 1.5, sheen: [0.80, 0.88, 0.95], sheenI: 0.14,
    stars: 0.0, emis: 0.25 },
  { h: 16.0, // afternoon: the white softens back toward warm
    skyLow: [0.85, 0.80, 0.72], skyMid: [0.60, 0.68, 0.85], skyTop: [0.25, 0.42, 0.78],
    fog: [0.85, 0.80, 0.70], fogD: 0.00044,
    sunDir: [-0.30, 0.62, -0.68], sunCol: [1.00, 0.90, 0.72], sunI: 0.95,
    discCol: [1.00, 0.90, 0.65], haloCol: [0.95, 0.70, 0.40], discI: 0.85,
    ambLo: [0.34, 0.30, 0.30], ambHi: [0.54, 0.50, 0.46],
    seaDeep: [0.045, 0.24, 0.35], seaLift: [0.14, 0.48, 0.57],
    sparkle: [1.00, 0.88, 0.60], glitter: 1.15, sheen: [0.90, 0.65, 0.40], sheenI: 0.25,
    stars: 0.0, emis: 0.30 },
  { h: 17.5, // the gold gathers
    skyLow: [1.00, 0.66, 0.36], skyMid: [0.90, 0.68, 0.50], skyTop: [0.32, 0.40, 0.64],
    fog: [0.94, 0.64, 0.44], fogD: 0.00050,
    sunDir: [-0.34, 0.48, -0.80], sunCol: [1.00, 0.84, 0.62], sunI: 0.88,
    discCol: [1.00, 0.84, 0.55], haloCol: [1.00, 0.62, 0.30], discI: 1.0,
    ambLo: [0.35, 0.24, 0.29], ambHi: [0.55, 0.48, 0.44],
    seaDeep: [0.05, 0.23, 0.33], seaLift: [0.13, 0.45, 0.55],
    sparkle: [1.00, 0.76, 0.42], glitter: 1.0, sheen: [0.98, 0.55, 0.30], sheenI: 0.34,
    stars: 0.0, emis: 0.35 },
  { h: 18.25, // SENJA — the original palette, exact
    skyLow: [1.00, 0.62, 0.34], skyMid: [0.98, 0.78, 0.52], skyTop: [0.36, 0.42, 0.66],
    fog: [0.96, 0.62, 0.42], fogD: 0.00052,
    sunDir: [-0.35, 0.42, -0.84], sunCol: [1.00, 0.82, 0.62], sunI: 0.85,
    discCol: [1.00, 0.83, 0.55], haloCol: [1.00, 0.60, 0.30], discI: 1.0,
    ambLo: [0.36, 0.24, 0.30], ambHi: [0.55, 0.48, 0.44],
    seaDeep: [0.05, 0.23, 0.33], seaLift: [0.13, 0.45, 0.55],
    sparkle: [1.00, 0.75, 0.42], glitter: 1.0, sheen: [0.98, 0.55, 0.30], sheenI: 0.35,
    stars: 0.0, emis: 0.35 },
  { h: 19.0, // dusk: embers and purple
    skyLow: [0.85, 0.42, 0.30], skyMid: [0.50, 0.30, 0.42], skyTop: [0.16, 0.18, 0.38],
    fog: [0.62, 0.38, 0.36], fogD: 0.00055,
    sunDir: [-0.55, 0.10, -0.78], sunCol: [1.00, 0.55, 0.35], sunI: 0.40,
    discCol: [1.00, 0.60, 0.35], haloCol: [0.90, 0.40, 0.25], discI: 0.9,
    ambLo: [0.22, 0.16, 0.22], ambHi: [0.36, 0.30, 0.36],
    seaDeep: [0.03, 0.12, 0.22], seaLift: [0.08, 0.24, 0.34],
    sparkle: [0.95, 0.60, 0.40], glitter: 0.8, sheen: [0.80, 0.40, 0.30], sheenI: 0.20,
    stars: 0.25, emis: 1.5 },
  { h: 19.75, // twilight: first stars, lamps take over
    skyLow: [0.36, 0.28, 0.42], skyMid: [0.14, 0.14, 0.28], skyTop: [0.05, 0.06, 0.16],
    fog: [0.20, 0.17, 0.26], fogD: 0.00050,
    sunDir: [0.30, 0.50, -0.60], sunCol: [0.50, 0.60, 0.90], sunI: 0.30,
    discCol: [0.80, 0.86, 1.00], haloCol: [0.40, 0.50, 0.80], discI: 0.5,
    ambLo: [0.12, 0.13, 0.20], ambHi: [0.21, 0.23, 0.31],
    seaDeep: [0.015, 0.05, 0.10], seaLift: [0.04, 0.10, 0.17],
    sparkle: [0.70, 0.80, 1.00], glitter: 0.8, sheen: [0.40, 0.50, 0.80], sheenI: 0.12,
    stars: 0.8, emis: 2.4 },
  { h: 21.5, ...NIGHT },
  { h: 24.0, ...NIGHT },
];

const COLOR_FIELDS = ['skyLow', 'skyMid', 'skyTop', 'fog', 'sunCol', 'discCol', 'haloCol', 'ambLo', 'ambHi', 'seaDeep', 'seaLift', 'sparkle', 'sheen'];
const SCALAR_FIELDS = ['fogD', 'sunI', 'discI', 'glitter', 'sheenI', 'stars', 'emis'];

// The interpolated phase at any hour in [0, 24): every field present, the sun
// direction normalized, the table wrapping seamlessly at midnight.
export function phaseAt(hour) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < PHASE_KEYS.length - 2 && PHASE_KEYS[i + 1].h <= h) i++;
  const a = PHASE_KEYS[i], b = PHASE_KEYS[i + 1];
  const t = smooth((h - a.h) / (b.h - a.h));
  const out = {};
  for (const f of COLOR_FIELDS) out[f] = mix3(a[f], b[f], t);
  for (const f of SCALAR_FIELDS) out[f] = lerp(a[f], b[f], t);
  out.sunDir = norm(mix3(a.sunDir, b.sunDir, t));
  return out;
}

// ---- weather: a deterministic table over (day, 4-hour block) ----
export const WEATHERS = ['clear', 'overcast', 'rain', 'storm'];
export const BLOCK_HOURS = 4; // one weather per block: 00–04, 04–08, …, 20–24
export const blockOfHour = hourFloat => Math.floor((((hourFloat % 24) + 24) % 24) / BLOCK_HOURS);
export const WEATHER_PARAMS = {
  // fogMul thickens the phase fog; windMul scales the season wind; rain is
  // the streak layer's strength; grey desaturates the sky toward gloom.
  clear:    { fogMul: 1.00, windMul: 1.0, rain: 0.00, grey: 0.00 },
  overcast: { fogMul: 1.55, windMul: 1.2, rain: 0.00, grey: 0.60 },
  rain:     { fogMul: 1.90, windMul: 1.6, rain: 0.75, grey: 0.45 },
  storm:    { fogMul: 2.20, windMul: 2.2, rain: 1.00, grey: 0.55 },
};

// The weather of one whole 4-hour block of one campaign day. Pure and
// seeded from the same hash family as the old hourly table: the board
// reads it to print the forecast, the flight reads it to keep it.
export function weatherAtBlock(day, blockIdx) {
  const bi = ((Math.floor(blockIdx) % 6) + 6) % 6;
  const r = mulberry32((Math.floor(day) * 1000003 + bi * 7919 + 17) >>> 0)();
  if (r < 0.42) return 'clear';
  if (r < 0.65) return 'overcast';
  if (r < 0.85) return 'rain';
  return 'storm';
}

// The weather in force at an hour: the weather of the block containing it.
export function weatherAtHour(day, hourFloat) {
  return weatherAtBlock(day, blockOfHour(hourFloat));
}

// Blended weather parameters at a fractional hour: the current block's
// state rules the whole block, and the next block's parameters ease in
// over the block's last ten minutes only, so fog, wind and rain never pop
// at a boundary — and never churn mid-flight either. The dominant state
// (what the HUD names) is the current block's until the blend passes
// halfway. The last block of the day blends into tomorrow's first block.
export function weatherBlend(day, hourFloat) {
  const h = ((hourFloat % 24) + 24) % 24;
  const block = Math.floor(h / BLOCK_HOURS);
  const minsToEnd = (BLOCK_HOURS - (h - block * BLOCK_HOURS)) * 60;
  const b = smooth((10 - minsToEnd) / 10);
  const s0 = weatherAtBlock(day, block);
  const s1 = block === 5 ? weatherAtBlock(day + 1, 0) : weatherAtBlock(day, block + 1);
  const p0 = WEATHER_PARAMS[s0], p1 = WEATHER_PARAMS[s1];
  const out = { state: b < 0.5 ? s0 : s1 };
  for (const f of ['fogMul', 'windMul', 'rain', 'grey']) out[f] = lerp(p0[f], p1[f], b);
  return out;
}

const desat = (c, g) => {
  if (g <= 0) return c;
  const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  return mix3(c, [lum, lum, lum], g * 0.7).map(v => v * (1 - 0.13 * g));
};

// The full environment at a moment: phase light reshaped by the weather.
// pinState (a weather name) overrides the table — screenshot staging and the
// test rig use it; real flights never do.
export function skyAt(day, hourFloat, pinState = null) {
  const env = phaseAt(hourFloat);
  const wb = pinState && WEATHER_PARAMS[pinState]
    ? { ...WEATHER_PARAMS[pinState], state: pinState }
    : weatherBlend(day, hourFloat);
  const g = wb.grey;
  if (g > 0) {
    for (const f of ['skyLow', 'skyMid', 'skyTop', 'fog']) env[f] = desat(env[f], g);
    env.sunI *= 1 - 0.70 * g;
    env.discI *= 1 - 0.80 * g;
    env.glitter *= 1 - 0.75 * g;
    env.stars *= 1 - g;
  }
  env.fogD = env.fogD * wb.fogMul;
  env.state = wb.state;
  env.rain = wb.rain;
  env.windMul = wb.windMul;
  env.grey = g;
  env.hour = ((hourFloat % 24) + 24) % 24;
  return env;
}

// "18:25" for the HUD, the board and the title chips.
export function fmtGameHour(hourFloat) {
  const h = ((hourFloat % 24) + 24) % 24;
  const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}
