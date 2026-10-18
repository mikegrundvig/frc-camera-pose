// Whether a camera's view faces out of the robot: hand-computed for a 35.5 in robot, mounts 6 in inside
// the bumpers and a 70.9 degree horizontal field of view (35.455 degrees each side).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PATH_LIMIT_METERS, longestPath, outwardYawRuns, overlapStyle, pathInside, polygonArea, viewFacesOut, viewOverRobot } from '../src/clip.js';

const INCH = 0.0254;
const SIZE = { length: 35.5 * INCH, width: 35.5 * INCH };
const HALF = 35.455;
const at = (forward, left) => ({ forward: forward * INCH, left: left * INCH });
const CORNER = at(11.75, 11.75);
const FRONT = at(11.75, 0);
const LEFT = at(0, 11.75);
const CENTER = at(0, 0);
const close = (a, b, tolerance, what) => assert.ok(Math.abs(a - b) <= tolerance, `${what}: ${a} vs ${b}`);

// A mount 6 in inside an edge: a ray straight out leaves after 6 in, and one at an angle after
// 6 / cos(angle). The limit is 14 in, so the rays may lean arccos(6 / 14) = 64.62 degrees from the
// face's normal: the front-left corner's yaws run from 64.62 - 35.455 below straight ahead (which is
// -29.17) to 154.62 - 35.455 (119.17), a side middle's from -29.17 to 29.17.

test('the path inside the robot: 6 in straight out, 6 / cos at an angle, along the diagonal 8.49 in', () => {
  close(pathInside(SIZE, CORNER, 0), 6 * INCH, 1e-9, 'ahead');
  close(pathInside(SIZE, CORNER, Math.PI / 2), 6 * INCH, 1e-9, 'left');
  close(pathInside(SIZE, CORNER, Math.PI / 4), (6 / Math.SQRT1_2) * INCH, 1e-9, 'diagonal');
  close(pathInside(SIZE, FRONT, Math.PI / 3), 12 * INCH, 1e-9, 'a side middle at 60 degrees: 12 in');
  // From the middle of the robot every way is 17.75 in or more.
  close(pathInside(SIZE, CENTER, 0), 17.75 * INCH, 1e-9, 'centre ahead');
  // A mount outside the outline runs no path inside it.
  assert.equal(pathInside(SIZE, at(20, 0), 0), 0);
});

test('the longest path of a view includes the ray through a corner, where the nearest edge changes', () => {
  // A corner camera facing out along the diagonal: the ends of its view run 6.08 in and the middle,
  // through the corner of the outline, 8.49 in.
  close(longestPath(SIZE, CORNER, 45, HALF), (6 / Math.SQRT1_2) * INCH, 1e-6, 'diagonal');
  assert.ok(longestPath(SIZE, CENTER, 0, HALF) >= 17.75 * INCH - 1e-9);
});

const yaws = [
  // [name, mount, yaw, faces out]
  ['corner, diagonal (the default 45)', CORNER, 45, true],
  ['corner, straight ahead', CORNER, 0, true],
  ['corner, just inside the limit ahead', CORNER, -29, true],
  ['corner, just past it', CORNER, -30, false],
  ['corner, along the side toward the back, inside', CORNER, 119, true],
  ['corner, along the side toward the back, past', CORNER, 120, false],
  ['corner, the old pinwheel 135', CORNER, 135, false],
  ['corner, backward', CORNER, 180, false],
  ['front middle, straight', FRONT, 0, true],
  ['front middle, inside the limit', FRONT, 29, true],
  ['front middle, past it', FRONT, 30, false],
  ['front middle, toward the side', FRONT, 90, false],
  ['left middle, straight out', LEFT, 90, true],
  ['left middle, inside', LEFT, 61, true],
  ['left middle, past', LEFT, 60, false],
  ['the centre, any way', CENTER, 0, false],
  ['the centre, sideways', CENTER, 90, false],
];

for (const [name, mount, yaw, expected] of yaws) {
  test(`faces out: ${name}`, () => {
    assert.equal(viewFacesOut(SIZE, mount, yaw, HALF), expected);
  });
}

test('the allowed yaw runs match the hand-computed ones', () => {
  const [corner] = outwardYawRuns(SIZE, CORNER, HALF);
  close(corner.from, -29.168, 0.01, 'corner from');
  close(corner.to, 154.623 - HALF, 0.01, 'corner to');
  const [front] = outwardYawRuns(SIZE, FRONT, HALF);
  close(front.from, -(64.6231 - HALF), 0.01, 'front from');
  close(front.to, 64.6231 - HALF, 0.01, 'front to');
  const [left] = outwardYawRuns(SIZE, LEFT, HALF);
  close(left.from, 90 - (64.6231 - HALF), 0.01, 'left from');
  close(left.to, 90 + (64.6231 - HALF), 0.01, 'left to');
  assert.deepEqual(outwardYawRuns(SIZE, CENTER, HALF), []);
  // A run that wraps past 180: the back middle looks 180 plus or minus 29.17.
  const [back] = outwardYawRuns(SIZE, at(-11.75, 0), HALF);
  close(back.from, 180 - (64.6231 - HALF), 0.01, 'back from');
  close(back.to, -180 + (64.6231 - HALF), 0.01, 'back to (wrapped)');
});

test('the limit is 14 in, and a narrower view faces out over a wider run of yaws', () => {
  close(PATH_LIMIT_METERS, 14 * INCH, 1e-12, 'limit');
  const narrow = outwardYawRuns(SIZE, FRONT, 20)[0];
  assert.ok(narrow.to > 29.17 + 15, `narrow view runs to ${narrow.to}`);
});

test('a robot small enough that the middle is within the limit of every edge has room in the middle', () => {
  // A 24 in robot: 12 in from the middle to every edge, so a centre camera faces out where its view
  // is narrow enough.
  const small = { length: 24 * INCH, width: 24 * INCH };
  assert.ok(viewFacesOut(small, CENTER, 0, 20));
});

test('a tighter allowance narrows the yaws: at 10.5 in the front-left corner faces out from -19.70 to 109.70', () => {
  // The rays may lean arccos(6 / 10.5) = 55.150 degrees from a face's normal, so the corner's rays run
  // from -55.150 to 145.150 degrees and its yaws from -55.150 + 35.455 to 145.150 - 35.455.
  const tight = 10.5 * INCH;
  const [corner] = outwardYawRuns(SIZE, CORNER, HALF, tight);
  close(corner.from, -55.150 + HALF, 0.01, 'from');
  close(corner.to, 145.150 - HALF, 0.01, 'to');
  // A yaw that passed at 14 in no longer does, and one inside still does.
  assert.equal(viewFacesOut(SIZE, CORNER, 115, HALF), true);
  assert.equal(viewFacesOut(SIZE, CORNER, 115, HALF, tight), false);
  assert.equal(viewFacesOut(SIZE, CORNER, 45, HALF, tight), true);
  // The least a view may run is the 6 in inset, so a view straight out of a face always passes.
  assert.equal(viewFacesOut(SIZE, FRONT, 0, 0.01, 6 * INCH + 1e-6), true);
});

// The part of the view over the robot, in square inches: hand-computed from the edges the rays reach.
const squareInches = (polygon) => polygonArea(polygon) / (INCH * INCH);
const TAN = Math.tan((HALF * Math.PI) / 180);

test('the view over the robot: a corner camera facing the diagonal has a four-sided patch of 29.95 in2', () => {
  // The rays at 9.545 and 80.455 degrees reach the front and left edges 6 in away at 1.0086 in along
  // them, and the middle ray goes through the corner: apex, (6, 1.0086), (6, 6), (1.0086, 6) in from it.
  const polygon = viewOverRobot(SIZE, CORNER, 45, HALF);
  assert.equal(polygon.length, 4);
  close(squareInches(polygon), 29.948, 0.01, 'area');
  const corner = polygon.find(([x, y]) => Math.abs(x - 17.75 * INCH) < 1e-9 && Math.abs(y - 17.75 * INCH) < 1e-9);
  assert.ok(corner, 'the patch reaches the corner of the robot');
});

test('the view over the robot: a side middle camera facing straight out has a triangle of 36 tan(35.455) in2', () => {
  const polygon = viewOverRobot(SIZE, FRONT, 0, HALF);
  assert.equal(polygon.length, 3);
  close(squareInches(polygon), 36 * TAN, 0.01, 'area');
  // Everything is inside the outline.
  for (const [x, y] of polygon) assert.ok(x <= 17.75 * INCH + 1e-9 && Math.abs(y) <= 17.75 * INCH + 1e-9);
});

test('the view over the robot: a camera in the middle fills a triangle of 17.75 squared times tan in2', () => {
  const polygon = viewOverRobot(SIZE, CENTER, 0, HALF);
  close(squareInches(polygon), 17.75 * 17.75 * TAN, 0.01, 'area');
});

test('the view over the robot: a view along the side stretches the patch, and a mount outside has none', () => {
  // Turned to 135 degrees from the corner the view runs along the left edge, a long patch.
  assert.ok(squareInches(viewOverRobot(SIZE, CORNER, 135, HALF)) > 100);
  assert.deepEqual(viewOverRobot(SIZE, at(20, 0), 0, HALF), []);
});

test('the style is soft or warn by the rule and the limit: warn only when the rule is on and the view crosses further', () => {
  // The diagonal view runs 8.49 in inside the robot; the pinwheel yaw 135 runs 14 in or more.
  assert.equal(overlapStyle(SIZE, CORNER, 45, HALF), 'soft');
  assert.equal(overlapStyle(SIZE, CORNER, 135, HALF), 'warn');
  // The rule off: always soft.
  assert.equal(overlapStyle(SIZE, CORNER, 135, HALF, PATH_LIMIT_METERS, true), 'soft');
  // The limit: 7 in is less than the diagonal's 8.49 in, 10.5 in is more.
  assert.equal(overlapStyle(SIZE, CORNER, 45, HALF, 7 * INCH), 'warn');
  assert.equal(overlapStyle(SIZE, CORNER, 45, HALF, 10.5 * INCH), 'soft');
  // A centre camera always crosses, until the rule is off.
  assert.equal(overlapStyle(SIZE, CENTER, 0, HALF), 'warn');
  assert.equal(overlapStyle(SIZE, CENTER, 0, HALF, PATH_LIMIT_METERS, true), 'soft');
});
