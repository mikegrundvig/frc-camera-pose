// A camera's image: where a tag's corners land, by a hand-worked case, and which tags are drawn.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { intrinsics } from '../src/camera.js';
import { horizon, tagsInImage } from '../src/eye.js';
import { buildField } from '../src/field.js';
import { box } from '../src/robots.js';
import { lookAtTags } from '../src/visibility.js';

const close = (a, b, tolerance = 0.05) => assert.ok(Math.abs(a - b) < tolerance, `${a} vs ${b}`);

// A 1280 x 800 lens with an 80 degree diagonal view: fx = 898.74 and fy = 898.31, the principal
// point at (639.5, 399.5).
const k = intrinsics({ widthPixels: 1280, heightPixels: 800, fovDegrees: 80, fovAcross: 'diagonal' });
const IDENTITY = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const camera = { position: [0, 0, 0], rotation: IDENTITY, intrinsics: k };
const SETTINGS = { sightMeters: 7 };

// Tags on a made-up field, each facing -x (back toward a camera at the origin): a quaternion for
// a half turn about the vertical.
function fieldWith(tags) {
  const layout = {
    name: 'test',
    'field-dimensions': { length: 16, width: 8 },
    'field-tags': tags.map(([ID, x, y, facing]) => ({
      ID,
      pose: {
        translation: { x, y, z: 0 },
        rotation: { quaternion: facing ? { W: 0, X: 0, Y: 0, Z: 1 } : { W: 1, X: 0, Y: 0, Z: 0 } },
      },
    })),
  };
  return buildField({ year: 0, game: 'test' }, layout, null);
}

test('a tag two meters ahead lands on the hand-worked pixels', () => {
  // The tag is 0.1651 m square, so each corner is 0.08255 m from its center: 37.095 pixels across
  // (fx * 0.08255 / 2) and 37.078 up (fy * 0.08255 / 2) either side of the principal point.
  const field = fieldWith([[1, 2, 0, true]]);
  const results = lookAtTags(field, camera, SETTINGS);
  const [tag] = tagsInImage(camera, results);
  assert.equal(tag.seen, true);
  const us = tag.corners.map((c) => c[0]).sort((a, b) => a - b);
  const vs = tag.corners.map((c) => c[1]).sort((a, b) => a - b);
  close(us[0], 639.5 - 37.095);
  close(us[3], 639.5 + 37.095);
  close(vs[0], 399.5 - 37.078);
  close(vs[3], 399.5 + 37.078);
  // About 74.17 pixels across: the square root of its area.
  close(tag.pixels, 74.17, 0.05);
});

test('a hidden tag is drawn too, with what hides it', () => {
  const field = fieldWith([[1, 2, 0, true]]);
  const robots = [box(1, 0, 0, 0.3, 0.3, 1)];
  const [tag] = tagsInImage(camera, lookAtTags(field, camera, SETTINGS, { robots }));
  assert.equal(tag.seen, false);
  assert.equal(tag.reason, 'behind another robot');
  close(tag.corners[0][0], 639.5, 40);
});

test('a tag cut off by the image edge is drawn with its corners past the edge', () => {
  // 2 m ahead and 1.5 m left: past the left of the image.
  const field = fieldWith([[1, 2, 1.5, true]]);
  const [tag] = tagsInImage(camera, lookAtTags(field, camera, SETTINGS));
  assert.equal(tag.seen, false);
  assert.equal(tag.reason, 'outside the image');
});

test('a tag facing away, or with no corner in the image, is left out', () => {
  const field = fieldWith([
    [1, 2, 0, false],
    [2, 2, 6, true],
    [3, -2, 0, true],
  ]);
  assert.equal(tagsInImage(camera, lookAtTags(field, camera, SETTINGS)).length, 0);
});

test('the horizon of a level camera is the middle row; tilted up 10 degrees it drops', () => {
  const [[, left], [width, right]] = horizon(camera);
  close(left, 399.5);
  close(right, 399.5);
  assert.equal(width, 1280);
  // Tilting up 10 degrees: the horizon is fy * tan(10 degrees) below the middle, 557.90.
  const t = (10 * Math.PI) / 180;
  const tilted = {
    ...camera,
    rotation: [
      [Math.cos(t), 0, -Math.sin(t)],
      [0, 1, 0],
      [Math.sin(t), 0, Math.cos(t)],
    ],
  };
  const [[, a], [, b]] = horizon(tilted);
  close(a, 557.9);
  close(b, 557.9);
});

test('there is no horizon in a camera looking straight up', () => {
  const up = { ...camera, rotation: [[0, 0, -1], [0, 1, 0], [1, 0, 0]] };
  assert.equal(horizon(up), null);
});
