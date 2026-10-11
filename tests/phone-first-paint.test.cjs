const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
require('tsx/cjs');

const root = path.resolve(__dirname, '..');
const phoneFlag = 'htpr-7008-phone-first-paint';
const keys = require("./helpers/flag-files.cjs").load("src/lib/flags/keys.ts");
const user = { id: 2343, displayName: 'Disposable QA', UserSetting: { notification: true } };

function load(relative, mocks) {
  const js = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', js)(name => {
    assert.ok(name in mocks, `Unexpected dependency: ${name}`);
    const value = mocks[name];
    return value.default ? { __esModule: true, ...value } : value;
  }, loaded, loaded.exports);
  return loaded.exports;
}

async function warming({ mobile, enabled, pathname, saveData = false }) {
  const effects = [], frames = [], idle = [], timers = [], listeners = new Map(), imports = [];
  const previousWindow = global.window, previousDocument = global.document;
  global.window = { innerWidth: mobile ? 390 : 1440, location: { pathname }, history: { state: {} }, navigator: { connection: { saveData, effectiveType: '4g' } },
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, cancelAnimationFrame: () => {},
    requestIdleCallback: fn => { idle.push(fn); return idle.length; }, cancelIdleCallback: () => {},
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
  };
  global.document = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const mocks = {
    react: { useEffect: fn => effects.push(fn), useRef: value => ({ current: value }), useState: value => [typeof value === 'function' ? value() : value, () => {}],
      useSyncExternalStore: () => pathname },
    'react-dom': {}, 'react/jsx-runtime': {},
    'next/navigation': { usePathname: () => pathname, useRouter: () => ({}) },
    '@tanstack/react-query': { useQueryClient: () => ({}) },
    '@/lib/state': { useRecoilValue: () => user }, '@/store': {},
    '@/hooks/useFlag': { useFlag: key => key === phoneFlag ? enabled : key === keys.HTPR_6752_INSTANT_TICKET_OPEN_FLAG },
    '@/lib/flags/keys': keys,
    '@/lib/navigation/cachedTaskDetail': { cachedTaskDetailLocation: () => undefined },
    '@/utils/helperFunctions/helperFunctions': {}, '@/lib/constants/constants': {},
  };
  for (const name of [
    '@/components/Modals/SwipeUnread/EmbeddedTaskDetail',
    '@/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/TopRow/DescriptionEmojiButton',
    '@/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/BottomRow/DescriptionReactions',
    '@/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/CommentReactions',
    '@/components/PageComponents/TaskDetail/TaskMovement',
    '@/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/EmojiOptionsComp',
    '@/lib/constants/emojiData', '@/firebase', 'firebase/messaging', '@/components/RTE/Extensions/lazyEmojiData',
  ]) {
    Object.defineProperty(mocks, name, { get: () => { imports.push(name); return { default: () => null, ensureEmojiData: async () => {} }; } });
  }
  const cleanups = [];
  try {
    const Component = load('src/components/PageComponents/TaskDetail/CachedTaskDetailNavigation.tsx', mocks).default;
    const children = { realContent: true };
    assert.equal(Component({ children, accountId: user.id }), children, 'warming never hides or replaces real content');
    for (const effect of effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
    while (frames.length) frames.shift()();
    while (idle.length) idle.shift()();
    while (timers.length) timers.shift()();
    await Promise.resolve(); await Promise.resolve();
    const automatic = imports.length;
    assert.equal(typeof listeners.get('pointerdown'), 'function');
    listeners.get('pointerdown')();
    await Promise.resolve(); await Promise.resolve();
    return { automatic, afterIntent: imports.length };
  } finally {
    cleanups.reverse().forEach(fn => fn());
    assert.equal(listeners.has('pointerdown'), false, 'unmount removes the warming listener');
    global.window = previousWindow; global.document = previousDocument;
  }
}

for (const pathname of ['/project', '/inbox']) {
  test(`${pathname}: optional editor, reactions, emoji and Firebase imports wait for phone intent`, async () => {
    const result = await warming({ pathname, mobile: true, enabled: true });
    assert.equal(result.automatic, 0);
    assert.equal(result.afterIntent, 10, 'all existing shared features still load on intent');
  });
  test(`${pathname}: flag-off and desktop warming retain all existing automatic imports`, async () => {
    for (const [mobile, enabled] of [[true, false], [false, true], [false, false]]) {
      const result = await warming({ pathname, mobile, enabled });
      assert.equal(result.automatic, 10, 'positive control for the no-import assertion');
      assert.equal(result.afterIntent, 10, 'warming stays deduplicated');
    }
  });
}
test('My Tasks and data-saving connections retain their existing warming policy', async () => {
  assert.equal((await warming({ pathname: '/my-tasks', mobile: true, enabled: true })).automatic, 10);
  assert.equal((await warming({ pathname: '/project', mobile: true, enabled: false, saveData: true })).automatic, 0);
});
