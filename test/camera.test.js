// The lens model and where a camera sits on the field.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cameraPose, diagonalFov, intrinsics } from '../src/camera.js';

const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} vs ${b}`);

test('a 1280 x 800 camera with an 80 degree diagonal view', () => {
  const k = intrinsics({ widthPixels: 1280, heightPixels: 800, fovDegrees: 80, fovAcross: 'diagonal' });
  close(k.cx, 639.5);
  close(k.cy, 399.5);
  // fx = cx / tan(atan(tan(40 deg) * 1280 / hypot(1280, 800))).
  const halfWidth = Math.atan((Math.tan((40 * Math.PI) / 180) * 1280) / Math.hypot(1280, 800));
  close(k.fx, 639.5 / Math.tan(halfWidth));
  // Half the view across, measured from the principal point half a pixel off center.
  close(k.halfWidthDegrees, 35.455, 0.001);
});

test('a horizontal field of view becomes the diagonal one', () => {
  const diagonal = diagonalFov({ widthPixels: 1280, heightPixels: 800, fovDegrees: 70, fovAcross: 'horizontal' });
  const back = intrinsics({ widthPixels: 1280, heightPixels: 800, fovDegrees: diagonal, fovAcross: 'diagonal' });
  // The horizontal view comes back, less the principal point's half-pixel offset.
  close(back.halfWidthDegrees * 2, 70, 0.1);
});

test('a camera on the front left corner of a robot facing +y', () => {
  const mount = { forward: 0.3, left: 0.2, up: 0.5, yawDegrees: 45, tiltUpDegrees: 10 };
  const pose = cameraPose({ x: 2, y: 3, heading: Math.PI / 2 }, mount);
  close(pose.position[0], 2 - 0.2);
  close(pose.position[1], 3 + 0.3);
  close(pose.position[2], 0.5);
  // Its lens looks 45 degrees left of +y (toward -x, +y), tilted up 10 degrees.
  const forward = [pose.rotation[0][0], pose.rotation[1][0], pose.rotation[2][0]];
  const c = Math.cos((10 * Math.PI) / 180);
  close(forward[0], -c * Math.SQRT1_2);
  close(forward[1], c * Math.SQRT1_2);
  close(forward[2], Math.sin((10 * Math.PI) / 180));
});
