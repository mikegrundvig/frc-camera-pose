// Where the robot may stand: dragging slides along what it touches, turning stops short of a hit,
// a typed spot moves to the nearest legal one, and every spot the page offers is legal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLegal, moveTo, placeAt, turnTo } from '../src/placement.js';
import { random } from '../src/robots.js';
import { SEASONS } from '../src/field.js';
import { spots } from '../src/spots.js';
import { loadField } from './helpers.js';

const INCH = 0.0254;
const ROBOT = { length: 35.5 * INCH, width: 35.5 * INCH };
const HALF = ROBOT.length / 2;
// How close counts as the same place: a few millimeters, the push's clearance plus rounding.
const CLOSE = 0.006;

const rebuilt = loadField(2026);
// The blue hub is the block from x 4.03 to 5.22 and y 3.44 to 4.63.
const HUB = { west: 4.0287, south: 3.4372 };

// A small field of its own for the cases that need an exact shape: a block along the left wall's
// middle and a block along the bottom wall's middle, leaving a corner between them and two gaps.
function block(x0, y0, x1, y1) {
  return {
    blocks: [
      {
        bottomMeters: 0,
        outline: [
          [x0, y0],
          [x1, y0],
          [x1, y1],
          [x0, y1],
        ],
      },
    ],
  };
}

function toyField(elements) {
  return { length: 10, width: 8, elements };
}

function pose(x, y, headingDegrees = 0) {
  return { x, y, headingDegrees };
}

function near(actual, expected, what) {
  assert.ok(Math.abs(actual - expected) < CLOSE, `${what}: ${actual} is not about ${expected}`);
}

test('dragging into a hub face head-on slides to it and stops', () => {
  const start = pose(2, 4.03);
  const end = moveTo(rebuilt, ROBOT, start, 4.9, 4.03);
  near(end.x, HUB.west - HALF, 'x');
  near(end.y, 4.03, 'y');
  assert.ok(isLegal(rebuilt, ROBOT, end));
});

test('dragging past a hub keeps the side it came from', () => {
  // The pointer goes far into the hub, past its middle; the robot stays on the west face.
  const end = moveTo(rebuilt, ROBOT, pose(2, 4.03), 5.1, 4.05);
  assert.ok(end.x < HUB.west, `x ${end.x}`);
  assert.ok(isLegal(rebuilt, ROBOT, end));
});

const glancing = [
  // [name, start, pointer, expected x, expected y]
  ['along the hub\'s south face', pose(3, 2.6), [4.6, 3.2], 4.6, HUB.south - HALF],
  ['along the hub\'s west face', pose(3, 3.6), [4.1, 4.4], HUB.west - HALF, 4.4],
  ['away from the hub is unhindered', pose(3.5, 4), [3, 4], 3, 4],
];

for (const [name, start, [px, py], x, y] of glancing) {
  test(`glancing: ${name}`, () => {
    const end = moveTo(rebuilt, ROBOT, start, px, py);
    near(end.x, x, 'x');
    near(end.y, y, 'y');
    assert.ok(isLegal(rebuilt, ROBOT, end));
  });
}

test('a turned robot slides along a face too', () => {
  const start = pose(3, 2.6, 30);
  const end = moveTo(rebuilt, ROBOT, start, 4.6, 3.6);
  assert.equal(end.headingDegrees, 30);
  assert.ok(isLegal(rebuilt, ROBOT, end));
  assert.ok(end.x > 3.5, `slid on to ${end.x}`);
});

test('into the corner between a wall and an element stops in it', () => {
  // A block on the left wall (x to 2, y 3 to 5): dragged down onto it from above, the
  // robot comes to rest on top of it, against the wall.
  const field = toyField([block(0, 3, 2, 5)]);
  const end = moveTo(field, ROBOT, pose(1.5, 6.5), 0.2, 3.1);
  assert.ok(isLegal(field, ROBOT, end));
  near(end.x, HALF, 'against the left wall');
  near(end.y, 5 + HALF, 'on top of the block');
});

test('into a concave corner of two elements fits snugly', () => {
  // An L: a block along the bottom (y to 1) and one rising from it on the left (x to 1).
  const field = toyField([block(0, 0, 9, 1), block(0, 1, 1, 6)]);
  const end = moveTo(field, ROBOT, pose(5, 3), 0.3, 1.2);
  assert.ok(isLegal(field, ROBOT, end));
  near(end.x, 1 + HALF, 'against the upright');
  near(end.y, 1 + HALF, 'on the long block');
});

test('a gap narrower than the robot is not entered', () => {
  const field = toyField([block(4, 0, 5, 3), block(6, 0, 7, 3)]);
  // The gap between x 5 and 6 is a meter wide against a 0.9 m robot: fits. Narrow it to 0.5 m.
  const narrow = toyField([block(4, 0, 5, 3), block(5.5, 0, 7, 3)]);
  const through = moveTo(field, ROBOT, pose(5.5, 5), 5.5, 1);
  near(through.y, 1, 'the wide gap lets it in');
  const stopped = moveTo(narrow, ROBOT, pose(5.25, 5), 5.25, 1);
  assert.ok(stopped.y > 3, `stopped at y ${stopped.y}`);
  assert.ok(isLegal(narrow, ROBOT, stopped));
});

test('a field corner holds the robot in both ways at once', () => {
  const field = toyField([]);
  const end = moveTo(field, ROBOT, pose(5, 4), -3, -3);
  near(end.x, HALF, 'x');
  near(end.y, HALF, 'y');
});

test('the walls hold the robot in', () => {
  const cases = [
    [-3, 2.5, HALF, 2.5],
    [20, 2.5, rebuilt.length - HALF, 2.5],
    [2, -3, 2, HALF],
    [2, 20, 2, rebuilt.width - HALF],
  ];
  for (const [px, py, x, y] of cases) {
    const end = moveTo(rebuilt, ROBOT, pose(2, 2.5), px, py);
    near(end.x, x, `x for ${px}, ${py}`);
    near(end.y, y, `y for ${px}, ${py}`);
  }
});

const turns = [
  // [name, field, start, heading asked for, least heading kept, most heading kept]
  ['against the left wall', rebuilt, pose(0.5, 5.5), 45, 5, 7],
  ['against the left wall, the other way', rebuilt, pose(0.5, 5.5), -45, -7, -5],
  ['against a hub face', rebuilt, pose(3.55, 4), 90, 2, 4],
  ['in the open, anywhere', rebuilt, pose(8, 4), 135, 135, 135],
  ['the long way round is the short one', rebuilt, pose(8, 4, 170), -170, -170, -170],
];

for (const [name, field, start, asked, least, most] of turns) {
  test(`turning ${name}`, () => {
    assert.ok(isLegal(field, ROBOT, start), 'the start is legal');
    const end = turnTo(field, ROBOT, start, asked);
    assert.ok(isLegal(field, ROBOT, end));
    assert.ok(end.headingDegrees >= least && end.headingDegrees <= most, `kept ${end.headingDegrees}`);
    assert.equal(end.x, start.x);
    assert.equal(end.y, start.y);
  });
}

test('a turn that would hit stays at the last legal heading', () => {
  const start = pose(0.5, 5.5, 0);
  const first = turnTo(rebuilt, ROBOT, start, 45);
  // Asking again for the same turn does not creep any further.
  assert.equal(turnTo(rebuilt, ROBOT, first, 45).headingDegrees, first.headingDegrees);
  // And turning back is free.
  assert.equal(turnTo(rebuilt, ROBOT, first, 0).headingDegrees, 0);
});

const typed = [
  // [name, typed x, typed y, expected x, expected y, or null for just legal and near]
  ['inside the hub, off center', 4.3, 4.0, HUB.west - HALF, 4.0],
  ['inside the hub, near its south face', 4.6, 3.6, 4.6, HUB.south - HALF],
  ['off the field', -5, 20, HALF, rebuilt.width - HALF],
  ['in the open', 8, 4, 8, 4],
];

for (const [name, tx, ty, x, y] of typed) {
  test(`typed position ${name}`, () => {
    const end = placeAt(rebuilt, ROBOT, pose(tx, ty));
    assert.ok(isLegal(rebuilt, ROBOT, end));
    near(end.x, x, 'x');
    near(end.y, y, 'y');
  });
}

test('typed position in the middle of the hub goes out of it by the shortest way', () => {
  const end = placeAt(rebuilt, ROBOT, pose(4.6258, 4.0345));
  assert.ok(isLegal(rebuilt, ROBOT, end));
  const away = Math.hypot(end.x - 4.6258, end.y - 4.0345);
  // Half the hub plus half the robot is the least it can be.
  near(away, 0.5945 + HALF, 'distance moved');
});

test('typed position in a gap too narrow finds the nearest open place', () => {
  const field = toyField([block(4, 0, 5, 8), block(5.5, 0, 7, 8)]);
  const end = placeAt(field, ROBOT, pose(5.25, 4));
  assert.ok(isLegal(field, ROBOT, end));
  assert.ok(Math.hypot(end.x - 5.25, end.y - 4) < 2, `${end.x}, ${end.y}`);
});

test('a place that is the same every time', () => {
  const a = moveTo(rebuilt, ROBOT, pose(2, 3.8, 20), 4.7, 4.1);
  const b = moveTo(rebuilt, ROBOT, pose(2, 3.8, 20), 4.7, 4.1);
  assert.deepEqual(a, b);
});

test('random drags and turns always end legal, in every season', () => {
  for (const season of SEASONS) {
    const field = loadField(season.year);
    const next = random(season.year);
    let at = placeAt(field, ROBOT, pose(field.length / 2, field.width / 2));
    for (let n = 0; n < 150; n++) {
      if (next() < 0.7) {
        at = moveTo(field, ROBOT, at, next() * field.length, next() * field.width);
      } else {
        at = turnTo(field, ROBOT, at, next() * 360 - 180);
      }
      assert.ok(isLegal(field, ROBOT, at), `${season.year} step ${n}: ${JSON.stringify(at)}`);
    }
  }
});

const sizes = [20, 28, 35.5, 40, 46].map((inches) => ({ length: inches * INCH, width: inches * INCH }));
sizes.push({ length: 40 * INCH, width: 26 * INCH });

for (const season of SEASONS) {
  test(`every spot in the ${season.year} season is legal`, () => {
    const field = loadField(season.year);
    for (const size of sizes) {
      const list = spots(field, size);
      assert.ok(list.length >= 5, `${list.length} spots for a ${size.length} m robot`);
      for (const spot of list) {
        assert.ok(isLegal(field, size, spot.pose), `${spot.label} for ${size.length} x ${size.width}`);
      }
    }
  });
}

test('the starting positions stay where the season puts them for a 35.5 in robot', () => {
  for (const season of SEASONS) {
    const field = loadField(season.year);
    const list = spots(field, ROBOT);
    for (const start of field.starts) {
      const spot = list.find((s) => s.label.startsWith('Start:') && s.label.includes(start.name.toLowerCase()) && s.label.includes(start.alliance));
      assert.ok(spot, `${season.year} ${start.alliance} ${start.name}`);
      assert.ok(Math.hypot(spot.pose.x - start.x, spot.pose.y - start.y) < 0.01, `${season.year} ${start.name} moved`);
    }
  }
});
