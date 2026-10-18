// Best angles: the angles a camera may have, the search over them on a coarse table, the limits, the
// slack around the best, and choosing which mounts to keep.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SLACK_METERS,
  allowedTilts,
  allowedYaws,
  candidateSlice,
  chooseMounts,
  descend,
  greedyMounts,
  makeCandidates,
  searchAngles,
  slack,
  startLayout,
  tiltAllowed,
  yawAllowed,
} from '../src/angles.js';
import { viewFacesOut } from '../src/clip.js';
import { intrinsics } from '../src/camera.js';
import { buildSamples, makeScorer } from '../src/finder.js';
import { random } from '../src/robots.js';
import { defaultState, scoringState } from '../src/state.js';
import { loadField } from './helpers.js';

// A coarse table on the open 2026 field (the study ignored elements) for the default cameras, with
// yaw and tilt in 15 degree steps (24 yaws and 3 tilts a camera).
const field = loadField(2026, false);
const scoring = scoringState(defaultState());
const samples = buildSamples(field, scoring, { spacing: 1.0, headings: 4, arrangements: 0 });
const gyro = (scoring.settings.gyroErrorDegrees * Math.PI) / 180;

function setup(cameras) {
  const candidates = makeCandidates(cameras, { yaw: 15, tilt: 15 });
  const lenses = scoring.cameras.map((c) => c.sensor);
  const data = candidateSlice(field, scoring, candidates, lenses, samples, 0, candidates.count);
  return { candidates, score: makeScorer(data, samples.length, gyro) };
}

const cameras = defaultState().cameras;
const four = setup(cameras);
const two = setup(cameras.slice(0, 2));

test('yaws: a full circle every 5 degrees, a range that wraps past 180, and the ends of a range', () => {
  const all = allowedYaws({});
  assert.equal(all.length, 72);
  assert.ok(all.includes(180) && !all.includes(-180));
  const wrapped = allowedYaws({ yawMin: 150, yawMax: -150 });
  assert.deepEqual(wrapped, [150, 155, 160, 165, 170, 175, 180, -175, -170, -165, -160, -155, -150]);
  assert.deepEqual(allowedYaws({ yawMin: 10, yawMax: 22 }), [10, 15, 20, 22]);
  // One end alone says nothing.
  assert.equal(allowedYaws({ yawMin: 10 }).length, 72);
});

test('tilts: 0 to 30 unless the limits say otherwise, in steps of 5', () => {
  assert.deepEqual(allowedTilts({}), [0, 5, 10, 15, 20, 25, 30]);
  assert.deepEqual(allowedTilts({ tiltMin: 10, tiltMax: 20 }), [10, 15, 20]);
  assert.deepEqual(allowedTilts({ tiltMin: 12, tiltMax: 13 }), [12.5]);
  assert.deepEqual(allowedTilts({ tiltMin: 20 }), [20, 25, 30]);
});

test('an angle is allowed inside its limits, including round the back', () => {
  const limits = { yawMin: 150, yawMax: -150, tiltMin: 5, tiltMax: 15 };
  assert.ok(yawAllowed(limits, 170) && yawAllowed(limits, -170) && yawAllowed(limits, 180));
  assert.ok(!yawAllowed(limits, 90) && !yawAllowed(limits, 0));
  assert.ok(tiltAllowed(limits, 10) && !tiltAllowed(limits, 25));
});

test('the candidates keep each camera\'s current angles, even off the steps', () => {
  const odd = [{ ...cameras[0], yawDegrees: 47, tiltUpDegrees: 12 }];
  const c = makeCandidates(odd);
  const angles = c.angles(c.current(0));
  assert.equal(angles.yawDegrees, 47);
  assert.equal(angles.tiltUpDegrees, 12);
  // Ids run camera after camera.
  const both = makeCandidates(cameras.slice(0, 2));
  assert.equal(both.count, 2 * 72 * 7);
  assert.equal(both.decode(both.idOf(1, 3, 2)).camera, 1);
});

test('descent never ends worse than it started, from any start', () => {
  const next = random(11);
  for (let trial = 0; trial < 8; trial++) {
    const ids = [0, 1, 2, 3].map((c) => {
      const e = four.candidates.cameras[c];
      return e.offset + Math.floor(next() * e.count);
    });
    const start = { kept: [0, 1, 2, 3], ids };
    const before = four.score(ids);
    const after = descend(four.candidates, four.score, start);
    assert.ok(after.score.rank <= before.rank + 1e-9, `trial ${trial}: ${after.score.rank} vs ${before.rank}`);
  }
});

test('with restarts, the search matches an exhaustive search on two cameras', () => {
  const { candidates, score } = two;
  const [a, b] = candidates.cameras;
  let best = Infinity;
  for (let i = a.offset; i < a.offset + a.count; i++) {
    for (let j = b.offset; j < b.offset + b.count; j++) best = Math.min(best, score([i, j]).rank);
  }
  const found = searchAngles(candidates, score, 20, 1);
  assert.ok(found.score.rank <= best + 1e-6, `search ${found.score.rank} vs exhaustive ${best}`);
});

test('the search is the same from the same seed', () => {
  const a = searchAngles(two.candidates, two.score, 5, 3);
  const b = searchAngles(two.candidates, two.score, 5, 3);
  assert.deepEqual(a.layout, b.layout);
});

test('limits are respected: a yaw range that wraps and a narrow tilt range', () => {
  const limited = cameras.slice(0, 2).map((c, i) => (i === 0 ? { ...c, yawMin: 150, yawMax: -150, tiltMin: 15, tiltMax: 30 } : c));
  const { candidates, score } = setup(limited);
  const found = searchAngles(candidates, score, 10, 2);
  const angles = candidates.angles(found.layout.ids[0]);
  assert.ok(yawAllowed(limited[0], angles.yawDegrees), `yaw ${angles.yawDegrees}`);
  assert.ok(Math.abs(angles.yawDegrees) >= 150, `yaw ${angles.yawDegrees}`);
  assert.ok(angles.tiltUpDegrees >= 15 && angles.tiltUpDegrees <= 30);
  // Every candidate of the limited camera is inside its limits.
  const e = candidates.cameras[0];
  for (const y of e.yaws) assert.ok(yawAllowed(limited[0], y) || y === limited[0].yawDegrees);
});

test('slack: the intervals hold the best, and every angle in them is within a millimeter', () => {
  const found = searchAngles(two.candidates, two.score, 5, 1);
  const base = two.score(found.layout.ids).rank;
  const result = slack(two.candidates, two.score, found.layout);
  result.forEach((s, k) => {
    const c = found.layout.kept[k];
    const e = two.candidates.cameras[c];
    const { yi, ti } = two.candidates.decode(found.layout.ids[k]);
    const inside = (list, from, to, at, circular) => {
      const i0 = list.indexOf(from);
      const i1 = list.indexOf(to);
      const run = [];
      for (let i = i0; ; i = (i + 1) % list.length) {
        run.push(i);
        if (i === i1) break;
        if (run.length > list.length) break;
      }
      assert.ok(run.includes(at), 'the best is inside');
      return run;
    };
    for (const i of inside(e.yaws, s.yaw.from, s.yaw.to, yi, e.full)) {
      const id = two.candidates.idOf(c, i, ti);
      const ids = found.layout.ids.map((x, j) => (j === k ? id : x));
      assert.ok(two.score(ids).rank <= base + SLACK_METERS + 1e-12, `yaw ${e.yaws[i]}`);
    }
    for (const i of inside(e.tilts, s.tilt.from, s.tilt.to, ti, false)) {
      const id = two.candidates.idOf(c, yi, i);
      const ids = found.layout.ids.map((x, j) => (j === k ? id : x));
      assert.ok(two.score(ids).rank <= base + SLACK_METERS + 1e-12, `tilt ${e.tilts[i]}`);
    }
  });
});

test('slack: the angle just past an interval is more than a millimeter worse', () => {
  const found = searchAngles(two.candidates, two.score, 5, 1);
  const base = two.score(found.layout.ids).rank;
  const result = slack(two.candidates, two.score, found.layout);
  result.forEach((s, k) => {
    const c = found.layout.kept[k];
    const e = two.candidates.cameras[c];
    const { yi, ti } = two.candidates.decode(found.layout.ids[k]);
    if (s.tilt.all) return;
    const upTo = e.tilts.indexOf(s.tilt.to);
    const downTo = e.tilts.indexOf(s.tilt.from);
    for (const i of [upTo + 1, downTo - 1]) {
      if (i < 0 || i >= e.tilts.length) continue;
      const ids = found.layout.ids.map((x, j) => (j === k ? two.candidates.idOf(c, yi, i) : x));
      assert.ok(two.score(ids).rank > base + SLACK_METERS, `tilt ${e.tilts[i]} is outside the slack`);
    }
  });
});

test('best N of the mounts: N distinct mounts, never worse than the greedy choice', () => {
  for (const n of [1, 2, 3]) {
    const chosen = chooseMounts(four.candidates, four.score, n);
    assert.equal(chosen.layout.kept.length, n);
    assert.equal(new Set(chosen.layout.kept).size, n);
    const greedy = greedyMounts(four.candidates, four.score, n);
    assert.ok(chosen.score.rank <= four.score(greedy.ids).rank + 1e-9, `n ${n}`);
    assert.ok(chosen.score.rank <= chosen.greedy.score.rank + 1e-9);
  }
  // Keeping all of them is the same as not choosing.
  const all = searchAngles(four.candidates, four.score, 0, 1, 4);
  assert.equal(all.layout.kept.length, 4);
});

test('the start is the current angles, and the search starts there', () => {
  const start = startLayout(four.candidates, [0, 1, 2, 3]);
  assert.deepEqual(start.ids.map((id) => four.candidates.angles(id)), cameras.map((c) => ({ yawDegrees: c.yawDegrees, tiltUpDegrees: c.tiltUpDegrees })));
  const found = searchAngles(four.candidates, four.score, 0, 1);
  assert.ok(found.score.rank <= four.score(start.ids).rank + 1e-9);
});

// The rule that a view faces out of the robot: the candidates, the search and the switch.
const rule = { size: scoring.robotSize, halfFovs: cameras.map((c) => intrinsics(c).halfWidthDegrees) };
const mountOf = (c) => ({ forward: c.forwardMeters, left: c.leftMeters });

test('with the rule, every candidate yaw faces out of the robot', () => {
  const candidates = makeCandidates(cameras, { yaw: 15, tilt: 15 }, rule);
  candidates.cameras.forEach((e, c) => {
    assert.ok(e.yaws.length > 0 && e.yaws.length < 24, `${e.yaws.length} yaws`);
    for (const yaw of e.yaws) assert.ok(viewFacesOut(rule.size, mountOf(cameras[c]), yaw, rule.halfFovs[c]), `camera ${c} yaw ${yaw}`);
  });
});

test('with the rule, the search\'s answer faces out for every camera, and the start (45 and so on) is allowed', () => {
  const candidates = makeCandidates(cameras, { yaw: 15, tilt: 15 }, rule);
  const lenses = scoring.cameras.map((c) => c.sensor);
  const data = candidateSlice(field, scoring, candidates, lenses, samples, 0, candidates.count);
  const score = makeScorer(data, samples.length, gyro);
  const start = startLayout(candidates, [0, 1, 2, 3]);
  start.ids.forEach((id, c) => assert.equal(candidates.angles(id).yawDegrees, cameras[c].yawDegrees));
  const found = searchAngles(candidates, score, 6, 1);
  found.layout.ids.forEach((id, k) => {
    const c = found.layout.kept[k];
    assert.ok(viewFacesOut(rule.size, mountOf(cameras[c]), candidates.angles(id).yawDegrees, rule.halfFovs[c]), `camera ${c}`);
  });
  assert.ok(found.score.rank <= score(start.ids).rank + 1e-9);
});

test('a camera in the middle of the robot has no yaw that faces out: it keeps the one it has', () => {
  const middle = [{ ...cameras[0], forwardMeters: 0, leftMeters: 0, yawDegrees: 30 }];
  const candidates = makeCandidates(middle, { yaw: 15, tilt: 15 }, { size: rule.size, halfFovs: [rule.halfFovs[0]] });
  assert.equal(candidates.cameras[0].blocked, true);
  assert.deepEqual(candidates.cameras[0].yaws, [30]);
});

test('with views across the robot allowed (no rule), the candidates are as they were', () => {
  const plain = makeCandidates(cameras, { yaw: 15, tilt: 15 });
  assert.equal(plain.count, plain.cameras.reduce((sum, e) => sum + e.yaws.length * e.tilts.length, 0));
  assert.ok(plain.cameras.every((e) => !e.blocked && e.yaws.length === 24));
  assert.deepEqual(makeCandidates(cameras, { yaw: 15, tilt: 15 }, null).cameras, plain.cameras);
});
