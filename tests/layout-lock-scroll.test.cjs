const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('jiti')(__filename, { alias: { '@': path.join(__dirname, '../src') } });
const { waitForStableScroll } = load('../e2e/smoke/lib/layout-lock-matrix.ts');
const { scrollToTop, waitForTicketInitialScroll } = load('../e2e/smoke/lib/layout-lock-scroll.ts');
const taskDetailConfig = load('../src/lib/configs/taskDetail.config.ts').default;

function samples(values) {
  let frame = 0;
  return {
    read: () => JSON.stringify(values[Math.min(frame, values.length - 1)]),
    frame: async () => { frame += 1; },
    frames: () => frame,
  };
}

test('stable scroll needs two animation frames, not just one matching sample', async () => {
  const scroll = samples([[0, 0]]);
  await waitForStableScroll(scroll);
  assert.equal(scroll.frames(), 2);
});

test('a delayed initial scroll restarts the two-frame stability window', async () => {
  const scroll = samples([[0, 0], [0, 0], [0, 24], [0, 489], [0, 489], [0, 489]]);
  await waitForStableScroll(scroll);
  assert.equal(scroll.frames(), 5);
});

test('nested horizontal scroll and growing virtualized rows also restart stability', async () => {
  const scroll = samples([
    [0, 0, 0, 0, 900],
    [0, 0, 10, 0, 900],
    [0, 0, 10, 0, 1000],
    [0, 0, 10, 0, 1000],
    [0, 0, 10, 0, 1000],
  ]);
  await waitForStableScroll(scroll);
  assert.equal(scroll.frames(), 4);
});

test('continuous scrolling fails instead of measuring an unsettled viewport', async () => {
  let offset = 0;
  await assert.rejects(waitForStableScroll({
    read: () => String(offset),
    frame: async () => { offset += 1; },
    maxFrames: 5,
  }), /ticket scroll did not stabilize/);
  assert.equal(offset, 5);
});

test('readiness and configured positioning delay precede stability, top reset and stability again', async () => {
  const calls = [];
  const page = {
    locator: selector => {
      assert.equal(selector, '[data-ticket-initial-scroll-ready="true"]');
      return { waitFor: async options => {
        assert.deepEqual(options, { state: 'attached' });
        calls.push('ready');
      } };
    },
    waitForTimeout: async delay => { calls.push(delay); },
    evaluate: async callback => { calls.push(callback === waitForStableScroll ? 'stable' : 'top'); },
  };
  await waitForTicketInitialScroll(page);
  await scrollToTop(page);
  assert.deepEqual(calls, [
    'ready', 'stable',
    Math.max(taskDetailConfig.delays.defaultCommentFocus, taskDetailConfig.delays.mobileFocusComment, taskDetailConfig.delays.scrollToElement),
    'stable', 'top', 'stable',
  ]);
});
