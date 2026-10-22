const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const Module = require('node:module');
const React = require('react');
const { JSDOM } = require('jsdom');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const flag = 'htpr-7571-inbox-ctrlk-close';
const composeFlag = 'htpr-6929-compose-task-writer';
const searchFlag = 'htpr-7547-search-lazy-closed';
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Mount Inbox's actual loader, focus effects, proxy and command boundary without its unrelated notification providers.
function inboxCommandHost() {
  const filename = 'src/app/inbox/Inbox.tsx';
  const source = read(filename);
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const loader = tree.statements.filter((node) => ts.isVariableStatement(node) &&
    node.declarationList.declarations.some((declaration) => ['loadedCommands', 'loadCommands'].includes(declaration.name.getText(tree))));
  let proxy;
  let boundary;
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'input' &&
      node.attributes.properties.some((attribute) => attribute.name?.getText(tree) === 'id' && attribute.initializer?.text === 'inbox-command-focus-proxy')) proxy = node;
    if (ts.isJsxExpression(node) && node.expression?.getText(tree).startsWith('showCommands.show && HypertasksCommands &&')) boundary = node;
    ts.forEachChild(node, visit);
  }
  visit(tree);
  const start = source.indexOf('  const [showCommands, setShowCommands]');
  const end = source.indexOf('  const [__notifications', start);
  assert.equal(loader.length, 2);
  assert.ok(proxy && boundary && start >= 0 && end > start, 'production Inbox command boundaries must exist');
  return `
    import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
    import { useRecoilState } from '@/lib/state';
    import { showCommandsAtom } from '@/store';
    ${loader.map((node) => node.getText(tree)).join('\n')}
    export default function InboxCommands({ isApple }) {
      const notificationsQuery = { isFetched: false };
      const loadInboxSplit = () => Promise.resolve();
      const htcCallbackHandler = () => {};
      ${source.slice(start, end)}
      return <>${proxy.getText(tree)}${boundary.getText(tree)}</>;
    }
  `;
}

function load(relative, dependencies = {}, source = read(relative)) {
  const filename = path.join(root, relative);
  const mod = new Module(filename, module);
  mod.require = (id) => {
    if (Object.hasOwn(dependencies, id)) return dependencies[id];
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    throw new Error(`Unexpected dependency in ${relative}: ${id}`);
  };
  mod._compile(ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true,
  } }).outputText, filename);
  return mod.exports;
}

async function withInbox({ enabled = true, apple = false, compose = true, pathname = '/inbox', search = true } = {}, check) {
  const dom = new JSDOM('<div id="root"></div>', { url: `https://example.test${pathname}` });
  const globals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLElement.prototype.attachEvent = () => {};
  dom.window.HTMLElement.prototype.detachEvent = () => {};
  const showCommandsAtom = {};
  let commandsState;
  let setCommandsState;
  let setEnabled;
  let imports = 0;
  let renders = 0;
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const flags = { [flag]: enabled, [composeFlag]: compose, [searchFlag]: search };
  const dependencies = {
    '@/hooks/useFlag': { useFlag: (key) => {
      assert.ok(Object.hasOwn(flags, key), `Unexpected flag ${key}`);
      return flags[key];
    } },
    '@/lib/flags/keys': {
      HTPR_6929_COMPOSE_TASK_WRITER_FLAG: composeFlag,
      HTPR_7547_SEARCH_LAZY_CLOSED_FLAG: searchFlag,
      HTPR_7571_INBOX_CTRLK_CLOSE_FLAG: flag,
    },
    '@/lib/state': {
      useRecoilState: (atom) => { assert.equal(atom, showCommandsAtom); return [commandsState, setCommandsState]; },
      useSetRecoilState: (atom) => { assert.equal(atom, showCommandsAtom); return setCommandsState; },
    },
    '@/store': { showCommandsAtom },
    '@/models/enums': { CommandMode: { Command: 0 } },
    '@/lib/constants/commandCenterShortcut': load('src/lib/constants/commandCenterShortcut.ts'),
    '@/components/commands': { __esModule: true, then: (resolve) => {
      imports++;
      return wait.then(() => resolve({ __esModule: true, default: function Commands() {
        renders++;
        return React.createElement('button', { id: 'commands' }, 'Commands');
      } }));
    } },
  };
  const { useCommandCenterShortcut } = load('src/hooks/General/useCommandCenterShortcut.ts', dependencies);
  const InboxCommands = load('src/app/inbox/Inbox.tsx', dependencies, inboxCommandHost()).default;
  let reactRoot;
  try {
    function Page() {
      const [state, updateState] = React.useState({ show: false, mode: 0, paletteTab: 'search' });
      commandsState = state;
      setCommandsState = updateState;
      const [value, updateEnabled] = React.useState(enabled);
      flags[flag] = value;
      setEnabled = updateEnabled;
      useCommandCenterShortcut(2343, apple, dom.window.location.pathname, false, false,
        () => updateState((prev) => ({ ...prev, show: !prev.show })));
      return React.createElement(InboxCommands, { isApple: apple });
    }
    reactRoot = require('react-dom/client').createRoot(document.getElementById('root'));
    await React.act(async () => reactRoot.render(React.createElement(Page)));
    const press = (key = 'k', extra = {}, target = document.activeElement) => React.act(async () => {
      target.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
        key, code: key === 'Escape' ? 'Escape' : `Key${key.toUpperCase()}`,
        ctrlKey: key !== 'Escape' && !apple, metaKey: key !== 'Escape' && apple,
        bubbles: true, cancelable: true, ...extra,
      }));
    });
    await check({
      press, state: () => commandsState, imports: () => imports, renders: () => renders,
      proxy: () => document.getElementById('inbox-command-focus-proxy'),
      release: () => React.act(async () => release()),
      toggleFlag: (value) => React.act(async () => setEnabled(value)),
      setState: (value) => React.act(async () => setCommandsState(value)),
    });
  } finally {
    await React.act(async () => release());
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
    dom.window.close();
  }
}

test('double Ctrl/Cmd+K closes pending Inbox commands, stays closed after load, and a third chord reopens', async () => {
  for (const apple of [false, true]) {
    for (const reopenBeforeRelease of [false, true]) {
      for (const pathname of ['/inbox', '/inbox?split=Board&projectId=15']) {
        await withInbox({ apple, pathname }, async ({ press, proxy, state, imports, renders, release }) => {
          assert.equal(imports(), 0);
          await press();
          assert.equal(state().show, true);
          assert.equal(state().paletteTab, 'search');
          assert.ok(imports() > 0, 'the production command loader is pending');
          assert.equal(renders(), 0);
          assert.equal(document.activeElement, proxy());
          proxy().value = 'cancel this draft';
          const beforeClose = state();
          await press();
          assert.deepEqual(state(), { ...beforeClose, show: false });
          assert.notEqual(document.activeElement, proxy());
          assert.equal(proxy().value, '');
          if (reopenBeforeRelease) {
            await press();
            assert.equal(state().show, true);
            assert.equal(document.activeElement, proxy());
            assert.equal(renders(), 0);
          }
          await release();
          if (!reopenBeforeRelease) {
            assert.equal(state().show, false);
            assert.equal(renders(), 0, 'late module resolution cannot mount the closed palette');
            assert.equal(document.getElementById('commands'), null);
            await press();
          }
          assert.equal(state().show, true);
          assert.ok(document.getElementById('commands'), 'third chord displays the loaded commands');
        });
      }
    }
  }
});

test('single Ctrl/Cmd+K still opens; Escape closes immediately and survives late loading with either flag mode', async () => {
  for (const apple of [false, true]) {
    for (const enabled of [false, true]) {
      await withInbox({ apple, enabled }, async ({ press, state, proxy, release, renders }) => {
        await press();
        assert.equal(state().show, true);
        assert.equal(document.activeElement, proxy());
        assert.equal(renders(), 0);
        await press('Escape');
        assert.equal(state().show, false);
        await release();
        assert.equal(document.getElementById('commands'), null);
        assert.equal(renders(), 0);
      });
    }
  }
});

test('flag Off retains the pending double-chord bug; switching On refreshes the capture listener', async () => {
  for (const apple of [false, true]) {
    await withInbox({ apple, enabled: false }, async ({ press, state, proxy, release, renders }) => {
      await press();
      await press();
      assert.equal(state().show, true, 'Off keeps the previous open call rather than closing');
      assert.equal(document.activeElement, proxy());
      assert.equal(renders(), 0);
      await release();
      assert.ok(document.getElementById('commands'), 'Off opens when the pending chunk resolves');
    });
    await withInbox({ apple, enabled: false }, async ({ press, state, toggleFlag }) => {
      await press();
      await toggleFlag(true);
      await press();
      assert.equal(state().show, false, 'the hook dependency must track the new flag');
    });
  }
});

test('Ctrl/Cmd+J and K from Compose switch tabs instead of closing, and Compose Off keeps its existing toggle', async () => {
  for (const apple of [false, true]) {
    await withInbox({ apple }, async ({ press, state, proxy }) => {
      await press('j');
      assert.equal(state().paletteTab, 'compose');
      assert.equal(document.activeElement, proxy());
      await press('j');
      assert.equal(state().show, true);
      assert.equal(state().paletteTab, 'compose');
      await press();
      assert.deepEqual(state(), { show: true, mode: 0, paletteTab: 'search' });
      await press();
      assert.equal(state().show, false);
    });
    await withInbox({ apple, compose: false }, async ({ press, state, release }) => {
      await press();
      assert.equal(state().show, true);
      await press();
      assert.equal(state().show, false);
      await release();
      assert.equal(document.getElementById('commands'), null);
    });
  }
});

test('the Inbox flag is scoped to its proxy and exact route, not modified chords or other hosts', async () => {
  for (const pathname of ['/search', '/inbox/agent/qa', '/project', '/inbox-other']) {
    await withInbox({ pathname }, async ({ press, state }) => {
      await press();
      await press();
      assert.equal(state().show, true, `${pathname} must not use the Inbox close branch`);
    });
  }
  await withInbox({}, async ({ press, state, proxy }) => {
    await press();
    for (const extra of [{ shiftKey: true }, { altKey: true }]) {
      await press('k', extra, document.body);
      assert.equal(state().show, true);
    }
    await press('k', {}, document.body);
    assert.equal(state().show, true, 'non-proxy K still uses the original open call');
    assert.equal(document.activeElement, proxy());
  });
});

test('Search proxy behavior remains controlled solely by its own flag in both Inbox flag modes', async () => {
  for (const apple of [false, true]) {
    for (const enabled of [false, true]) {
      for (const search of [false, true]) {
        await withInbox({ pathname: '/search', apple, enabled, search }, async ({ press, state, setState }) => {
          const proxy = document.createElement('input');
          proxy.id = 'search-command-focus-proxy';
          document.body.append(proxy);
          await setState({ show: true, mode: 0, paletteTab: 'search' });
          proxy.focus();
          await press();
          assert.equal(state().show, !search);
          assert.equal(state().paletteTab, 'search');
          await press('j', {}, proxy);
          assert.deepEqual(state(), { show: true, mode: 0, paletteTab: 'compose' });
          await press('k', {}, proxy);
          assert.deepEqual(state(), { show: true, mode: 0, paletteTab: 'search' });
        });
      }
    }
  }
});

test('flag is auto-registered as a client-safe Everyone bugfix with release-risk metadata', async () => {
  const filename = `src/lib/flags/definitions/${flag}.ts`;
  const { HTPR_7571_INBOX_CTRLK_CLOSE_FLAG, default: definition } = load(filename);
  assert.equal(HTPR_7571_INBOX_CTRLK_CLOSE_FLAG, flag);
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, 'bugfix');
  assert.equal(definition.defaultMode, 'EVERYONE');
  assert.equal(definition.shippedOn, '2026-10-22');
  assert.equal(definition.releaseRisk.risk, 'small');
  assert.ok(definition.releaseRisk.reason.trim());
  const { parseFlagFile } = await import('../.github/scripts/feature-flag-registry.mjs');
  assert.equal(parseFlagFile(read(filename), filename).definition.key, flag);
  assert.match(read('src/lib/flags/keys.ts'), /export \* from "\.\/definitions\/index\.generated"/);
  assert.match(read('src/lib/flags/definitions.ts'), /FEATURE_FLAG_DEFINITIONS = FLAG_DEFINITIONS/);
});
