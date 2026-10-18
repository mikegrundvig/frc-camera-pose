// Driving: what the keys ask for, and that a step of motion is the same at any frame rate, in the
// right directions, and slides along what it touches.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRIVE_METERS_PER_SECOND,
  FIELD_RELATIVE,
  ROBOT_RELATIVE,
  asksForMotion,
  driveStep,
  inputFromGamepad,
  inputFromKeys,
} from '../src/drive.js';
import { isLegal } from '../src/placement.js';
import { loadField } from './helpers.js';

const INCH = 0.0254;
const SIZE = { length: 35.5 * INCH, width: 35.5 * INCH };
const field = loadField(2026);
const pose = (x, y, headingDegrees = 0) => ({ x, y, headingDegrees });
const keys = (...codes) => new Set(codes);
const near = (a, b, tolerance, what) => assert.ok(Math.abs(a - b) <= tolerance, `${what}: ${a} is not about ${b}`);

// Holds an input for some seconds at a frame rate, as the page's loop would.
function drive(from, input, seconds, fps, relative = FIELD_RELATIVE) {
  let at = from;
  const frames = Math.round(seconds * fps);
  for (let i = 0; i < frames; i++) at = driveStep(field, SIZE, at, input, 1 / fps, relative);
  return at;
}

const inputs = [
  // [name, keys, forward, left, turn]
  ['W', ['KeyW'], 1, 0, 0],
  ['the up arrow', ['ArrowUp'], 1, 0, 0],
  ['S', ['KeyS'], -1, 0, 0],
  ['A', ['KeyA'], 0, 1, 0],
  ['the right arrow', ['ArrowRight'], 0, -1, 0],
  ['Q', ['KeyQ'], 0, 0, 1],
  ['E', ['KeyE'], 0, 0, -1],
  ['W and D together are no faster than W', ['KeyW', 'KeyD'], Math.SQRT1_2, -Math.SQRT1_2, 0],
  ['W and S cancel', ['KeyW', 'KeyS'], 0, 0, 0],
  ['nothing', [], 0, 0, 0],
];

for (const [name, codes, forward, left, turn] of inputs) {
  test(`keys: ${name}`, () => {
    const input = inputFromKeys(keys(...codes));
    near(input.forward, forward, 1e-9, 'forward');
    near(input.left, left, 1e-9, 'left');
    near(input.turn, turn, 1e-9, 'turn');
  });
}

test('Shift is slow, and asking for nothing is not asking for motion', () => {
  assert.equal(inputFromKeys(keys('KeyW', 'ShiftLeft')).slow, true);
  assert.equal(inputFromKeys(keys('KeyW')).slow, false);
  assert.equal(asksForMotion(inputFromKeys(keys('ShiftLeft'))), false);
  assert.equal(asksForMotion(inputFromKeys(keys('KeyE'))), true);
});

test('a gamepad: dead zone, up is forward, right stick turns right', () => {
  const pad = (axes, pressed = []) => ({ axes, buttons: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ pressed: pressed.includes(i) })) });
  assert.equal(asksForMotion(inputFromGamepad(pad([0.1, -0.1, 0.05, 0]))), false);
  const full = inputFromGamepad(pad([0, -1, 1, 0]));
  near(full.forward, 1, 1e-9, 'forward');
  near(full.turn, -1, 1e-9, 'turn');
  const left = inputFromGamepad(pad([-1, 0, 0, 0], [7]));
  near(left.left, 1, 1e-9, 'left');
  assert.equal(left.slow, true);
});

test('field-relative W goes away from the blue wall whatever way the robot faces', () => {
  for (const heading of [0, 90, 180, -135]) {
    const end = drive(pose(8, 4, heading), inputFromKeys(keys('KeyW')), 0.5, 60);
    near(end.x, 8 + 1.5, 1e-6, `x facing ${heading}`);
    near(end.y, 4, 1e-6, `y facing ${heading}`);
    near(Math.abs(end.headingDegrees), Math.abs(heading), 1e-6, 'heading');
  }
});

test('field-relative A goes toward +y, the left of someone looking down the field', () => {
  const end = drive(pose(8, 4, 90), inputFromKeys(keys('KeyA')), 0.5, 60);
  near(end.x, 8, 1e-6, 'x');
  near(end.y, 5.5, 1e-6, 'y');
});

const robotRelative = [
  // [name, keys, heading, expected dx, expected dy] for half a second at full speed (1.5 m)
  ['W facing +x', ['KeyW'], 0, 1.5, 0],
  ['W facing +y', ['KeyW'], 90, 0, 1.5],
  ['S facing +y', ['KeyS'], 90, 0, -1.5],
  ['A facing +x', ['KeyA'], 0, 0, 1.5],
  ['A facing +y', ['KeyA'], 90, -1.5, 0],
  ['D facing 180', ['KeyD'], 180, 0, 1.5],
];

for (const [name, codes, heading, dx, dy] of robotRelative) {
  test(`robot-relative: ${name}`, () => {
    const end = drive(pose(8, 4, heading), inputFromKeys(keys(...codes)), 0.5, 60, ROBOT_RELATIVE);
    near(end.x, 8 + dx, 1e-6, 'x');
    near(end.y, 4 + dy, 1e-6, 'y');
  });
}

test('speeds: 3 m/s, 180 degrees a second, a quarter of that slowed', () => {
  const full = drive(pose(6, 4), inputFromKeys(keys('KeyW')), 1, 60);
  near(full.x - 6, DRIVE_METERS_PER_SECOND, 1e-6, 'meters in a second');
  const slow = drive(pose(6, 4), inputFromKeys(keys('KeyW', 'ShiftLeft')), 1, 60);
  near(slow.x - 6, DRIVE_METERS_PER_SECOND / 4, 1e-6, 'meters in a second slowed');
  const turn = drive(pose(8, 4), inputFromKeys(keys('KeyQ')), 0.5, 60);
  near(turn.headingDegrees, 90, 1e-6, 'degrees in half a second');
  const turnSlow = drive(pose(8, 4), inputFromKeys(keys('KeyE', 'ShiftLeft')), 1, 60);
  near(turnSlow.headingDegrees, -45, 1e-6, 'degrees in a second slowed');
});

const paths = [
  // [name, keys, relative]
  ['straight', ['KeyW'], FIELD_RELATIVE],
  ['a diagonal while turning', ['KeyW', 'KeyA', 'KeyQ'], FIELD_RELATIVE],
  ['an arc, robot-relative', ['KeyW', 'KeyQ'], ROBOT_RELATIVE],
  ['a tight arc, robot-relative and slow', ['KeyW', 'KeyE', 'ShiftLeft'], ROBOT_RELATIVE],
  ['sideways while turning, robot-relative', ['KeyD', 'KeyQ'], ROBOT_RELATIVE],
];

for (const [name, codes, relative] of paths) {
  test(`the same path at 30, 60 and 144 frames a second: ${name}`, () => {
    const input = inputFromKeys(keys(...codes));
    // Half a second: a whole number of frames at each rate.
    const results = [30, 60, 144].map((fps) => drive(pose(8, 4, 20), input, 0.5, fps, relative));
    for (const end of results) {
      near(end.x, results[0].x, 0.01, 'x');
      near(end.y, results[0].y, 0.01, 'y');
      near(end.headingDegrees, results[0].headingDegrees, 0.1, 'heading');
    }
  });
}

test('driving into a hub stops at its face and then slides along it', () => {
  // The blue hub's west face is at x 4.029; the robot's front stops there.
  const head = drive(pose(2, 4.035), inputFromKeys(keys('KeyW')), 2, 60);
  near(head.x, 4.0287 - SIZE.length / 2, 0.006, 'x at the face');
  near(head.y, 4.035, 1e-6, 'y');
  // Diagonally from below the hub's middle: the robot comes up against the face and slides up it.
  const slid = drive(pose(3, 3.5), inputFromKeys(keys('KeyW', 'KeyA')), 0.5, 60);
  assert.ok(isLegal(field, SIZE, slid));
  assert.ok(slid.y > 4.3, `slid up to ${slid.y}`);
  near(slid.x, 4.0287 - SIZE.length / 2, 0.006, 'x stays at the face');
  // The same slide at another frame rate ends in the same place.
  const again = drive(pose(3, 3.5), inputFromKeys(keys('KeyW', 'KeyA')), 0.5, 144);
  near(again.y, slid.y, 0.02, 'y at 144 frames a second');
  near(again.x, slid.x, 0.006, 'x at 144 frames a second');
});

test('driving into a wall stops there, and a turn against it is refused', () => {
  const wall = drive(pose(1, 5.5), inputFromKeys(keys('KeyS')), 2, 60);
  near(wall.x, SIZE.length / 2, 0.006, 'x');
  const turned = drive(wall, inputFromKeys(keys('KeyQ')), 1, 60);
  assert.ok(Math.abs(turned.headingDegrees) < 1, `heading ${turned.headingDegrees}`);
  assert.ok(isLegal(field, SIZE, turned));
});

test('driving does not go through another robot', () => {
  const other = [[[9, 3.5], [9.9, 3.5], [9.9, 4.4], [9, 4.4]]];
  let at = pose(6, 3.95);
  for (let i = 0; i < 120; i++) at = driveStep(field, SIZE, at, inputFromKeys(keys('KeyW')), 1 / 60, FIELD_RELATIVE, other);
  near(at.x, 9 - SIZE.length / 2, 0.006, 'x');
  assert.ok(isLegal(field, SIZE, at, other));
});
