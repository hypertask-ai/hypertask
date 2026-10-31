const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const spec = fs.readFileSync(path.join(__dirname, '../e2e/smoke/layout-lock.spec.ts'), 'utf8');
const sample = spec.match(/tops\.push\((Math\.round\(position\.top[^\n]+)\)/)?.[1];
assert.ok(sample, 'exercise the smoke test composer measurement');
const top = (position) => vm.runInNewContext(sample, { position });

test('fixed phone composer measurement ignores initial thread scrolling', () => {
  const tops = [0, 1032, 1082].map(scrollY => top({ top: 770, scrollY, position: 'fixed' }));
  assert.deepEqual(tops, [770, 770, 770]);
});

test('fixed phone composer measurement still catches a real shove after visibility', () => {
  const tops = [770, 820].map(y => top({ top: y, scrollY: 1082, position: 'fixed' }));
  assert.equal(Math.max(...tops) - Math.min(...tops), 50);
  assert.ok(Math.max(...tops) - Math.min(...tops) > 24);
});

test('in-flow desktop composer measurement compensates for scrolling but catches layout movement', () => {
  const tops = [0, 400, 800].map(scrollY => top({ top: 1852 - scrollY, scrollY, position: 'relative' }));
  assert.deepEqual(tops, [1852, 1852, 1852]);
  assert.equal(top({ top: 1102, scrollY: 800, position: 'relative' }) - tops[2], 50);
});

test('first-load smoke attaches shift evidence before asserting unchanged budgets', () => {
  const firstLoad = spec.slice(spec.indexOf("test('layout lock: ticket page first load"), spec.indexOf("test('layout lock: phone ticket opened from a board card"));
  assert.match(spec, /const CLS_BUDGET = 0\.05/);
  assert.match(firstLoad, /toBeLessThanOrEqual\(24\)/);
  assert.match(firstLoad, /toBeLessThanOrEqual\(CLS_BUDGET\)/);
  assert.ok(firstLoad.indexOf("testInfo.attach('cls-shifts'") < firstLoad.indexOf('expect(Math.max(...tops)'));
  assert.ok(firstLoad.indexOf("testInfo.attach('composer-positions'") < firstLoad.indexOf('expect(Math.max(...tops)'));
});
