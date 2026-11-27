// The hangar preview's brain (v14): which airframe stands on the
// turntable, and the pose she holds at a given moment. Pure state and
// math — main.js owns the second renderer and the animation loop, so
// the suite can pin selection and posing (including the screenshot
// pin) without a browser.
//
// Posing contract: in live play the pose is a function of the clock
// (a slow turntable, a spinning prop, a breathing fan glow for the
// jet). For dossier capture the pose is PINNED — fixed angles, the
// same every build — the same trick the jet's flight frame uses.
import { PLANES, planeById } from './planes.js';

export const PREVIEW_PIN = { yaw: 0.62, prop: 2.35, glow: 0.55 };

export function createPreviewState(activeId) {
  const id = PLANES.some(p => p.id === activeId) ? activeId : PLANES[0].id;
  return { selectedId: id };
}

// Selecting a card stands that airframe on the turntable. An unknown
// id changes nothing (a stale click can never blank the stand).
export function previewSelect(state, id) {
  if (PLANES.some(p => p.id === id)) state.selectedId = id;
  return state.selectedId;
}

// The pose for one instant. `pinned` (screenshot staging) ignores the
// clock entirely: identical inputs, identical frame, every build.
export function previewPose(state, tSec, pinned = false) {
  const plane = planeById(state.selectedId);
  if (pinned) {
    return { planeId: plane.id, jet: !!plane.jet, yaw: PREVIEW_PIN.yaw,
             prop: plane.jet ? 0 : PREVIEW_PIN.prop, glow: PREVIEW_PIN.glow };
  }
  const t = Math.max(0, tSec || 0);
  return {
    planeId: plane.id,
    jet: !!plane.jet,
    yaw: t * 0.45,                       // one slow revolution ≈ 14 s
    prop: plane.jet ? 0 : t * 26,        // the prop blur's spin
    glow: 0.5 + 0.3 * Math.sin(t * 2.1), // the jet's fans breathe
  };
}
