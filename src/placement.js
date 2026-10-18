// Where a robot may stand: inside the walls and clear of the field elements it would bump into
// (the same ones the coverage grid leaves blank), and of any other robots, given as their outlines
// (`others`, a list of corner lists). Poses here are the page's own, in meters and degrees:
// { x, y, headingDegrees }. Everything is deterministic, and every pose that comes back is legal
// and rounded the way the page keeps it (millimeters, tenths of a degree), except from the `exact`
// functions, which keep every digit so that driving does not drift with the frame rate.

import { floorBlocks, robotOutline } from './coverage.js';
import { outlinesOverlap, shadow } from './robots.js';

const DEG = Math.PI / 180;

// How far past a wall the outline may reach: rounding a pose to a millimeter must not matter.
export const WALL_SLACK = 0.002;
// How much room to leave when pushing out of an element, so rounding cannot put the robot back in.
export const CLEARANCE = 0.003;
// How far a drag moves between checks, in meters: small enough not to slip through a thin element.
const STEP = 0.05;
// How many turns of pushing out to try before giving up on a spot.
const PUSHES = 16;
// How far a turn moves between checks, in degrees.
const TURN_STEP = 1;
// How wide the search for a free spot grows, in meters, and by how much each time.
const SEARCH_REACH = 24;
const SEARCH_STEP = 0.05;
const SEARCH_ANGLES = 24;

// A robot's outline at a pose.
export function outlineAt(size, pose) {
  return robotOutline({ x: pose.x, y: pose.y, heading: pose.headingDegrees * DEG }, size);
}

function onField(field, outline) {
  return outline.every(
    ([x, y]) =>
      x >= -WALL_SLACK && x <= field.length + WALL_SLACK && y >= -WALL_SLACK && y <= field.width + WALL_SLACK,
  );
}

// The outlines a robot must stay off: the floor blocks of the field, then the other robots.
function obstacles(field, others) {
  return floorBlocks(field)
    .map((block) => block.outline)
    .concat(others);
}

// Whether the robot may stand here: its bumper outline inside the walls and off every element and
// every other robot.
export function isLegal(field, size, pose, others = []) {
  const outline = outlineAt(size, pose);
  if (!onField(field, outline)) return false;
  return !obstacles(field, others).some((other) => outlinesOverlap(outline, other));
}

function center(corners) {
  const sum = corners.reduce((total, [x, y]) => [total[0] + x, total[1] + y], [0, 0]);
  return [sum[0] / corners.length, sum[1] / corners.length];
}

// The way out of the block for an outline, as { x, y, depth }, or null when they are apart. Along
// the edge normals of both, the outline must slide until the shadows part. With no `before` (the
// outline a moment ago, clear of the block) the axis where that is least is the way out. With it,
// the way out is the least of the axes it was already clear along: the face it came up against,
// so at a corner it slides along that face instead of catching on the corner.
function pushOutOf(outline, block, before) {
  const axes = [];
  for (const shape of [outline, block]) {
    for (let i = 0; i < shape.length; i++) {
      const p = shape[i];
      const q = shape[(i + 1) % shape.length];
      const length = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (length < 1e-12) continue;
      const axis = [(q[1] - p[1]) / length, (p[0] - q[0]) / length];
      const [aLow, aHigh] = shadow(outline, axis);
      const [bLow, bHigh] = shadow(block, axis);
      const depth = Math.min(aHigh, bHigh) - Math.max(aLow, bLow);
      if (depth < 0) return null;
      axes.push({ depth, axis, cameFrom: before ? depthAlong(before, block, axis) < 0 : true });
    }
  }
  const candidates = axes.filter((a) => a.cameFrom);
  const best = (candidates.length > 0 ? candidates : axes).reduce((a, b) => (b.depth < a.depth ? b : a));
  const [ox, oy] = center(outline);
  const [bx, by] = center(block);
  const way = (ox - bx) * best.axis[0] + (oy - by) * best.axis[1] >= 0 ? 1 : -1;
  const move = best.depth + CLEARANCE;
  return { x: way * best.axis[0] * move, y: way * best.axis[1] * move, depth: best.depth };
}

// How far two outlines' shadows overlap along an axis; negative when they are apart.
function depthAlong(a, b, axis) {
  const [aLow, aHigh] = shadow(a, axis);
  const [bLow, bHigh] = shadow(b, axis);
  return Math.min(aHigh, bHigh) - Math.max(aLow, bLow);
}

// The move that brings the outline back inside the walls, or null when it already is.
function pushIntoField(field, outline) {
  const xs = outline.map((c) => c[0]);
  const ys = outline.map((c) => c[1]);
  const over = (low, high, limit) => (low < 0 ? -low : high > limit ? limit - high : 0);
  const x = over(Math.min(...xs), Math.max(...xs), field.length);
  const y = over(Math.min(...ys), Math.max(...ys), field.width);
  return x === 0 && y === 0 ? null : { x, y };
}

// The pose pushed to the nearest place it is legal at the same heading: back inside the walls
// first, then out of whichever element it is deepest in, until it is clear. Null when a few
// pushes do not get there (a gap too narrow for the robot).
function pushOut(field, size, pose, from = null, others = []) {
  let at = { ...pose };
  const before = from && outlineAt(size, from);
  const blocks = obstacles(field, others);
  for (let i = 0; i < PUSHES; i++) {
    const outline = outlineAt(size, at);
    const wall = pushIntoField(field, outline);
    let push = wall;
    if (!push) {
      for (const block of blocks) {
        const p = pushOutOf(outline, block, before);
        if (p && (!push || p.depth > push.depth)) push = p;
      }
    }
    if (!push) return at;
    at = { ...at, x: at.x + push.x, y: at.y + push.y };
  }
  return isLegal(field, size, at, others) ? at : null;
}

function rounded(pose) {
  const to = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;
  return {
    x: to(pose.x, 3),
    y: to(pose.y, 3),
    headingDegrees: to(((((pose.headingDegrees + 180) % 360) + 360) % 360) - 180, 1),
  };
}

// The pose as the page keeps it, if that is legal.
function kept(field, size, pose, others) {
  const r = rounded(pose);
  return isLegal(field, size, r, others) ? r : null;
}

// The nearest legal pose to this one at its heading, or null when there is none on the field. A
// legal pose stays as it is; one in the way is pushed out along the shortest way; if that finds
// nothing (a narrow gap), the search widens in rings around it.
export function placeAt(field, size, pose, others = []) {
  const target = rounded({ ...pose, x: clampTo(pose.x, 0, field.length), y: clampTo(pose.y, 0, field.width) });
  if (isLegal(field, size, target, others)) return target;
  const pushed = pushOut(field, size, target, null, others);
  const result = pushed && kept(field, size, pushed, others);
  if (result) return result;
  for (let reach = SEARCH_STEP; reach <= SEARCH_REACH; reach += SEARCH_STEP) {
    for (let k = 0; k < SEARCH_ANGLES; k++) {
      const angle = (2 * Math.PI * k) / SEARCH_ANGLES;
      const near = kept(
        field,
        size,
        { ...target, x: target.x + reach * Math.cos(angle), y: target.y + reach * Math.sin(angle) },
        others,
      );
      if (near) return near;
    }
  }
  return null;
}

function clampTo(value, low, high) {
  return Math.min(high, Math.max(low, value));
}

// Drags the robot from a legal pose toward a point: in small steps, each pushed out of whatever it
// touches, so it slides along an element or a wall rather than stopping. Each step starts from
// where the last one ended, so the robot stays on the side it came from, however far inside an
// element the point is. The heading stays; a step that finds no room ends the drag there. The
// pose that comes back has every digit (see `moveTo` for the one the page keeps).
export function moveToExact(field, size, from, x, y, others = []) {
  let at = from;
  const budget = 3 * Math.ceil(Math.hypot(x - from.x, y - from.y) / STEP) + 3;
  for (let i = 0; i < budget; i++) {
    const dx = x - at.x;
    const dy = y - at.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 1e-6) break;
    const share = Math.min(1, STEP / distance);
    const next = pushOut(field, size, { ...at, x: at.x + dx * share, y: at.y + dy * share }, at, others);
    if (!next) break;
    // Pressed against something with nowhere further to slide.
    if (Math.hypot(next.x - at.x, next.y - at.y) < 1e-9) break;
    at = next;
  }
  return at;
}

// The same, as the page keeps the pose: rounded to a millimeter.
export function moveTo(field, size, from, x, y, others = []) {
  return kept(field, size, moveToExact(field, size, from, x, y, others), others) || from;
}

// Turns the robot from a legal pose toward a heading, the short way round, a degree at a time,
// and stops at the last heading where it is still legal: a turn that would swing a corner into an
// element, a wall or another robot is refused from there on. Every digit is kept.
export function turnToExact(field, size, from, headingDegrees, others = []) {
  const turn = ((((headingDegrees - from.headingDegrees) % 360) + 540) % 360) - 180;
  const steps = Math.max(1, Math.ceil(Math.abs(turn) / TURN_STEP));
  let heading = from.headingDegrees;
  for (let i = 1; i <= steps; i++) {
    const next = from.headingDegrees + (turn * i) / steps;
    if (!isLegal(field, size, { ...from, headingDegrees: next }, others)) break;
    heading = next;
  }
  return { ...from, headingDegrees: heading };
}

// The same, as the page keeps the pose: the heading to a tenth of a degree.
export function turnTo(field, size, from, headingDegrees, others = []) {
  const wanted = rounded({ ...from, headingDegrees }).headingDegrees;
  const turn = ((((wanted - from.headingDegrees) % 360) + 540) % 360) - 180;
  const steps = Math.max(1, Math.ceil(Math.abs(turn) / TURN_STEP));
  let heading = from.headingDegrees;
  for (let i = 1; i <= steps; i++) {
    const next = i === steps ? wanted : from.headingDegrees + (turn * i) / steps;
    if (!isLegal(field, size, { ...from, headingDegrees: next }, others)) break;
    heading = next;
  }
  const result = rounded({ ...from, headingDegrees: heading });
  return isLegal(field, size, result, others) ? result : from;
}

// A pose with every digit as the page keeps it: rounded to a millimeter and a tenth of a degree
// when that is still legal, else as it is.
export function asKept(field, size, pose, others = []) {
  return kept(field, size, pose, others) || pose;
}

// A free place near a pose for another robot: a ring of spots round it, nearest first, the first
// one ahead of it and then turning, each moved to the nearest legal place. Null when there is none.
export function spotNear(field, size, pose, others = []) {
  const gap = size.length + 0.3;
  for (let ring = 0; ring < 6; ring++) {
    const reach = gap + ring * 0.6;
    for (let k = 0; k < 8; k++) {
      const angle = pose.headingDegrees * DEG + (k * Math.PI) / 4;
      const at = placeAt(
        field,
        size,
        { x: pose.x + reach * Math.cos(angle), y: pose.y + reach * Math.sin(angle), headingDegrees: pose.headingDegrees },
        others,
      );
      if (at && Math.hypot(at.x - pose.x, at.y - pose.y) < reach + 1) return at;
    }
  }
  return null;
}
