const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const ts = require('typescript');
const { createJiti } = require('jiti');
const icons = require('lucide-react');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
let enabled = false;
const flagPath = path.join(root, 'src/hooks/useFlag.tsx');
require.cache[flagPath] = { id: flagPath, filename: flagPath, loaded: true, exports: { useFlag: () => enabled } };
const jiti = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, fsCache: false, jsx: { runtime: 'automatic' } });
const { ChatScopeChip } = jiti(path.join(root, 'src/components/AI_CHAT/ChatScopeChip.tsx'));
const source = fs.readFileSync(path.join(root, 'src/components/AI_CHAT/AI_Tiptap_Container.tsx'), 'utf8');
const ast = ts.createSourceFile('chat.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let legacyButton;
function visit(node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'button' && node.getText(ast).includes('{scopeChip.label}')) legacyButton = node.getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(legacyButton, 'retain the production chat trigger while the flag is off');
const compiled = ts.transpileModule(`const Legacy = () => (${legacyButton});`, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS } }).outputText;
const renderLegacy = (scopeChip, mobile, isOpen) => {
  const Legacy = new Function('React', 'scopeChip', 'mobile', 'isOpen', 'setIsOpen', 'ListTodo', 'Layers', 'SquareKanban', 'ChevronDown', 'sharedShortcuts', 'chatShortcutHint', `${compiled}; return Legacy;`)(React, scopeChip, mobile, isOpen, () => {}, icons.ListTodo, icons.Layers, icons.SquareKanban, icons.ChevronDown, false, () => "");
  return renderToStaticMarkup(React.createElement(Legacy));
};

test('shared chat chip renders exactly the retained production icon, name, chevron and theme classes', () => {
  for (const kind of ['task', 'board', 'boards']) for (const mobile of [false, true]) for (const isOpen of [false, true]) {
    const props = { kind, label: 'QA Sandbox', title: 'QA Sandbox', mobile, isOpen, 'aria-haspopup': 'dialog', onClick() {} };
    const shared = new JSDOM(renderToStaticMarkup(React.createElement(ChatScopeChip, props)));
    const legacy = new JSDOM(renderLegacy(props, mobile, isOpen));
    assert.equal(shared.window.document.body.isEqualNode(legacy.window.document.body), true);
    shared.window.close();
    legacy.window.close();
  }
});

test('compose variant is runtime-gated and keeps the compact chat trigger with keyboard focus shade', () => {
  const props = { compose: true, kind: 'board', label: 'QA Sandbox', isOpen: false, 'aria-haspopup': 'dialog' };
  assert.equal(renderToStaticMarkup(React.createElement(ChatScopeChip, props)), '');
  enabled = true;
  const markup = renderToStaticMarkup(React.createElement(ChatScopeChip, props));
  assert.match(markup, /QA Sandbox/);
  assert.match(markup, /square-kanban/);
  assert.match(markup, /chevron-down/);
  assert.match(markup, /focus-visible:bg-hover-active/);
  assert.doesNotMatch(markup, /Context:/);
  enabled = false;
});
