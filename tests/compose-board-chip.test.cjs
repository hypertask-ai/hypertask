const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { createJiti } = require('jiti');
const root = path.resolve(__dirname, '..');
const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, fsCache: false, jsx: { runtime: 'automatic' } });
const { ChatScopeChip } = jiti(path.join(root, 'src/components/AI_CHAT/ChatScopeChip.tsx'));

test('chat scope chip renders the icon, name, chevron and theme classes', () => {
  for (const kind of ['task', 'board', 'boards']) for (const isOpen of [false, true]) {
    const markup = renderToStaticMarkup(React.createElement(ChatScopeChip, { kind, label: 'QA Sandbox', isOpen, 'aria-haspopup': 'dialog' }));
    assert.match(markup, /QA Sandbox/);
    assert.match(markup, /chevron-down/);
    assert.match(markup, kind === 'task' ? /list-todo/ : kind === 'boards' ? /layers/ : /square-kanban/);
    assert.equal(markup.includes('rotate-180'), isOpen);
  }
});

test('compose variant keeps the compact chat trigger with keyboard focus shade', () => {
  const props = { compose: true, kind: 'board', label: 'QA Sandbox', isOpen: false, 'aria-haspopup': 'dialog' };
  const markup = renderToStaticMarkup(React.createElement(ChatScopeChip, props));
  assert.match(markup, /QA Sandbox/);
  assert.match(markup, /square-kanban/);
  assert.match(markup, /chevron-down/);
  assert.match(markup, /focus-visible:bg-hover-active/);
  assert.doesNotMatch(markup, /Context:/);
});
