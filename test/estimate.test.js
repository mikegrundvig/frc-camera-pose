// The golden check: the estimate here against the study's own Java estimate (CameraEstimate), on
// the study's poses and five layouts of the 2026 field. The fixture is written by the study's
// CameraPoseExport; every pose is scored here, and every fifth pose's details are compared.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outcome, prepareCameras, summarize, viewsAt } from '../src/coverage.js';
import { shareWithin } from '../src/estimate.js';
import { DEG } from '../src/math.js';
import { loadField, readJson } from './helpers.js';

const golden = readJson('test/fixtures/estimate-golden.json');
// The study's estimate has no field elements.
const field = loadField(2026, false);
const settings = {
  sightMeters: golden.settings.sightMeters,
  cornerNoisePixels: golden.settings.cornerNoiseMeanPixels,
  cornerSpreadRatio: golden.settings.cornerNoiseStdDevPixels / golden.settings.cornerNoiseMeanPixels,
  gyroErrorDegrees: golden.settings.gyroErrorDegrees,
};
const sensor = {
  widthPixels: golden.sensor.widthPixels,
  heightPixels: golden.sensor.heightPixels,
  fovDegrees: golden.sensor.diagonalFovDegrees,
  fovAcross: 'diagonal',
};

function camerasOf(layout) {
  return prepareCameras(
    layout.cameras.map((c) => ({
      name: c.name,
      sensor,
      mount: {
        forward: c.forwardMeters,
        left: c.leftMeters,
        up: c.upMeters,
        rollDegrees: c.rollDegrees,
        tiltUpDegrees: c.tiltUpDegrees,
        yawDegrees: c.yawDegrees,
      },
    })),
  );
}

function relativeError(a, b) {
  return Math.abs(a - b) / Math.max(Math.abs(b), 1e-30);
}

for (const layout of golden.layouts) {
  test(`golden estimate: ${layout.name}`, () => {
    const cameras = camerasOf(layout);
    const every = cameras.map((_, i) => i);
    const gyroSigma = settings.gyroErrorDegrees * DEG;
    const outcomes = [];
    let tagMismatches = 0;
    let worstEigenvalueError = 0;
    golden.poses.forEach(([x, y, heading], i) => {
      const views = viewsAt(field, cameras, { x, y, heading }, settings, {}).map((c) => c.view);
      const o = outcome(views, every, gyroSigma);
      outcomes.push(o);
      if (i % golden.checkEvery !== 0) return;
      const k = i / golden.checkEvery;
      const tags = views.map((v) => v.tags);
      if (tags.join() !== layout.tagsPerCamera[k].join()) tagMismatches++;
      // An empty list is no measurement.
      const expected = layout.eigenvalues[k].length === 2 ? layout.eigenvalues[k] : null;
      assert.equal(o.eigenvalues === null, expected === null, `pose ${i}: measured or not`);
      if (expected) {
        // The smaller eigenvalue is compared against the larger one's scale, since it can be tiny.
        worstEigenvalueError = Math.max(
          worstEigenvalueError,
          relativeError(o.eigenvalues[0], expected[0]),
          Math.abs(o.eigenvalues[1] - expected[1]) / expected[0] > 1e-3
            ? relativeError(o.eigenvalues[1], expected[1])
            : 0,
        );
      }
    });
    assert.equal(tagMismatches, 0, 'tags seen per camera');
    assert.ok(worstEigenvalueError < 0.01, `eigenvalues within 1% (worst ${worstEigenvalueError})`);

    const s = summarize(outcomes);
    const points = (a, b) => Math.abs(a - b) * 100;
    assert.ok(points(s.oneTag, layout.oneTag) < 0.5, `one tag ${s.oneTag} vs ${layout.oneTag}`);
    assert.ok(points(s.twoTags, layout.twoTags) < 0.5, `two tags ${s.twoTags} vs ${layout.twoTags}`);
    assert.ok(
      points(s.twoCameras, layout.twoCameras) < 0.5,
      `two cameras ${s.twoCameras} vs ${layout.twoCameras}`,
    );
    assert.ok(points(s.measured, layout.measured) < 0.5, `measured ${s.measured} vs ${layout.measured}`);
    const eigenvalues = outcomes.map((o) => o.eigenvalues);
    const within2 = shareWithin(0.02, eigenvalues);
    const within5 = shareWithin(0.05, eigenvalues);
    assert.ok(points(within2, layout.within2cm) < 0.5, `within 2 cm ${within2} vs ${layout.within2cm}`);
    assert.ok(points(within5, layout.within5cm) < 0.5, `within 5 cm ${within5} vs ${layout.within5cm}`);
    // No p95Meters means more than 5% of the field had no measurement.
    if (layout.p95Meters === undefined) {
      assert.equal(s.within95, Infinity, '95% within: none');
    } else {
      assert.ok(
        relativeError(s.within95, layout.p95Meters) < 0.01,
        `95% within ${s.within95} vs ${layout.p95Meters}`,
      );
    }
    console.log(
      `${layout.name}: 95% within ${fmt(s.within95)} (Java ${fmt(layout.p95Meters)}),` +
        ` one tag ${pct(s.oneTag)} (${pct(layout.oneTag)}), two tags ${pct(s.twoTags)}` +
        ` (${pct(layout.twoTags)}), two cameras ${pct(s.twoCameras)} (${pct(layout.twoCameras)}),` +
        ` measured ${pct(s.measured)} (${pct(layout.measured)}), worst eigenvalue error` +
        ` ${(worstEigenvalueError * 100).toExponential(2)}%`,
    );
  });
}

function fmt(meters) {
  return meters === undefined || meters === Infinity ? 'none' : `${(meters * 100).toFixed(3)} cm`;
}

function pct(share) {
  return `${(share * 100).toFixed(2)}%`;
}
