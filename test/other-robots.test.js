// Other robots in the way, against the camera placement study's own runs with --other-robots=3-5.
// The study simulates images and runs the robot's vision pipeline; here it's the estimate, and the
// robots are drawn from other random numbers, so the method is matched, not the draws. Coverage
// shares must be within 2 points; the 95% errors are the estimate against the simulation, so they
// get a looser check (see the README).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { outcome, prepareCameras, summarize, viewsAt } from '../src/coverage.js';
import { DEG } from '../src/math.js';
import { mixSeed, placeRobots, random, reachMeters } from '../src/robots.js';
import { loadField, readJson } from './helpers.js';

const golden = readJson('test/fixtures/estimate-golden.json');
const study = readJson('test/fixtures/study-other-robots.json');
const field = loadField(2026, false);
const settings = {
  sightMeters: 7,
  cornerNoisePixels: 0.25,
  cornerSpreadRatio: 0.08 / 0.25,
  gyroErrorDegrees: 0.25,
};
const size = { length: golden.bumperLengthMeters, width: golden.bumperWidthMeters };
const sensor = { widthPixels: 1280, heightPixels: 800, fovDegrees: 80, fovAcross: 'diagonal' };
const INCH = 0.0254;

// Scores a layout on the study's poses, each with as many arrangements as the study's images,
// with and without each camera.
function score(layout, withRobots) {
  const cameras = prepareCameras(
    layout.cameras.map((c) => ({
      sensor,
      mount: {
        forward: c.forwardInches * INCH,
        left: c.leftInches * INCH,
        up: c.upInches * INCH,
        yawDegrees: c.yawDegrees,
        tiltUpDegrees: c.tiltUpDegrees,
      },
    })),
  );
  const every = cameras.map((_, i) => i);
  const lessOne = every.map((lost) => every.filter((i) => i !== lost));
  const gyroSigma = settings.gyroErrorDegrees * DEG;
  const reach = reachMeters(settings.sightMeters, size);
  const all = [];
  const allLessOne = lessOne.map(() => []);
  const arrangements = withRobots ? study.imagesPerPose : 1;
  golden.poses.forEach(([x, y, heading], i) => {
    const pose = { x, y, heading };
    for (let a = 0; a < arrangements; a++) {
      let robots = [];
      if (withRobots) {
        const next = random(mixSeed(1, i, a));
        const count =
          study.otherRobotsLeast +
          Math.floor(next() * (study.otherRobotsMost - study.otherRobotsLeast + 1));
        robots = placeRobots(pose, field, size, study.otherRobotsHeightMeters, count, reach, next, null);
      }
      const views = viewsAt(field, cameras, pose, settings, { robots }).map((c) => c.view);
      all.push(outcome(views, every, gyroSigma));
      lessOne.forEach((which, k) => allLessOne[k].push(outcome(views, which, gyroSigma)));
    }
  });
  const s = summarize(all);
  const lost = allLessOne.map(summarize);
  return {
    ...s,
    oneLostP95Meters: Math.max(...lost.map((l) => l.within95)),
    oneLostMeasured: Math.min(...lost.map((l) => l.measured)),
  };
}

function compare(name, ours, theirs) {
  const points = (a, b) => Math.abs(a - b) * 100;
  for (const key of ['oneTag', 'twoTags', 'twoCameras', 'measured', 'oneLostMeasured']) {
    assert.ok(points(ours[key], theirs[key]) < 2, `${name} ${key}: ${ours[key]} vs ${theirs[key]}`);
  }
  // "None" (more than 5% unmeasured) must agree, unless the study's measured share is within a
  // point of the 95% line, where random draws decide it; a number is the estimate against the
  // simulation.
  for (const [key, p95, measured] of [
    ['p95Meters', ours.within95, theirs.measured],
    ['oneLostP95Meters', ours.oneLostP95Meters, theirs.oneLostMeasured],
  ]) {
    if (theirs[key] === null) {
      if (Math.abs(measured - 0.95) > 0.01) assert.equal(p95, Infinity, `${name} ${key}: none`);
    } else if (p95 !== Infinity || Math.abs(measured - 0.95) > 0.01) {
      assert.ok(Math.abs(p95 - theirs[key]) / theirs[key] < 0.25, `${name} ${key}: ${p95} vs ${theirs[key]}`);
    }
  }
  const cm = (m) => (m === Infinity || m === null ? 'none' : `${(m * 100).toFixed(2)} cm`);
  const pc = (s) => `${(s * 100).toFixed(2)}%`;
  console.log(
    `${name}: 95% within ${cm(ours.within95)} (study ${cm(theirs.p95Meters)}), one tag` +
      ` ${pc(ours.oneTag)} (${pc(theirs.oneTag)}), two tags ${pc(ours.twoTags)} (${pc(theirs.twoTags)}),` +
      ` two cameras ${pc(ours.twoCameras)} (${pc(theirs.twoCameras)}), measured ${pc(ours.measured)}` +
      ` (${pc(theirs.measured)}); one lost: ${cm(ours.oneLostP95Meters)} (${cm(theirs.oneLostP95Meters)}),` +
      ` measured ${pc(ours.oneLostMeasured)} (${pc(theirs.oneLostMeasured)})`,
  );
}

for (const layout of study.layouts) {
  if (layout.clear) {
    test(`clear field, with one camera lost: ${layout.name}`, () => {
      compare(`${layout.name}, clear`, score(layout, false), layout.clear);
    });
  }
  test(`other robots in the way: ${layout.name}`, () => {
    compare(`${layout.name}, 3 to 5 robots`, score(layout, true), layout.otherRobots);
  });
}
