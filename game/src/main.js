// ARCHIPEL AIR — Archipelago Air Mail: the game shell. Screens, HUD, input
// bindings and the flight loop live here; the rules live in flight.js /
// state.js, the 3D in engine3d.js / scene3d.js, the words in i18n.js.
// Every control scheme writes into ONE normalized frame, so switching
// schemes mid-flight changes only who is holding the controls — never
// the flight itself.
import { createRenderer, M4 } from './engine3d.js';
import { buildPlane, buildJet, buildJetFanBlur, buildIsland, buildRingMeshes, buildSeaMesh, buildSkyMesh, buildBuoys, buildBlob, buildStrip, buildStripGlow, buildDepartureRunway, buildDepartureGlow, buildHomeTerrain, buildShallows, buildDestShallows, buildExplosion, buildBird, buildBeacon, buildFlag, buildVan, buildSock, buildStreaks, buildAirport, buildCloud, buildCloudB, buildCloudC, buildBoat, buildGateMesh, buildCockpit, buildLightCone, cloudField, createScene } from './scene3d.js';
import { cockpitState } from './cockpit.js';
import { createFlight, stepFlight, settleFlight, guidance, objectiveState, RUNWAY_M } from './flight.js';
import { GAME_HOUR_SECONDS, skyAt, weatherAtBlock, blockOfHour, fmtGameHour, WEATHER_PARAMS } from './clock.js';
import { ISLANDS, HOP_M, ringCourse, islandPositions, islandOutline } from './world.js';
import { loadSave, storeSave, defaultSave, morningBoard, applyResult, applyType, challengeResult, windForSeason, buyPlane, switchPlane, UPGRADE_COST, CHALLENGES, SAVE_KEY } from './state.js';
import { PLANES, planeById } from './planes.js';
import { createLook, lookDrag, lookRelease, lookSet, updateLook } from './look.js';
import { makeT } from './i18n.js';
import { createAudio } from './audio.js';
import { createRadio, radioPoll } from './radio.js';
import { minimapRoute, minimapPlane } from './minimap.js';
import { createPreviewState, previewSelect, previewPose } from './preview.js';
import { makeFrame, keyboardFrame, stickFrame, sliderValue, touchFrame, gyroFrame, gyroButtons, conditionFrame } from './input-core.js';
import { pilotFrame } from './demo-pilot.js';
import { clamp, fmtKnots, fmtFeet, fmtRp, fmtClock, FT } from './util.js';

const $ = s => document.querySelector(s);
const ui = $('#ui');
let storage = null;
try { storage = window.localStorage; } catch { storage = null; }
const store = storage || { getItem: () => null, setItem: () => {}, removeItem: () => {} };

let save = loadSave(store);
let t = makeT(save.settings.lang);
// The environment at the current game hour: phase light reshaped by the
// deterministic (day, hour) weather. Recomputed as the clock runs; the
// scene consumes it every frame, the HUD and the weather layers read it.
let envNow = skyAt(save.day, save.clockH ?? 6.5);
const WX_ICON = { clear: '☀', overcast: '☁', rain: '☂', storm: '⛈' };
const wxIcon = s => WX_ICON[s] || '☀';
const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
let scheme = save.scheme || (coarse ? 'touch' : 'keyboard');
let screen = 'title';
let controlsReturn = 'title';
let paused = false;
let boardCache = { day: -1, tickets: [] };
let flightCtx = null;
let ambient = 0, propSpin = 0, warned = false, stallWarned = false;
// Free-look (v12): the pilot's head. Dragging the view (or I/J/K/L)
// turns it; the flight frame never hears about it.
const look = createLook();
const lookPointer = { id: null, x: 0, y: 0, on: false };
let lookPin = false; // screenshot staging holds the pilot's head turned
let titleBackdrop = null; // posed title-screen flight (screenshot staging)
// Screenshot staging pins the scene's clock so dossier frames are
// byte-identical between builds (the sea swell and sky read this time).
const IS_SHOT = new URLSearchParams(location.search).has('shot');

const frame = makeFrame(); // the conditioned frame the model flies
const rawFrame = makeFrame(); // what the pilot's hands are actually doing
let camMode = save.camMode || 'near';
const keys = new Set();
const held = { up: false, down: false, left: false, right: false, thrUp: false, thrDn: false };
const stickVec = { dx: 0, dy: 0 };
const gyro = { status: 'idle', enabled: false, neutral: { beta: 0, gamma: 0 }, sens: 'std', have: false };
const tilt = { beta: 0, gamma: 0 };

const audio = createAudio(() => save.settings);

// ---------- airport radio (v13) ----------
// radio.js judges when the tower speaks; here the transmissions queue,
// print on the strip, and sound in the synthesized radio voice. The
// queue advances only in flight and never while paused.
let radio = null, radioQueue = [], radioLog = [], radioNowKey = null, radioBusyUntil = 0;
function windText() {
  const kt = Math.round(4 + Math.abs(windForSeason(save.settings.season)) * 6 + (envNow.windMul || 0) * 4);
  return `120 at ${kt}`;
}
function radioText(m) {
  const plane = planeById(save.planes.active);
  const dest = flightCtx ? ISLANDS[flightCtx.ticket.to].name : ISLANDS[Math.min(save.islandIdx + 1, ISLANDS.length - 1)].name;
  return t('radio_' + m.key, { cs: plane.callsign, dest, wind: windText() });
}
function pollRadio() {
  if (!flightCtx || !radio) return;
  const msgs = radioPoll(radio, flightCtx.flight, { type: flightCtx.ticket.type || 'cargo', weather: envNow.state });
  for (const m of msgs) {
    radioLog.push(m.key);
    if ((save.settings.radio ?? 4) > 0) radioQueue.push(m);
  }
}
function pumpRadio(now) {
  const strip = $('#radio'); if (!strip) return;
  if (screen !== 'flight' || paused || !flightCtx) { strip.style.display = 'none'; return; }
  if (now < radioBusyUntil) return;
  const m = radioQueue.shift();
  if (!m) { strip.style.display = 'none'; radioNowKey = null; return; }
  const label = m.speaker === 'tower' ? (save.settings.lang === 'id' ? 'MENARA' : 'TOWER') : m.speaker.toUpperCase();
  strip.innerHTML = `<b>${label}</b> ${radioText(m)}`;
  strip.style.display = 'block';
  radioNowKey = m.key;
  const dur = audio.radioVoice(radioText(m), m.speaker);
  radioBusyUntil = now + Math.max(2.8, dur + 0.5);
}

// ---------- tiny DOM helpers ----------
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function btn(label, cls, act, onClick) {
  const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label);
  if (act) b.dataset.act = act;
  b.addEventListener('click', ev => { ev.preventDefault(); audio.ensure(); audio.blip('click'); onClick(); });
  return b;
}
function show(name) {
  screen = name;
  for (const s of ui.querySelectorAll('.screen')) s.classList.toggle('on', s.id === 'scr-' + name);
  $('#hud').classList.toggle('on', name === 'flight');
  updateFlightControls();
  const st = $('#status'); if (st) st.textContent = name;
}
function toast(msg) {
  const e = $('#toast'); e.textContent = msg; e.style.display = 'block';
  clearTimeout(toast._h); toast._h = setTimeout(() => { e.style.display = 'none'; }, 2400);
}

// ---------- screens ----------
function chipsRow() {
  const row = el('div', 'topchips');
  const dest = ISLANDS[Math.min(save.islandIdx + 1, ISLANDS.length - 1)];
  row.append(
    chip(`${t('day')} ${save.day}`), chip(`${t('island')}: ${ISLANDS[save.islandIdx].name}`),
    chip(`${t('saldo')}: <b>${fmtRp(save.saldo)}</b>`), chip(`✦ ${save.stamps.length}/${ISLANDS.length - 1}`),
    chip(`🕐 <b class="clockface">${fmtGameHour(save.clockH)}</b> <span class="wxface">${wxIcon(weatherAtBlock(save.day, blockOfHour(save.clockH)))}</span>`),
  );
  const obj = el('div', 'objline', save.islandIdx < ISLANDS.length - 1
    ? t('next_obj', { island: dest.name }) : t('all_stamps'));
  const wrap = el('div'); wrap.append(row, obj); return wrap;
}
function chip(html) { const c = el('span', 'chip'); c.innerHTML = html; return c; }

function renderTitle() {
  const s = $('#scr-title'); s.innerHTML = '';
  s.append(chipsRow());
  s.append(el('h1', 'logo', t('game_title')), el('p', 'sub', t('game_sub')));
  const col = el('div'); col.style.cssText = 'display:flex;flex-direction:column;align-items:center;';
  if (save.started) col.append(btn(t('continue'), 'primary', 'continue', () => showBoard()));
  col.append(btn(t('new_game'), save.started ? '' : 'primary', 'newgame', () => {
    const keep = { settings: save.settings };
    save = defaultSave(); save.settings = keep.settings; save.scheme = scheme; save.started = true;
    storeSave(store, save); renderTitle(); showBoard();
  }));
  col.append(
    btn(t('morning_board'), '', 'board', () => showBoard()),
    btn(t('map'), '', 'title-map', () => openMap('title')),
    btn(t('hangar'), '', 'hangar', () => { renderHangar(); show('hangar'); }),
    btn(t('controls'), '', 'controls', () => { controlsReturn = 'title'; renderControls(); show('controls'); }),
    btn(t('challenges'), '', 'challenges', () => { renderChallenges(); show('challenges'); }),
    btn(t('pilot_stats'), '', 'stats', () => { renderStats(); show('stats'); }),
    btn(t('settings'), '', 'settings', () => { renderSettings(); show('settings'); }),
    btn(t('how_to_play'), '', 'howto', () => show('howto')),
  );
  const sc = chip(`${t('scheme_chip')}: <b>${t('scheme_' + scheme)} · ${t('handling_' + (save.handling || 'assisted'))}</b>`);
  sc.style.cursor = 'pointer';
  sc.addEventListener('click', () => { controlsReturn = 'title'; renderControls(); show('controls'); });
  const foot = el('div', 'topchips'); foot.append(sc);
  s.append(col, foot);
}
function showBoard() { renderBoard(); show('board'); }
function board() {
  if (boardCache.day !== save.day) boardCache = { day: save.day, tickets: morningBoard(save, save.day) };
  return boardCache.tickets;
}
// Mission-type icons (v13): small hand-drawn vector marks, one per kind
// of work — drawn paths, never emoji.
const TYPE_SVG = {
  cargo: '<path d="M4 8 L12 4 L20 8 V16 L12 20 L4 16 Z M4 8 L12 12 L20 8 M12 12 V20" />',
  passenger: '<circle cx="12" cy="8" r="3.4" /><path d="M5.5 19 C6.5 15.5 9 14 12 14 C15 14 17.5 15.5 18.5 19" />',
  rescue: '<circle cx="12" cy="12" r="7.5" /><circle cx="12" cy="12" r="3.2" /><path d="M12 4.5 V8 M12 16 V19.5 M4.5 12 H8 M16 12 H19.5" />',
  photo: '<rect x="4" y="8" width="16" height="11" rx="2" /><circle cx="12" cy="13.5" r="3.4" /><path d="M9 8 L10.5 5.5 H13.5 L15 8" />',
  express: '<path d="M13 3 L5.5 13.5 H11 L9.8 21 L18.5 10 H12.8 Z" />',
  trial: '<circle cx="12" cy="13" r="7" /><path d="M12 9.5 V13 L14.8 14.8 M9.5 3.5 H14.5 M12 3.5 V6.5" />',
  storm: '<path d="M7 15 A4.5 4.5 0 1 1 8.6 6.6 A5.5 5.5 0 0 1 19 9 A3.8 3.8 0 0 1 17.5 15 Z" /><path d="M12.5 14.5 L10.5 18 H12.8 L11.5 21.5" />',
};
function typeIcon(type) {
  const s = el('span', 'typeicon');
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">${TYPE_SVG[type] || TYPE_SVG.cargo}</svg>`;
  return s;
}

function renderBoard() {
  const s = $('#scr-board'); s.innerHTML = '';
  s.append(chipsRow(), el('h2', 'ptitle', t('board_title')), el('p', 'meta', t('board_hint')));
  const activeCap = planeById(save.planes.active).capacity;
  const activeIcon = planeIconImg(save.planes.active, 'ticketicon');
  for (const [i, tk] of board().entries()) {
    const card = el('div', 'panel card');
    if (activeIcon) card.append(activeIcon.cloneNode());
    const row = el('div', 'row');
    row.append(el('span', 'route', `${ISLANDS[tk.from].name} → ${ISLANDS[tk.to].name}`),
      el('span', 'tag' + (tk.main ? '' : ' side'), tk.main ? t('ticket_main') : t('ticket_side')));
    card.append(row);
    // The job at a glance (v14): the mission type wears a badge, the
    // pay is a gold pill, the objective sits in its own tinted box,
    // and the destination's stamp state is a chip — the four things
    // the owner reads before she commits to a departure.
    const typerow = el('div', 'row');
    const badge = el('span', 'typebadge'); badge.append(typeIcon(tk.type || 'cargo'));
    typerow.append(badge, el('span', 'tag side', t('type_' + (tk.type || 'cargo'))));
    card.append(typerow);
    const cargo = save.settings.lang === 'id' ? tk.cargoId : tk.cargo;
    const meta = el('p', 'meta', `${tk.customer} — ${t('cargo')}: ${cargo}\n${t('distance')}: ${(tk.dist / 1000).toFixed(1)} km · ${tk.rings.length} ${t('rings_avail')}\n${t('departs')}: ${fmtGameHour(tk.depHour)} · ${wxIcon(tk.weather)} ${t('wx_' + tk.weather)}`);
    meta.style.whiteSpace = 'pre-line';
    card.append(meta);
    const objKey = 'objb_' + (tk.type || 'cargo');
    card.append(el('p', 'meta objbox',
      t(objKey, { par: tk.par || 0, need: Math.ceil(tk.rings.length * 0.6) }) + ' · ' + t('weight_line', { n: tk.weight || 1 })));
    const foot = el('div', 'row ticketfoot');
    foot.append(el('span', 'paypill', fmtRp(tk.pay)));
    const destHasStamp = save.stamps.includes(ISLANDS[tk.to].id);
    if (destHasStamp) foot.append(el('span', 'stampchip have', t('stamp_have')));
    else if (tk.main && tk.to === save.islandIdx + 1) foot.append(el('span', 'stampchip next', t('map_next')));
    const tooHeavy = (tk.weight || 1) > activeCap;
    const fly = btn(t('fly'), 'primary small', 'fly' + i, () => startFlight(tk));
    foot.append(fly);
    card.append(foot);
    if (tooHeavy) {
      fly.disabled = true;
      card.append(el('p', 'meta', t('needs_capacity', { n: tk.weight })));
    }
    s.append(card);
  }
  s.append(btn(t('back'), 'small', 'back', () => { renderTitle(); show('title'); }),
    btn(t('map'), 'small', 'board-map', () => openMap('board')));
}

// ---------- the chart (v13) ----------
// A parchment map of the whole chain, drawn from the world's own
// tables: island positions from islandPositions() (the cumulative hop
// line), coastlines from islandOutline() — the same polygons the 3D
// terrain is built from — so the shape on the chart IS the island.
let mapReturn = 'title';
function openMap(from) { mapReturn = from; renderMap(); show('map'); }
function closeMap() {
  if (mapReturn === 'pause') { show('flight'); $('#pause').classList.add('on'); }
  else if (mapReturn === 'board') showBoard();
  else { renderTitle(); show('title'); }
}
function renderMap() {
  const s = $('#scr-map'); s.innerHTML = '';
  s.append(chipsRow(), el('h2', 'ptitle', t('map_title')));
  const card = el('div', 'panel card'); card.style.width = 'min(700px, 94vw)';
  const cv = document.createElement('canvas'); cv.id = 'mapcv';
  cv.width = 680; cv.height = 400; cv.style.width = '100%'; cv.style.display = 'block';
  card.append(cv); s.append(card);
  s.append(el('p', 'meta', t('map_hint')));
  s.append(btn(t('back'), 'small', 'map-back', closeMap));
  drawMapChart(cv);
}
function drawMapChart(cv) {
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  // Parchment ground with a soft vignette and a faint graticule.
  g.fillStyle = '#e9d6ab'; g.fillRect(0, 0, W, H);
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.95);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(122,84,32,0.28)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(120, 90, 40, 0.14)'; g.lineWidth = 1;
  for (let x = 40; x < W; x += 46) { g.beginPath(); g.moveTo(x, 8); g.lineTo(x, H - 8); g.stroke(); }
  for (let y = 30; y < H; y += 46) { g.beginPath(); g.moveTo(8, y); g.lineTo(W - 8, y); g.stroke(); }
  const pos = islandPositions();
  const total = Math.max(1, -pos[pos.length - 1].z);
  const px = (p) => 52 + (-p.z / total) * (W - 104);
  const py = (p) => H * 0.52 - (p.lat + 3.4) * 15;
  const pts = pos.map(p => [px(p), py(p)]);
  // The route: a dashed ink line island to island, in campaign order.
  g.strokeStyle = 'rgba(122, 60, 30, 0.75)'; g.lineWidth = 2; g.setLineDash([7, 6]);
  g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.stroke();
  g.setLineDash([]);
  const R = 30;
  pos.forEach((p, i) => {
    const isl = ISLANDS[i], [cx, cy] = pts[i];
    const outline = islandOutline(isl);
    // Land: the real coastline, filled parchment-green over sand.
    for (const [fill, k] of [['#d9b878', 1.10], ['#7fae5f', 1.0]]) {
      g.beginPath();
      outline.forEach((o, j) => {
        const X = cx + o.dx * R * k, Y = cy - o.dy * R * k;
        j ? g.lineTo(X, Y) : g.moveTo(X, Y);
      });
      g.closePath(); g.fillStyle = fill; g.fill();
    }
    g.beginPath();
    outline.forEach((o, j) => {
      const X = cx + o.dx * R, Y = cy - o.dy * R;
      j ? g.lineTo(X, Y) : g.moveTo(X, Y);
    });
    g.closePath(); g.strokeStyle = '#5d4322'; g.lineWidth = 1.6; g.stroke();
    // The volcano, where the island keeps one.
    if (isl.volcano) {
      const vx = cx + isl.volcano.at[0] * R, vy = cy - isl.volcano.at[1] * R;
      g.beginPath(); g.moveTo(vx - 6, vy + 4); g.lineTo(vx, vy - 6); g.lineTo(vx + 6, vy + 4); g.closePath();
      g.fillStyle = '#8a6b42'; g.fill();
    }
    // Stamps earned: a gold postmark ring over the island.
    if (save.stamps.includes(isl.id)) {
      g.beginPath(); g.arc(cx, cy, R * 0.52, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(178, 32, 24, 0.85)'; g.lineWidth = 3; g.stroke();
      g.fillStyle = 'rgba(178, 32, 24, 0.9)'; g.font = '900 15px sans-serif';
      g.textAlign = 'center'; g.fillText('✓', cx, cy + 5);
    }
    // The player's island, and the next stamp beyond it.
    if (i === save.islandIdx) {
      g.beginPath(); g.arc(cx, cy, R * 1.28, 0, Math.PI * 2);
      g.strokeStyle = '#b44f1d'; g.lineWidth = 2.5; g.stroke();
      g.fillStyle = '#7a2d12'; g.font = '800 10.5px sans-serif'; g.textAlign = 'center';
      g.fillText(t('map_here'), cx, cy - R * 1.28 - 6);
    } else if (i === save.islandIdx + 1) {
      g.fillStyle = '#7a2d12'; g.font = '800 10.5px sans-serif'; g.textAlign = 'center';
      g.fillText(t('map_next'), cx, cy - R * 1.05 - 4);
    }
    g.fillStyle = '#4a3418'; g.font = '700 12.5px sans-serif'; g.textAlign = 'center';
    g.fillText(isl.name, cx, cy + R * 1.18 + 13);
  });
  // Compass rose, top right.
  const [nx, ny] = [W - 42, 44];
  g.strokeStyle = '#5d4322'; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(nx, ny + 14); g.lineTo(nx, ny - 14); g.stroke();
  g.beginPath(); g.moveTo(nx - 5, ny - 8); g.lineTo(nx, ny - 16); g.lineTo(nx + 5, ny - 8); g.closePath();
  g.fillStyle = '#5d4322'; g.fill();
  g.font = '800 12px sans-serif'; g.textAlign = 'center'; g.fillText('N', nx, ny - 21);
}

function renderHangar() {
  const s = $('#scr-hangar'); s.innerHTML = '';
  s.append(chipsRow(), el('h2', 'ptitle', t('hangar_title')));
  // The living preview (v14): the selected airframe turning above the
  // fleet cards. Tapping a card (not its buttons) brings that plane up.
  s.append(hangarPreviewPanel());
  // The fleet (v12): every airframe, owned or for sale. Switching is
  // free; buying is forever; the board's heavy work is why they exist.
  s.append(el('h3', 'ptitle', t('fleet_title')));
  for (const p of PLANES) {
    const owned = save.planes.owned.includes(p.id);
    const active = save.planes.active === p.id;
    const card = el('div', 'panel card');
    if (pvState && pvState.selectedId === p.id) card.classList.add('sel');
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('button')) return;
      if (!pvState) pvState = createPreviewState(save.planes.active);
      previewSelect(pvState, p.id);
      s.querySelectorAll('.card.sel').forEach(n => n.classList.remove('sel'));
      card.classList.add('sel');
    });
    // Her portrait (v13): the airframe's own rendered mesh, in livery.
    const icon = planeIconImg(p.id, 'planeicon');
    if (icon) card.append(icon);
    const row = el('div', 'row');
    row.append(el('span', 'route', t('plane_' + p.id)));
    if (active) row.append(el('span', 'tag', t('active_plane')));
    else if (!owned && !p.finale) row.append(el('span', 'tag side', fmtRp(p.price)));
    const stats = el('p', 'meta',
      `${t('top_speed')}: ${Math.round(89 * p.speedMul)} KT · ${t('climb_w')}: ${Math.round(p.climbMul * 100)}% · ${t('capacity_w')}: ${p.capacity} · ${p.callsign}`);
    card.append(row, stats);
    if (active) { /* she is the one on the line */ }
    else if (owned) {
      card.append(btn(t('switch_plane'), 'small', 'use-plane-' + p.id, () => {
        if (switchPlane(save, p.id)) { storeSave(store, save); setActivePlaneMesh(); audio.blip('switch'); renderHangar(); }
      }));
    } else if (p.finale) {
      // The flagship is never sold: the campaign itself is the price.
      card.append(el('p', 'meta', t('jet_locked')));
    } else {
      const b = btn(`${t('buy_plane')} · ${fmtRp(p.price)}`, 'small', 'buy-plane-' + p.id, () => {
        if (!buyPlane(save, p.id)) { toast(t('not_enough')); return; }
        storeSave(store, save); audio.blip('coin'); renderHangar();
      });
      if (save.saldo < p.price) b.disabled = true;
      card.append(b);
    }
    s.append(card);
  }
  const rows = [
    ['engine', t('engine'), t('engine_desc')], ['fuel', t('fuel_tank'), t('fuel_desc')], ['hull', t('hull'), t('hull_desc')],
    ['handling', t('up_handling'), t('up_handling_desc')],
  ];
  for (const [key, name, desc] of rows) {
    const lvl = save.upgrades[key];
    const card = el('div', 'panel card');
    const row = el('div', 'row');
    row.append(el('span', 'route', name), el('span', 'pips', '●'.repeat(lvl) + '○'.repeat(3 - lvl)));
    card.append(row, el('p', 'meta', `${t('lvl')} ${lvl} — ${desc}`));
    if (lvl >= 3) card.append(el('p', 'meta', t('maxed')));
    else {
      const cost = UPGRADE_COST[key][lvl];
      const b = btn(`${t('buy')} · ${fmtRp(cost)}`, 'small', 'buy-' + key, () => {
        if (save.saldo < cost) { toast(t('not_enough')); return; }
        save.saldo -= cost; save.upgrades[key]++; storeSave(store, save); audio.blip('coin'); renderHangar();
      });
      if (save.saldo < cost) b.disabled = true;
      card.append(b);
    }
    s.append(card);
  }
  s.append(btn(t('back'), 'small', 'back', () => { renderTitle(); show('title'); }));
}
// Point the stage at the active airframe: the scene draws ONE plane
// mesh, so a switch rebuilds it from the new plane's livery and span —
// or, for the flagship, from the jet builder entirely (v13).
function setActivePlaneMesh() {
  if (R && assets) {
    const p = planeById(save.planes.active);
    assets.plane = p.jet ? buildJet(R) : buildPlane(R, p);
  }
}

// Hangar icons (v13): each airframe's portrait is its OWN mesh, rendered
// once offscreen in senja light against a dark card ground — the jet
// through the jet builder, the floatplanes through theirs, liveries and
// proportions exactly as flown. Cached for the session; a plane's
// portrait can never drift from its model.
let iconCache = null;
function planeIcons() {
  if (iconCache) return iconCache;
  iconCache = {};
  if (!R) return iconCache;
  try {
    const cv = document.createElement('canvas'); cv.width = 264; cv.height = 132;
    const R2 = createRenderer(cv);
    if (!R2) return iconCache;
    R2.setEnv({ ...skyAt(1, 18.25), fog: [0.10, 0.06, 0.09], fogD: 0.0001 });
    for (const p of PLANES) {
      const built = p.jet ? buildJet(R2) : buildPlane(R2, p);
      const d = p.jet ? 36 : 12.5, hh = p.jet ? 3.2 : 1.5;
      const eye = [-d, hh + 3.6, -d * 0.30];
      R2.begin();
      R2.setCamera(M4.lookAt(eye, [0, hh * 0.72, 0], [0, 1, 0]), M4.persp(0.60, 2, 0.5, 400), eye);
      R2.draw(built.plane, M4.compose(0, 0, 0, 0, 0.5, 0, p.jet ? 1 : p.scale));
      iconCache[p.id] = cv.toDataURL('image/png');
    }
  } catch { iconCache = {}; }
  return iconCache;
}

// Hangar preview (v14): the selected airframe ALIVE above the fleet
// cards — her own mesh on a slow turntable, propeller turning; the
// flagship wears fan blur at her four intakes instead. One renderer,
// meshes cached per airframe, and a rAF loop that lives only while
// the hangar is on screen. At dossier capture the pose is pinned
// (previewPose under IS_SHOT), so the hangar frame stays byte-stable.
let pvState = null, pvR = null, pvMeshes = {}, pvRaf = 0;
function hangarPreviewPanel() {
  const card = el('div', 'panel card pvcard');
  const cv = document.createElement('canvas'); cv.id = 'pvcanvas';
  cv.width = 660; cv.height = 300; cv.style.width = '100%'; cv.style.display = 'block';
  card.append(cv);
  if (!pvState) pvState = createPreviewState(save.planes.active);
  requestAnimationFrame(pvTick);
  return card;
}
function pvTick() {
  cancelAnimationFrame(pvRaf);
  if (screen !== 'hangar') return;
  const cv = $('#pvcanvas'); if (!cv) return;
  try {
    if (!pvR) { pvR = createRenderer(cv); if (pvR) pvR.setEnv({ ...skyAt(1, 18.25), fog: [0.10, 0.06, 0.09], fogD: 0.0001 }); }
    if (pvR && pvState) {
      const pose = previewPose(pvState, ambient, IS_SHOT);
      const spec = planeById(pose.planeId);
      if (!pvMeshes[pose.planeId]) {
        pvMeshes[pose.planeId] = spec.jet
          ? { ...buildJet(pvR), fan: buildJetFanBlur(pvR) }
          : buildPlane(pvR, spec);
      }
      const m = pvMeshes[pose.planeId];
      const d = spec.jet ? 36 : 12.5, hh = spec.jet ? 3.2 : 1.5;
      const eye = [-d, hh + 3.6, -d * 0.30];
      pvR.begin();
      pvR.setCamera(M4.lookAt(eye, [0, hh * 0.72, 0], [0, 1, 0]), M4.persp(0.60, cv.width / cv.height, 0.5, 400), eye);
      const planeM = M4.compose(0, 0, 0, 0, pose.yaw, 0, spec.jet ? 1 : spec.scale);
      pvR.draw(m.plane, planeM);
      if (spec.jet) {
        for (const [fx, fz] of [[3.8, -1.42], [7.6, 0.18], [-3.8, -1.42], [-7.6, 0.18]]) {
          pvR.draw(m.fan, M4.mul(planeM, M4.compose(fx, 0.5, fz, 0, 0, pose.yaw * 7 + fx, 1)), 0.25 + pose.glow * 0.45);
        }
      } else {
        const propM = M4.mul(planeM, M4.compose(0, 1.00, -3.42, 0, 0, pose.prop));
        pvR.draw(m.prop, propM);
        pvR.draw(m.disc, propM, 0.16 + pose.glow * 0.10);
      }
    }
  } catch { /* a preview must never break the hangar */ }
  pvRaf = requestAnimationFrame(pvTick);
}
function planeIconImg(id, cls) {
  const src = planeIcons()[id];
  if (!src) return null;
  const im = document.createElement('img');
  im.className = cls; im.src = src; im.alt = t('plane_' + id);
  return im;
}
function renderChallenges() {
  const s = $('#scr-challenges'); s.innerHTML = '';
  s.append(chipsRow(), el('h2', 'ptitle', t('challenges_title')));
  const keys = { rings: 'ch_rings', grade: 'ch_grade', centre: 'ch_centre', fast: 'ch_fast', storm: 'ch_storm', rescue: 'ch_rescue', smooth: 'ch_smooth' };
  for (const ch of CHALLENGES) {
    const card = el('div', 'panel card');
    const row = el('div', 'row');
    row.append(el('span', 'route', t(keys[ch.id.replace(/[0-9]/g, '')] || keys[ch.kind], { n: ch.n, g: ch.g })),
      save.challengesDone.includes(ch.id) ? el('span', 'tag', t('ch_done')) : el('span', 'tag side', `${t('ch_bonus')} ${fmtRp(ch.bonus)}`));
    card.append(row); s.append(card);
  }
  s.append(btn(t('back'), 'small', 'back', () => { renderTitle(); show('title'); }));
}
function renderStats() {
  const s = $('#scr-stats'); s.innerHTML = '';
  s.append(chipsRow(), el('h2', 'ptitle', t('stats_title')));
  const card = el('div', 'panel card');
  const rows = [
    [t('st_flights'), save.stats.flights], [t('st_deliveries'), save.stats.deliveries],
    [t('st_rings'), save.stats.rings], [t('st_best'), save.stats.bestGrade || '—'],
    [t('st_rescues'), save.stats.rescues || 0], [t('st_storms'), save.stats.stormRuns || 0],
    [t('st_photos'), save.stats.photos || 0], [t('st_smooth'), save.stats.smoothRuns || 0],
    [t('st_earned'), fmtRp(save.stats.earned)],
    [t('st_stamps'), save.stamps.map(id => ISLANDS.find(i => i.id === id)?.name).filter(Boolean).join(', ') || '—'],
  ];
  for (const [k, v] of rows) { const m = el('div', 'money'); m.append(el('span', '', k), el('b', '', String(v))); card.append(m); }
  s.append(card, btn(t('back'), 'small', 'back', () => { renderTitle(); show('title'); }));
}
function segControl(get, set) {
  const wrap = el('div', 'segrow');
  for (let i = 1; i <= 5; i++) {
    const seg = el('button', 'seg' + (get() >= i ? ' fill' : ''));
    seg.dataset.seg = String(i);
    seg.addEventListener('click', () => { set(get() === i && i === 1 ? 0 : i); });
    wrap.append(seg);
  }
  wrap.append(el('span', 'seglabel', `${get()} / 5`));
  return wrap;
}
function renderSettings() {
  const s = $('#scr-settings'); s.innerHTML = '';
  s.append(el('h2', 'ptitle', t('settings_title')));
  const card = el('div', 'panel card');
  const row = (name, control) => { const r = el('div', 'setrow'); r.append(el('span', 'setname', name), control); return r; };
  card.append(row(t('music'), segControl(() => save.settings.music, v => { save.settings.music = v; storeSave(store, save); audio.applyLevels(); renderSettings(); })));
  card.append(row(t('sfx'), segControl(() => save.settings.sfx, v => { save.settings.sfx = v; storeSave(store, save); audio.applyLevels(); renderSettings(); })));
  card.append(row(t('radio_w'), segControl(() => save.settings.radio ?? 4, v => { save.settings.radio = v; storeSave(store, save); audio.applyLevels(); renderSettings(); })));
  const master = el('div', 'segrow');
  for (const on of [true, false]) {
    const b = btn(on ? t('on') : t('off'), 'small' + (save.settings.master === on ? ' on' : ''), '', () => {
      save.settings.master = on; storeSave(store, save); audio.applyLevels(); renderSettings();
    });
    master.append(b);
  }
  card.append(row(t('master'), master));
  const season = el('div', 'segrow');
  for (const k of ['calm', 'breezy', 'fresh']) {
    season.append(btn(t('season_word_' + k), 'small' + (save.settings.season === k ? ' on' : ''), '', () => {
      save.settings.season = k; storeSave(store, save); renderSettings();
    }));
  }
  card.append(row(t('season'), season));
  const lang = el('div', 'segrow');
  for (const [k, key] of [['en', 'lang_en'], ['id', 'lang_id']]) {
    lang.append(btn(t(key), 'small' + (save.settings.lang === k ? ' on' : ''), '', () => {
      save.settings.lang = k; t = makeT(k); storeSave(store, save); renderAll(); show('settings');
    }));
  }
  card.append(row(t('language'), lang));
  let armed = false;
  const reset = btn(t('reset_save'), 'small', 'reset', () => {
    if (!armed) { armed = true; reset.textContent = t('reset_confirm'); return; }
    store.removeItem(SAVE_KEY); const st = save.settings;
    save = defaultSave(); save.settings = st; storeSave(store, save);
    renderAll(); show('title');
  });
  card.append(row('', reset));
  s.append(card, btn(t('back'), 'small', 'back', () => { renderTitle(); show('title'); }));
}
function renderControls() {
  const s = $('#scr-controls'); s.innerHTML = '';
  s.append(el('h2', 'ptitle', t('controls_title')));
  const hcard = el('div', 'panel card');
  const hrow = el('div', 'row');
  hrow.append(el('span', 'route', t('handling')));
  const hbtns = el('div', 'segrow');
  for (const m of ['assisted', 'direct']) {
    hbtns.append(btn(t('handling_' + m), 'small' + ((save.handling || 'assisted') === m ? ' on' : ''), 'handling-' + m, () => setHandling(m)));
  }
  hrow.append(hbtns);
  hcard.append(hrow, el('p', 'meta', t('handling_desc')));
  s.append(hcard);
  const cards = [
    ['keyboard', t('scheme_keyboard'), t('kb_desc') + (coarse ? '\n' + t('kb_note_touch') : '')],
    ['joystick', t('scheme_joystick'), t('joy_desc')],
    ['touch', t('scheme_touch'), t('touch_desc')],
    ['gyro', t('scheme_gyro'), t('gyro_desc')],
  ];
  for (const [key, name, desc] of cards) {
    const card = el('div', 'panel card');
    const row = el('div', 'row');
    row.append(el('span', 'route', name));
    const use = btn(scheme === key ? t('active') : t('use_this'), 'small' + (scheme === key ? ' on' : ''), 'use-' + key, () => setScheme(key));
    row.append(use);
    card.append(row);
    const d = el('p', 'meta', desc); d.style.whiteSpace = 'pre-line'; card.append(d);
    if (key === 'gyro') card.append(gyroPanel());
    s.append(card);
  }
  s.append(btn(t('back'), 'small', 'back', () => backFromControls()));
}
function gyroPanel() {
  const wrap = el('div');
  const status = el('p', 'meta', t('gyro_status_' + gyro.status)); status.id = 'gyrostatus';
  const enable = btn(t('gyro_enable'), 'small', 'gyro-enable', onGyroEnable);
  const sens = el('div', 'segrow');
  for (const k of ['calm', 'std', 'hot']) {
    sens.append(btn(t('gyro_' + k), 'small' + (gyro.sens === k ? ' on' : ''), '', () => { gyro.sens = k; renderControls(); }));
  }
  const cal = btn(t('gyro_calibrate'), 'small', 'gyro-cal', () => {
    gyro.neutral = { beta: tilt.beta, gamma: tilt.gamma }; toast(t('gyro_status_on'));
  });
  wrap.append(status, enable, sens, cal);
  return wrap;
}
function setGyroStatus(st) {
  gyro.status = st;
  const e = $('#gyrostatus'); if (e) e.textContent = t('gyro_status_' + st);
}
function onGyroEnable() {
  // The permission request MUST be the first synchronous statement (iOS rule).
  const req = (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function')
    ? DeviceOrientationEvent.requestPermission() : null;
  setGyroStatus('waiting');
  const begin = () => {
    gyro.enabled = true;
    let got = false;
    window.addEventListener('deviceorientation', ev => {
      if (ev.beta === null || ev.gamma === null) return;
      tilt.beta = ev.beta; tilt.gamma = ev.gamma; got = true;
      if (!gyro.have) { gyro.have = true; gyro.neutral = { beta: ev.beta, gamma: ev.gamma }; setGyroStatus('on'); }
    });
    setTimeout(() => { if (!got) setGyroStatus(typeof DeviceOrientationEvent === 'undefined' ? 'unsupported' : 'nosensor'); }, 1400);
  };
  if (req && typeof req.then === 'function') {
    req.then(r => { if (r === 'granted') begin(); else setGyroStatus('denied'); })
      .catch(() => setGyroStatus('error'));
  } else if (typeof DeviceOrientationEvent !== 'undefined') begin();
  else setGyroStatus('unsupported');
}
const CAM_ORDER = ['near', 'far', 'cockpit'];
function cycleCam() {
  camMode = CAM_ORDER[(CAM_ORDER.indexOf(camMode) + 1) % CAM_ORDER.length];
  save.camMode = camMode; storeSave(store, save);
  const b = $('#cambtn'); if (b) b.textContent = t('cam_' + camMode);
  audio.blip('click');
}
function setHandling(mode) {
  save.handling = mode; storeSave(store, save);
  renderControls();
}
function setScheme(key) {
  // Only the writer changes: the shared frame (and with it throttle and the
  // flight itself) is untouched, so a mid-flight switch is seamless.
  scheme = key; save.scheme = key; storeSave(store, save);
  renderControls(); updateFlightControls();
}
function backFromControls() {
  if (controlsReturn === 'pause') { show('flight'); $('#pause').classList.add('on'); }
  else { renderTitle(); show('title'); }
}
function renderHowto() {
  const s = $('#scr-howto'); s.innerHTML = '';
  s.append(el('h2', 'ptitle', t('how_title')));
  const card = el('div', 'panel card');
  card.append(el('p', 'meta', t('how_body')));
  s.append(card, btn(t('back'), 'small', 'back', () => { renderTitle(); show('title'); }));
}
function renderAll() { renderTitle(); renderBoard(); renderHangar(); renderControls(); renderChallenges(); renderStats(); renderSettings(); renderHowto(); renderMap(); }

// ---------- flight HUD & controls (built once, updated per frame) ----------
function buildHud() {
  const hud = el('div'); hud.id = 'hud';
  const top = el('div', 'topbar');
  const left = el('div', 'col');
  const rings = el('div', 'hchip'); rings.id = 'hud-rings';
  const dest = el('div', 'hchip'); dest.id = 'hud-dest';
  const wx = el('div', 'hchip'); wx.id = 'hud-wx';
  left.append(rings, dest, wx);
  const mid = el('div'); const timer = el('div'); timer.id = 'timer'; timer.textContent = '0:00';
  const sch = el('div', 'hchip'); sch.id = 'hud-scheme'; sch.style.textAlign = 'center'; sch.style.marginTop = '6px';
  mid.append(timer, sch);
  const right = el('div', 'col'); right.style.alignItems = 'flex-end';
  const pauseB = el('button'); pauseB.id = 'pausebtn'; pauseB.textContent = '❚❚'; pauseB.dataset.act = 'pause';
  pauseB.addEventListener('click', () => setPaused(true));
  const camB = el('button'); camB.id = 'cambtn'; camB.dataset.act = 'cam';
  camB.textContent = t('cam_' + camMode);
  camB.addEventListener('click', () => cycleCam());
  const togo = el('div', 'hchip'); togo.id = 'hud-togo';
  // The mission tracker (v12) rides the RIGHT column: the left column's
  // fourth slot would slide under the gauges canvas and hide the job.
  const obj = el('div', 'hchip'); obj.id = 'hud-obj';
  right.append(pauseB, camB, togo, obj);
  top.append(left, mid, right);
  const gauges = document.createElement('canvas'); gauges.id = 'gauges';
  gauges.width = 300; gauges.height = 148;
  const ribbon = el('div'); ribbon.id = 'ribbon';
  const track = el('div', 'track'); const marker = el('div', 'marker'); marker.id = 'rib-marker';
  ribbon.append(track, marker);
  for (const ft of [0, 100, 200, 300]) {
    const tick = el('div', 'tick', ft + ' FT');
    tick.style.bottom = `calc(${4 + (ft / 320) * 88}% )`;
    tick.dataset.ft = String(ft);
    ribbon.append(tick);
  }
  const guide = el('div'); guide.id = 'guide';
  const radioStrip = el('div'); radioStrip.id = 'radio'; radioStrip.style.display = 'none';
  const lookChip = el('div'); lookChip.id = 'lookchip'; lookChip.style.display = 'none';
  const warn = el('div'); warn.id = 'warn';
  const radar = document.createElement('canvas'); radar.id = 'radar';
  radar.width = 116; radar.height = 116;
  // The route box (v14): a compact chart of this leg under the radar —
  // both islands' real coastlines, the route line, and the plane's
  // live mark travelling it. Flight UI only; the HUD hides off-flight.
  const minimap = document.createElement('canvas'); minimap.id = 'minimap';
  minimap.width = 148; minimap.height = 104;
  const veil = el('div'); veil.id = 'cloudveil';
  const rain = document.createElement('canvas'); rain.id = 'rain';
  hud.append(top, gauges, ribbon, guide, radioStrip, lookChip, warn, radar, minimap, veil, rain);
  ui.append(hud);
  // Touch pad (TOUCH scheme)
  const pad = el('div', 'fctl'); pad.id = 'pad';
  const mkPad = (label, x, y, key) => {
    const b = el('button', 'fbtn', label); b.style.left = x + 'px'; b.style.top = y + 'px';
    b.dataset.dir = key; bindHold(b, key); pad.append(b);
  };
  mkPad('▲', 64, 0, 'up'); mkPad('◀', 0, 37, 'left'); mkPad('▶', 128, 37, 'right'); mkPad('▼', 64, 74, 'down');
  ui.append(pad);
  // Throttle buttons (TOUCH + GYRO schemes)
  const thr = el('div', 'fctl'); thr.id = 'thrbtns';
  const up = el('button', 'fbtn', '+'); up.style.left = '2px'; up.style.top = '0'; up.dataset.dir = 'thrUp'; bindHold(up, 'thrUp');
  const dn = el('button', 'fbtn', '−'); dn.style.left = '2px'; dn.style.top = '92px'; dn.dataset.dir = 'thrDn'; bindHold(dn, 'thrDn');
  const tv = el('div'); tv.id = 'thrval'; tv.textContent = 'THR 0%';
  thr.append(up, dn, tv); ui.append(thr);
  // Joystick (JOYSTICK scheme)
  const stick = el('div', 'fctl'); stick.id = 'stick';
  const knob = el('div'); knob.id = 'knob'; stick.append(knob); ui.append(stick);
  bindStick(stick, knob);
  const slider = el('div', 'fctl'); slider.id = 'slider';
  slider.innerHTML = '<div class="slabel">THR</div><div class="rail"></div><div class="fill"></div><div class="grip"></div>';
  ui.append(slider);
  bindSlider(slider);
  // Pause overlay
  const pause = el('div'); pause.id = 'pause';
  const pcard = el('div', 'panel'); pcard.style.cssText = 'display:flex;flex-direction:column;align-items:center;';
  pcard.append(el('h2', 'ptitle', t('pause_title')));
  pcard.append(
    btn(t('resume'), 'primary', 'resume', () => setPaused(false)),
    btn(t('map'), '', 'pause-map', () => { $('#pause').classList.remove('on'); openMap('pause'); }),
    btn(t('controls'), '', 'pause-controls', () => { controlsReturn = 'pause'; $('#pause').classList.remove('on'); renderControls(); show('controls'); }),
    btn(t('quit_title'), '', 'quit', () => quitFlight()),
  );
  pause.append(pcard); ui.append(pause);
  const tst = el('div'); tst.id = 'toast'; ui.append(tst);
}
// Hold-to-press binding: unified Pointer Events + capture, no type gating.
const activeHolds = new Set();
function bindHold(elm, key) {
  const on = e => { e.preventDefault(); try { elm.setPointerCapture(e.pointerId); } catch { /* noop */ } held[key] = true; elm.classList.add('held'); activeHolds.add(off); };
  const off = () => { held[key] = false; elm.classList.remove('held'); activeHolds.delete(off); };
  elm.addEventListener('pointerdown', on);
  elm.addEventListener('pointerup', off);
  elm.addEventListener('pointercancel', off);
  elm.addEventListener('lostpointercapture', off);
}
// A system interruption may retarget or swallow the cancel before it
// reaches the button; a window-level cancel releases every hold and
// centres the stick, so no input can ever stick on.
window.addEventListener('pointercancel', () => {
  for (const off of [...activeHolds]) off();
  stickVec.dx = 0; stickVec.dy = 0;
});
function bindStick(stick, knob) {
  let active = null;
  const setFromEvent = e => {
    const r = stick.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let dx = e.clientX - cx, dy = e.clientY - cy;
    const max = r.width / 2 - 6, len = Math.hypot(dx, dy);
    if (len > max) { dx = dx / len * max; dy = dy / len * max; }
    stickVec.dx = dx; stickVec.dy = dy;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  };
  stick.addEventListener('pointerdown', e => { e.preventDefault(); active = e.pointerId; try { stick.setPointerCapture(e.pointerId); } catch { /* noop */ } setFromEvent(e); });
  stick.addEventListener('pointermove', e => { if (active === e.pointerId) setFromEvent(e); });
  const end = e => { if (active === e.pointerId) { active = null; stickVec.dx = 0; stickVec.dy = 0; knob.style.transform = ''; } };
  stick.addEventListener('pointerup', end);
  stick.addEventListener('pointercancel', end);
}
function bindSlider(slider) {
  let active = null;
  const setFromEvent = e => {
    const r = slider.getBoundingClientRect();
    // Track runs the element's full height; top = full throttle.
    rawFrame.throttle = 1 - sliderValue(e.clientY, r.top, r.height);
    paintSlider(slider);
  };
  slider.addEventListener('pointerdown', e => { e.preventDefault(); active = e.pointerId; try { slider.setPointerCapture(e.pointerId); } catch { /* noop */ } setFromEvent(e); });
  slider.addEventListener('pointermove', e => { if (active === e.pointerId) setFromEvent(e); });
  const end = e => { if (active === e.pointerId) active = null; };
  slider.addEventListener('pointerup', end);
  slider.addEventListener('pointercancel', end);
}
function paintSlider(slider) {
  const fill = slider.querySelector('.fill'), grip = slider.querySelector('.grip');
  const h = slider.clientHeight || 176;
  fill.style.height = (rawFrame.throttle * h) + 'px';
  grip.style.bottom = `calc(${rawFrame.throttle * h}px - 13px)`;
}
function updateFlightControls() {
  const inFlight = screen === 'flight' && !!flightCtx;
  const showCtl = (id, on) => { const e = document.getElementById(id); if (e) e.classList.toggle('on', !!on); };
  showCtl('pad', inFlight && scheme === 'touch');
  showCtl('thrbtns', inFlight && (scheme === 'touch' || scheme === 'gyro'));
  showCtl('stick', inFlight && scheme === 'joystick');
  showCtl('slider', inFlight && scheme === 'joystick');
  if (inFlight && scheme === 'joystick') paintSlider($('#slider'));
}

// ---------- flight lifecycle ----------
function startFlight(ticket) {
  // Taking a ticket sets the clock to its scheduled departure hour; the
  // flight then lives under the (day, hour) weather table, whose word for
  // this hour is the forecast printed on the board.
  if (typeof ticket.depHour === 'number') save.clockH = ticket.depHour;
  const plane = planeById(save.planes.active);
  const f = createFlight({
    legDist: ticket.dist, rings: ticket.rings,
    engineLvl: save.upgrades.engine, hullLvl: save.upgrades.hull,
    wind: windForSeason(save.settings.season) * (WEATHER_PARAMS[ticket.weather]?.windMul ?? 1),
    runwayM: RUNWAY_M, // departures roll on the paved strip at the home island
    // The hangar rides along (v12): the active airframe's speed and
    // climb, the handling kit's response, the mode's stall damping —
    // and the ticket's own objective geometry.
    speedMul: plane.speedMul, climbMul: plane.climbMul, accelMul: plane.accelMul || 1,
    respMul: 1 + ((save.upgrades.handling || 1) - 1) * 0.18,
    assist: (save.handling || 'assisted') === 'assisted',
    pickup: ticket.pickup || null, gate: ticket.gate || null,
  });
  flightCtx = { flight: f, ticket, weather: ticket.weather || 'clear', wxPin: ticket.wxPin || null, finished: false, frozen: false, settle: null, challenge: null, stampEarned: false, fx: [] };
  pilotMode = false; // every fresh flight starts in the player's hands (v13 fix: a demo pilot left engaged by staging used to override the next flight's controls — throttle and keys alike)
  envNow = skyAt(save.day, save.clockH, flightCtx.wxPin);
  flightCtx.weather = envNow.state;
  storeSave(store, save);
  frame.pitch = 0; frame.roll = 0; frame.throttle = 0;
  rawFrame.pitch = 0; rawFrame.roll = 0; rawFrame.throttle = 0;
  for (const k of Object.keys(held)) held[k] = false;
  stickVec.dx = 0; stickVec.dy = 0;
  lookSet(look, 0, 0); lookRelease(look);
  paused = false; warned = false; stallWarned = false;
  $('#pause').classList.remove('on');
  radio = createRadio(); radioQueue = []; radioLog = []; radioNowKey = null; radioBusyUntil = 0;
  audio.radioStop(); // no voice carries over from the last flight (v14)
  // The destination island is THIS ticket's island (v13): its real
  // shape, rebuilt per flight from the world table.
  if (R && assets) assets.isleDest = buildIsland(R, ISLANDS[ticket.to], 1);
  audio.engineStart(); audio.windStart(); audio.rainStart();
  show('flight');
  updateHud();
}
function finishFlight(instant = false) {
  const ctx = flightCtx; if (!ctx || ctx.finished) return;
  ctx.finished = true;
  ctx.wxPin = null; // the receipt backdrop flies under the real clock again
  const f = ctx.flight, ticket = ctx.ticket;
  const settle = settleFlight(f, ticket, save.upgrades.fuel);
  ctx.settle = settle;
  ctx.challenge = challengeResult(save, f, settle, ticket);
  ctx.stampEarned = !!(settle.delivered && ticket.main && ticket.to === save.islandIdx + 1
    && !save.stamps.includes(ISLANDS[ticket.to].id));
  if (ctx.challenge) save.challengesDone.push(ctx.challenge.id);
  const wasJetLocked = !save.planes.owned.includes('raksasa');
  applyResult(save, ticket, f, settle, ctx.challenge ? ctx.challenge.bonus : 0);
  ctx.jetJustUnlocked = wasJetLocked && save.planes.owned.includes('raksasa');
  storeSave(store, save);
  audio.engineStop(); audio.windStop(); audio.rainStop();
  // The crash and the celebration (v13): an exploded arrival gets the
  // boom and the sad sting; a delivery gets the thud its firmness
  // earned, the stamp, and the jingle.
  if (f.exploded) {
    ctx.boom = { x: f.x, dist: f.dist, t0: ambient };
    audio.blip('boom'); audio.jingle('lose');
  } else if (settle.delivered) {
    audio.blip('thud', clamp(Math.abs((f.touchdown ? f.touchdown.vs : -1.1) + 1.1) / 6, 0, 1));
    audio.blip('stamp'); audio.jingle('win');
  } else if (f.outcome === 'splash') audio.blip('splash');
  const go = () => { renderReceipt(); show('receipt'); };
  if (instant) go(); else setTimeout(go, 650);
}
function quitFlight() {
  // Quitting never settles the flight, so cash, stamps and the day stand.
  $('#pause').classList.remove('on');
  paused = false; flightCtx = null;
  audio.engineStop(); audio.windStop(); audio.rainStop(); audio.radioStop();
  renderTitle(); show('title');
}
function setPaused(on) {
  if (!flightCtx || flightCtx.finished) return;
  paused = on;
  if (on) audio.radioStop(); // a paused tower says nothing (v14)
  $('#pause').classList.toggle('on', on);
}
function renderReceipt() {
  const s = $('#scr-receipt'); s.innerHTML = '';
  const { flight: f, ticket, settle, challenge, stampEarned } = flightCtx;
  const titles = { landed: t('receipt_delivered'), aborted: t('receipt_aborted'), missed: t('receipt_missed'), splash: t('receipt_splash') };
  // A rescue that comes home empty gets its own headline: she landed,
  // but the job did not happen. A high-energy arrival gets the fireball.
  const title = f.exploded ? t('receipt_boom')
    : (f.outcome === 'landed' && !settle.delivered && ticket.type === 'rescue')
    ? t('receipt_rescue_missed') : (titles[f.outcome] || titles.missed);
  s.append(el('h2', 'ptitle', title));
  const card = el('div', 'panel card');
  const head = el('div', 'row');
  head.append(el('span', 'route', `${ISLANDS[ticket.from].name} → ${ISLANDS[ticket.to].name}`));
  if (settle.delivered) { const st = el('span', 'stamp', 'TERKIRIM'); head.append(st); }
  card.append(head);
  card.append(el('p', 'meta', `${ticket.customer} — ${save.settings.lang === 'id' ? ticket.cargoId : ticket.cargo}`));
  if (settle.delivered && settle.grade) {
    const grow = el('div', 'row');
    const g = el('div'); g.append(el('span', 'meta', t('r_grade')), el('div', 'gradebig', settle.grade));
    grow.append(g);
    const bars = el('div'); bars.style.flex = '1';
    for (const [label, v] of [[t('r_soft'), f.touchdown.soft], [t('r_centreline'), f.touchdown.centre], [t('r_approach'), f.touchdown.approach]]) {
      const r = el('div', 'barow'); const bar = el('div', 'bar'); const fill = el('i');
      fill.style.width = Math.round(v * 100) + '%'; bar.append(fill);
      r.append(el('span', '', label), bar, el('b', '', Math.round(v * 100) + '%'));
      bars.append(r);
    }
    grow.append(bars); card.append(grow);
  }
  const keyFor = { ticket: 'r_ticket', rings: 'r_rings', centre: 'r_centre', gradebonus: 'r_gradebonus', fuel: 'r_fuel', fee: 'r_fee', comfort: 'r_comfort', photo: 'r_photo', express: 'r_express', trial: 'r_trial' };
  for (const line of settle.lines) {
    const m = el('div', 'money');
    m.append(el('span', '', t(keyFor[line.k]) + (line.n ? ` ×${line.n}` : '')),
      el('b', '', (line.amt < 0 ? '− ' : '+ ') + fmtRp(Math.abs(line.amt))));
    card.append(m);
  }
  if (challenge) {
    const m = el('div', 'money');
    m.append(el('span', '', t('r_challenge')), el('b', '', '+ ' + fmtRp(challenge.bonus)));
    card.append(m);
  }
  const tot = el('div', 'money total');
  tot.append(el('span', '', t('r_total')), el('b', '', fmtRp(settle.total + (challenge ? challenge.bonus : 0))));
  card.append(tot);
  const meta = el('p', 'meta',
    `${t('r_time')}: ${fmtClock(f.t)} · ${stampEarned ? t('r_stamp', { island: ISLANDS[ticket.to].name }) : t('r_nostamp')}\n${t('r_newbalance')}: ${fmtRp(save.saldo)}`);
  meta.style.whiteSpace = 'pre-line';
  card.append(meta);
  // The tower's last word rides the receipt (v13): the welcome, or the
  // unanswered call over a wreck.
  const lastRadio = radioLog[radioLog.length - 1];
  if (lastRadio === 'welcome' || lastRadio === 'crashcall') {
    card.append(el('p', 'meta', `RADIO — ${radioText({ key: lastRadio, speaker: 'tower' })}`));
  }
  s.append(card);
  // The finale celebration (v13): the flight that completes the chain
  // unlocks the flagship, and the receipt says so before anything else.
  if (flightCtx.jetJustUnlocked) {
    const cel = el('div', 'panel card');
    cel.append(el('h3', 'ptitle', t('jet_unlocked_title')), el('p', 'meta', t('jet_unlocked_body')));
    cel.append(btn(t('jet_unlocked_btn'), 'small', 'to-hangar-jet', () => { flightCtx = null; renderHangar(); show('hangar'); }));
    s.append(cel);
  }
  const row = el('div', 'row'); row.style.justifyContent = 'center';
  row.append(
    btn(t('morning_board'), 'primary small', 'to-board', () => { flightCtx = null; showBoard(); }),
    btn(t('hangar'), 'small', 'to-hangar', () => { flightCtx = null; renderHangar(); show('hangar'); }),
    btn(t('title_btn'), 'small', 'to-title', () => { flightCtx = null; renderTitle(); show('title'); }),
  );
  s.append(row);
}

// ---------- HUD ----------
function updateHud() {
  if (!flightCtx) return;
  const f = flightCtx.flight;
  $('#timer').textContent = fmtClock(f.t);
  $('#hud-rings').innerHTML = `${t('hud_rings')} <b>${f.ringsHit}/${f.rings.length}</b>`;
  const remain = Math.max(0, f.legDist - f.dist);
  $('#hud-togo').innerHTML = `${t('hud_to_go')} <b>${(remain / 1000).toFixed(1)} KM</b>`;
  $('#hud-dest').innerHTML = `▸ <b>${ISLANDS[flightCtx.ticket.to].name}</b>`;
  $('#hud-wx').innerHTML = `🕐 <b>${fmtGameHour(save.clockH)}</b> · ${wxIcon(envNow.state)} ${t('wx_' + envNow.state)}`;
  $('#hud-scheme').innerHTML = `${t('scheme_chip')}: <b>${t('scheme_' + scheme)} · ${t('handling_' + (save.handling || 'assisted'))}</b>`;
  drawRadar(f);
  const altFT = f.alt / FT;
  $('#rib-marker').style.bottom = `calc(${4 + clamp(altFT / 320, 0, 1) * 88}% )`;
  const g = guidance(f);
  const guide = $('#guide');
  if (g.mode === 'approach') {
    guide.textContent = g.approach === 'flare' ? t('guide_flare')
      : g.approach === 'descend' ? t('guide_descend') : t('guide_approach', { n: g.targetFT });
  } else if (g.mode === 'ring') {
    const alt = Math.abs(g.dAltFT) <= 6 ? t('guide_ring_level')
      : g.dAltFT > 0 ? t('guide_ring_up', { n: g.dAltFT }) : t('guide_ring_down', { n: -g.dAltFT });
    const line = g.centred ? t('guide_centred') : t('guide_line', { n: (g.dX > 0 ? '+' : '') + g.dX });
    guide.textContent = `${alt} · ${line}`;
  } else if (g.mode === 'done') guide.textContent = t('guide_none');
  else guide.textContent = t('guide_head');
  // A stall outranks every other word on the glass: the wing has quit,
  // and the recovery is always the same sentence.
  if (g.stalled) guide.textContent = t('guide_stall');
  // The mission tracker (v12): the job's objective and its live state.
  const obj = objectiveState(f, flightCtx.ticket);
  const objEl = $('#hud-obj');
  if (objEl) {
    let txt = '';
    if (obj.type === 'passenger') txt = `${t('obj_passenger')} <b>${Math.round(obj.comfort * 100)}%</b>`;
    else if (obj.type === 'rescue') txt = obj.stage === 'deliver' ? t('obj_rescue_deliver')
      : obj.stage === 'missed' ? t('obj_rescue_missed') : t('obj_rescue_go');
    else if (obj.type === 'photo') txt = f.photoTaken ? t('obj_photo_done') : t('obj_photo');
    else if (obj.type === 'express') txt = `${t('obj_express')} <b>${Math.max(0, Math.ceil(obj.left))}s</b>`;
    else if (obj.type === 'trial') txt = t('obj_trial', { n: f.ringsHit, m: obj.need }) + ` <b>${Math.max(0, Math.ceil(obj.left))}s</b>`;
    else if (obj.type === 'storm') txt = t('obj_storm');
    else txt = t('obj_cargo');
    objEl.innerHTML = txt;
  }
  const lc = $('#lookchip');
  if (lc) {
    const looking = Math.abs(look.yaw) > 0.06 || Math.abs(look.pitch) > 0.06;
    lc.style.display = looking ? 'block' : 'none';
    if (looking) lc.textContent = t('look_chip');
  }
  // The overspeed warning exists for the approach, where speed is a landing
  // problem — at ring altitude, full throttle is the correct answer and the
  // warning would only cry wolf.
  $('#warn').style.display = (g.tooFast && remain <= 700) ? 'block' : 'none';
  $('#warn').textContent = t('warn_fast');
  const tv = $('#thrval'); if (tv) tv.textContent = 'THR ' + Math.round(frame.throttle * 100) + '%';
  drawGauges(f);
  drawMinimap(f);
}
// Radar: north-up scope. The plane sits at the centre; the next ring is a
// gold dot, the destination a cream marker at the top bearing, both placed
// by their true relative bearing and scaled distance, with the range ring
// labelled by the distance to the destination.
function drawRadar(f) {
  const c = $('#radar'); if (!c) return;
  const g = c.getContext('2d');
  const cx = 58, cy = 58, R = 52;
  g.clearRect(0, 0, 116, 116);
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2);
  g.fillStyle = 'rgba(14, 26, 30, 0.88)'; g.fill();
  g.strokeStyle = 'rgba(255, 190, 110, 0.65)'; g.lineWidth = 1.5; g.stroke();
  g.beginPath(); g.arc(cx, cy, R * 0.55, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(255, 220, 160, 0.22)'; g.lineWidth = 1; g.stroke();
  const remain = Math.max(0, f.legDist - f.dist);
  const scale = Math.max(remain, 320); // metres mapped to the scope radius
  const plot = (dx, dz) => {
    let px = dx / scale * R, py = -dz / scale * R;
    const len = Math.hypot(px, py);
    if (len > R - 5) { px = px / len * (R - 5); py = py / len * (R - 5); }
    return [cx + px, cy + py];
  };
  // Destination (route centreline ahead) and next ring.
  const [dxX, dxY] = plot(0 - f.x, remain);
  g.fillStyle = '#ffe9c4';
  g.beginPath(); g.arc(dxX, dxY, 4, 0, Math.PI * 2); g.fill();
  const next = f.rings.find(r => !r.passed && !r.missed);
  if (next) {
    const [rx, ry] = plot(next.x - f.x, next.dist - f.dist);
    g.fillStyle = '#ffc21f';
    g.beginPath(); g.arc(rx, ry, 4.5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255, 194, 31, 0.6)'; g.stroke();
  }
  // The mission marks (v12): the rescue boat in cyan, the photo gate in
  // sky blue — the scope shows the job, not just the course.
  if (f.pickup && !f.pickedUp) {
    const [bx, by] = plot(f.pickup.x - f.x, f.pickup.dist - f.dist);
    g.fillStyle = '#57e6e6';
    g.beginPath(); g.arc(bx, by, 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(87, 230, 230, 0.7)'; g.stroke();
  }
  if (f.gate && !f.gate.passed && !f.gate.missed) {
    const [gx, gy] = plot(f.gate.x - f.x, f.gate.dist - f.dist);
    g.fillStyle = '#6fc3ff';
    g.beginPath(); g.arc(gx, gy, 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(111, 195, 255, 0.7)'; g.stroke();
  }
  // The plane: a wedge at the centre, leaning with her bank.
  g.save();
  g.translate(cx, cy); g.rotate(-f.bank * 0.5);
  g.beginPath(); g.moveTo(0, -8); g.lineTo(5.5, 6); g.lineTo(0, 3); g.lineTo(-5.5, 6); g.closePath();
  g.fillStyle = '#f2a541'; g.fill();
  g.restore();
  g.fillStyle = '#f3d9b0'; g.font = '700 9.5px system-ui'; g.textAlign = 'center';
  g.fillText('N', cx, 12);
  g.fillText((remain / 1000).toFixed(1) + ' KM', cx, 105);
}
function drawGauges(f) {
  const c = $('#gauges'); if (!c) return;
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  const dial = (cx, frac, val, unit, label) => {
    const cy = 62, r = 40;
    g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 2.25);
    g.strokeStyle = 'rgba(255,220,160,0.25)'; g.lineWidth = 5; g.stroke();
    g.beginPath(); g.arc(cx, cy, r, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * clamp(frac, 0, 1));
    g.strokeStyle = '#f2a541'; g.stroke();
    const a = Math.PI * 0.75 + Math.PI * 1.5 * clamp(frac, 0, 1);
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (r - 7), cy + Math.sin(a) * (r - 7));
    g.strokeStyle = '#ffe9c4'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#fff3da'; g.font = '800 19px system-ui'; g.textAlign = 'center';
    g.fillText(val, cx, cy + 30);
    g.fillStyle = '#f3d9b0'; g.font = '700 10px system-ui';
    g.fillText(unit, cx, cy + 43); g.fillText(label, cx, 14);
  };
  dial(52, (f.speed / 0.514444) / 100, fmtKnots(f.speed), 'KT', 'SPD');
  dial(150, (f.alt / FT) / 350, fmtFeet(f.alt), 'FT', 'ALT');
  const vsFpm = Math.round(f.vs / FT * 60 / 10) * 10;
  dial(248, (f.vs + 8) / 16, (vsFpm > 0 ? '+' : '') + vsFpm, 'FT/MIN', 'VS');
}

// The route box (v14): the leg at a glance. Both islands are drawn
// from the same outline tables as the big chart, the route is a dashed
// gold line between them, and the plane's wedge rides it by her true
// along-track fraction and lateral offset, leaning with her bank. The
// route data is cached per ticket so the per-frame cost is one canvas
// pass over ~40 points.
let mmRoute = null, mmKey = '';
function drawMinimap(f) {
  const c = $('#minimap'); if (!c || !flightCtx) return;
  const tk = flightCtx.ticket;
  const key = tk.from + '>' + tk.to;
  if (key !== mmKey) { mmKey = key; mmRoute = minimapRoute(tk.from, tk.to); }
  const rt = mmRoute; if (!rt) return;
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  g.clearRect(0, 0, W, H);
  const A = { x: 30, y: H - 24 }, B = { x: W - 30, y: 24 };
  const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const LAT = 260; // metres of lateral offset that reach the box edge
  const p = minimapPlane(rt, f);
  const px = A.x + ux * len * p.frac + nx * clamp(p.lateral / LAT, -1, 1) * 15;
  const py = A.y + uy * len * p.frac + ny * clamp(p.lateral / LAT, -1, 1) * 15;
  const R = 15;
  const drawIsle = (o, cx, cy) => {
    g.beginPath();
    o.forEach((pt, j) => { const X = cx + pt.dx * R, Y = cy - pt.dy * R; j ? g.lineTo(X, Y) : g.moveTo(X, Y); });
    g.closePath(); g.fillStyle = '#7fae5f'; g.fill();
    g.strokeStyle = '#d9b878'; g.lineWidth = 1.4; g.stroke();
  };
  g.strokeStyle = 'rgba(242, 165, 65, 0.9)'; g.lineWidth = 1.6; g.setLineDash([5, 4]);
  g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke(); g.setLineDash([]);
  drawIsle(rt.from.outline, A.x, A.y);
  drawIsle(rt.to.outline, B.x, B.y);
  g.beginPath(); g.arc(B.x, B.y, 4.5, 0, Math.PI * 2); g.strokeStyle = '#ffe9c4'; g.lineWidth = 1.6; g.stroke();
  g.save();
  g.translate(px, py); g.rotate(Math.atan2(uy, ux) + Math.PI / 2 - f.bank * 0.5);
  g.beginPath(); g.moveTo(0, -7); g.lineTo(4.8, 5.4); g.lineTo(0, 2.6); g.lineTo(-4.8, 5.4); g.closePath();
  g.fillStyle = '#f2a541'; g.fill();
  g.restore();
  g.fillStyle = '#f3d9b0'; g.font = '700 8.5px system-ui'; g.textAlign = 'center';
  g.fillText(rt.from.name.toUpperCase(), A.x, H - 4);
  g.fillText(rt.to.name.toUpperCase(), B.x, 12);
}

// ---------- input: keyboard & global keys ----------
window.addEventListener('keydown', e => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  keys.add(e.code);
  if ((e.code === 'Escape' || e.code === 'KeyP') && screen === 'flight') setPaused(!paused);
  if (e.code === 'KeyC' && screen === 'flight') cycleCam();
});
window.addEventListener('keyup', e => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());
document.addEventListener('pointerdown', () => { audio.ensure(); }, { once: true });

// Free-look drag (v12): a drag that starts on the bare stage — not on a
// button, the stick, the throttle slider or any flight control — turns
// the pilot's head instead of flying the plane. The listener sits on
// the document because the HUD is pointer-events:none by design: a
// drag on open sky lands on the canvas, and the canvas is the stage.
// The flight controls keep their own pointer handling; the look drag
// never touches the frame, so a second finger can look while the
// first one flies.
document.addEventListener('pointerdown', e => {
  if (screen !== 'flight' || lookPointer.on) return;
  if (e.target.closest('button') || e.target.closest('#stick') || e.target.closest('#slider') || e.target.closest('.fctl')) return;
  lookPointer.id = e.pointerId; lookPointer.x = e.clientX; lookPointer.y = e.clientY; lookPointer.on = true;
});
window.addEventListener('pointermove', e => {
  if (!lookPointer.on || e.pointerId !== lookPointer.id) return;
  lookDrag(look, e.clientX - lookPointer.x, e.clientY - lookPointer.y);
  lookPointer.x = e.clientX; lookPointer.y = e.clientY;
});
const endLookDrag = e => {
  if (lookPointer.on && e.pointerId === lookPointer.id) { lookPointer.on = false; lookRelease(look); }
};
window.addEventListener('pointerup', endLookDrag);
window.addEventListener('pointercancel', endLookDrag);

// ---------- the 3D stage ----------
const canvas = $('#gl');
let R = null, scene = null, assets = null;
try { R = createRenderer(canvas); } catch { R = null; }
if (R) {
  assets = {
    plane: buildPlane(R, planeById(save.planes.active)),
    isleHome: buildIsland(R, ISLANDS[0], 1),
    isleDest: buildIsland(R, ISLANDS[1], 1),
    islets: [
      { mesh: buildIsland(R, ISLANDS[2], 0.5), x: -170, f: 0.3, rot: 1.2, s: 0.55 },
      { mesh: buildIsland(R, ISLANDS[4], 0.5), x: 210, f: 0.55, rot: 2.6, s: 0.7 },
      { mesh: buildIsland(R, ISLANDS[1], 0.5), x: -240, f: 0.78, rot: 0.4, s: 0.5 },
      { mesh: buildIsland(R, ISLANDS[3], 0.42), x: -820, f: 0.44, rot: 2.1, s: 0.5 }, // a far western silhouette for depth (v14)
    ],
    rings: buildRingMeshes(R),
    sea: buildSeaMesh(R),
    sky: buildSkyMesh(R),
    buoys: buildBuoys(R),
    strip: buildStrip(R),
    stripGlow: buildStripGlow(R),
    deptStrip: buildDepartureRunway(R),
    deptGlow: buildDepartureGlow(R),
    homeTerrain: buildHomeTerrain(R),
    shallows: buildShallows(R),
    destShallows: buildDestShallows(R),
    boom: buildExplosion(R),
    bird: buildBird(R),
    beacon: buildBeacon(R),
    flag: buildFlag(R),
    van: buildVan(R),
    sock: buildSock(R),
    airport: buildAirport(R),
    cloud: buildCloud(R),
    cloudB: buildCloudB(R),
    cloudC: buildCloudC(R),
    boat: buildBoat(R),
    gate: buildGateMesh(R),
    cockpit: buildCockpit(R),
    cone: buildLightCone(R),
    streaks: buildStreaks(R),
    shadow: buildBlob(R, [0.03, 0.05, 0.07]),
    foam: buildBlob(R, [0.98, 0.95, 0.88]),
  };
  scene = createScene(R, assets);
} else {
  const n = el('div'); n.id = 'nogl'; n.style.display = 'flex';
  n.textContent = 'WebGL 2 is not available in this browser, so the 3D flight cannot start.';
  document.body.append(n);
}
const demoRings = ringCourse(HOP_M[0], 5, 42);
function stageState() {
  if (flightCtx) {
    const f = flightCtx.flight;
    return { dist: f.dist, x: f.x, alt: f.alt, speed: f.speed, vs: f.vs, bank: f.bank, pitchVis: f.pitchVis,
      rings: f.rings, legDist: f.legDist, time: IS_SHOT ? 3.7 : ambient, propSpin, fx: flightCtx.fx, camMode, env: envNow,
      surface: f.surface, discA: 0.08 + 0.24 * frame.throttle,
      boom: flightCtx.boom ? { x: flightCtx.boom.x, dist: flightCtx.boom.dist, age: ambient - flightCtx.boom.t0 } : null,
      lookYaw: look.yaw, lookPitch: look.pitch, planeScale: planeById(save.planes.active).scale,
      camMul: planeById(save.planes.active).camMul || 1,
      seatY: planeById(save.planes.active).seatY, seatZ: planeById(save.planes.active).seatZ,
      pickup: f.pickup, gate: f.gate };
  }
  if (titleBackdrop) {
    // The posed cover flight (v12): rotating off the land runway in the
    // senja light, the strip and the field in frame under the logo.
    return { ...titleBackdrop, vs: 2, rings: demoRings, legDist: HOP_M[0],
      time: IS_SHOT ? 3.7 : ambient, propSpin: 33, fx: [], env: envNow,
      planeScale: planeById(save.planes.active).scale };
  }
  // Title backdrop: the plane under way over open sea, offset so the menu
  // column does not swallow her. In shot mode her gentle wobble is pinned
  // to the same fixed phase as everything else on the staged stage.
  const amb = IS_SHOT ? 3.7 : ambient;
  return { dist: 500, x: -40, alt: 40 + Math.sin(amb * 0.5) * 1.2, speed: 32, vs: 0,
    bank: 0.14 + Math.sin(amb * 0.35) * 0.04, pitchVis: 0, rings: demoRings, legDist: HOP_M[0],
    time: amb, propSpin: IS_SHOT ? 33 : ambient * 9, fx: [], camBack: 30, camUp: -2, aimDy: -9.6, env: envNow,
    planeScale: planeById(save.planes.active).scale };
}
function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}
window.addEventListener('resize', resize);
resize();

// ---------- main loop ----------
let lastTs = 0, acc = 0;
let musicMood = ''; // the music loop's current weather (v13)
const STEP = 1 / 60;
let pilotMode = false; // demo-pilot control, used by staging and the test rig
function stepOnce(dt) {
  const ctx = flightCtx; if (!ctx) return;
  const f = ctx.flight;
  if (pilotMode) pilotFrame(f, rawFrame);
  else if (scheme === 'keyboard') keyboardFrame(rawFrame, keys, dt);
  else if (scheme === 'joystick') stickFrame(rawFrame, stickVec.dx, stickVec.dy, 46);
  else if (scheme === 'touch') touchFrame(rawFrame, held, dt);
  else if (scheme === 'gyro') {
    if (gyro.enabled) gyroFrame(rawFrame, tilt.beta, tilt.gamma, gyro.neutral, gyro.sens);
    gyroButtons(rawFrame, held, dt);
  }
  // The handling mode conditions raw hands into the flown frame.
  conditionFrame(frame, rawFrame, dt, save.handling || 'assisted', f.x);
  // The wind is the weather's, and the weather follows the clock: a leg that
  // crosses into a storm hour earns its harder drift honestly.
  f.wind = windForSeason(save.settings.season) * envNow.windMul;
  const before = f.ringsHit;
  stepFlight(f, frame, dt);
  pollRadio(); // the tower speaks at flight phases, judged after each step
  propSpin += dt * (3 + frame.throttle * 34);
  audio.engineSet(frame.throttle, f.speed / (89 * 0.514444));
  audio.windSet(f.speed / 46);
  if (f.ringsHit > before) {
    audio.blip('ring');
    // The pass must be FELT the same frame: a flash blooms where the ring
    // was crossed and the FOV kicks (scene3d reads the fx list).
    const crossed = f.rings.filter(r => r.passed).sort((a, b) => b.dist - a.dist)[0];
    if (crossed) ctx.fx.push({ x: crossed.x, altM: crossed.altM, dist: crossed.dist, age: 0 });
  }
  const g = guidance(f);
  if (g.tooFast && !warned) { warned = true; audio.blip('warn'); }
  if (!g.tooFast) warned = false;
  // The stall warning sounds once per stall, on entry — a held note
  // while the nose drops would only shout over the recovery.
  if (g.stalled && !stallWarned) { stallWarned = true; audio.blip('stall'); }
  if (!g.stalled) stallWarned = false;
  if (f.done) finishFlight();
}
// The menu clock chip is rendered once per screen, so its text must be
// refreshed as the clock runs — the value advanced all along, but the
// board's baked-in "06:30" never moved (the gate watched it for 65 s).
// Refresh every live clock face whenever the displayed minute changes.
let lastClockFace = '';
function refreshClockFaces() {
  const face = fmtGameHour(save.clockH);
  if (face === lastClockFace) return;
  lastClockFace = face;
  const icon = wxIcon(weatherAtBlock(save.day, blockOfHour(save.clockH)));
  for (const e of document.querySelectorAll('.clockface')) e.textContent = face;
  for (const e of document.querySelectorAll('.wxface')) e.textContent = icon;
}

// The game clock: one game hour per GAME_HOUR_SECONDS of unpaused play.
// It runs on menus too — the title's sky lives — and the environment is
// recomputed from it every frame, so light and weather never pop.
function advanceClock(dt) {
  if (paused || IS_SHOT) return; // staging pins the hour it set: dossier frames must not drift
  const prevHour = Math.floor(save.clockH);
  save.clockH = (save.clockH + dt / GAME_HOUR_SECONDS) % 24;
  if (Math.floor(save.clockH) !== prevHour) storeSave(store, save);
  envNow = skyAt(save.day, save.clockH, flightCtx ? flightCtx.wxPin : null);
  if (flightCtx) flightCtx.weather = envNow.state;
  refreshClockFaces();
}
function loop(ts) {
  requestAnimationFrame(loop);
  const now = ts / 1000;
  // The frame clamp is a quarter second, not a tenth (v11): on a slow
  // renderer the old clamp made the whole game run in slow motion —
  // the render rate capped the SIM rate, so a struggling device didn't
  // just drop frames, it dropped game time, and a takeoff roll could
  // outlast the runway clock. Physics still steps in fixed 1/60 quanta
  // (identical per-step behaviour at any frame rate); the accumulator
  // simply gets a big enough budget to keep game time honest down to
  // ~4 fps. On a healthy 60 fps device nothing changes at all.
  const dt = Math.min(now - (lastTs || now), 0.25);
  lastTs = now;
  ambient += dt;
  // The pilot's head (v12): keyboard look turns at a steady rate while
  // its keys are held; the head itself eases and recentres in updateLook.
  if (screen === 'flight') {
    const kv = 150 * dt; // pixels-equivalent per frame of held key
    if (keys.has('KeyJ')) lookDrag(look, -kv, 0);
    if (keys.has('KeyL')) lookDrag(look, kv, 0);
    if (keys.has('KeyI')) lookDrag(look, 0, -kv);
    if (keys.has('KeyK')) lookDrag(look, 0, kv);
    if (keys.has('KeyJ') || keys.has('KeyL') || keys.has('KeyI') || keys.has('KeyK')) look.active = true;
    else if (!lookPointer.on && !lookPin) lookRelease(look);
  }
  updateLook(look, dt);
  advanceClock(dt);
  // The music follows the moment (v13): bright by day, calm at night,
  // tense in a storm, the flight figure under way. The mood is recomputed
  // cheaply and the loop only restarts when it actually changes.
  const mood = (flightCtx && screen === 'flight')
    ? (envNow.state === 'storm' ? 'storm' : 'flight')
    : envNow.state === 'storm' ? 'storm' : (save.clockH >= 19 || save.clockH < 5.2) ? 'night' : 'day';
  if (mood !== musicMood) { musicMood = mood; audio.startMusic(mood); }
  pumpRadio(ambient);
  audio.rainSet(flightCtx && screen === 'flight' ? envNow.rain : 0);
  if (screen === 'flight' && flightCtx && !paused && !flightCtx.finished && !flightCtx.frozen) {
    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard++ < 16) { stepOnce(STEP); acc -= STEP; }
    updateHud();
  }
  if (flightCtx) { // ring flashes age in real time, even on a frozen stage
    for (const fx of flightCtx.fx) fx.age += dt;
    flightCtx.fx = flightCtx.fx.filter(fx => fx.age < 0.5);
  }
  // Weather drives the rain layer; the cloud veil rises as the plane nears
  // a cloud's heart. Fog itself rides inside the environment now.
  drawRain();
  drawVeil();
  if (scene) scene.draw(stageState());
}

// ---------- weather layers ----------
const rainDrops = [];
function drawRain() {
  const c = $('#rain'); if (!c) return;
  const raining = !!(flightCtx && screen === 'flight' && envNow.rain > 0.3);
  c.style.display = raining ? 'block' : 'none';
  if (!raining) return;
  c.style.opacity = String(Math.min(1, 0.35 + envNow.rain * 0.75));
  if (c.width !== window.innerWidth) { c.width = window.innerWidth; c.height = window.innerHeight; }
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  while (rainDrops.length < 150) rainDrops.push({ x: Math.random() * c.width, y: Math.random() * c.height, l: 13 + Math.random() * 15, s: 620 + Math.random() * 380 });
  g.strokeStyle = 'rgba(196, 222, 248, 0.38)'; g.lineWidth = 1.1;
  g.beginPath();
  for (const d of rainDrops) {
    d.y += d.s * 0.016; d.x -= d.s * 0.0035;
    if (d.y > c.height) { d.y = -20; d.x = Math.random() * (c.width + 40); }
    g.moveTo(d.x, d.y); g.lineTo(d.x - 2.5, d.y + d.l);
  }
  g.stroke();
}
let veilCache = { leg: -1, field: [] };
function drawVeil() {
  const v = $('#cloudveil'); if (!v) return;
  // The veil takes the fog's colour: white in daylight, blue-grey at night.
  const fc = envNow.fog;
  v.style.background = `rgb(${Math.round(fc[0] * 255)},${Math.round(fc[1] * 255)},${Math.round(fc[2] * 255)})`;
  let o = 0;
  if (flightCtx && screen === 'flight') {
    const f = flightCtx.flight;
    if (veilCache.leg !== f.legDist) veilCache = { leg: f.legDist, field: cloudField(f.legDist) };
    for (const cl of veilCache.field) {
      const dz = Math.abs(cl.z + f.dist), dx = Math.abs(cl.x - f.x), dy = Math.abs(cl.y - f.alt);
      const d = Math.hypot(dx * 0.7, dy * 1.6, dz);
      if (d < 20) o = Math.max(o, 0.6 * (1 - d / 20));
    }
  }
  v.style.opacity = o.toFixed(2);
}

// ---------- boot & screenshot staging ----------
function buildScreens() {
  for (const name of ['title', 'board', 'hangar', 'controls', 'challenges', 'stats', 'settings', 'howto', 'receipt', 'map']) {
    const s = el('section', 'screen'); s.id = 'scr-' + name; ui.append(s);
  }
}
buildScreens();
buildHud();
renderAll();
show('title');
if (scene) scene.snap(stageState());
requestAnimationFrame(loop);

const params = new URLSearchParams(location.search);
const shot = params.get('shot');
if (shot === 'flight' || shot === 'receipt') {
  save.settings.lang = 'en'; t = makeT('en'); save.started = true;
  // &plane= stages a specific airframe (the flagship's dossier frame
  // flies the jet): grant it, activate it, rebuild its mesh.
  const planeP = params.get('plane');
  if (planeP && PLANES.some(p => p.id === planeP)) {
    if (!save.planes.owned.includes(planeP)) save.planes.owned.push(planeP);
    save.planes.active = planeP;
    setActivePlaneMesh();
  }
  const ticket = morningBoard(save, 1)[0];
  // &type= stages a specific mission (rescue, photo, ...) on the cover hop.
  const typeP = params.get('type');
  if (typeP) { applyType(ticket, typeP, 1); if (typeP === 'storm') ticket.weather = 'storm'; }
  startFlight(ticket);
  // Staging can pin the moment: &hour= sets the game clock, &wx= pins the
  // weather, &at=approach poses the plane on final instead of flying her.
  const hourP = parseFloat(params.get('hour'));
  if (Number.isFinite(hourP)) save.clockH = ((hourP % 24) + 24) % 24;
  if (params.get('wx')) flightCtx.wxPin = params.get('wx');
  // &cam= picks the staging camera for ANY flight shot (the cockpit
  // dossier frame depends on it), not only the posed roll/rotate shots.
  const camP = params.get('cam');
  if (camP === 'near' || camP === 'far' || camP === 'cockpit') {
    camMode = camP;
    const cb = $('#cambtn'); if (cb) cb.textContent = t('cam_' + camMode);
  }
  // &look=<deg> poses the pilot's head for the free-look frames, pinned
  // so the ease-home does not steal the angle before the shutter.
  const lookP = parseFloat(params.get('look'));
  if (Number.isFinite(lookP)) { lookSet(look, lookP * Math.PI / 180, 0); lookPin = true; }
  envNow = skyAt(save.day, save.clockH, flightCtx.wxPin);
  flightCtx.weather = envNow.state;
  const f = flightCtx.flight;
  const fr = makeFrame();
  let steps = 0;
  const maxSteps = 60 * 120;
  if (params.get('at') === 'approach' && shot === 'flight') {
    f.dist = f.legDist - 430; f.alt = 24; f.x = 0; f.speed = 27;
    f.airborne = true; f.maxAlt = 24;
    frame.throttle = 0.55; rawFrame.throttle = 0.55;
    propSpin = 2.4;
    flightCtx.frozen = true;
    if (scene) scene.snap(stageState());
    updateHud();
    steps = maxSteps; // posed: skip the pilot loop below
  }
  // &at=roll poses her mid-roll on the departure runway, &at=rotate at
  // the moment she leaves it; &cam= picks the staging camera.
  if ((params.get('at') === 'roll' || params.get('at') === 'rotate') && shot === 'flight') {
    const camP = params.get('cam');
    if (camP === 'near' || camP === 'far' || camP === 'cockpit') camMode = camP;
    if (params.get('at') === 'roll') {
      f.dist = 30; f.alt = 0; f.x = 0; f.speed = 13;
      frame.throttle = 0.85; rawFrame.throttle = 0.85;
    } else {
      f.dist = 120; f.alt = 5; f.x = 0; f.speed = 24;
      f.airborne = true; f.maxAlt = 5; f.tookOffFrom = 'runway'; f.pitchVis = 0.55;
      frame.throttle = 1; rawFrame.throttle = 1;
    }
    propSpin = 2.4;
    flightCtx.frozen = true;
    if (scene) scene.snap(stageState());
    updateHud();
    steps = maxSteps; // posed: skip the pilot loop below
  }
  while (steps++ < maxSteps) {
    pilotFrame(f, fr);
    stepFlight(f, fr, STEP);
    if (shot === 'flight') {
      const next = f.rings.find(r => !r.passed && !r.missed);
      if (next && f.dist > f.legDist * 0.3 && next.dist - f.dist < 120 && f.ringsHit >= 1) break;
      if (f.done) break;
    } else if (f.done) break;
  }
  // Hand the staged state to the live frame so the HUD reads true numbers.
  frame.throttle = fr.throttle; frame.pitch = fr.pitch; frame.roll = fr.roll;
  rawFrame.throttle = fr.throttle; rawFrame.pitch = fr.pitch; rawFrame.roll = fr.roll;
  propSpin = 2.4;
  if (scene) scene.snap(stageState());
  updateHud();
  if (shot === 'receipt') finishFlight(true);
  else flightCtx.frozen = true;
} else if (shot === 'controls') {
  controlsReturn = 'title'; renderControls(); show('controls');
} else if (shot === 'board') {
  showBoard();
} else if (shot === 'hangar') {
  // The fleet frame: a hangar that can actually sell something — a
  // stocked balance and a partly-grown fleet on the cards.
  save.settings.lang = 'en'; t = makeT('en'); save.started = true;
  save.saldo = 900000;
  save.planes.owned = ['kutilang', 'pipit'];
  save.planes.active = 'pipit';
  setActivePlaneMesh();
  renderHangar(); show('hangar');
} else if (shot === 'title') {
  // The cover backdrop: the title screen flown over the home island —
  // senja light, the land airfield and its mountains behind the logo.
  save.settings.lang = 'en'; t = makeT('en');
  save.clockH = 18.2;
  envNow = skyAt(save.day, save.clockH, null);
  titleBackdrop = { dist: 120, x: 0, alt: 5, speed: 24, bank: 0.06, pitchVis: 0.55 };
  renderTitle(); show('title');
  if (scene) scene.snap(stageState());
} else if (shot === 'map') {
  // The chart frame (v13): a campaign mid-way — three stamps banked,
  // standing on Sumbawa, Flores the next stamp east.
  save.settings.lang = 'en'; t = makeT('en'); save.started = true;
  save.stamps = ['penida', 'lombok', 'sumbawa'];
  save.islandIdx = 3;
  openMap('title');
}

// Debug/testing surface: read-only state plus the same actions the UI offers.
window.__senja = {
  get screen() { return screen; },
  get scheme() { return scheme; },
  get flight() { return flightCtx ? flightCtx.flight : null; },
  get save() { return save; },
  get paused() { return paused; },
  get gyroStatus() { return gyro.status; },
  get camMode() { return camMode; },
  // The cockpit as the instruments read it, while the cockpit camera is
  // active in a flight: layout presence + live gauge/radar values.
  get cockpit() { return flightCtx && camMode === 'cockpit' ? cockpitState(flightCtx.flight) : null; },
  get handling() { return save.handling || 'assisted'; },
  get throttle() { return frame.throttle; },
  get look() { return { yaw: look.yaw, pitch: look.pitch }; },
  // The radio's record (v13): every transmission fired this flight, and
  // the one currently on the strip.
  get radioLog() { return [...radioLog]; },
  get radioNow() { return radioNowKey; },
  // The route box's data (v14): the current leg's route + plane mark.
  get minimap() { return flightCtx ? { route: mmRoute, plane: flightCtx.flight ? minimapPlane(mmRoute, flightCtx.flight) : null } : null; },
  openMap,
  setLook(yawDeg, pitchDeg) { lookSet(look, (yawDeg || 0) * Math.PI / 180, (pitchDeg || 0) * Math.PI / 180); },
  setThrottle(v) { frame.throttle = clamp(v, 0, 1); rawFrame.throttle = frame.throttle; },
  get fog() { return R ? R.getFog() : null; },
  get weather() { return flightCtx ? flightCtx.weather : null; },
  get clock() { return save.clockH; },
  get envState() { return envNow.state; },
  setClock(h) {
    save.clockH = ((h % 24) + 24) % 24;
    envNow = skyAt(save.day, save.clockH, flightCtx ? flightCtx.wxPin : null);
    if (flightCtx) flightCtx.weather = envNow.state;
  },
  pinWeather(w) {
    if (!flightCtx) return;
    flightCtx.wxPin = w || null;
    envNow = skyAt(save.day, save.clockH, flightCtx.wxPin);
    flightCtx.weather = envNow.state;
  },
  setScheme, startFlight, board, cycleCam, setHandling,
  setPilot(on) { pilotMode = !!on; },
  // Position the current flight for staged screenshots and feel sequences:
  // rings behind the new position count as missed, rings ahead stay live.
  stage(dist, alt, x) {
    if (!flightCtx) return false;
    const f = flightCtx.flight;
    f.dist = dist; f.alt = alt; f.x = x; f.speed = 30;
    f.airborne = alt > 1; f.maxAlt = Math.max(f.maxAlt, alt);
    for (const r of f.rings) {
      if (r.dist < dist - 7) { r.missed = true; r.passed = false; }
      else { r.missed = false; r.passed = false; }
    }
    f.ringsHit = 0;
    flightCtx.frozen = true;
    updateHud();
    return true;
  },
  unfreeze() { if (flightCtx) flightCtx.frozen = false; },
  snapCam() { if (scene) scene.snap(stageState()); },
};
