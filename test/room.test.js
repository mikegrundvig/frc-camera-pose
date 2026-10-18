// Whether a grid point has room for the robot: decided heading by heading, not at heading 0 only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEADING_NO_ROOM, elementsHit, fittingHeadings, headingAt, robotOutline, scoreField } from '../src/coverage.js';
import { defaultState, scoringState } from '../src/state.js';

// A field with no tags and one block along the far wall, from x 5.6, and a long, narrow robot: it
// overlaps the block pointing along x at a point 0.35 m from it, and fits across.
const BLOCK = { name: 'Wall block', blocks: [{ bottomMeters: 0, topMeters: 1, outline: [[5.6, 0], [8, 0], [8, 4], [5.6, 4]] }] };
const field = { length: 8, width: 4, tags: [], elements: [BLOCK], starts: [], places: [] };
const SIZE = { length: 1, width: 0.2 };

test('a point where heading 0 overlaps an element but a turned heading fits has room', () => {
  const fits = fittingHeadings(field, SIZE, 5.25, 2, 0);
  assert.equal(fits[0], false, 'heading 0 overlaps');
  assert.equal(fits[2], true, 'heading 90 fits');
  assert.ok(fits.some(Boolean));
});

test('headings that overlap are counted as no room, not as unmeasured', () => {
  const scoring = { ...scoringState(defaultState()), robotSize: SIZE };
  const result = scoreField(field, scoring);
  const g = result.grid;
  // The cell whose centre is x 5.25: it is not "no room", and its overlapping headings say so.
  const cell = g.cells.find((c) => Math.abs(c.x - 5.25) < 1e-6 && Math.abs(c.y - 2.25) < 0.3);
  const index = g.cells.indexOf(cell);
  assert.notEqual(result.cells[index], null);
  const codes = Array.from(result.headings.slice(index * 8, index * 8 + 8));
  assert.ok(codes.includes(HEADING_NO_ROOM));
  assert.ok(codes.some((c) => c !== HEADING_NO_ROOM));
  // A cell inside the block has no room at any heading.
  const inside = g.cells.findIndex((c) => c.x > 6.5);
  assert.equal(result.cells[inside], null);
  assert.ok(Array.from(result.headings.slice(inside * 8, inside * 8 + 8)).every((c) => c === HEADING_NO_ROOM));
});

test('a cell with room at no heading is no room, and the elements it overlaps can be named', () => {
  const outline = robotOutline({ x: 7, y: 2, heading: headingAt(0, 0) }, SIZE);
  assert.deepEqual(elementsHit(field, outline), ['Wall block']);
  assert.deepEqual(elementsHit(field, robotOutline({ x: 2, y: 2, heading: 0 }, SIZE)), []);
});

test('a field with no elements has room everywhere', () => {
  const open = { ...field, elements: [] };
  assert.ok(fittingHeadings(open, SIZE, 7, 2, 0.3).every(Boolean));
});
