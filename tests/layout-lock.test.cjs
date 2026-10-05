const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { layoutDifferences, verticalOrder, LAYOUT_CHANGE_MESSAGE } = require('jiti')(__filename)('../e2e/smoke/lib/layout-lock.ts');

const box = (y, width = 300, height = 40) => ({ x: 16, y, width, height });
const baseline = {
  landmarks: {
    title: { selector: '#title', box: box(20) },
    list: { selector: '#list', box: box(80, 300, 100), contentHeight: true },
    composer: { selector: '#composer', box: box(200) },
  },
  order: [['title'], ['list'], ['composer']],
};
const actual = () => Object.fromEntries(Object.entries(baseline.landmarks).map(([key, value]) => [key, { ...value.box }]));

test('unchanged layout and movement within tolerance pass', () => {
  assert.deepEqual(layoutDifferences('ticket/Desktop', baseline, actual()), []);
  const boxes = actual();
  boxes.composer.x += 24;
  boxes.composer.width += 30;
  boxes.list.height = 500;
  assert.deepEqual(layoutDifferences('ticket/Desktop', baseline, boxes), []);
});

test('missing or hidden landmarks name the screen, landmark and both boxes', () => {
  for (const missing of [null, box(20, 0)]) {
    const failures = layoutDifferences('ticket/Mobile', baseline, { ...actual(), title: missing });
    assert.equal(failures.length, 1);
    assert.match(failures[0], /ticket\/Mobile: title: landmark missing or hidden; baseline=.*actual=/);
    assert.ok(failures[0].endsWith(LAYOUT_CHANGE_MESSAGE));
  }
});

test('position and fixed-height resizing exceed tolerance, not content height', () => {
  for (const [edge, delta] of [['x', 25], ['y', 25], ['width', 31], ['height', 25]]) {
    const boxes = actual();
    boxes.composer[edge] += delta;
    assert.ok(layoutDifferences('ticket/Desktop', baseline, boxes).some(message => message.includes(`${edge} moved/resized`)));
  }
  const boxes = actual();
  boxes.list.y += 25;
  assert.ok(layoutDifferences('ticket/Desktop', baseline, boxes).some(message => message.includes('list: y moved')));
});

test('vertical reordering fails even when every box stays within pixel tolerance', () => {
  const expected = { landmarks: { a: { selector: '#a', box: box(0) }, b: { selector: '#b', box: box(10) } }, order: [['a'], ['b']] };
  const failures = layoutDifferences('board/Desktop', expected, { a: box(10), b: box(0) });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /b: vertical order changed: expected a before b/);
});

test('vertical order groups same-row landmarks deterministically', () => {
  assert.deepEqual(verticalOrder({ z: box(10), a: box(12), b: box(50) }), [['a', 'z'], ['b']]);
});

test('committed baseline contains measured boxes and complete vertical order for both viewports', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, '../e2e/smoke/layout-lock.baseline.json'), 'utf8'));
  assert.equal(baseline.flagMode, 'live-like');
  assert.match(baseline.sourceCommit, /^[a-f0-9]{40}$/);
  for (const [device, viewport] of Object.entries({ Desktop: { width: 1440, height: 900 }, Mobile: { width: 390, height: 844 } })) {
    const entry = baseline.viewports[device];
    assert.deepEqual(entry.viewport, viewport);
    assert.deepEqual(Object.keys(entry.screens).sort(), ['app-shell', 'board', 'inbox', 'my-tasks', 'new-task', 'ticket']);
    for (const screen of Object.values(entry.screens)) {
      const names = Object.keys(screen.landmarks);
      assert.ok(names.length >= 4 && names.length <= 8);
      assert.deepEqual(screen.order.flat().sort(), [...names].sort());
      for (const landmark of Object.values(screen.landmarks)) {
        assert.equal(typeof landmark.selector, 'string');
        assert.deepEqual(Object.keys(landmark.box).sort(), ['height', 'width', 'x', 'y']);
        assert.ok(Object.values(landmark.box).every(Number.isInteger));
        assert.ok(landmark.box.width > 0 && landmark.box.height > 0);
      }
      assert.deepEqual(screen.order, verticalOrder(Object.fromEntries(Object.entries(screen.landmarks).map(([name, landmark]) => [name, landmark.box]))));
    }
  }
});

test('spec covers six screens, updates serially from live-like flags, and never changes the baseline on ordinary runs', () => {
  const spec = fs.readFileSync(path.join(__dirname, '../e2e/smoke/layout-lock.spec.ts'), 'utf8');
  assert.match(spec, /\['ticket', 'board', 'inbox', 'my-tasks', 'new-task', 'app-shell'\]/);
  assert.match(spec, /LAYOUT_LOCK_UPDATE=1/);
  assert.match(spec, /--workers=1 --retries=0/);
  assert.match(spec, /if \(update && !fromBoard\) \{[\s\S]*testInfo\.config\.workers/);
  assert.match(spec, /baseline update requires live-like flags, not all-flags-on/);
  assert.match(spec, /modes\[key\] === 'EVERYONE'/);
  assert.match(spec, /sourceCommit = process\.env\.LAYOUT_LOCK_SOURCE_COMMIT/);
  assert.match(spec, /writeFileSync\(baselinePath,[\s\S]*\} else \{[\s\S]*layoutDifferences/);
  assert.match(LAYOUT_CHANGE_MESSAGE, /Only change e2e\/smoke\/layout-lock\.baseline\.json when the ticket asks for this layout change; put Valentin's quote in the PR\./);
});
