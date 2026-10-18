// The search against the camera placement study's own family of layouts, on the 2026 field without
// elements (the study ignored them), with left and right mirrored. The family is in the search's
// space (heights 8, 16 and 24 in, tilts 0 to 30 in tens, splays of 15, 30 and 45 degrees), so each
// of its layouts is scored by the same quick scorer; for counts 1 to 4 the search's best must be
// as good as the family's best, within a millimeter. Slow: the table of cameras takes some seconds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewFacesOut } from '../src/clip.js';
import { intrinsics } from '../src/camera.js';
import { allUnits, buildSamples, makeScorer, makeSpace, searchAll, tableSlice } from '../src/finder.js';
import { defaultState, scoringState } from '../src/state.js';
import { loadField } from './helpers.js';

const INCH = 0.0254;
const RESTARTS = 12;

test('the search is as good as the study\'s family for 1 to 4 cameras', { timeout: 300000 }, async (t) => {
  const field = loadField(2026, false);
  const scoring = scoringState(defaultState());
  const space = makeSpace(scoring.robotSize, 30 * INCH);
  const samples = buildSamples(field, scoring, { spacing: 1.0, headings: 4, arrangements: 0 });
  const data = tableSlice(field, scoring, scoring.cameras[0].sensor, space, samples, 0, space.count);
  const score = makeScorer(data, samples.length, (scoring.settings.gyroErrorDegrees * Math.PI) / 180);

  // The family, as ids: places (front-left 0, front 1, front-right 2, right 3, back-right 4,
  // back 5, back-left 6, left 7), the yaw step from straight out, the heights 8, 16, 24 in
  // (steps 1, 3, 5 of the space) and the tilts 0, 10, 20, 30 (steps 0, 2, 4, 6).
  const spots = {
    ahead: [1, 3],
    back: [5, 3],
    left: [7, 3],
    right: [3, 3],
    frontLeft: (s) => [0, 3 + (s - 45) / 15],
    frontRight: (s) => [2, 3 + (45 - s) / 15],
    backLeft: (s) => [6, 3 + (45 - s) / 15],
    backRight: (s) => [4, 3 + (s - 45) / 15],
  };
  const layouts = [{ count: 1, spots: [spots.ahead] }, { count: 2, spots: [spots.ahead, spots.back] }, { count: 2, spots: [spots.left, spots.right] }, { count: 4, spots: [spots.ahead, spots.back, spots.left, spots.right] }];
  for (const s of [15, 30, 45]) {
    layouts.push({ count: 2, spots: [spots.frontLeft(s), spots.frontRight(s)] });
    layouts.push({ count: 3, spots: [spots.frontLeft(s), spots.frontRight(s), spots.back] });
    layouts.push({ count: 4, spots: [spots.frontLeft(s), spots.frontRight(s), spots.backLeft(s), spots.backRight(s)] });
  }
  const familyBest = [null, null, null, null, null];
  for (const layout of layouts) {
    for (const height of [1, 3, 5]) {
      for (const tilt of [0, 2, 4, 6]) {
        const ids = layout.spots.map(([place, yaw]) => space.encode(place, yaw, height, tilt));
        const result = score(ids);
        if (!familyBest[layout.count] || result.rank < familyBest[layout.count].rank) familyBest[layout.count] = result;
      }
    }
  }

  // With the rule that a view faces out of the robot, the search's answers all face out, and the
  // family (which does) is still beaten or matched; with the switch on (no rule) it is as before.
  const half = intrinsics(scoring.cameras[0].sensor).halfWidthDegrees;
  const ruled = makeSpace(scoring.robotSize, 30 * INCH, { halfFovDegrees: half });
  assert.ok(allUnits(ruled, true).length < allUnits(space, true).length);
  const unruled = makeSpace(scoring.robotSize, 30 * INCH, null);
  assert.equal(allUnits(unruled, true).length, allUnits(space, true).length);
  const withRule = searchAll(ruled, true, score, RESTARTS, 1, 6);
  for (let count = 1; count <= 6; count++) {
    for (const id of withRule[count].units.flat()) {
      const m = ruled.mount(id);
      assert.ok(viewFacesOut(scoring.robotSize, m, m.yawDegrees, half), `count ${count}: camera ${id} faces across the robot`);
    }
  }
  for (let count = 1; count <= 4; count++) {
    t.diagnostic(`facing out, ${count} cameras: ${(withRule[count].score.error * 1000).toFixed(1)} mm (${(withRule[count].score.measured * 100).toFixed(1)}% measured), family ${(familyBest[count].error * 1000).toFixed(1)} mm`);
    assert.ok(withRule[count].score.rank <= familyBest[count].rank + 0.001, `facing out, count ${count}`);
  }

  // Free to stack cameras at one place, and with one camera to a place (the family never stacks).
  for (const distinct of [false, true]) {
    checkAgainstFamily(t, searchAll(space, true, score, RESTARTS, 1, 4, distinct), familyBest, distinct, space);
  }
});

function checkAgainstFamily(t, found, familyBest, distinct, space) {
  for (let count = 1; count <= 4; count++) {
    const mine = found[count].score;
    if (distinct) {
      const places = found[count].units.flat().map((id) => space.decode(id).place);
      assert.equal(new Set(places).size, count, `count ${count} stacks: ${places}`);
    }
    const theirs = familyBest[count];
    t.diagnostic(`${distinct ? 'one to a place, ' : ''}${count} cameras: search ${(mine.error * 1000).toFixed(1)} mm (${(mine.measured * 100).toFixed(1)}% measured), family ${(theirs.error * 1000).toFixed(1)} mm (${(theirs.measured * 100).toFixed(1)}%)`);
    // Both without a number: compare the share measured, as the search does.
    assert.ok(mine.rank <= theirs.rank + 0.001, `count ${count}: search ${mine.rank} vs family ${theirs.rank}`);
  }
}
