const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { layoutDifferences, validateFlagChanges, verticalOrder, LAYOUT_CHANGE_MESSAGE } = require('jiti')(__filename)('../e2e/smoke/lib/layout-lock.ts');

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

const flag = 'htpr-6422-my-tasks-views';
const change = {
  flag, ticket: 'https://app.hypertask.ai/detail/project-15/6422', screen: 'ticket/Desktop',
  landmarks: ['composer'], reason: 'The ticket explicitly requests this landmark change.',
};
const allowances = (entries = [change]) => ({ entries, registry: [flag], flags: { [flag]: true } });

test('all-flags-on allows only listed landmarks under enabled registered flags, not live-like drift', () => {
  const boxes = actual();
  boxes.composer.y += 56;
  assert.deepEqual(layoutDifferences('ticket/Desktop', baseline, boxes, allowances()), []);
  assert.equal(layoutDifferences('ticket/Desktop', baseline, boxes).length, 1);
  for (const options of [allowances([]), { ...allowances(), registry: [] }, { ...allowances(), flags: { [flag]: false } }]) {
    const failures = layoutDifferences('ticket/Desktop', baseline, boxes, options);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /ticket\/Desktop: composer:.*must be listed.*registered flag.*ticket that asked for this change/);
  }
  assert.equal(layoutDifferences('ticket/Mobile', baseline, boxes, allowances()).length, 1);
});

test('one listed landmark cannot hide another unrequested drift or a different screen', () => {
  const boxes = actual();
  boxes.composer.y += 56;
  boxes.title.y += 56;
  const failures = layoutDifferences('ticket/Desktop', baseline, boxes, allowances());
  assert.equal(failures.length, 1);
  assert.match(failures[0], /ticket\/Desktop: title:/);
  assert.deepEqual(layoutDifferences('ticket/Desktop', baseline, { ...actual(), composer: null }, allowances()), []);
});

test('vertical reordering requires both involved landmarks to be listed', () => {
  const expected = { landmarks: { a: { selector: '#a', box: box(0) }, b: { selector: '#b', box: box(10) } }, order: [['a'], ['b']] };
  const boxes = { a: box(10), b: box(0) };
  const failures = layoutDifferences('ticket/Desktop', expected, boxes, allowances([{ ...change, landmarks: ['b'] }]));
  assert.equal(failures.length, 1);
  assert.match(failures[0], /ticket\/Desktop: a: vertical order changed/);
  assert.deepEqual(layoutDifferences('ticket/Desktop', expected, boxes, allowances([{ ...change, landmarks: ['a', 'b'] }])), []);
});

test('retired or unknown flags fail the ratchet even when the layout did not move', () => {
  assert.deepEqual(validateFlagChanges([change], [flag], { 'ticket/Desktop': baseline }), []);
  const failures = validateFlagChanges([change], [], { 'ticket/Desktop': baseline });
  assert.equal(failures.length, 1);
  assert.match(failures[0], /ticket\/Desktop: htpr-6422-my-tasks-views: flag no longer exists in the registry/);
  assert.match(failures[0], /Remove.*entry and update the live-like baseline instead/);
});

test('ratchet requires the matching full ticket URL, reason, exact screen and unique existing landmarks', () => {
  for (const invalid of [
    { ...change, ticket: 'https://app.hypertask.ai/detail/project-15/6556' },
    { ...change, ticket: 'HTPR-6422' }, { ...change, reason: '' },
    { ...change, screen: 'ticket' }, { ...change, landmarks: [] },
    { ...change, landmarks: ['typo'] }, { ...change, landmarks: ['composer', 'composer'] },
  ]) assert.ok(validateFlagChanges([invalid], [flag], { 'ticket/Desktop': baseline }).length);
  assert.match(validateFlagChanges([change, change], [flag], { 'ticket/Desktop': baseline })[0], /duplicate/);
});

test('spec validates the registry in both modes and applies allowances only to all-flags-on fixtures', () => {
  const spec = fs.readFileSync(path.join(__dirname, '../e2e/smoke/layout-lock.spec.ts'), 'utf8');
  const seed = fs.readFileSync(path.join(__dirname, '../scripts/seed-browser-smoke.mjs'), 'utf8');
  assert.match(spec, /import \{ FEATURE_FLAG_KEYS \} from '\.\.\/\.\.\/src\/lib\/flags'/);
  assert.match(spec, /test\.beforeAll\([\s\S]*validateFlagChanges\(flagChanges, FEATURE_FLAG_KEYS, screens\)/);
  assert.match(spec, /layoutDifferences\([\s\S]*fixture\.allFlagsOn\s*\? \{ entries: flagChanges, registry: FEATURE_FLAG_KEYS, flags \}\s*: undefined/);
  assert.match(seed, /JSON\.stringify\(\{ \.\.\.fixture, flags, allFlagsOn \}\)/);
  const entries = JSON.parse(fs.readFileSync(path.join(__dirname, '../e2e/smoke/layout-lock.flag-changes.json'), 'utf8'));
  const committed = JSON.parse(fs.readFileSync(path.join(__dirname, '../e2e/smoke/layout-lock.baseline.json'), 'utf8'));
  const screens = Object.fromEntries(Object.entries(committed.viewports).flatMap(([device, viewport]) =>
    Object.entries(viewport.screens).map(([screen, value]) => [`${screen}/${device}`, value])));
  const keys = require('jiti')(__filename)('../src/lib/flags/keys.ts');
  const definitions = fs.readFileSync(path.join(__dirname, '../src/lib/flags/definitions.ts'), 'utf8').split('const FEATURE_FLAG_DEFINITIONS = [')[1].split('] as const')[0];
  const registry = [...definitions.matchAll(/key: ([A-Z_0-9]+),/g)].map(match => keys[match[1]]).filter(Boolean);
  assert.deepEqual(validateFlagChanges(entries, registry, screens), []);
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

test('phone title hit-target invariant is independent of allowed landmark drift', () => {
  const spec = fs.readFileSync(path.join(__dirname, '../e2e/smoke/layout-lock.spec.ts'), 'utf8');
  const invariant = spec.slice(spec.indexOf("test('layout lock: phone New Task title"), spec.indexOf("test('layout lock: desktop New Task"));
  assert.match(invariant, /#title-input-modal/);
  assert.match(invariant, /toBeGreaterThanOrEqual\(24\)/);
  assert.match(invariant, /document\.elementFromPoint[\s\S]*=== field/);
  assert.match(invariant, /await title\.tap\(\)[\s\S]*toBeFocused\(\)/);
  assert.doesNotMatch(invariant, /layoutDifferences|flagChanges/);
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


test('stable cached phone opens allow the intentional unscrolled viewport only with their registered flag on', () => {
  const committed = JSON.parse(fs.readFileSync(path.join(__dirname, '../e2e/smoke/layout-lock.baseline.json'), 'utf8'));
  const entries = JSON.parse(fs.readFileSync(path.join(__dirname, '../e2e/smoke/layout-lock.flag-changes.json'), 'utf8'));
  const expected = committed.viewports.Mobile.screens.ticket;
  const stable = 'htpr-6899-stable-layout';
  // PR 1074 browser-smoke failure: the old baseline had already scrolled past properties.
  const measured = {
    title: { x: 18, y: 64, width: 274, height: 37 },
    description: { x: 10, y: 534, width: 370, height: 274 },
    'first-comment': { x: 10, y: 792, width: 370, height: 88 },
    'last-comment': { x: 10, y: 880, width: 370, height: 88 },
    composer: { x: 0, y: 770, width: 390, height: 74 },
    properties: { x: 10, y: 158, width: 370, height: 360 },
  };
  const options = { entries, registry: [stable], flags: { [stable]: true } };
  assert.deepEqual(layoutDifferences('ticket/Mobile', expected, measured, options), []);
  for (const control of [undefined, { ...options, flags: { [stable]: false } }, { ...options, registry: [] }]) {
    assert.ok(layoutDifferences('ticket/Mobile', expected, measured, control).length, 'flag-off/live-like/unregistered drift must remain a failure');
  }
  assert.ok(layoutDifferences('ticket/Desktop', expected, measured, options).length, 'phone allowance cannot change desktop layout');
  assert.deepEqual(entries.filter(entry => entry.flag === stable).map(entry => entry.screen), ['ticket/Mobile']);
});
