// Blending the coverage map: values between grid points, and no bleeding from cells with nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLANK, UNMEASURED, VALUE, blendCells } from '../src/blend.js';

const near = (a, b, tolerance = 1e-6) => assert.ok(Math.abs(a - b) <= tolerance, `${a} vs ${b}`);
const cell = (error) => ({ error });

// A grid one row high, with the given cells.
function row(...cells) {
  return blendCells({ columns: cells.length, rows: 1 }, cells, 'error', 4);
}

test('between two measured points the value is between them, rising from one to the other', () => {
  const r = row(cell(0.2), cell(0.8));
  assert.equal(r.width, 8);
  const middle = Array.from({ length: 8 }, (_, px) => r.values[px]);
  for (let px = 1; px < 8; px++) assert.ok(middle[px] >= middle[px - 1], `px ${px}`);
  assert.ok(middle[3] > 0.2 && middle[3] < 0.8 && middle[4] > middle[3]);
  // The two points either side of the cells' border average to the middle of the two values.
  near((middle[3] + middle[4]) / 2, 0.5);
  // The ends are the cells' own values.
  near(middle[0], 0.2);
  near(middle[7], 0.8);
  assert.ok(Array.from(r.kinds).every((k) => k === VALUE));
});

test('a measured cell next to one with no room is not pulled toward it, and the blank stays blank', () => {
  const r = row(null, cell(0.8), cell(0.4));
  for (let px = 0; px < 4; px++) assert.equal(r.kinds[px], BLANK, `px ${px}`);
  // The measured cell's side by the blank is its own value all the way.
  near(r.values[4], 0.8);
  near(r.values[5], 0.8);
  // Its other side blends toward the next cell.
  assert.ok(r.values[7] < 0.8 && r.values[7] > 0.4);
});

test('a cell with no measurement keeps its square and is not blended', () => {
  const r = row(cell(0.2), cell(Infinity), cell(0.6));
  for (let px = 4; px < 8; px++) assert.equal(r.kinds[px], UNMEASURED);
  // Either neighbor keeps its own value on the side by the unmeasured cell.
  near(r.values[3], 0.2);
  near(r.values[8], 0.6);
});

test('the raster is the grid scaled up, the first row the lowest y', () => {
  const cells = [cell(0.1), cell(0.1), cell(0.9), cell(0.9)];
  const r = blendCells({ columns: 2, rows: 2 }, cells, 'error', 2);
  assert.equal(r.width, 4);
  assert.equal(r.height, 4);
  // The bottom rows are the first cells' value, the top rows the second's, blending between.
  near(r.values[0], 0.1);
  near(r.values[3 * 4], 0.9);
  assert.ok(r.values[1 * 4] > 0.1 && r.values[1 * 4] < 0.9);
});

test('a single measured cell among blanks is flat', () => {
  const r = blendCells({ columns: 3, rows: 3 }, [null, null, null, null, cell(0.5), null, null, null, null], 'error', 3);
  for (let i = 0; i < r.values.length; i++) {
    if (r.kinds[i] === VALUE) near(r.values[i], 0.5);
  }
  assert.equal(Array.from(r.kinds).filter((k) => k === VALUE).length, 9);
});
