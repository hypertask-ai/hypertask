const assert = require('node:assert/strict');
const test = require('node:test');

const { loadModule } = require('./helpers/loadModule.cjs');

const { getAllCommands } = loadModule('src/components/Modals/commands/HTC/AllCommands.ts');

const palettes = {
  board: getAllCommands({ context: 'Others' }),
  task: getAllCommands({ context: 'Task', taskOptions: { isKanban: false, isMyTasks: false } }),
};

const loadSearch = (synonymsEnabled) => {
  let filtered;
  const useHtc = loadModule('src/hooks/MultiPages/HTC/useHTC.tsx', {
    react: {
      useCallback: (callback) => callback,
      useEffect: () => {},
      useState: (initial) => [initial, (value) => { filtered = value; }],
    },
    '@/hooks/useFlag': { useFlag: () => synonymsEnabled },
    '@/lib/state': { useRecoilState: () => [{}] },
    '@/store': {},
    '@/utils/getCurrentUser': { getCurrentUserFromCookies: () => ({ id: 6 }) },
  });
  return (context, query) => {
    useHtc.default(palettes[context]).onKeyChange({ target: { value: query } });
    return filtered.flatMap((group) => group.commandLists);
  };
};

const withSynonyms = loadSearch(true);
const withoutSynonyms = loadSearch(false);
const topKey = (search, context, query) => search(context, query)[0]?.key;
const topCommandKey = (search, context, query) =>
  search(context, query).filter((command) => command.key !== 'searchTasksHandover')[0]?.key;

const GOALS = [
  ['dark mode', 'darkTheme', 'board'],
  ['make it dark', 'darkTheme', 'board'],
  ['light mode', 'lightTheme', 'board'],
  ['add someone to this board', 'inviteBoard', 'board'],
  ['who is working on this ticket', 'assignUser', 'task'],
  ['make a new ticket', 'createTask', 'board'],
  ['put this in the bin', 'deleteTask', 'task'],
  ['rename this section', 'renameColumn', 'board'],
  ['move it to another board', 'movetasktodifferentboard', 'task'],
  ['search my tickets', 'searchTask', 'board'],
  ['make this full screen', 'fullScreenAiChat', 'board'],
  ['let ai write the description', 'openAiTaskWriter', 'task'],
  ['hide finished tasks', 'toggleArchivedOnBoard', 'board'],
  ['assign this to me', 'assignToMe', 'task'],
  ['get rid of this board', 'deleteBoard', 'board'],
  ['kick someone off the board', 'manageMembers', 'board'],
  ['open the trash', 'GoToTrash', 'board'],
  ['set a deadline for this task', 'setDueDate', 'task'],
  ['repeat this every week', 'setRecurrence', 'task'],
  ['rename this project', 'renameBoard', 'board'],
];

test('twenty plain-language goals find the right command', () => {
  for (const [query, key, context] of GOALS) {
    assert.equal(topKey(withSynonyms, context, query), key, `goal "${query}" must find ${key}`);
  }
});

test('with the flag off the same goals find nothing or the wrong command', () => {
  for (const [query, key, context] of GOALS) {
    assert.notEqual(topKey(withoutSynonyms, context, query), key, `goal "${query}" must not resolve with the flag off`);
  }
});

test('existing name and keyword matches keep their result with the flag on', () => {
  for (const query of ['invite', 'due date', 'archive', 'copy', 'settings', 'move task']) {
    for (const context of Object.keys(palettes)) {
      const before = topCommandKey(withoutSynonyms, context, query);
      if (before === undefined) continue;
      assert.equal(topCommandKey(withSynonyms, context, query), before, `query "${query}" must keep its ${context} result`);
    }
  }
});

test('single-word keyword searches keep their results with the flag on', () => {
  for (const query of ['off', 'my']) {
    const before = topCommandKey(withoutSynonyms, 'board', query);
    assert.ok(before, `query "${query}" must match a command without the flag`);
    assert.equal(topCommandKey(withSynonyms, 'board', query), before, `query "${query}" must keep its result with the flag on`);
  }
});

test('a query of filler words alone lists no commands', () => {
  const results = withSynonyms('board', 'the a to');
  assert.deepEqual(results, []);
  assert.ok(withSynonyms('board', 'invite').length > 0);
});

test('matching runs on the shipped list and never calls the network', () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => {
    calls += 1;
    throw new Error('search must not call the network');
  };
  try {
    for (const [query, , context] of GOALS) withSynonyms(context, query);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(calls, 0);
});
