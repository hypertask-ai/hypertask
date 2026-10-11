// YPER4-252 matrix: same parts at every width and sidebar state, 8px tolerance.
const test = require('node:test');
const assert = require('node:assert/strict');
const matrix = require('jiti')(__filename)('../e2e/smoke/lib/layout-lock-matrix.ts');

const state = { ai: 'open', rail: 'expanded' };
const label = matrix.describeCombo('ticket-short-thread', 950, state);
const anchor = (x, y, width, height, contentHeight) => ({ selector: '#a', box: { x, y, width, height }, ...(contentHeight ? { contentHeight } : {}) });
const sideBySide = {
  'comment-list': anchor(100, 200, 400, 300, true),
  'properties-panel': anchor(520, 200, 240, 300, true),
  'comment-box': anchor(100, 520, 400, 80),
};
const same = () => Object.fromEntries(Object.entries(sideBySide).map(([name, value]) => [name, { ...value.box }]));
const diff = (boxes, flags) => matrix.matrixDifferences(label, 'ticket-short-thread', sideBySide, boxes, flags);

test('unchanged layout and movement within 8px pass', () => {
  assert.equal(label, 'ticket-short-thread @ 950px, AI sidebar open, left sidebar expanded');
  assert.deepEqual(diff(same()), []);
  const boxes = same();
  boxes['comment-box'].y += 8;
  boxes['comment-list'].height += 500;
  assert.deepEqual(diff(boxes), []);
});

test('a part that moves names the page, width, state, part and distance', () => {
  const boxes = same();
  boxes['comment-box'].y += 58;
  boxes['comment-box'].x -= 3;
  assert.deepEqual(diff(boxes), [`${label}: comment-box moved -3,58px`]);
});

test('a panel pushed below its neighbour is reported as wrapped, not just moved', () => {
  const boxes = same();
  boxes['properties-panel'] = { x: 100, y: 520, width: 240, height: 300 };
  boxes['comment-box'].y = 830;
  const failures = diff(boxes);
  assert.ok(failures.includes(`${label}: properties-panel wrapped below comment-list`));
  assert.ok(failures.some(message => message.startsWith(`${label}: properties-panel moved -420,320px`)));
});

test('a part that jumps to another column is reported', () => {
  const boxes = same();
  boxes['properties-panel'].x = 40;
  const failures = diff(boxes);
  assert.ok(failures.some(message => message.includes('properties-panel changed column')));
});

test('a hidden part and a composer above the last comment fail', () => {
  assert.match(diff({ ...same(), 'comment-box': null })[0], /comment-box disappeared/);
  assert.deepEqual(matrix.composerFollowsComments(label, 520, 519), []);
  assert.match(matrix.composerFollowsComments(label, 520, 700)[0], /composer is no longer the last part of the thread/);
});

test('a listed flag change is allowed only when that flag is on', () => {
  const boxes = same();
  boxes['comment-box'].y += 58;
  const url = 'https://app.hypertask.ai/detail/project-15/1';
  const entries = [{ flag: 'htpr-1-demo', ticket: url, page: 'ticket-short-thread', anchors: ['comment-box'], reason: 'asked', approvedIn: url }];
  const run = on => diff(boxes, { entries, registry: ['htpr-1-demo'], flags: { 'htpr-1-demo': on } });
  assert.deepEqual(run(true), []);
  assert.equal(run(false).length, 1);
  assert.deepEqual(matrix.validateMatrixFlagChanges(entries, ['htpr-1-demo'], ['ticket-short-thread']), []);
  assert.ok(matrix.validateMatrixFlagChanges([{ ...entries[0], approvedIn: 'x' }], ['htpr-1-demo'], ['ticket-short-thread']).length);
});

test('a flowY part ignores vertical movement but still checks x, width and the fixed parts', () => {
  const flow = { ...sideBySide, 'comment-list': { ...sideBySide['comment-list'], flowY: true }, 'comment-box': { ...sideBySide['comment-box'], flowY: true } };
  const boxes = same();
  boxes['comment-list'].y -= 900;
  boxes['comment-box'].y += 300;
  assert.deepEqual(matrix.matrixDifferences(label, 'ticket-long-thread', flow, boxes), []);
  boxes['comment-box'].x += 30;
  assert.deepEqual(matrix.matrixDifferences(label, 'ticket-long-thread', flow, boxes), [`${label}: comment-box moved 30,0px`]);
});
