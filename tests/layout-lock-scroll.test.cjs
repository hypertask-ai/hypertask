const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const load = require('jiti')(__filename, { alias: { '@': path.join(__dirname, '../src') } });
const { MATRIX_STATES, MATRIX_WIDTHS, matrixBaselineLayout, waitForStableScroll } = load('../e2e/smoke/lib/layout-lock-matrix.ts');
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

test('only the phone long-thread AI-open expanded-rail matrix state changes its captured target', () => {
  for (const name of ['ticket-short-thread', 'ticket-long-thread', 'board', 'inbox', 'search']) {
    for (const width of MATRIX_WIDTHS) {
      for (const state of MATRIX_STATES) {
        const previous = name.startsWith('ticket-') && width < 768 ? 'phone' : 'desktop';
        const changed = name === 'ticket-long-thread' && width < 768 && state.ai === 'open' && state.rail === 'expanded';
        assert.equal(matrixBaselineLayout(name, width, state), changed ? 'phone-top' : previous, `${name}/${width}/${state.ai}/${state.rail}`);
      }
    }
  }
  const baseline = require('../e2e/smoke/layout-lock-matrix.baseline.json');
  const anchors = baseline.pages['ticket-long-thread']['ai-open|rail-expanded']['390'];
  assert.equal(anchors.title.box.y, 64);
  assert.equal(anchors['properties-panel'].box.y, 126);
  assert.equal(anchors.description.box.y, 502);
  assert.equal(anchors['comment-list'].box.y, 118);
});

for (const kind of ['embedded', 'page', 'missing-ticket']) {
  test(`phone-top: ${kind} resets only the window and ticket container, never sheet, rail or virtualized descendants`, async () => {
    const previousDocument = global.document;
    const previousWindow = global.window;
    const calls = [];
    const container = { scrollTop: kind === 'embedded' ? 2400 : 0, scrollLeft: 0, scrollHeight: kind === 'embedded' ? 3300 : 0, clientHeight: kind === 'embedded' ? 900 : 0, scrollWidth: 390, clientWidth: 390, parentElement: null };
    container.scrollTo = options => { container.scrollTop = options.top; calls.push(['ticket', options]); };
    const thread = {
      scrollLeft: 0, scrollTop: 0, scrollWidth: 390, scrollHeight: 3200, clientWidth: 390, clientHeight: 3200,
      parentElement: container,
      closest: selector => { assert.equal(selector, '[data-task-detail-path]'); return container; },
    };
    global.document = {
      querySelector: selector => { assert.equal(selector, '[data-testid="ticket-thread"]'); return kind === 'missing-ticket' ? null : thread; },
      querySelectorAll: () => { assert.fail('phone-top must not scroll unrelated elements'); },
      documentElement: { scrollHeight: 3300, clientHeight: 900 },
    };
    global.window = {
      scrollX: 0, scrollY: 2400,
      scrollTo: options => { global.window.scrollY = options.top; calls.push(['window', options]); },
    };
    let frames = 0;
    try {
      await scrollToBaselinePosition({
        evaluate: (callback, argument) => callback({ ...argument, frame: async () => { frames += 1; } }),
      }, 'phone-top');
      const reset = [
        ...(kind === 'embedded' ? [['ticket', { top: 0, behavior: 'instant' }]] : []),
        ['window', { top: 0, left: 0, behavior: 'instant' }],
      ];
      assert.deepEqual(calls, [...reset, ...reset, ...reset]);
      assert.equal(global.window.scrollY, 0);
      assert.equal(container.scrollTop, 0);
      assert.equal(frames, 2);
    } finally {
      if (previousDocument === undefined) delete global.document;
      else global.document = previousDocument;
      if (previousWindow === undefined) delete global.window;
      else global.window = previousWindow;
    }
  });
}
