// Other robots placed by hand: where they may stand, that they stay put, and the link.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLegal, moveTo, outlineAt, placeAt, spotNear, turnTo } from '../src/placement.js';
import { defaultState, fromText, scoringState, toJson } from '../src/state.js';
import { loadField } from './helpers.js';

const INCH = 0.0254;
const SIZE = { length: 35.5 * INCH, width: 35.5 * INCH };
const HALF = SIZE.length / 2;
const CLOSE = 0.006;

const field = loadField(2026);
const pose = (x, y, headingDegrees = 0) => ({ x, y, headingDegrees });
const outlines = (...poses) => poses.map((p) => outlineAt(SIZE, p));
const near = (a, b, what) => assert.ok(Math.abs(a - b) < CLOSE, `${what}: ${a} is not about ${b}`);

test('a robot dragged into another one slides along it and stops', () => {
  const main = pose(10, 3);
  // Head-on from the left into the main robot's west face.
  const end = moveTo(field, SIZE, pose(7, 3), 10, 3, outlines(main));
  near(end.x, 10 - 2 * HALF, 'x');
  near(end.y, 3, 'y');
  assert.ok(isLegal(field, SIZE, end, outlines(main)));
});

test('dragged past another robot it keeps the side it came from', () => {
  const main = pose(10, 3);
  const end = moveTo(field, SIZE, pose(7, 3), 10.3, 3.1, outlines(main));
  assert.ok(end.x < 10, `x ${end.x}`);
  assert.ok(isLegal(field, SIZE, end, outlines(main)));
});

test('two other robots do not overlap: the second goes round the first', () => {
  const first = pose(10, 3);
  const second = moveTo(field, SIZE, pose(7, 2.4), 10.2, 2.4, outlines(first));
  assert.ok(isLegal(field, SIZE, second, outlines(first)));
  // It came up against the first robot's west face and stopped there, not inside it.
  assert.ok(second.x < 10 - 2 * HALF + CLOSE, `x ${second.x}`);
});

test('a turn that would swing into another robot is refused', () => {
  const neighbor = pose(10 + 2 * HALF + 0.02, 3);
  const start = pose(10, 3, 0);
  const end = turnTo(field, SIZE, start, 45, outlines(neighbor));
  assert.ok(isLegal(field, SIZE, end, outlines(neighbor)));
  assert.ok(end.headingDegrees < 5, `heading ${end.headingDegrees}`);
});

test('a typed place inside another robot moves to the nearest free one', () => {
  const other = pose(10, 3);
  const end = placeAt(field, SIZE, pose(10.1, 3.05), outlines(other));
  assert.ok(isLegal(field, SIZE, end, outlines(other)));
  assert.ok(Math.hypot(end.x - 10.1, end.y - 3.05) < 2 * HALF + 0.1);
});

test('a new robot goes to a clear spot near the main one, and the next to another', () => {
  const main = pose(8, 4);
  const placed = [];
  for (let n = 0; n < 5; n++) {
    const at = spotNear(field, SIZE, main, outlines(main, ...placed));
    assert.ok(at, `robot ${n + 1}`);
    assert.ok(isLegal(field, SIZE, at, outlines(main, ...placed)));
    assert.ok(Math.hypot(at.x - main.x, at.y - main.y) < 6, 'near the main robot');
    placed.push(at);
  }
});

test('a new robot near a wall and an element still finds room', () => {
  const main = pose(HALF + 0.01, 0.6);
  const at = spotNear(field, SIZE, main, outlines(main));
  assert.ok(at);
  assert.ok(isLegal(field, SIZE, at, outlines(main)));
});

test('placed robots go in the link and come back as they were', () => {
  const state = defaultState();
  state.otherRobots.robots = [pose(9, 2, 30), pose(11.5, 5.25, -120)];
  const back = fromText(toJson(state));
  assert.deepEqual(back.otherRobots.robots, state.otherRobots.robots);
});

test('a link with too many robots, or odd ones, is cleaned up', () => {
  const state = defaultState();
  state.otherRobots.robots = Array.from({ length: 8 }, (_, i) => pose(i, 1));
  assert.equal(fromText(toJson(state)).otherRobots.robots.length, 5);
  const odd = fromText(JSON.stringify({ otherRobots: { robots: [{ x: 'far', y: 99 }, null] } }));
  assert.deepEqual(odd.otherRobots.robots, [pose(8, 10, 0), pose(8, 4, 0)]);
});

test('the maps take as many robots as are placed', () => {
  const state = defaultState();
  assert.equal(scoringState(state).otherRobots.count, 0);
  state.otherRobots.robots = [pose(9, 2), pose(11, 5), pose(12, 6)];
  assert.equal(scoringState(state).otherRobots.count, 3);
});

test('the maps do not depend on where the robots or the main robot are', () => {
  const a = defaultState();
  a.otherRobots.robots = [pose(9, 2), pose(11, 5)];
  const b = defaultState();
  b.pose = pose(5, 5);
  b.otherRobots.robots = [pose(3, 3), pose(14, 1)];
  assert.deepEqual(scoringState(a), scoringState(b));
});
