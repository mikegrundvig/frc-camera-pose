// Finding a layout: the space of cameras, the units of a layout, the quick scorer against the page's
// own numbers, and the search on a made-up score with a known best.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combine, within95 } from '../src/estimate.js';
import {
  PLACES,
  RECORD,
  allUnits,
  fewestWithin,
  greedy,
  improve,
  layoutMounts,
  makeScorer,
  makeSpace,
  neighbors,
  onePerPlace,
  randomLayout,
  restart,
  searchAll,
} from '../src/finder.js';
import { random } from '../src/robots.js';

const INCH = 0.0254;
const SIZE = { length: 35.5 * INCH, width: 35.5 * INCH };
const space = makeSpace(SIZE, 30 * INCH);
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} vs ${b}`);

test('the space: 8 places, 7 yaws, 8 heights from 6 in to the robot height, 7 tilts', () => {
  assert.equal(space.heights.length, 8);
  assert.deepEqual(space.heights.map((h) => Math.round(h / INCH)), [6, 8, 12, 16, 20, 24, 28, 30]);
  assert.equal(space.count, 8 * 7 * 8 * 7);
  // A taller or shorter robot changes the heights, always ending at its own.
  assert.equal(makeSpace(SIZE, 24 * INCH).heights.length, 6);
  near(makeSpace(SIZE, 25 * INCH).heights.at(-1), 25 * INCH);
  assert.equal(makeSpace(SIZE, 4 * INCH).heights.length, 1);
});

test('an id decodes to where a camera is and back', () => {
  for (let id = 0; id < space.count; id += 7) {
    const c = space.decode(id);
    assert.equal(space.encode(c.place, c.yaw, c.height, c.tilt), id);
  }
});

test('a camera sits just inside the bumpers, faces out, and tilts up in 5 degree steps', () => {
  const front = space.mount(space.encode(1, 3, 3, 4));
  near(front.forward, SIZE.length / 2 - 6 * INCH);
  near(front.left, 0);
  near(front.up, 16 * INCH);
  near(front.yawDegrees, 0);
  near(front.tiltUpDegrees, 20);
  // A corner turns 0 to 90 degrees between the two edges it is on.
  const yaws = [0, 1, 2, 3, 4, 5, 6].map((y) => space.mount(space.encode(0, y, 0, 0)).yawDegrees);
  assert.deepEqual(yaws, [0, 15, 30, 45, 60, 75, 90]);
  const back = [0, 3, 6].map((y) => space.mount(space.encode(6, y, 0, 0)).yawDegrees);
  assert.deepEqual(back, [90, 135, -180]);
});

test('a mirrored camera is the same on the other side, turned the other way', () => {
  for (let id = 0; id < space.count; id += 13) {
    const m = space.mount(id);
    const mirror = space.mount(space.mirror(id));
    near(mirror.forward, m.forward);
    near(mirror.left, -m.left);
    near(mirror.up, m.up);
    near(mirror.tiltUpDegrees, m.tiltUpDegrees);
    const turned = (((m.yawDegrees + mirror.yawDegrees) % 360) + 360) % 360;
    assert.ok(Math.min(turned, 360 - turned) < 1e-9 || Math.abs(turned - 360) < 1e-9, `yaw ${m.yawDegrees} and ${mirror.yawDegrees}`);
    assert.equal(space.mirror(space.mirror(id)), id);
  }
});

test('units: with mirroring, pairs on the sides and straight-out cameras on the centerline', () => {
  const mirrored = allUnits(space, true);
  const pairs = mirrored.filter((u) => u.length === 2);
  const singles = mirrored.filter((u) => u.length === 1);
  assert.equal(pairs.length, 3 * 7 * 8 * 7);
  assert.equal(singles.length, 2 * 8 * 7);
  for (const [a, b] of pairs) assert.equal(space.mirror(a), b);
  for (const [a] of singles) assert.equal(space.mirror(a), a);
  assert.equal(allUnits(space, false).length, space.count);
});

test('a unit moves one step at a time and stays a unit', () => {
  for (const mirrored of [true, false]) {
    for (const unit of allUnits(space, mirrored).filter((_, i) => i % 97 === 0)) {
      const moves = neighbors(space, mirrored, unit);
      assert.ok(moves.length >= 2);
      const valid = new Set(allUnits(space, mirrored).map((u) => u[0]));
      for (const m of moves) {
        assert.ok(valid.has(m[0]), `${m} is a unit`);
        assert.notDeepEqual(m, unit);
      }
    }
  }
});

test('a random layout has the count asked for, no camera twice, the same from the same seed', () => {
  for (const mirrored of [true, false]) {
    for (let count = 1; count <= 6; count++) {
      const a = randomLayout(space, mirrored, count, random(7)).flat();
      const b = randomLayout(space, mirrored, count, random(7)).flat();
      assert.deepEqual(a, b);
      assert.equal(a.length, count);
      assert.equal(new Set(a).size, count);
    }
  }
});

// A table of made-up records: S samples, `cameras` cameras, each a weight and a covariance.
function madeUp(samples, cameras, seed) {
  const next = random(seed);
  const data = new Float32Array(cameras * samples * RECORD);
  for (let i = 0; i < data.length; i += RECORD) {
    if (next() < 0.25) continue;
    data[i] = 50 + next() * 400;
    data[i + 1] = 1e-4 * (0.5 + next());
    data[i + 2] = 1e-5 * (next() - 0.5);
    data[i + 3] = 1e-4 * (0.5 + next());
    data[i + 4] = next() * 6 - 3;
    data[i + 5] = next() * 6 - 3;
  }
  return data;
}

test('the quick score is the page\'s own figure, within a tenth of a percent', () => {
  const samples = 60;
  const data = madeUp(samples, 6, 3);
  const gyro = (0.25 * Math.PI) / 180;
  const score = makeScorer(data, samples, gyro);
  for (const ids of [[0], [1, 2], [0, 3, 5], [2, 3, 4, 5]]) {
    const eigenvalues = [];
    for (let s = 0; s < samples; s++) {
      const views = ids.map((id) => {
        const o = (id * samples + s) * RECORD;
        return { ok: data[o] > 0, weight: data[o], axx: data[o + 1], axy: data[o + 2], ayy: data[o + 3], lx: data[o + 4], ly: data[o + 5] };
      });
      eigenvalues.push(combine(views, gyro));
    }
    const exact = within95(eigenvalues);
    const quick = score(ids);
    if (exact === Infinity) assert.equal(quick.error, Infinity);
    else assert.ok(Math.abs(quick.error - exact) / exact < 1e-3, `${quick.error} vs ${exact}`);
    assert.equal(quick.measured, eigenvalues.filter(Boolean).length / samples);
  }
});

test('layouts with an error rank before those without; those without go by the share measured', () => {
  const data = new Float32Array(3 * 4 * RECORD);
  const set = (id, s, w) => {
    const o = (id * 4 + s) * RECORD;
    data[o] = w;
    data[o + 1] = 1e-4;
    data[o + 3] = 1e-4;
  };
  for (let s = 0; s < 4; s++) set(0, s, 100);
  set(1, 0, 100);
  set(1, 1, 100);
  set(2, 0, 100);
  const score = makeScorer(data, 4, 0.004);
  assert.ok(Number.isFinite(score([0]).error));
  assert.equal(score([1]).error, Infinity);
  assert.ok(score([0]).rank < score([1]).rank && score([1]).rank < score([2]).rank);
});

// A made-up score with a known best: the distance of a layout's cameras from a target layout.
function target(ids) {
  const wanted = ids;
  return (got) => {
    const rank = got.reduce((sum, id) => sum + Math.min(...wanted.map((w) => Math.abs(id - w))), 0);
    return { error: rank, measured: 1, rank };
  };
}

test('improving a layout reaches the best of its neighbourhood, and never gets worse', () => {
  const pick = [space.encode(0, 3, 3, 2), space.encode(2, 3, 3, 2)];
  const score = target(pick);
  const start = [[space.encode(0, 2, 2, 3), space.mirror(space.encode(0, 2, 2, 3))]];
  const result = improve(space, true, score, start);
  assert.ok(result.score.rank <= score(start.flat()).rank);
  assert.ok(result.score.rank < 5, `ended at ${result.score.rank}`);
  // Every unit in the result is a unit of a mirrored layout.
  for (const u of result.units) assert.ok(u.length === 1 || space.mirror(u[0]) === u[1]);
});

test('the greedy build gives a layout for every count, built from the one before', () => {
  const score = target([space.encode(1, 3, 3, 2), space.encode(5, 3, 3, 2), space.encode(0, 3, 3, 2), space.encode(2, 3, 3, 2)]);
  const g = greedy(space, true, score, 4);
  assert.equal(g.length, 5);
  for (let k = 1; k <= 4; k++) assert.equal(g[k].units.flat().length, k);
  // Each count is no worse than the one before it, here, where more cameras cannot hurt.
  for (let k = 2; k <= 4; k++) assert.ok(g[k].score.rank <= g[k - 1].score.rank + 1e-9);
  assert.equal(g[4].score.rank, 0);
});

test('a restart is the same from the same seed and keeps the count', () => {
  const score = target([space.encode(0, 3, 3, 2)]);
  const a = restart(space, true, score, 2, 5);
  const b = restart(space, true, score, 2, 5);
  assert.deepEqual(a, b);
  assert.equal(a.units.flat().length, 2);
});

test('the fewest cameras within a millimeter of the best', () => {
  // By count (index 0 unused): 50, 30, 22.5, 22.0, 22.0 mm: the third is within a millimeter of the best.
  assert.equal(fewestWithin([0, 0.05, 0.03, 0.0225, 0.022, 0.022]), 3);
  assert.equal(fewestWithin([0, 0.05, 0.03, 0.0235, 0.022, 0.022]), 4);
  assert.equal(fewestWithin([0, Infinity, 0.03, 0.0301]), 2);
});

test('mounts of a layout carry the place names', () => {
  const mounts = layoutMounts(space, [space.encode(0, 3, 3, 2), space.encode(5, 3, 1, 0)]);
  assert.deepEqual(mounts.map((m) => m.name), [PLACES[0].name, PLACES[5].name]);
});

const placesOf = (units) => units.flat().map((id) => space.decode(id).place);

test('one camera to a place: random layouts never use a place twice, with and without mirroring', () => {
  for (const mirrored of [true, false]) {
    for (let count = 1; count <= 6; count++) {
      for (let seed = 1; seed <= 30; seed++) {
        const units = randomLayout(space, mirrored, count, random(seed), true);
        const places = placesOf(units);
        assert.equal(places.length, count, `${mirrored} ${count} ${seed}`);
        assert.equal(new Set(places).size, count);
      }
    }
  }
});

test('one camera to a place: the scorer ranks a stacked layout last', () => {
  const real = target([space.encode(0, 3, 3, 2)]);
  const score = onePerPlace(space, real);
  const stacked = [space.encode(0, 3, 3, 2), space.encode(0, 2, 3, 2)];
  const apart = [space.encode(0, 3, 3, 2), space.encode(2, 3, 3, 2)];
  assert.ok(score(stacked).rank > score(apart).rank);
  // A mirrored pair holds both its places.
  assert.ok(score([space.encode(0, 3, 3, 2), space.encode(2, 3, 3, 2)]).rank < 1000);
});

test('one camera to a place: no search result stacks two, even when the score likes stacking', () => {
  // A made-up score that is best with every camera at the same place and the same height.
  const stack = (ids) => {
    const places = new Set(ids.map((id) => space.decode(id).place));
    const rank = places.size + Math.abs(ids.length - 3) * 0 + ids.reduce((sum, id) => sum + space.decode(id).tilt, 0) * 0.01;
    return { error: rank, measured: 1, rank };
  };
  for (const mirrored of [true, false]) {
    const found = searchAll(space, mirrored, stack, 6, 3, 6, true);
    for (let count = 1; count <= 6; count++) {
      const places = placesOf(found[count].units);
      assert.equal(places.length, count);
      assert.equal(new Set(places).size, count, `${mirrored} ${count}: ${places}`);
    }
  }
});
