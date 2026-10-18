// Units: conversions at the display edge, feet and inches with carry, and the saved choice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOOT, IMPERIAL, INCH, METRIC, formatFeetInches, loadUnits, saveUnits, splitFeetInches, unitsFor, unitsFromText } from '../src/units.js';

const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) <= tolerance, `${a} vs ${b}`);

const feetInches = [
  // [meters, shown]
  [0, '0 ft 0 in'],
  [FOOT, '1 ft 0 in'],
  [11 * FOOT + 8 * INCH, '11 ft 8 in'],
  // 11 ft 11.6 in rounds to 12 in and carries into the feet.
  [11 * FOOT + 11.6 * INCH, '12 ft 0 in'],
  [11 * FOOT + 11.4 * INCH, '11 ft 11 in'],
  [0.2, '0 ft 8 in'],
  [-(FOOT + 2 * INCH), '-1 ft 2 in'],
  // A hair below zero is zero, not "-0 ft 0 in".
  [-0.001, '0 ft 0 in'],
  [7, '23 ft 0 in'],
  [16.541, '54 ft 3 in'],
];

for (const [meters, shown] of feetInches) {
  test(`feet and inches: ${meters} m is ${shown}`, () => {
    assert.equal(formatFeetInches(meters), shown);
  });
}

test('feet and inches never show 12 inches', () => {
  for (let i = 0; i < 5000; i++) {
    const { inches } = splitFeetInches(i * 0.0137 - 20);
    assert.ok(inches >= 0 && inches <= 11, `${inches} in`);
  }
});

const systems = [IMPERIAL, METRIC];

for (const system of systems) {
  test(`${system}: values go to the display and back unchanged`, () => {
    const u = unitsFor(system);
    for (const meters of [0, 0.0254, 0.9017, 3.5, 16.541, -2.25]) {
      near(u.fromLong(u.toLong(meters)), meters);
      near(u.fromShort(u.toShort(meters)), meters);
    }
  });
}

test('imperial: lengths in feet and inches, errors in inches', () => {
  const u = unitsFor(IMPERIAL);
  assert.equal(u.longLabel, 'ft');
  assert.equal(u.shortLabel, 'in');
  near(u.toShort(0.9017), 35.5);
  near(u.fromShort(21), 21 * INCH);
  near(u.toLong(3.048), 10);
  assert.equal(u.distance(3.7592), '12 ft 4 in');
  assert.equal(u.length(0.9017), '35.5 in');
  assert.equal(u.length(21 * INCH), '21 in');
  assert.equal(u.error(0.0254), '1.0 in');
  assert.equal(u.error(0.0361), '1.4 in');
  assert.equal(u.grid(0.4925), '1.6 ft');
  assert.deepEqual([u.scaleLabel(u.errorScale.good), u.scaleLabel(u.errorScale.poor)], ['0.5 in', '3 in']);
});

test('metric: meters and centimeters', () => {
  const u = unitsFor(METRIC);
  assert.equal(u.longLabel, 'm');
  assert.equal(u.shortLabel, 'cm');
  near(u.toShort(0.9017), 90.17);
  near(u.fromLong(3.5), 3.5);
  assert.equal(u.distance(3.7592), '3.76 m');
  assert.equal(u.length(0.9017), '90.2 cm');
  assert.equal(u.error(0.0254), '2.5 cm');
  assert.equal(u.grid(0.4925), '0.49 m');
  assert.deepEqual([u.scaleLabel(u.errorScale.good), u.scaleLabel(u.errorScale.poor)], ['1 cm', '8 cm']);
});

test('the saved choice: imperial unless metric is saved', () => {
  assert.equal(unitsFromText(null), IMPERIAL);
  assert.equal(unitsFromText('furlongs'), IMPERIAL);
  assert.equal(unitsFromText(METRIC), METRIC);
});

test('without storage the page still has its default', () => {
  // Node has no localStorage: loading and saving neither throw nor change anything.
  assert.equal(loadUnits(), IMPERIAL);
  assert.doesNotThrow(() => saveUnits(METRIC));
});
