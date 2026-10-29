const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
const { JSDOM } = require('jsdom');
const { loadModule } = require('./helpers/loadModule.cjs');

async function withStarredQuery(run) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.hypertask.ai/starred' });
  const previous = { window: global.window, document: global.document, act: global.IS_REACT_ACT_ENVIRONMENT };
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const { useGetStarredContent } = loadModule('src/hooks/General/useGetStarredContent.ts', {
    '../Task Detail/useStarAndPin': { useStarAndPin: () => ({ getAllStarred: () => pending }) },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(document.getElementById('root'));
  let data;
  function StarredLists() {
    data = useGetStarredContent(985).data;
    return React.createElement('div', null,
      React.createElement('span', { id: 'tasks' }, data.starredTasks.map(item => item.task.title).join(', ')),
      React.createElement('span', { id: 'comments' }, data.pinnedComments.map(item => item.comment.text).join(', ')));
  }
  const render = () => React.act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(StarredLists))));
  try {
    await render();
    await run({ client, data: () => data, resolve, render });
  } finally {
    await React.act(async () => root.unmount());
    client.clear();
    Object.assign(global, { window: previous.window, document: previous.document, IS_REACT_ACT_ENVIRONMENT: previous.act });
    dom.window.close();
  }
}

test('a cold Starred visit supplies both lists before its request finishes', async () => {
  await withStarredQuery(async ({ data }) => {
    assert.deepEqual(data(), { starredTasks: [], pinnedComments: [] });
    assert.equal(document.getElementById('tasks').textContent, '');
    assert.equal(document.getElementById('comments').textContent, '');
  });
});

test('Starred replaces its empty lists with fetched tasks and comments', async () => {
  await withStarredQuery(async ({ client, data, resolve, render }) => {
    const saved = { starredTasks: [{ task: { title: 'Saved task' } }], pinnedComments: [{ comment: { text: 'Saved comment' } }] };
    await React.act(async () => {
      resolve(saved);
      await client.refetchQueries({ queryKey: ['Saved starred for [userId]:', 985] });
    });
    await render();
    assert.deepEqual(data(), saved);
    assert.equal(document.getElementById('tasks').textContent, 'Saved task');
    assert.equal(document.getElementById('comments').textContent, 'Saved comment');
  });
});
