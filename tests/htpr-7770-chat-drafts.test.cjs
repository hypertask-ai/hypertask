const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://app.hypertask.ai/chat' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle']) {
  Object.defineProperty(global, name, { configurable: true, value: dom.window[name] });
}
global.requestAnimationFrame = (callback) => setTimeout(callback, 0);
global.cancelAnimationFrame = clearTimeout;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { createRoot } = require('react-dom/client');
const { Editor } = require('@tiptap/core');
const StarterKit = require('@tiptap/starter-kit').default;
const { load } = require('./task-route-loader.cjs');
const { useAiChatDraft } = load('src/hooks/MultiPages/AIChat/useAiChatDraft.ts', {});

function fixture() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const editor = new Editor({ extensions: [StarterKit], content: '' });
  function Mount(props) { useAiChatDraft(props); return null; }
  const render = (sessionId, userId = 985, currentEditor = editor) => React.act(() => root.render(React.createElement(Mount, { editor: currentEditor, sessionId, userId })));
  return { editor, render, destroy: () => { React.act(() => root.unmount()); editor.destroy(); host.remove(); } };
}
test.beforeEach(() => window.sessionStorage.clear());

test('real composer keeps each session draft and rich formatting, without stealing focus', () => {
  const f = fixture();
  try {
    f.render('A');
    f.editor.commands.setContent('<p>Draft <strong>A</strong></p>');
    f.render('B');
    assert.equal(f.editor.getText(), '');
    f.editor.commands.setContent('<p>Draft B</p>');
    f.render('A');
    assert.equal(f.editor.getHTML(), '<p>Draft <strong>A</strong></p>');
    assert.equal(f.editor.isFocused, false);
    f.render('B');
    assert.equal(f.editor.getText(), 'Draft B');
  } finally { f.destroy(); }
});

test('reload restores the draft; sending or explicitly clearing does not revive it', () => {
  let f = fixture();
  f.render('A');
  f.editor.commands.setContent('<p>Unsent</p>');
  f.destroy();
  f = fixture();
  f.render('A');
  assert.equal(f.editor.getText(), 'Unsent');
  f.editor.commands.clearContent();
  f.destroy();
  f = fixture();
  try { f.render('A'); assert.equal(f.editor.getText(), ''); } finally { f.destroy(); }
});

test('reply rerenders and editor remounts do not clear typed text', () => {
  const f = fixture();
  const nextEditor = new Editor({ extensions: [StarterKit], content: '' });
  try {
    f.render('A');
    f.editor.commands.setContent('<p>Keep typing</p>');
    for (const event of ['stream', 'finish', 'error', 'stop']) {
      f.render('A');
      assert.equal(f.editor.getText(), 'Keep typing', event);
    }
    f.render('A', 985, nextEditor);
    assert.equal(nextEditor.getText(), 'Keep typing');
  } finally { f.destroy(); nextEditor.destroy(); }
});

test('user drafts never cross accounts or overwrite saved text during a session transition', () => {
  const f = fixture();
  try {
    f.render('A');
    f.editor.commands.setContent('<p>Private</p>');
    f.editor.commands.setContent('', { emitUpdate: false });
    f.render('B');
    f.render('A');
    assert.equal(f.editor.getText(), 'Private');
    f.render('A', 2343);
    assert.equal(f.editor.getText(), '');
    f.render('A', 985);
    assert.equal(f.editor.getText(), 'Private');
  } finally { f.destroy(); }
});

test('blocked browser storage still preserves drafts when switching sessions', () => {
  const original = Object.getOwnPropertyDescriptor(dom.window, 'sessionStorage');
  Object.defineProperty(dom.window, 'sessionStorage', { configurable: true, get() { throw new Error('Storage blocked'); } });
  const f = fixture();
  try {
    f.render('A');
    f.editor.commands.setContent('<p>In memory</p>');
    f.render('B');
    f.render('A');
    assert.equal(f.editor.getText(), 'In memory');
  } finally { f.destroy(); Object.defineProperty(dom.window, 'sessionStorage', original); }
});

test('text entered while session history loads belongs to the first resolved session', () => {
  const f = fixture();
  try {
    f.render(undefined);
    f.editor.commands.setContent('<p>Already typing</p>');
    f.render('A');
    assert.equal(f.editor.getText(), 'Already typing');
    f.render('B');
    f.render('A');
    assert.equal(f.editor.getText(), 'Already typing');
  } finally { f.destroy(); }
});

test('fresh typing during history loading takes priority over an older saved draft', () => {
  window.sessionStorage.setItem('ht:aiChatDraft:985:A', '<p>Older saved text</p>');
  const f = fixture();
  try {
    f.render(undefined);
    f.editor.commands.setContent('<p>Fresh typing</p>');
    f.render('A');
    assert.equal(f.editor.getText(), 'Fresh typing');
    f.render(undefined);
    f.editor.commands.setContent('<p>Typed while switching</p>');
    f.render('B');
    assert.equal(f.editor.getText(), 'Typed while switching');
    f.render('A');
    assert.equal(f.editor.getText(), 'Fresh typing');
  } finally { f.destroy(); }
});

test('undo cannot restore another chat or account draft', () => {
  const f = fixture();
  try {
    f.render('A');
    f.editor.commands.insertContent('Private A');
    assert.equal(f.editor.can().undo(), true);
    f.render('B');
    assert.equal(f.editor.can().undo(), false);
    f.editor.commands.undo();
    assert.equal(f.editor.getText(), '');
    f.editor.commands.insertContent('B text');
    f.editor.commands.undo();
    assert.equal(f.editor.getText(), '');
    f.render('A');
    assert.equal(f.editor.getText(), 'Private A');
    f.render('A', 2343);
    assert.equal(f.editor.can().undo(), false);
    f.editor.commands.undo();
    assert.equal(f.editor.getText(), '');
  } finally { f.destroy(); }
});

test('typing into an unresolved destination cannot carry the previous chat text or undo history', () => {
  const f = fixture();
  try {
    f.render('A');
    f.editor.commands.insertContent('Private A');
    f.render(undefined);
    assert.equal(f.editor.getText(), '');
    assert.equal(f.editor.can().undo(), false);
    f.editor.commands.insertContent('Only B');
    f.render('B');
    assert.equal(f.editor.getText(), 'Only B');
    f.render('A');
    assert.equal(f.editor.getText(), 'Private A');
  } finally { f.destroy(); }
});
