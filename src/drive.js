// Driving the robot: what keys (or a stick) ask for, and one step of the robot's motion for a
// slice of time. The step is the same whatever the frame rate: speeds are per second, the heading
// a step travels in is the middle of its turn, and the robot slides along what it touches as it
// does when dragged (see placement.js). Poses are { x, y, headingDegrees } with every digit.

import { DEG } from './math.js';
import { moveToExact, turnToExact } from './placement.js';

// How fast the robot drives and turns at full input, and the share of that when slowed.
export const DRIVE_METERS_PER_SECOND = 3;
export const TURN_DEGREES_PER_SECOND = 180;
export const SLOW_SHARE = 0.25;

export const FIELD_RELATIVE = 'field';
export const ROBOT_RELATIVE = 'robot';

// The keys that drive (by what they are, not what they type), and the ones that count as asking for
// something: each is a direction on the driver's own axes.
const FORWARD = ['KeyW', 'ArrowUp'];
const BACK = ['KeyS', 'ArrowDown'];
const LEFT = ['KeyA', 'ArrowLeft'];
const RIGHT = ['KeyD', 'ArrowRight'];
const TURN_LEFT = ['KeyQ'];
const TURN_RIGHT = ['KeyE'];
const SLOW_KEYS = ['ShiftLeft', 'ShiftRight'];
export const DRIVE_CODES = [...FORWARD, ...BACK, ...LEFT, ...RIGHT, ...TURN_LEFT, ...TURN_RIGHT, ...SLOW_KEYS];

function held(keys, codes) {
  return codes.some((code) => keys.has(code)) ? 1 : 0;
}

// What a set of held keys asks for: `forward`, `left` and `turn` from -1 to 1 (turn is left, the
// way the heading grows), the pair of translations no stronger than 1 together, and `slow`.
export function inputFromKeys(keys) {
  const forward = held(keys, FORWARD) - held(keys, BACK);
  const left = held(keys, LEFT) - held(keys, RIGHT);
  const length = Math.hypot(forward, left);
  return {
    forward: length > 1 ? forward / length : forward,
    left: length > 1 ? left / length : left,
    turn: held(keys, TURN_LEFT) - held(keys, TURN_RIGHT),
    slow: held(keys, SLOW_KEYS) === 1,
  };
}

// What a gamepad asks for: the left stick translates (up is forward), the right stick's side
// turns, either trigger slows. A stick inside the dead zone counts as centered, and outside it
// the push is measured from the edge of the zone.
const DEAD_ZONE = 0.15;

function stick(value) {
  const size = Math.abs(value);
  return size < DEAD_ZONE ? 0 : Math.sign(value) * ((size - DEAD_ZONE) / (1 - DEAD_ZONE));
}

export function inputFromGamepad(pad) {
  const forward = stick(-pad.axes[1]);
  const left = stick(-pad.axes[0]);
  const length = Math.hypot(forward, left);
  return {
    forward: length > 1 ? forward / length : forward,
    left: length > 1 ? left / length : left,
    turn: stick(-(pad.axes[2] || 0)),
    slow: [6, 7].some((i) => pad.buttons[i] && pad.buttons[i].pressed),
  };
}

export function asksForMotion(input) {
  return input.forward !== 0 || input.left !== 0 || input.turn !== 0;
}

// The robot after `seconds` of the input. `relative` says what forward is: away from the blue
// alliance wall (+x) with left to its +y side, or the way the robot faces. `others` are outlines
// to stay off besides the field's.
export function driveStep(field, size, pose, input, seconds, relative = FIELD_RELATIVE, others = []) {
  const share = input.slow ? SLOW_SHARE : 1;
  const turnRate = input.turn * TURN_DEGREES_PER_SECOND * share;
  // The heading the translation is taken in: the middle of this step's turn.
  const heading = (pose.headingDegrees + (relative === ROBOT_RELATIVE ? (turnRate * seconds) / 2 : 0)) * DEG;
  const ahead = relative === ROBOT_RELATIVE ? [Math.cos(heading), Math.sin(heading)] : [1, 0];
  const aside = [-ahead[1], ahead[0]];
  const speed = DRIVE_METERS_PER_SECOND * share * seconds;
  const dx = (input.forward * ahead[0] + input.left * aside[0]) * speed;
  const dy = (input.forward * ahead[1] + input.left * aside[1]) * speed;
  const moved = moveToExact(field, size, pose, pose.x + dx, pose.y + dy, others);
  const turned = turnToExact(field, size, moved, moved.headingDegrees + turnRate * seconds, others);
  return { ...turned, headingDegrees: wrapDegrees(turned.headingDegrees) };
}

function wrapDegrees(degrees) {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}
