// Loads the fields and fixtures from disk for the tests.

import { readFileSync } from 'node:fs';
import { buildField, SEASONS } from '../src/field.js';

const root = new URL('../', import.meta.url);

export function readJson(path) {
  return JSON.parse(readFileSync(new URL(path, root), 'utf8'));
}

// A season's field, with its elements unless `withElements` is false.
export function loadField(year, withElements = true) {
  const season = SEASONS.find((s) => s.year === year);
  const elements = withElements ? readJson(season.elements) : null;
  return buildField(season, readJson(season.layout), elements);
}
