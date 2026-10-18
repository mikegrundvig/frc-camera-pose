// Other robots in the cameras' way, as the camera placement study's --other-robots places them:
// solid boxes with the robot's own bumper outline, each at a random place near the robot (evenly
// over the area within reach), turned a random way, clear of the robot, of each other and of the
// walls. A tag is hidden when the line from the camera to any of its corners, the middles of its
// edges, or its center passes through one.

// How many tries to find a place for a robot before leaving it out (the study's TRIES).
const TRIES = 50;

// A small seeded random number generator (mulberry32): the same seed gives the same numbers, so a
// shared link draws the same robots. Returns numbers in [0, 1).
export function random(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Mixes numbers into one seed, so each pose and each arrangement draws its own robots.
export function mixSeed(...values) {
  let h = 2166136261;
  for (const value of values) {
    h = Math.imul(h ^ (value | 0), 16777619);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

// A box on the floor: center (x, y), heading in radians, half its length and width, its height.
export function box(x, y, heading, halfLength, halfWidth, height) {
  return { x, y, heading, halfLength, halfWidth, height };
}

// Its outline's four corners on the floor.
export function boxCorners(b) {
  const cos = Math.cos(b.heading);
  const sin = Math.sin(b.heading);
  const corners = [];
  for (const [ahead, left] of [
    [1, 1],
    [-1, 1],
    [-1, -1],
    [1, -1],
  ]) {
    const along = ahead * b.halfLength;
    const across = left * b.halfWidth;
    corners.push([b.x + along * cos - across * sin, b.y + along * sin + across * cos]);
  }
  return corners;
}

// Whether the line between two points passes through the box: with the points in the box's own
// frame, the part of the line between each pair of faces, narrowed axis by axis, is not empty.
export function boxBlocks(b, from, to) {
  const cos = Math.cos(b.heading);
  const sin = Math.sin(b.heading);
  const start = [
    (from[0] - b.x) * cos + (from[1] - b.y) * sin,
    -(from[0] - b.x) * sin + (from[1] - b.y) * cos,
    from[2],
  ];
  const end = [
    (to[0] - b.x) * cos + (to[1] - b.y) * sin,
    -(to[0] - b.x) * sin + (to[1] - b.y) * cos,
    to[2],
  ];
  const low = [-b.halfLength, -b.halfWidth, 0];
  const high = [b.halfLength, b.halfWidth, b.height];
  let enter = 0;
  let leave = 1;
  for (let axis = 0; axis < 3; axis++) {
    const along = end[axis] - start[axis];
    if (Math.abs(along) < 1e-12) {
      if (start[axis] < low[axis] || start[axis] > high[axis]) return false;
      continue;
    }
    const first = (low[axis] - start[axis]) / along;
    const second = (high[axis] - start[axis]) / along;
    enter = Math.max(enter, Math.min(first, second));
    leave = Math.min(leave, Math.max(first, second));
    if (enter > leave) return false;
  }
  return true;
}

// Whether two convex outlines (lists of [x, y] corners) overlap, by separating axes: they are
// apart exactly when, along some edge's normal, their shadows don't meet. Touching counts as
// overlapping, as in the study.
export function outlinesOverlap(a, b) {
  for (const shape of [a, b]) {
    for (let i = 0; i < shape.length; i++) {
      const p = shape[i];
      const q = shape[(i + 1) % shape.length];
      const axis = [q[1] - p[1], p[0] - q[0]];
      const [aLow, aHigh] = shadow(a, axis);
      const [bLow, bHigh] = shadow(b, axis);
      if (aHigh < bLow || bHigh < aLow) return false;
    }
  }
  return true;
}

// The stretch of the line along `axis` that a shape's corners cover, as [low, high].
export function shadow(corners, axis) {
  let low = Infinity;
  let high = -Infinity;
  for (const c of corners) {
    const d = c[0] * axis[0] + c[1] * axis[1];
    low = Math.min(low, d);
    high = Math.max(high, d);
  }
  return [low, high];
}

// How far from the robot's center another robot can stand and still be in the way of a tag a
// camera sees: the sight range, plus how far a camera and the other robot's outline reach from
// their centers (both robots the same outline).
export function reachMeters(sightMeters, robotSize) {
  return sightMeters + Math.hypot(robotSize.length, robotSize.width);
}

// Places up to `count` robots near the robot at `pose`, each clear of it, of each other, of the
// walls, and of anything `blocked(outline)` says no to. `next` is a random number generator. Fewer
// come back when there's no room.
export function placeRobots(pose, field, robotSize, height, count, reach, next, blocked) {
  const halfLength = robotSize.length / 2;
  const halfWidth = robotSize.width / 2;
  const self = boxCorners(box(pose.x, pose.y, pose.heading, halfLength, halfWidth, height));
  const placed = [];
  const outlines = [];
  for (let n = 0; n < count; n++) {
    for (let attempt = 0; attempt < TRIES; attempt++) {
      const radius = reach * Math.sqrt(next());
      const bearing = 2 * Math.PI * next();
      const other = box(
        pose.x + radius * Math.cos(bearing),
        pose.y + radius * Math.sin(bearing),
        2 * Math.PI * next(),
        halfLength,
        halfWidth,
        height,
      );
      const outline = boxCorners(other);
      const onField = outline.every(
        ([x, y]) => x >= 0 && x <= field.length && y >= 0 && y <= field.width,
      );
      if (!onField || outlinesOverlap(outline, self)) continue;
      if (blocked && blocked(outline)) continue;
      if (outlines.some((o) => outlinesOverlap(outline, o))) continue;
      placed.push(other);
      outlines.push(outline);
      break;
    }
  }
  return placed;
}

// The points of a tag another robot must leave clear: its corners, the middles of its edges, and
// its center.
export function tagOutlinePoints(tag) {
  const points = tag.corners.slice();
  for (let i = 0; i < 4; i++) {
    const a = tag.corners[i];
    const b = tag.corners[(i + 1) % 4];
    points.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
  }
  points.push(tag.position);
  return points;
}

// Whether any of the robots hides any of the tag from the lens.
export function robotHidesTag(robots, lens, tag) {
  if (robots.length === 0) return false;
  const points = tag.outlinePoints || tagOutlinePoints(tag);
  for (const robot of robots) {
    for (const point of points) {
      if (boxBlocks(robot, lens, point)) return true;
    }
  }
  return false;
}
