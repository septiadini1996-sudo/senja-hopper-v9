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
// the pilot a shade brighter, the boat's keeper in between.
export function radioSpeechParams(speaker) {
  if (speaker === 'pilot') return { pitch: 0.95, rate: 0.97 };
  if (speaker === 'boat') return { pitch: 0.88, rate: 0.94 };
  return { pitch: 0.85, rate: 0.93 }; // tower
}

// How long a spoken transmission keeps the channel: words at a
// measured radio pace, scaled by the rate the voice will actually use,
// plus the squelch-and-settle margin the queue already allowed for.
export function estimateSpeechSeconds(text, rate = 0.93) {
  const words = String(text).split(/\s+/).filter(Boolean).length;
  return 0.35 + (words * 0.46) / Math.max(0.5, rate);
}
