// Whether a field element stands between a camera and a tag, as the robot model's FieldModel.hides
// answers it. Each element is made of upright blocks: an outline seen from above (no corner
// pointing in, corners counterclockwise) standing from one height to another.

// How far in front of a tag's face its sight line ends, so the element the tag hangs on never
// hides it from in front (FieldModel.SIGHT_STANDOFF_METERS).
export const SIGHT_STANDOFF_METERS = 0.03;

// Whether the straight line from one point to another passes through the block. Seen from above,
// each side of the outline cuts the line where it crosses it; what is left is the stretch inside.
// The line's height changes evenly along it, so the block is in the way if the heights at the
// stretch's two ends reach into the block's own. A line that only touches it is not blocked.
export function blockStandsBetween(block, from, to) {
  const alongX = to[0] - from[0];
  const alongY = to[1] - from[1];
  let enters = 0;
  let leaves = 1;
  const corners = block.outline;
  const sides = corners.length;
  for (let side = 0; side < sides; side++) {
    const corner = corners[side];
    const next = corners[(side + 1) % sides];
    const sideX = next[0] - corner[0];
    const sideY = next[1] - corner[1];
    // Positive on the side's left, which is the inside.
    const startInside = sideX * (from[1] - corner[1]) - sideY * (from[0] - corner[0]);
    const movesInside = sideX * alongY - sideY * alongX;
    if (movesInside === 0) {
      if (startInside <= 0) return false;
      continue;
    }
    const crossesAt = -startInside / movesInside;
    if (movesInside > 0) {
      enters = Math.max(enters, crossesAt);
    } else {
      leaves = Math.min(leaves, crossesAt);
    }
    if (enters >= leaves) return false;
  }
  const heightEntering = from[2] + enters * (to[2] - from[2]);
  const heightLeaving = from[2] + leaves * (to[2] - from[2]);
  const lowest = Math.min(heightEntering, heightLeaving);
  const highest = Math.max(heightEntering, heightLeaving);
  return highest > block.bottomMeters && lowest < block.topMeters;
}

// The first element standing between two points, or null if none does.
export function elementBetween(elements, from, to) {
  for (const element of elements) {
    for (const block of element.blocks) {
      if (blockStandsBetween(block, from, to)) return element;
    }
  }
  return null;
}

// The element hiding a point on a tag's face from the eye, or null: the sight line ends a little
// in front of the face.
export function elementHidingOnAFace(elements, eye, onTheFace, outOfTheFace) {
  const end = [
    onTheFace[0] + SIGHT_STANDOFF_METERS * outOfTheFace[0],
    onTheFace[1] + SIGHT_STANDOFF_METERS * outOfTheFace[1],
    onTheFace[2] + SIGHT_STANDOFF_METERS * outOfTheFace[2],
  ];
  return elementBetween(elements, eye, end);
}

// The element hiding any of a tag from the eye, or null: its center or one of its corners. A
// detector needs the tag's whole border, so a tag with a corner hidden is not found.
export function elementHidingTag(elements, eye, tag) {
  if (elements.length === 0) return null;
  const center = elementHidingOnAFace(elements, eye, tag.position, tag.normal);
  if (center) return center;
  for (const corner of tag.corners) {
    const hiding = elementHidingOnAFace(elements, eye, corner, tag.normal);
    if (hiding) return hiding;
  }
  return null;
}
