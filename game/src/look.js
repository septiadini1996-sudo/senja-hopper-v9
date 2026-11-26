// Free-look: the pilot's head, as pure state. A drag (or the look keys)
// moves the TARGET angles; the flown angles ease after them, so the view
// swings like a head turning instead of snapping. While a drag is held
// the view stays where it was put; shortly after release the head comes
// back to the nose on its own. Yaw is the full circle — the pilot can
// look dead astern — and pitch clamps at a sensible neck's reach. None
// of this touches the flight frame: the plane flies her course while
// the pilot looks wherever she likes.
import { clamp } from './util.js';

export const LOOK_PITCH_MAX = 1.15; // radians, up or down
const wrapPi = a => Math.atan2(Math.sin(a), Math.cos(a));

export function createLook() {
  return { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0, active: false, holdT: 0 };
}

// A drag of (dxPx, dyPx) screen pixels turns the head: right drag looks
// right, down drag looks down — the view follows the hand.
export function lookDrag(l, dxPx, dyPx) {
  l.tYaw = wrapPi(l.tYaw + dxPx * 0.0052);
  l.tPitch = clamp(l.tPitch + dyPx * 0.0042, -LOOK_PITCH_MAX, LOOK_PITCH_MAX);
  l.active = true;
  l.holdT = 0;
  return l;
}
export function lookRelease(l) { l.active = false; return l; }

// Pin the view at an angle at once (screenshot staging, tests).
export function lookSet(l, yaw, pitch) {
  l.tYaw = l.yaw = wrapPi(yaw || 0);
  l.tPitch = l.pitch = clamp(pitch || 0, -LOOK_PITCH_MAX, LOOK_PITCH_MAX);
  l.active = true;
  l.holdT = 0;
  return l;
}

export function updateLook(l, dt) {
  if (!l.active) {
    l.holdT += dt;
    if (l.holdT > 0.35) { l.tYaw = 0; l.tPitch = 0; }
  }
  const k = Math.min(1, dt * 7);
  l.yaw = wrapPi(l.yaw + wrapPi(l.tYaw - l.yaw) * k); // shortest way round
  l.pitch += (l.tPitch - l.pitch) * k;
  return l;
}

export function lookOffset(l) { return { yaw: l.yaw, pitch: l.pitch }; }
