const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const Module = require('node:module');
const React = require('react');
const { JSDOM } = require('jsdom');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const flag = 'htpr-7547-search-lazy-closed';

async function withSearch({ enabled, layout = true, mobile = true, delayed = false, loaded = true, hydrate = false, apple = false, suspendPanel = false, tab = 'search', importFailures = 0 }, check) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/search' });
  const globals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLElement.prototype.attachEvent = () => {};
  dom.window.HTMLElement.prototype.detachEvent = () => {};
  let imports = 0;
  let renders = 0;
  let setOpen;
  let setArchived;
  let setEnabled;
  let setLoaded;
  let release;
  let released = false;
  const wait = new Promise((resolve) => { release = () => { released = true; resolve(); }; });
  const hydrationErrors = [];
  let serverMarkup;
  let bufferedInput;
  let pendingEnter;
  const showCommandsAtom = {};
  function realModule(relative) {
    const filename = path.join(root, relative);
    const mod = new Module(filename, module);
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
    return mod.exports;
  }
  const stubs = {
    '@/styles/search.module.scss': { links_modal: 'links_modal', list_container: 'list_container', links_list: 'links_list' },
    '@/utils/generateTime': () => 'today',
    'lucide-react': { Check: () => null },
    '@/lib/configs/search.config': { searchConfig: { elementIds: { results: { id: 'tasks-list', childKeys: 'task' }, history: { id: 'history-list' }, input: { id: 'search-input' } } } },
    '@/hooks/Search/useSearch': { useSearch: () => {
      const [show, updateOpen] = React.useState(false);
      const [includeArchived, updateArchived] = React.useState(false);
      setOpen = updateOpen;
      setArchived = updateArchived;
      return {
        availableSearchBoards: [], setSelectedIndex() {}, selectedIndex: 0, tasksInputRef: React.useRef(null),
        inputValue: 'QA', responseMessage: 'None', typedTasks: [{ taskId: 43, projectId: 6859, projectTitle: 'QA Sandbox', ticketNumber: 'QASA-43', taskTitle: 'Fixture result', highlight: {} }],
        isSearchDraft: false, ulRef: React.useRef(null), handleLinkClick() {}, handleMouseEnter() {}, handleMouseLeave() {}, handleMouseMove() {},
        searchCache: { history: [] }, selectedHistory: null, updateSearchHistory() {}, showCommands: { show, paletteTab: tab }, setInputValue() {}, liSelectedRef: React.useRef(null),
        tabs: ['All'], activeSplit: 0, updateSplitAndTasks() {}, results: { All: [{}] }, includeArchived, setIncludeArchivedResults: updateArchived,
      };
    } },
    '@/utils/undoActions/helperFuncs': { cn: (...args) => args.filter((arg) => typeof arg === 'string').join(' ') },
    '@/hooks/useFlag': { useFlag: (key) => key === flag ? loaded && enabled : layout, useFlagLoaded: () => loaded },
    'next/navigation': { useRouter: () => ({ push() {} }), useSearchParams: () => new URLSearchParams() },
    '@/lib/aiChatDisplayMode': { buildFullScreenChatPath: () => '/chat' },
    '@/lib/flags/keys': new Proxy({}, { get: (_target, key) => key === 'HTPR_7547_SEARCH_LAZY_CLOSED_FLAG' ? flag : String(key) }),
    '@/lib/flags/definitions/htpr-7547-search-lazy-closed': realModule('src/lib/flags/definitions/htpr-7547-search-lazy-closed.ts'),
    '@/lib/contexts/deviceContext': { useDeviceContext: () => apple },
    '@/lib/search/autocomplete': { highlightedSearchSnippet: () => [], highlightedTitle: (text) => [{ text, matched: false }] },
    '@/components/Labels/LabelWrapper': ({ children }) => children,
    '@/lib/contexts/mobileContext': { MobileViewContext: React.createContext(mobile) },
    '@/lib/state': { useRecoilValue: () => false, useSetRecoilState: (atom) => atom === showCommandsAtom ? (update) => setOpen((show) => update({ show }).show) : () => {} },
    '@/store': { aiChatPendingPromptAtom: {}, appShellRailAtom: {}, showCommandsAtom },
    '@/components/ProviderGlobal/useGlobalUIState': { useGlobalUIState: () => ({ openAIChatInterface() {} }) },
    '@/components/PageComponents/Kanban/HeaderComponents/AppShellRail': () => null,
    './SearchChipsInput': ({ value }) => React.createElement('input', { id: 'search-input', value, readOnly: true }),
    './search-autocomplete.css': {},
  };
  const filename = path.join(root, 'src/app/search/SearchComp.tsx');
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = module.paths;
  mod.require = (id) => {
    if (id === '@/components/commands') {
      imports++;
      const failImport = importFailures-- > 0;
      const commands = { __esModule: true, default: ({ contextOptions, callbackHandler, focusProxy }) => {
        renders++;
        if (suspendPanel && !released) throw wait;
        bufferedInput = focusProxy?.current?.value;
        pendingEnter = focusProxy?.pendingEnter;
        return React.createElement('button', { id: 'commands', onClick: () => callbackHandler(!contextOptions.searchOptions.includeArchived, 'ToggleArchivedSearchResults') }, `Archived: ${contextOptions.searchOptions.includeArchived}`);
      } };
      if (failImport && !delayed) throw new Error('Command import failed');
      return delayed ? { __esModule: true, then: (resolve, reject) => wait.then(() => failImport ? reject(new Error('Command import failed')) : resolve(commands)) } : commands;
    }
    if (Object.hasOwn(stubs, id)) return stubs[id];
    if (id === 'react' || id === 'react/jsx-runtime') return require(id);
    throw new Error(`Unexpected SearchComp dependency: ${id}`);
  };
  let reactRoot;
  try {
    mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, filename);
    const SearchComp = mod.exports.default;
    function Page() {
      const [value, update] = React.useState(enabled);
      enabled = value;
      setEnabled = update;
      const [isLoaded, updateLoaded] = React.useState(loaded);
      loaded = isLoaded;
      setLoaded = updateLoaded;
      return React.createElement(React.Suspense, { fallback: React.createElement('div', { id: 'outer-fallback' }, 'Search hidden') },
        React.createElement(SearchComp, { _searchTerm: 'QA', _includeArchived: false, currentUser: { id: 2343 } }));
    }
    const container = document.getElementById('root');
    if (hydrate) {
      serverMarkup = require('react-dom/server').renderToString(React.createElement(Page));
      container.innerHTML = serverMarkup;
      serverMarkup = container.innerHTML;
      assert.equal(imports, 0, 'SSR must not evaluate closed tools');
      assert.equal(container.querySelector('#outer-fallback'), null, 'SSR itself must render Search, not a failed-render fallback');
      await React.act(async () => {
        reactRoot = require('react-dom/client').hydrateRoot(container, React.createElement(Page), { onRecoverableError: (error) => hydrationErrors.push(error.message) });
      });
    } else {
      reactRoot = require('react-dom/client').createRoot(container);
      await React.act(async () => reactRoot.render(React.createElement(Page)));
    }
    await check({
      imports: () => imports, renders: () => renders, markup: () => container.innerHTML,
      resultsMarkup: () => container.querySelector('.search-input').outerHTML,
      hydrationErrors, serverMarkup, bufferedInput: () => bufferedInput, pendingEnter: () => pendingEnter,
      proxy: () => document.getElementById('search-command-focus-proxy'),
      pressProxy: (key, extra = {}) => React.act(async () => document.getElementById('search-command-focus-proxy').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }))),
      open: () => React.act(async () => setOpen(true)), close: () => React.act(async () => setOpen(false)),
      release: () => React.act(async () => release()),
      loadFlag: () => React.act(async () => setLoaded(true)),
      toggleFlag: (value) => React.act(async () => setEnabled(value)),
      updateArchived: (value) => React.act(async () => setArchived(value)),
      clickCommand: () => React.act(async () => document.getElementById('commands').click()),
    });
  } finally {
    release();
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
    dom.window.close();
  }
}

test('closed commands are not imported with the flag on; search markup matches flag off', async () => {
  for (const layout of [true, false]) {
    for (const mobile of [true, false]) {
      let baseline;
      await withSearch({ enabled: false, layout, mobile }, async ({ imports, renders, markup }) => {
        assert.equal(imports(), 1, 'flag off warms commands during startup (positive control)');
        assert.equal(renders(), 0, 'closed command hooks are not mounted');
        baseline = markup();
        assert.match(baseline, /QASA-43/);
      });
      await withSearch({ enabled: true, layout, mobile }, async ({ imports, renders, markup, updateArchived }) => {
        assert.equal(imports(), 0, 'closed commands must stay outside the initial search evaluation');
        assert.equal(renders(), 0);
        assert.equal(markup(), baseline);
        await updateArchived(true);
        assert.equal(imports(), 0, 'search updates must not warm the closed tool');
        assert.equal(markup(), baseline);
      });
    }
  }
});

test('opening pending commands preserves results; loaded commands keep context and callbacks', async () => {
  await withSearch({ enabled: true, delayed: true }, async ({ imports, markup, resultsMarkup, open, close, release, clickCommand, proxy, bufferedInput }) => {
    const baseline = markup();
    const results = resultsMarkup();
    assert.equal(imports(), 0);
    await open();
    assert.equal(resultsMarkup(), results, 'the loading boundary must not hide search results');
    assert.equal(imports(), 1, 'one open starts one pending command import');
    assert.equal(document.activeElement, proxy(), 'the first open immediately focuses a typing target');
    proxy().value = 'archived';
    proxy().setSelectionRange(2, 5);
    await release();
    assert.equal(imports(), 1);
    assert.equal(bufferedInput(), 'archived', 'the real SearchComp passes buffered typing to the existing palette focusProxy contract');
    assert.match(markup(), /Archived: false/);
    await clickCommand();
    assert.match(markup(), /Archived: true/);
    await close();
    assert.equal(markup(), baseline);
    await open();
    assert.equal(imports(), 1, 'reopening reuses the loaded module');
    assert.match(markup(), /Archived: true/);
  });
});

test('switching the flag off while closed warms commands without changing markup', async () => {
  await withSearch({ enabled: true }, async ({ imports, markup, toggleFlag, open }) => {
    const baseline = markup();
    assert.equal(imports(), 0);
    await toggleFlag(false);
    assert.equal(imports(), 1);
    assert.equal(markup(), baseline);
    await open();
    assert.match(markup(), /Archived: false/);
  });
});

test('flag definition is an Everyone improvement with the requested release date', () => {
  const filename = path.join(root, 'src/lib/flags/definitions/htpr-7547-search-lazy-closed.ts');
  const mod = new Module(filename, module);
  mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
  const definition = mod.exports.default;
  assert.equal(mod.exports.HTPR_7547_SEARCH_LAZY_CLOSED_FLAG, flag);
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, 'improvement');
  assert.equal(definition.defaultMode, 'EVERYONE');
  assert.equal(definition.shippedOn, '2026-10-22');
  assert.equal(definition.releaseRisk.risk, 'small');
  assert.ok(definition.releaseRisk.reason);
});

test('unresolved flags do not accidentally import commands; opening remains available', async () => {
  for (const enabled of [true, false]) {
    await withSearch({ enabled, loaded: false }, async ({ imports, markup, loadFlag }) => {
      const baseline = markup();
      assert.equal(imports(), 0, 'the initial false flag value is not a resolved Off');
      await loadFlag();
      assert.equal(imports(), enabled ? 0 : 1);
      assert.equal(markup(), baseline);
    });
  }
  await withSearch({ enabled: true, loaded: false }, async ({ imports, markup, open }) => {
    await open();
    assert.equal(imports(), 1, 'opening must not depend on flag API availability');
    assert.match(markup(), /Archived: false/);
  });
});


test('closed search hydrates without changed markup with flag on, off or unresolved', async () => {
  for (const enabled of [true, false]) {
    for (const loaded of [true, false]) {
      for (const mobile of [true, false]) {
        await withSearch({ enabled, loaded, mobile, hydrate: true }, async ({ markup, serverMarkup, hydrationErrors, imports }) => {
          assert.equal(markup(), serverMarkup);
          assert.deepEqual(hydrationErrors, []);
          assert.equal(imports(), loaded && !enabled ? 1 : 0);
        });
      }
    }
  }
});

test('pending cold opens preserve Escape and platform command shortcut dismissal', async () => {
  for (const apple of [true, false]) {
    for (const key of ['Escape', 'k']) {
      await withSearch({ enabled: true, delayed: true, apple }, async ({ open, proxy, pressProxy, markup, release }) => {
        await open();
        assert.equal(document.activeElement, proxy());
        await pressProxy(key, key === 'k' ? (apple ? { metaKey: true } : { ctrlKey: true }) : {});
        assert.equal(proxy(), null, 'dismissal cannot wait for the command chunk');
        await release();
        assert.doesNotMatch(markup(), /id="commands"/, 'a resolved import must not reopen dismissed commands');
      });
    }
  }
});


test('suspending command panels cannot replace the outer search page', async () => {
  await withSearch({ enabled: true, suspendPanel: true }, async ({ open, imports, renders, resultsMarkup, markup, release }) => {
    const baseline = resultsMarkup();
    await open();
    assert.equal(imports(), 1);
    assert.ok(renders() > 0, 'the pending command panel was actually evaluated');
    assert.equal(resultsMarkup(), baseline);
    assert.doesNotMatch(markup(), /Search hidden/);
    await release();
    assert.match(markup(), /Archived: false/);
    assert.equal(resultsMarkup(), baseline);
  });
});


test('HTPR-7547 pending Enter survives command loading in Search and Compose for every flag state', async () => {
  for (const enabled of [true, false]) {
    for (const loaded of [true, false]) {
      for (const tab of ['search', 'compose']) {
        await withSearch({ enabled, loaded, tab, delayed: true }, async ({ open, proxy, pressProxy, release, pendingEnter, bufferedInput }) => {
          await open();
          const text = tab === 'compose' ? 'first line\nsecond line' : 'archived';
          proxy().value = text;
          await pressProxy('Enter', { code: 'Enter' });
          await release();
          assert.equal(bufferedInput(), text, 'multiline Compose text must survive the proxy');
          assert.equal(pendingEnter(), text, 'the mounted palette receives the Enter intent with its text');
        });
      }
    }
  }
});


test('HTPR-7547 closing a pending Enter cancels it before the next open', async () => {
  await withSearch({ enabled: true, delayed: true }, async ({ open, close, proxy, pressProxy, release, pendingEnter }) => {
    await open();
    proxy().value = 'archived';
    await pressProxy('Enter', { code: 'Enter' });
    await close();
    await open();
    await release();
    assert.equal(pendingEnter(), undefined);
  });
});


test('HTPR-7547 Shift+Enter and IME confirmation do not queue a submit', async () => {
  for (const extra of [{ shiftKey: true }, { isComposing: true }]) {
    await withSearch({ enabled: true, tab: 'compose', delayed: true }, async ({ open, proxy, pressProxy, release, pendingEnter }) => {
      await open();
      proxy().value = 'draft';
      await pressProxy('Enter', { code: 'Enter', ...extra });
      await release();
      assert.equal(pendingEnter(), undefined);
    });
  }
});


test('HTPR-7547 editing pending proxy text cancels the queued Enter even when the original text returns', async () => {
  for (const tab of ['search', 'compose']) {
    await withSearch({ enabled: true, tab, delayed: true }, async ({ open, proxy, pressProxy, release, pendingEnter, bufferedInput }) => {
      await open();
      proxy().value = 'draft';
      await pressProxy('Enter', { code: 'Enter' });
      await React.act(async () => {
        proxy().value = 'draft2';
        proxy().dispatchEvent(new window.Event('input', { bubbles: true }));
        proxy().value = 'draft';
        proxy().dispatchEvent(new window.Event('input', { bubbles: true }));
      });
      await release();
      assert.equal(bufferedInput(), 'draft');
      assert.equal(pendingEnter(), undefined);
    });
  }
});


test('HTPR-7547 a failed command import closes the palette and the next open retries it', async () => {
  for (const loaded of [true, false]) {
    await withSearch({ enabled: true, loaded, delayed: true, importFailures: 1 }, async ({ open, proxy, pressProxy, release, imports, resultsMarkup, pendingEnter }) => {
      const baseline = resultsMarkup();
      await open();
      proxy().value = 'draft';
      await pressProxy('Enter', { code: 'Enter' });
      await release();
      assert.equal(imports(), 1);
      assert.equal(proxy(), null, 'a failed import closes the palette instead of leaving it invisible');
      assert.equal(document.querySelector('[role="alert"]'), null, 'no new UI on a failed import');
      assert.equal(resultsMarkup(), baseline, 'a failed tool import cannot hide search results');
      await open();
      await release();
      assert.equal(imports(), 2);
      assert.ok(document.getElementById('commands'));
      assert.equal(pendingEnter(), undefined, 'the closed draft does not submit on reopen');
    });
  }
});


test('HTPR-7547 failed background warmup stays invisible and opening retries the import', async () => {
  await withSearch({ enabled: false, importFailures: 1 }, async ({ open, imports, markup }) => {
    assert.equal(imports(), 1);
    assert.equal(document.querySelector('[role="alert"]'), null);
    assert.match(markup(), /QASA-43/);
    await open();
    assert.equal(imports(), 2);
    assert.ok(document.getElementById('commands'));
    assert.equal(document.querySelector('[role="alert"]'), null);
  });
});
