// Field elements and other robots hiding tags, checked by hand on the 2026 field. The blue hub
// stands from x 4.03 to 5.22 m and y 3.44 to 4.63 m, 1.83 m tall; tag 26 is on its face toward the
// blue wall (facing -x), tag 20 on its face toward the red side (facing +x), and tag 4 on the red
// hub's face toward the blue side.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { intrinsics } from '../src/camera.js';
import { rotationFromRollPitchYaw } from '../src/math.js';
import { blockStandsBetween, elementHidingTag } from '../src/occlusion.js';
import { box, outlinesOverlap, placeRobots, random, robotHidesTag } from '../src/robots.js';
import { HIDDEN, SEEN, lookAtTags } from '../src/visibility.js';
import { loadField } from './helpers.js';

const field = loadField(2026);
const tag = (id) => field.tags.find((t) => t.id === id);
const hiding = (eye, id) => {
  const element = elementHidingTag(field.elements, eye, tag(id));
  return element ? element.name : null;
};

test('every block outline is counterclockwise, as the sight-line test needs', () => {
  for (const year of [2024, 2025, 2026]) {
    for (const element of loadField(year).elements) {
      for (const block of element.blocks) {
        let area = 0;
        const o = block.outline;
        for (let i = 0; i < o.length; i++) {
          const p = o[i];
          const q = o[(i + 1) % o.length];
          area += p[0] * q[1] - q[0] * p[1];
        }
        assert.ok(area > 0, `${year} ${element.name}`);
      }
    }
  }
});

test('a tag is not hidden by its own element from in front', () => {
  assert.equal(hiding([2.5, 4.035, 0.5], 26), null);
  assert.equal(hiding([7.0, 4.035, 0.5], 20), null);
  assert.equal(hiding([8.0, 4.035, 0.5], 4), null);
});

test('a tag behind a hub is hidden by it', () => {
  // Tag 20 seen from the blue side, through its own hub.
  assert.equal(hiding([2.5, 4.035, 0.5], 20), 'Hub (blue)');
  // The red hub's tag 4, from behind the blue hub.
  assert.equal(hiding([2.5, 4.035, 0.5], 4), 'Hub (blue)');
  // From above the hub, the line clears it.
  assert.equal(hiding([2.5, 4.035, 3.0], 4), null);
});

test('a block lets a line pass that only runs along its face', () => {
  const block = {
    outline: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    bottomMeters: 0,
    topMeters: 1,
  };
  assert.equal(blockStandsBetween(block, [-1, 0.5, 0.5], [2, 0.5, 0.5]), true);
  assert.equal(blockStandsBetween(block, [-1, 0, 0.5], [2, 0, 0.5]), false);
  assert.equal(blockStandsBetween(block, [-1, 0.5, 1.5], [2, 0.5, 1.2]), false);
  // A bar a line passes under.
  assert.equal(blockStandsBetween({ ...block, bottomMeters: 0.6 }, [-1, 0.5, 0.3], [2, 0.5, 0.3]), false);
});

test('a camera reports a tag behind a hub as hidden, naming the hub', () => {
  // A camera at x = 2.5 m looking straight at the red hub, 0.5 m up, level, seeing far enough.
  const camera = {
    position: [2.5, 4.035, 0.5],
    rotation: rotationFromRollPitchYaw(0, 0, 0),
    intrinsics: intrinsics({ widthPixels: 1280, heightPixels: 800, fovDegrees: 80, fovAcross: 'diagonal' }),
  };
  const settings = { sightMeters: 10 };
  const clear = lookAtTags(field, camera, settings, {}).find((r) => r.id === 4);
  assert.equal(clear.status, SEEN);
  const blocked = lookAtTags(field, camera, settings, { elements: true }).find((r) => r.id === 4);
  assert.equal(blocked.status, HIDDEN);
  assert.equal(blocked.hiddenBy, 'Hub (blue)');
});

test('another robot between the camera and a tag hides it', () => {
  const eye = [2.0, 4.035, 0.5];
  const between = box(3.0, 4.035, 0, 0.45, 0.45, 0.76);
  const aside = box(3.0, 6.0, 0, 0.45, 0.45, 0.76);
  const short = box(3.0, 4.035, 0, 0.45, 0.45, 0.3);
  assert.equal(robotHidesTag([between], eye, tag(26)), true);
  assert.equal(robotHidesTag([aside], eye, tag(26)), false);
  // A robot lower than the line from the camera to the tag doesn't hide it.
  assert.equal(robotHidesTag([short], eye, tag(26)), false);
});

test('other robots are placed clear of the robot, each other and the walls, the same each time', () => {
  const pose = { x: 8.27, y: 4.03, heading: 0.3 };
  const size = { length: 0.9017, width: 0.9017 };
  const place = (seed) => placeRobots(pose, field, size, 0.76, 5, 9.0, random(seed), null);
  const robots = place(7);
  assert.equal(robots.length, 5);
  assert.deepEqual(place(7), robots);
  assert.notDeepEqual(place(8), robots);
  const corners = (b) => {
    const c = Math.cos(b.heading);
    const s = Math.sin(b.heading);
    return [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ].map(([a, l]) => [b.x + a * b.halfLength * c - l * b.halfWidth * s, b.y + a * b.halfLength * s + l * b.halfWidth * c]);
  };
  const self = corners(box(pose.x, pose.y, pose.heading, 0.45, 0.45, 0.76));
  robots.forEach((r, i) => {
    assert.equal(outlinesOverlap(corners(r), self), false);
    for (const [x, y] of corners(r)) {
      assert.ok(x >= 0 && x <= field.length && y >= 0 && y <= field.width);
    }
    robots.slice(i + 1).forEach((other) => assert.equal(outlinesOverlap(corners(r), corners(other)), false));
  });
});
