// What the drawing shows: the defaults, and reading saved choices without trusting them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SHOW_ITEMS, defaultShow, loadShow, saveShow, showFromText } from '../src/show.js';

test('everything is on at first except the lines to hidden tags', () => {
  const show = defaultShow();
  for (const item of SHOW_ITEMS) assert.equal(show[item.id], item.id !== 'hiddenLines', item.id);
});

const saved = [
  // [name, text, what it reads as]
  ['nothing saved', null, defaultShow()],
  ['not JSON', 'views', defaultShow()],
  ['not an object', '3', defaultShow()],
  ['one choice', '{"views":false}', { ...defaultShow(), views: false }],
  ['a choice that is not true or false', '{"views":"no","map":false}', { ...defaultShow(), map: false }],
  ['something unknown', '{"unknown":false}', defaultShow()],
];

for (const [name, text, expected] of saved) {
  test(`reading saved choices: ${name}`, () => {
    assert.deepEqual(showFromText(text), expected);
  });
}

test('without storage the page still has its defaults', () => {
  // Node has no localStorage: loading and saving must neither throw nor change anything.
  assert.deepEqual(loadShow(), defaultShow());
  assert.doesNotThrow(() => saveShow(defaultShow()));
});
