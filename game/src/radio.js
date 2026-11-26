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
