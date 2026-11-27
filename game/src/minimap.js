// The flight minimap's data (v14): pure route geometry for the little
// chart that rides the HUD in flight. Like the big chart (world.js),
// everything here is read from the world's own tables — island positions
// from islandPositions(), coastlines from islandOutline() — so the box
// on the glass can never disagree with the world under the wings.
//
// Route space: the departure island sits at the origin, the destination
// at (legM, 0); the plane's place is (along, lateral) = (dist flown,
// sideways offset), the very numbers the flight model already keeps.
import { ISLANDS, islandPositions, islandOutline } from './world.js';
import { clamp } from './util.js';

// The route a ticket flies, in world-table terms: both islands'
// chart positions and coastlines, and the leg's true length — the
// z-distance the cumulative hop line puts between them, which is the
// distance the flight model flies (HOP_M by construction).
export function minimapRoute(fromIdx, toIdx) {
  const pos = islandPositions();
  const a = pos[fromIdx], b = pos[toIdx];
  if (!a || !b) return null;
  return {
    from: { id: a.id, name: a.name, x: a.x, z: a.z, outline: islandOutline(ISLANDS[fromIdx]) },
    to: { id: b.id, name: b.name, x: b.x, z: b.z, outline: islandOutline(ISLANDS[toIdx]) },
    legM: Math.abs(b.z - a.z),
  };
}

// The plane's place on the route for one flight state: how far along
// (metres and as a clamped fraction) and how far off the centreline.
// worldZ is the plane's true chart z — the interpolation of the two
// islands' table positions at the flown fraction — so a test can hold
// the box's dot against the world table itself.
export function minimapPlane(route, f) {
  if (!route || !f) return null;
  const legM = Math.max(1, f.legDist || route.legM);
  const frac = clamp((f.dist || 0) / legM, 0, 1);
  return {
    along: f.dist || 0,
    lateral: f.x || 0,
    frac,
    worldX: f.x || 0,
    worldZ: route.from.z + (route.to.z - route.from.z) * frac,
  };
}
