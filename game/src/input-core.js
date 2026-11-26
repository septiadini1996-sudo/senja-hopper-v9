// Pure input math: every control scheme writes into ONE normalized frame
// {pitch, roll, throttle}. These functions are shared verbatim by all four
// schemes and are unit-tested without a DOM.
import { clamp } from './util.js';

export function makeFrame() { return { pitch: 0, roll: 0, throttle: 0 }; }

// Keyboard: held keys give continuous (hold-based) pitch and roll; Q/E walk
// the throttle. `keys` is a Set of codes.
export function keyboardFrame(frame, keys, dt) {
  const up = keys.has('ArrowUp') || keys.has('KeyW');
  const down = keys.has('ArrowDown') || keys.has('KeyS');
  const left = keys.has('ArrowLeft') || keys.has('KeyA');
  const right = keys.has('ArrowRight') || keys.has('KeyD');
  frame.pitch = (up ? 1 : 0) + (down ? -1 : 0);
  frame.roll = (right ? 1 : 0) + (left ? -1 : 0);
  if (keys.has('KeyE')) frame.throttle = clamp(frame.throttle + dt * 0.55, 0, 1);
  if (keys.has('KeyQ')) frame.throttle = clamp(frame.throttle - dt * 0.55, 0, 1);
  return frame;
}

// Virtual stick: knob offset in pixels from centre, radius = stick travel.
export function stickFrame(frame, dx, dy, radius) {
  const nx = clamp(dx / radius, -1, 1);
  const ny = clamp(dy / radius, -1, 1);
  frame.roll = nx;
  frame.pitch = -ny; // push up (negative dy) = climb
  return frame;
}

// Slider: pointer position along a track maps linearly to 0..1. A pointerdown
// anywhere on the track jumps straight to that value (click-to-position).
export function sliderValue(clientPos, trackStart, trackLength) {
  if (trackLength <= 0) return 0;
  return clamp((clientPos - trackStart) / trackLength, 0, 1);
}

// Touch zones: buttons write pitch/roll while held; THR +/− walk the throttle.
export function touchFrame(frame, held, dt) {
  frame.pitch = (held.up ? 1 : 0) + (held.down ? -1 : 0);
  frame.roll = (held.right ? 1 : 0) + (held.left ? -1 : 0);
  if (held.thrUp) frame.throttle = clamp(frame.throttle + dt * 0.6, 0, 1);
  if (held.thrDn) frame.throttle = clamp(frame.throttle - dt * 0.6, 0, 1);
  return frame;
}

// Gyro: tilt relative to a calibrated neutral pose. gamma tilts left/right,
// beta tilts forward/back. Sensitivity scales degrees-per-full-deflection.
export const GYRO_SENS = { calm: 26, std: 18, hot: 11 };
export function gyroFrame(frame, beta, gamma, neutral, sensKey) {
  const range = GYRO_SENS[sensKey] || GYRO_SENS.std;
  frame.roll = clamp((gamma - neutral.gamma) / range, -1, 1);
  frame.pitch = clamp((neutral.beta - beta) / range, -1, 1);
  return frame;
}
export function gyroButtons(frame, held, dt) {
  if (held.thrUp) frame.throttle = clamp(frame.throttle + dt * 0.6, 0, 1);
  if (held.thrDn) frame.throttle = clamp(frame.throttle - dt * 0.6, 0, 1);
  return frame;
}

// Handling modes. Every scheme writes a RAW frame; this conditioner turns it
// into the frame the model flies, so the mode is one small pure function:
// - direct: the raw frame, untouched.
// - assisted: pitch/roll/throttle ease toward the raw values (damped), and
//   with no roll commanded the plane gently steers back toward the route
//   centreline (self-levelling), proportional to how far off it has drifted.
//   Pitch eases fastest of the three: a released climb must stop promptly,
//   or altitude corrections on approach overshoot the strip.
export function conditionFrame(frame, raw, dt, mode, planeX) {
  if (mode !== 'assisted') {
    frame.pitch = raw.pitch; frame.roll = raw.roll; frame.throttle = raw.throttle;
    return frame;
  }
  const kp = Math.min(1, dt * 7), kPitch = Math.min(1, dt * 9), kt = Math.min(1, dt * 5);
  let rollTarget = raw.roll;
  if (raw.roll === 0) rollTarget = clamp(-planeX * 0.012, -0.3, 0.3);
  frame.pitch += (raw.pitch - frame.pitch) * kPitch;
  frame.roll += (rollTarget - frame.roll) * kp;
  frame.throttle += (raw.throttle - frame.throttle) * kt;
  return frame;
}
