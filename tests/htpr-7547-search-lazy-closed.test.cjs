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

async function withSearch({ enabled, layout = true, mobile = true, delayed = false, loaded = true }, check) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/search' });
  const globals = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map((key) => [key, Object.getOwnPropertyDescriptor(global, key)]);
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let imports = 0;
  let renders = 0;
  let setOpen;
  let setArchived;
  let setEnabled;
  let setLoaded;
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  const dynamic = require('next/dist/shared/lib/app-dynamic');
  const actualDynamic = dynamic.default ?? dynamic;
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
        searchCache: { history: [] }, selectedHistory: null, updateSearchHistory() {}, showCommands: { show }, setInputValue() {}, liSelectedRef: React.useRef(null),
        tabs: ['All'], activeSplit: 0, updateSplitAndTasks() {}, results: { All: [{}] }, includeArchived, setIncludeArchivedResults: updateArchived,
      };
    } },
    '@/utils/undoActions/helperFuncs': { cn: (...args) => args.filter((arg) => typeof arg === 'string').join(' ') },
    '@/hooks/useFlag': { useFlag: (key) => key === flag ? loaded && enabled : layout, useFlagLoaded: () => loaded },
    'next/navigation': { useRouter: () => ({ push() {} }), useSearchParams: () => new URLSearchParams() },
    '@/lib/aiChatDisplayMode': { buildFullScreenChatPath: () => '/chat' },
    '@/lib/flags/keys': new Proxy({}, { get: (_target, key) => String(key) }),
    '@/lib/flags/definitions/htpr-7547-search-lazy-closed': { HTPR_7547_SEARCH_LAZY_CLOSED_FLAG: flag },
    '@/lib/search/autocomplete': { highlightedSearchSnippet: () => [], highlightedTitle: (text) => [{ text, matched: false }] },
    '@/components/Labels/LabelWrapper': ({ children }) => children,
    '@/lib/contexts/mobileContext': { MobileViewContext: React.createContext(mobile) },
    '@/lib/state': { useRecoilValue: () => false, useSetRecoilState: () => () => {} },
    '@/store': { aiChatPendingPromptAtom: {}, appShellRailAtom: {} },
    '@/components/ProviderGlobal/useGlobalUIState': { useGlobalUIState: () => ({ openAIChatInterface() {} }) },
    '@/components/PageComponents/Kanban/HeaderComponents/AppShellRail': () => null,
    './SearchChipsInput': ({ value }) => React.createElement('input', { id: 'search-input', value, readOnly: true }),
    './search-autocomplete.css': {},
    'next/dynamic': (loader, options) => {
      assert.equal(options.ssr, false, 'closed commands must not introduce server rendering');
      return actualDynamic(() => delayed ? wait.then(loader) : loader(), options);
    },
  };
  const filename = path.join(root, 'src/app/search/SearchComp.tsx');
  const mod = new Module(filename, module);
  mod.filename = filename;
  mod.paths = module.paths;
  mod.require = (id) => {
    if (id === '@/components/commands') {
      imports++;
      return { __esModule: true, default: ({ contextOptions, callbackHandler }) => {
        renders++;
        return React.createElement('button', { id: 'commands', onClick: () => callbackHandler(!contextOptions.searchOptions.includeArchived, 'ToggleArchivedSearchResults') }, `Archived: ${contextOptions.searchOptions.includeArchived}`);
      } };
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
      return React.createElement(SearchComp, { _searchTerm: 'QA', _includeArchived: false, currentUser: { id: 2343 } });
    }
    reactRoot = require('react-dom/client').createRoot(document.getElementById('root'));
    await React.act(async () => reactRoot.render(React.createElement(Page)));
    await check({
      imports: () => imports, renders: () => renders, markup: () => document.getElementById('root').innerHTML,
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
  await withSearch({ enabled: true, delayed: true }, async ({ imports, markup, open, close, release, clickCommand }) => {
    const baseline = markup();
    assert.equal(imports(), 0);
    await open();
    assert.equal(markup(), baseline, 'the loading boundary must not hide search results');
    assert.equal(imports(), 0);
    await release();
    assert.equal(imports(), 1);
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
