const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const { createJiti } = require('jiti');

const root = path.resolve(__dirname, '..');

test('active palette search follows late Pages availability without retyping', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const globals = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previousGlobals = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
  const modules = ['lib/state.tsx', 'store/index.ts', 'utils/getCurrentUser.ts', 'hooks/MultiPages/HTC/useHTC.tsx'].map(file => path.join(root, 'src', file));
  const previousModules = new Map(modules.map(file => [file, require.cache[file]]));
  let reactRoot;
  try {
    global.window = dom.window;
    global.document = dom.window.document;
    global.HTMLElement = dom.window.HTMLElement;
    global.IS_REACT_ACT_ENVIRONMENT = true;
    for (const [file, exports] of [
      [modules[0], { useRecoilState: atom => React.useState(atom.default) }],
      [modules[1], { currentProjectAtom: { default: null }, frequentlyUsedHTCAton: { default: {} } }],
      [modules[2], { getCurrentUserFromCookies: () => null }],
    ]) require.cache[file] = { id: file, filename: file, loaded: true, exports };
    delete require.cache[modules[3]];
    const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') } });
    const useHTC = jiti(modules[3]).default;
    const { pageCommandGroups } = jiti(path.join(root, 'src/lib/pages/commands.ts'));
    const pages = pageCommandGroups('/detail/project-7049/1');
    const empty = [];
    let state;
    function Harness({ groups, enabled }) {
      state = useHTC(groups, groups, false, enabled);
      return React.createElement('output', null, state.filterCommands.flatMap(group => group.commandLists).map(command => command.name).join('|'));
    }
    const container = document.getElementById('root');
    reactRoot = createRoot(container);
    const render = (groups, enabled = true) => React.act(async () => {
      reactRoot.render(React.createElement(Harness, { groups, enabled }));
    });
    const search = value => React.act(async () => state.onKeyChange({ target: { value } }));
    const names = () => state.filterCommands.flatMap(group => group.commandLists).map(command => command.name);

    await render(empty);
    await search('Link page');
    assert.ok(!names().includes('Link page'));
    await render(pages);
    assert.ok(names().includes('Link page'), 'late Pages commands must enter the active search');
    assert.equal(state.keyword, 'Link page');
    assert.equal(state.selectedCommand.key, 'linkPage');
    await render(empty);
    assert.ok(!names().includes('Link page'), 'revoked commands must leave active search');
    await render(pages);
    await search('');
    assert.deepEqual(names(), ['Go to Pages', 'New page', 'Link page']);
    assert.equal(state.selectedCommand, null, 'mobile empty search must not preselect');
    await render(empty, false);
    await search('Link page');
    await render(pages, false);
    assert.ok(!names().includes('Link page'), 'flag off preserves existing behavior');
    await search('Link pag');
    assert.ok(names().includes('Link page'), 'flag-off commands remain searchable by typing');
    await render(pages, true);
    assert.ok(names().includes('Link page'));
  } finally {
    if (reactRoot) await React.act(async () => reactRoot.unmount());
    for (const [file, previous] of previousModules) {
      if (previous === undefined) delete require.cache[file];
      else require.cache[file] = previous;
    }
    for (const [key, previous] of previousGlobals) {
      if (previous) Object.defineProperty(global, key, previous);
      else delete global[key];
    }
    dom.window.close();
  }
});
