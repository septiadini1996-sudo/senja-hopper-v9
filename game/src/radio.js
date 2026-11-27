// Airport radio (v13): the pure event logic of pilot↔tower traffic.
// Given a flight's state and the leg's context, radioPoll returns the
// transmissions that should fire NOW — each at most once per flight.
// main.js owns the queue, the printed strip and the synthesized voice;
// this module owns only the judgement of when the tower speaks, so the
// logic suite can pin every phase without a browser.
//
// Moments: a rescue boat's call and the tower's relay before departure;
// takeoff clearance (and the pilot's readback); the departure farewell
// after liftoff; a storm warning whenever heavy weather is met; the
// tower's concern at a stall; landing clearance inside the approach
// threshold; the welcome on touchdown; one last call to a wreck.
export function createRadio() {
  return { said: new Set() };
}

export function radioPoll(r, f, ctx) {
  const out = [];
  const say = (key, speaker) => {
    if (!r.said.has(key)) { r.said.add(key); out.push({ key, speaker }); }
  };
  const remain = f.legDist - f.dist;
  // Before departure: the boat calls first, the tower relays it, then
  // the ordinary business of leaving the ground.
  if (ctx.type === 'rescue' && !f.airborne && f.t > 0.3) { say('distress', 'boat'); say('relay', 'tower'); }
  if (!f.airborne && !f.done && f.t > 0.6) { say('takeoff', 'tower'); say('ack', 'pilot'); }
  // Airborne: farewell, and the weather warning whenever heavy weather
  // is first met — at departure or an hour into the leg alike.
  if (f.airborne && f.alt > 14) {
    say('departure', 'tower');
    if (ctx.weather === 'rain' || ctx.weather === 'storm') say('stormwarn', 'tower');
  }
  if (f.stalled) say('stallwarn', 'tower');
  // The approach: landing clearance inside the threshold, once.
  if (f.airborne && remain < 700 && remain > 40) say('landing', 'tower');
  if (f.done && f.outcome === 'landed') say('welcome', 'tower');
  if (f.done && f.outcome === 'splash') say('crashcall', 'tower');
  // Sky Patrol traffic (v15): the tower works the hunt on the same
  // channel — the contact call once she is up, praise on the first
  // drone down, and a warning as each new wave is reported in. The
  // mode's ledger rides in ctx (downed, wave) so this stays pure.
  if (ctx.mode === 'patrol') {
    if (f.airborne && f.alt > 14) say('patrol_start', 'tower');
    // v15.2: the fight talks back — a bandit warning the moment the
    // first escort shows, a break call while she is taking fire, the
    // hull warning under a third, and the cheer when a bandit falls.
    if (ctx.bandit) say('patrol_bandit', 'tower');
    if (ctx.underFire) say('patrol_fire', 'tower');
    if (ctx.hullCrit) say('patrol_hull', 'tower');
    if ((ctx.banditsDown || 0) >= 1) say('patrol_banditdown', 'tower');
    if ((ctx.downed || 0) >= 1) say('patrol_hit', 'tower');
    if ((ctx.wave || 0) >= 2) say('patrol_wave', 'tower');
    if ((ctx.wave || 0) >= 4) say('patrol_wave2', 'tower');
  }
  return out;
}

// ---- the voice itself (v14) ----
// The v13 formant voice was honestly a mumble: it carried the radio's
// rhythm, never its words. Where the platform offers real speech
// synthesis, the tower now SPEAKS — the choice is made here, as pure
// logic over a global-like object, so the suite can pin both branches
// (synthesis present → speak; absent or partial → the formant fallback
// takes over silently, exactly as v13 sounded).
export function radioEngine(g) {
  const ok = !!g && typeof g.speechSynthesis === 'object' && g.speechSynthesis !== null
    && typeof g.speechSynthesis.speak === 'function'
    && typeof g.SpeechSynthesisUtterance === 'function';
  return ok ? 'tts' : 'formant';
}

// The radio colour of a spoken call: pitch dipped and pace eased a
// touch below conversational, per speaker — the tower sits lowest,
// the pilot a shade brighter, the boat's keeper in between. The
// rates eased again in v18 (tower 0.93 → 0.90): a slower tower is
// a clearer tower, and clarity was the owner's whole ask.
export function radioSpeechParams(speaker) {
  if (speaker === 'pilot') return { pitch: 0.95, rate: 0.95 };
  if (speaker === 'boat') return { pitch: 0.88, rate: 0.92 };
  return { pitch: 0.85, rate: 0.90 }; // tower
}

// How long a spoken transmission keeps the channel: words at a
// measured radio pace, scaled by the rate the voice will actually use,
// plus the squelch-and-settle margin the queue already allowed for.
export function estimateSpeechSeconds(text, rate = 0.93) {
  const words = String(text).split(/\s+/).filter(Boolean).length;
  return 0.35 + (words * 0.46) / Math.max(0.5, rate);
}
