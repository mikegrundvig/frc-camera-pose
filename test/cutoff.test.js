// The distance cutoff: a camera whose tags average farther than it measures nothing, unless there is
// no cutoff; and the setting in the state and the link.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { intrinsics } from '../src/camera.js';
import { VISION, combine } from '../src/estimate.js';
import { buildField } from '../src/field.js';
import { viewsAt } from '../src/coverage.js';
import { defaultState, fromText, scoringState, toJson } from '../src/state.js';
import { PATH_LIMIT_METERS } from '../src/clip.js';

const sensor = { widthPixels: 1280, heightPixels: 800, fovDegrees: 80, fovAcross: 'diagonal' };
// One tag 7 m ahead of a camera at the origin, facing back at it.
const layout = {
  name: 'test',
  'field-dimensions': { length: 16, width: 8 },
  'field-tags': [{ ID: 1, pose: { translation: { x: 7, y: 0, z: 0 }, rotation: { quaternion: { W: 0, X: 0, Y: 0, Z: 1 } } } }],
};
const field = buildField({ year: 0, game: 'test' }, layout, null);
const camera = [{ intrinsics: intrinsics(sensor), mount: { forward: 0, left: 0, up: 0, yawDegrees: 0, tiltUpDegrees: 0 } }];
const base = { sightMeters: 20, cornerNoisePixels: 0.25, cornerSpreadRatio: 0.32, gyroErrorDegrees: 0.25 };
const gyro = (0.25 * Math.PI) / 180;

function measured(settings) {
  const [look] = viewsAt(field, camera, { x: 0, y: 0, heading: 0 }, settings, {});
  return { tags: look.view.tags, ok: look.view.ok, eigenvalues: combine([look.view], gyro) };
}

test('by default a camera whose tags average 7 m away measures nothing', () => {
  const m = measured(base);
  assert.equal(m.tags, 1);
  assert.equal(m.ok, false);
  assert.equal(m.eigenvalues, null);
  assert.equal(VISION.maxDistanceMeters, 6);
});

test('with the cutoff off, the same pose is measured', () => {
  const m = measured({ ...base, maxDistanceMeters: Infinity });
  assert.equal(m.ok, true);
  assert.ok(m.eigenvalues);
});

test('a cutoff set past the tags measures them, and one short of them does not', () => {
  assert.equal(measured({ ...base, maxDistanceMeters: 7.5 }).ok, true);
  assert.equal(measured({ ...base, maxDistanceMeters: 6.9 }).ok, false);
});

test('the setting goes to the scoring in meters, with off as no limit', () => {
  const state = defaultState();
  assert.equal(scoringState(state).settings.maxDistanceMeters, 6);
  state.noise.cutoffMeters = 4.5;
  assert.equal(scoringState(state).settings.maxDistanceMeters, 4.5);
  state.noise.cutoffMeters = null;
  assert.equal(scoringState(state).settings.maxDistanceMeters, Infinity);
});

test('the setting round-trips through the link, off included, and a bad one is the default', () => {
  const state = defaultState();
  for (const cutoff of [6, 3.2, null]) {
    state.noise.cutoffMeters = cutoff;
    assert.equal(fromText(toJson(state)).noise.cutoffMeters, cutoff);
  }
  assert.equal(fromText('{"noise":{"cutoffMeters":"far"}}').noise.cutoffMeters, 6);
  assert.equal(fromText('{}').noise.cutoffMeters, 6);
});

test('how far a view may cross the robot is in the link, and a bad value is the default', () => {
  const state = defaultState();
  assert.equal(state.viewAcrossMeters, PATH_LIMIT_METERS);
  state.viewAcrossMeters = 0.2;
  assert.equal(fromText(toJson(state)).viewAcrossMeters, 0.2);
  for (const bad of ['far', null, -1, 0.05, 5]) {
    assert.equal(fromText(JSON.stringify({ viewAcrossMeters: bad })).viewAcrossMeters, PATH_LIMIT_METERS, String(bad));
  }
  assert.equal(fromText('{}').viewAcrossMeters, PATH_LIMIT_METERS);
});
