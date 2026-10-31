const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const { createJiti } = require('jiti');

const root = path.resolve(__dirname, '..');

test('Ctrl+K board name search answers a lowercase query and a capitalized query the same way', async () => {
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
    const { boardCommands } = jiti(path.join(root, 'src/components/Modals/commands/HTC/domains/boardCommands.ts'));
    const groups = [{
      group: 'Boards',
      commandLists: boardCommands({
        projects: [
          { id: 11, title: 'Hypertask Prod' },
          { id: 12, title: 'Design' },
          { id: 13, title: 'Hypertask Staging' },
        ],
        currentProject: null,
        onMyTasks: false,
        myTasksViewsEnabled: false,
        myTasksFilterParityEnabled: false,
        myTasksScopesEnabled: false,
        columnArchiveEnabled: false,
      }),
    }];
    let state;
    function Harness() {
      state = useHTC(groups, groups, true, false);
      return React.createElement('output', null, state.filterCommands.flatMap(group => group.commandLists).map(command => command.key).join('|'));
    }
    const container = document.getElementById('root');
    reactRoot = createRoot(container);
    const search = value => React.act(async () => state.onKeyChange({ target: { value } }));
    const keys = () => state.filterCommands.flatMap(group => group.commandLists).map(command => command.key);
    const boardKeys = (list) => list.filter(key => key !== 'searchTasksHandover');
    await React.act(async () => { reactRoot.render(React.createElement(Harness)); });

    await search('hypertask prod');
    const lowercase = keys();
    assert.deepEqual(boardKeys(lowercase), ['gotoBoard-11']);

    await search('Hypertask Prod');
    assert.deepEqual(keys(), lowercase);

    await search('HYPERTASK PROD');
    assert.deepEqual(keys(), lowercase);

    await search('hypertask');
    assert.deepEqual(boardKeys(keys()), ['gotoBoard-11', 'gotoBoard-13'], 'ranking of the matching boards stays unchanged');
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
