// A simple demo pilot: flies a course off the same numbers the player sees —
// next-ring altitude, lateral offset, the approach target band. It exists so
// screenshots can stage real flights and the test suite can prove every
// course is flyable end to end; it plays by the model's rules, no cheats.
import { clamp } from './util.js';
import { approachTargetM } from './flight.js';

export function pilotFrame(f, frame) {
  const remain = f.legDist - f.dist;
  const next = f.rings.find(r => !r.passed && !r.missed);
  let targetAlt, targetX = 0;
  if (remain <= 600 && f.airborne) {
    targetAlt = approachTargetM(remain);
    // Approach speed discipline: settle near 24 m/s.
    frame.throttle = clamp(0.52 + (24 - f.speed) * 0.03, 0.25, 0.8);
    let wantVs = clamp((targetAlt - f.alt) * 0.30, -4.2, 2.6);
    if (f.alt < 4.5 && remain < 130) wantVs = Math.max(wantVs, -1.15); // flare: sink gently
    // Pitch authority fades with airflow in the model, so the stick must be
    // pushed further than the raw VS ratio suggests — as a human would.
    frame.pitch = clamp(wantVs / 3.0, -1, 1);
  } else {
    frame.throttle = 1;
    targetAlt = next ? next.altM : 55;
    if (next) targetX = next.x;
    const wantVs = clamp((targetAlt - f.alt) * 0.22, -5.5, 6.2);
    frame.pitch = clamp(wantVs / 7, -1, 1);
  }
  frame.roll = clamp((targetX - f.x) * 0.055, -1, 1);
  return frame;
}
