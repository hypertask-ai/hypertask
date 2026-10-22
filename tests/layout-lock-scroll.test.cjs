const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('jiti')(__filename, { alias: { '@': path.join(__dirname, '../src') } });
const { waitForStableScroll } = load('../e2e/smoke/lib/layout-lock-matrix.ts');
const { scrollToBaselinePosition, waitForTicketInitialScroll } = load('../e2e/smoke/lib/layout-lock-scroll.ts');
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

for (const layout of ['desktop', 'phone']) {
  test(`${layout}: readiness and configured positioning delay precede stability, baseline reset and stability again`, async () => {
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
      evaluate: async (callback, argument) => {
        assert.equal(callback, waitForStableScroll);
        if (argument.baselineLayout) {
          assert.equal(argument.baselineLayout, layout);
          calls.push(layout);
        }
        calls.push('stable');
      },
    };
    await waitForTicketInitialScroll(page);
    await scrollToBaselinePosition(page, layout);
    assert.deepEqual(calls, [
      'ready', 'stable',
      Math.max(taskDetailConfig.delays.defaultCommentFocus, taskDetailConfig.delays.mobileFocusComment, taskDetailConfig.delays.scrollToElement),
      'stable', layout, 'stable',
    ]);
  });
}

for (const layout of ['desktop', 'phone']) {
  test(`${layout}: baseline reset positions window and nested containers, including one initially at top`, async () => {
    const previousDocument = global.document;
    const previousWindow = global.window;
    const calls = [];
    const containers = [
      { scrollTop: 24, scrollHeight: 1000, clientHeight: 400 },
      { scrollTop: 0, scrollHeight: 1130, clientHeight: 844 },
      { scrollTop: 0, scrollHeight: 100, clientHeight: 100 },
    ];
    for (const [index, container] of containers.entries()) {
      container.scrollTo = options => { calls.push([index, options]); };
    }
    global.document = {
      querySelectorAll: selector => { assert.equal(selector, '*'); return containers; },
      documentElement: { scrollHeight: 1130, clientHeight: 844 },
    };
    global.window = { scrollTo: options => { calls.push(['window', options]); } };
    const page = {
      evaluate: async (callback, argument) => {
        assert.equal(callback, waitForStableScroll);
        await callback({ ...argument, read: () => 'settled', frame: async () => {} });
        calls.push('stable');
      },
    };
    try {
      await scrollToBaselinePosition(page, layout);
      const reset = [
        [0, { top: layout === 'phone' ? 600 : 0, behavior: 'instant' }],
        [1, { top: layout === 'phone' ? 286 : 0, behavior: 'instant' }],
        ['window', { top: layout === 'phone' ? 286 : 0, left: 0, behavior: 'instant' }],
      ];
      assert.deepEqual(calls, [...reset, ...reset, ...reset, 'stable']);
    } finally {
      if (previousDocument === undefined) delete global.document;
      else global.document = previousDocument;
      if (previousWindow === undefined) delete global.window;
      else global.window = previousWindow;
    }
  });
}

test('phone reset follows growing scroll extents before accepting two stable frames', async () => {
  const previousDocument = global.document;
  const previousWindow = global.window;
  const offsets = [];
  const container = { scrollTop: 0, scrollHeight: 1080, clientHeight: 844 };
  container.scrollTo = ({ top }) => { container.scrollTop = top; };
  global.document = { querySelectorAll: () => [container], documentElement: container };
  global.window = { scrollTo: ({ top }) => { offsets.push(top); } };
  let frames = 0;
  try {
    await scrollToBaselinePosition({
      evaluate: (callback, argument) => callback({
        ...argument,
        read: () => String(container.scrollTop),
        frame: async () => {
          frames += 1;
          if (frames === 1) container.scrollHeight += 50;
        },
      }),
    }, 'phone');
    assert.deepEqual(offsets, [236, 286, 286, 286]);
    assert.equal(container.scrollTop, 286);
    assert.equal(frames, 3);
  } finally {
    if (previousDocument === undefined) delete global.document;
    else global.document = previousDocument;
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});
