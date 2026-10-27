const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const ts = require('typescript');

const keyCodes = { E: 69, J: 74, K: 75, ENTER: 13, M: 77, V: 86, G: 71, T: 84, I: 73, D: 68, U: 85, S: 83, ARROW_DOWN: 40, ARROW_UP: 38 };
const row = (id) => ({ id: `saved-${id}`, taskId: id, projectId: 7049, task: { id, projectId: 7049, title: `Task ${id}`, ticketNumber: `QA-${id}`, uniqueIndex: id }, comment: { id: `comment-${id}` } });

async function withStarred(run) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.hypertask.ai/starred' });
  const previous = { window: global.window, document: global.document, act: global.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const calls = [];
  const errors = [];
  const pending = [];
  const listeners = new Map();
  const add = document.addEventListener.bind(document);
  const remove = document.removeEventListener.bind(document);
  document.addEventListener = (type, listener, options) => {
    if (type !== 'keydown') return add(type, listener, options);
    const wrapped = (event) => pending.push(Promise.resolve(listener(event)).catch(error => errors.push(error.message)));
    listeners.set(listener, wrapped);
    add(type, wrapped, options);
  };
  document.removeEventListener = (type, listener, options) => remove(type, listeners.get(listener) ?? listener, options);
  const noop = () => {};
  const mocks = {
    'next/navigation': { useRouter: () => ({ push: (url) => calls.push(['push', url]) }) },
    '@/lib/state': { useRecoilState: (atom) => [atom === 'commands' ? { show: false } : null, noop] },
    '@/store': { showCommandsAtom: 'commands' },
    '@/utils/helperFunctions/helperFunctions': { scrollToCenterIfNearBottom: noop },
    '@/lib/constants': { default: { multipleKeys: Object.fromEntries(Object.values(keyCodes).map(code => [code, { pressed: false }])), gThenKeyDelay: 0, inboxRoute: '/inbox', draftsRoute: '/drafts' } },
    '@/lib/contexts/deviceContext': { useDeviceContext: () => false },
    '@/hooks/Task Detail/useStarAndPin': { useStarAndPin: () => ({
      starTask: async (...args) => { calls.push(['star', ...args]); return { status: 201 }; },
      pinComment: async (...args) => { calls.push(['comment', ...args]); return { status: 201 }; },
      removeFromStarredContentQuery: (item, type) => calls.push(['remove', item.taskId, type]),
    }) },
    '@/hooks/General/useCopyURL': { default: () => ({}) },
    '@/hooks/General/useProjectQuery': { useProjectQuery: () => ({ goToProjectShortcut: noop }) },
    '@/lib/constants/APIRouteConstants': {},
    'react-hot-toast': { default: noop },
    './SavedContentRow': { SavedContentRow: ({ task, selected, buttonClick }) => React.createElement('button', { 'data-selected': String(selected), onClick: buttonClick }, task.title) },
    '@/hooks/Inbox/useGlobalFocusHandler': { default: () => ({ archiveNotificationGetter: noop }) },
    '@/lib/constants/keyboard-handler': { KeyCodes: keyCodes },
    '@/lib/keyboard/archiveShortcutGuard': { shouldRunArchiveShortcut: () => true },
  };
  const source = fs.readFileSync(path.join(__dirname, '../src/components/PageComponents/Starred/StarredRowComp.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((name) => {
    if (Object.hasOwn(mocks, name)) return { __esModule: true, ...mocks[name] };
    if (name.startsWith('@/') || name.startsWith('./')) throw new Error(`Unstubbed dependency ${name}`);
    return require(name);
  }, mod, mod.exports);
  const root = createRoot(document.getElementById('root'));
  const render = (rows, type = 'Task') => React.act(async () => root.render(React.createElement(mod.exports.default, { _savedContent: rows, _currentUser: { id: 985 }, _starType: type })));
  const press = (code, options = {}) => React.act(async () => {
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { keyCode: code, bubbles: true, ...options }));
    document.dispatchEvent(new dom.window.KeyboardEvent('keyup', { keyCode: code, bubbles: true, ...options }));
    await Promise.all(pending.splice(0));
  });
  try { await run({ render, press, calls, errors, selected: () => document.querySelector('[data-selected="true"]')?.textContent }); }
  finally {
    await React.act(async () => root.unmount());
    Object.assign(global, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act });
    dom.window.close();
  }
}

test('unstar after a shorter tab or refreshed list uses its last valid row', async () => {
  for (const type of ['Task', 'Comment']) {
    await withStarred(async ({ render, press, calls, errors, selected }) => {
      await render([row(1), row(2), row(3)]);
      await press(keyCodes.J);
      await press(keyCodes.J);
      assert.equal(selected(), 'Task 3');
      await render([row(4)], type);
      assert.equal(selected(), 'Task 4');
      await press(keyCodes.S, type === 'Task' ? { altKey: true } : { ctrlKey: true, shiftKey: true });
      assert.deepEqual(errors, []);
      assert.deepEqual(calls, type === 'Task' ? [['star', 4, 7049, true], ['remove', 4, 'Task']] : [['comment', 4, 7049, 'comment-4', 'Private'], ['remove', 4, 'Comment']]);
    });
  }
});

test('removing the final row and repeating unstar is a no-op', async () => {
  await withStarred(async ({ render, press, calls, errors, selected }) => {
    await render([row(1), row(2)]);
    await press(keyCodes.J);
    await press(keyCodes.S, { altKey: true });
    await render([row(1)]);
    assert.equal(selected(), 'Task 1');
    await press(keyCodes.S, { altKey: true });
    await render([]);
    await press(keyCodes.S, { altKey: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(calls, [['star', 2, 7049, true], ['remove', 2, 'Task'], ['star', 1, 7049, true], ['remove', 1, 'Task']]);
  });
});

test('a selection still within the refreshed list does not jump to the first row', async () => {
  await withStarred(async ({ render, press, calls, errors, selected }) => {
    await render([row(1), row(2), row(3)]);
    await press(keyCodes.J);
    await render([row(4), row(5)]);
    assert.equal(selected(), 'Task 5');
    await press(keyCodes.S, { altKey: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(calls, [['star', 5, 7049, true], ['remove', 5, 'Task']]);
  });
});

test('the remaining selected row still opens through the document shortcut', async () => {
  await withStarred(async ({ render, press, calls, errors }) => {
    await render([row(1), row(2)]);
    await press(keyCodes.J);
    await render([row(1)]);
    await press(keyCodes.ENTER);
    assert.deepEqual(errors, []);
    assert.deepEqual(calls, [['push', '/detail/project-7049/1']]);
  });
});
