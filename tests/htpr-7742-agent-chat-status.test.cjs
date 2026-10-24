const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { createJiti } = require('jiti');
const root = path.resolve(__dirname, '..');
let enabled;
const stub = (file, exports) => { const id = path.join(root, file); require.cache[id] = { id, filename: id, loaded: true, exports }; };
const Empty = () => null;
const icons = require.resolve('lucide-react');
require.cache[icons] = { id: icons, filename: icons, loaded: true, exports: { ArrowLeft: Empty, ChevronLeft: Empty, ChevronRight: Empty, Info: Empty } };
stub('src/hooks/useFlag.tsx', { useFlag: (key) => { assert.equal(key, 'htpr-7742-agent-chat-all'); return enabled; } });
stub('src/components/Agents/AgentAvatar.tsx', { default: Empty });
stub('src/components/AI_CHAT/AI_Tiptap_Container.tsx', { AI_Tiptap_Container: Empty });
stub('src/components/AI_CHAT/TypingIndicator.tsx', { TypingIndicator: Empty });
stub('src/components/RTE/Components/AudioButton.tsx', { AudioButton: Empty });
stub('src/lib/configs/general.config.ts', { MOBILE_TARGET: '' });
stub('src/utils/undoActions/helperFuncs.ts', { cn: (...args) => args.filter(Boolean).join(' ') });
stub('src/app/agents/chat/AgentChatFeedItems.tsx', { chatStatusText: () => '', emptyFeedText: () => '', ActivityGroup: Empty, FeedFilter: Empty, MessageBubble: Empty, ScrollToBottomButton: Empty });
const load = createJiti(__filename, { alias: { '@': path.join(root, 'src') }, interopDefault: true, fsCache: false, jsx: { runtime: 'automatic' } });
const { AgentChatPane } = load(path.join(root, 'src/app/agents/chat/AgentChatPane.tsx'));
const definition = load(path.join(root, 'src/lib/flags/definitions/htpr-7742-agent-chat-all.ts'));
function render(mode, notice, on) {
  enabled = on;
  return renderToStaticMarkup(React.createElement(AgentChatPane, {
    embedded: true, selectedAgent: { id: 'agent-1', displayName: 'Agent' }, isExternal: true,
    deliveryMode: mode, deliveryNotice: notice, draft: '', messages: [], visibleFeed: [], queuedMessages: [],
  }));
}
for (const mode of ['webhook', 'polling', null]) {
  test(`existing sidebar notice renders honest ${mode ?? 'offline'} status when on`, () => {
    const markup = render(mode, mode === null, true);
    assert.ok(markup.includes(`<p class="mb-2 text-meta text-text-light-gray">${mode ? 'Online' : 'Reads when it next runs'}</p>`));
    assert.ok(!markup.includes('runtime has not enabled'));
  });
}
test('flag off preserves original notice and does not introduce an online notice', () => {
  assert.match(render(null, true, false), /This agent&#x27;s runtime has not enabled chat yet\./);
  assert.doesNotMatch(render('webhook', false, false), /Online|Reads when it next runs|runtime has not enabled/);
});
test('ticket flag definition starts on Owner and QA with access risk and uses direct definition imports without registry edits', () => {
  assert.equal(definition.default.key, 'htpr-7742-agent-chat-all');
  assert.equal(definition.default.defaultMode, 'OWNER_AND_QA');
  assert.equal(definition.default.releaseRisk.highRisk, 'access');
  assert.equal(definition.default.kind, 'improvement');
  assert.ok(definition.default.releaseRisk.reason);
  const changed = cp.execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  assert.ok(!changed.some((file) => /^src\/lib\/flags\/(keys\.ts|definitions\.ts|definitions\/index\.generated\.ts)$/.test(file)));
});
test('changed source parses and contains no added explanatory comments or new UI elements/classes', () => {
  const tracked = cp.execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  const untracked = cp.execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  for (const file of [...new Set([...tracked, ...untracked])].filter((file) => file.startsWith('src/') && /\.tsx?$/.test(file))) {
    const result = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { fileName: file, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
    assert.deepEqual(result.diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')), [], file);
  }
  const diff = cp.execFileSync('git', ['diff', '--', 'src'], { cwd: root, encoding: 'utf8' });
  assert.doesNotMatch(diff, /^\+(?!\+).*?(\/\/|\/\*)/m);
  const ui = cp.execFileSync('git', ['diff', '--', 'src/app/agents/chat/AgentChatPane.tsx'], { cwd: root, encoding: 'utf8' });
  assert.doesNotMatch(ui, /^\+(?!\+).*?(className=|<[a-z])/m);
  assert.throws(() => assert.doesNotMatch('+  // explanatory comment', /^\+(?!\+).*?(\/\/|\/\*)/m));
  assert.throws(() => assert.doesNotMatch('+ <div className="new"/>', /^\+(?!\+).*?(className=|<[a-z])/m));
});
test('user docs explain inbox/reply, original sessions, ordinary heartbeat and MCP inbox freshness', () => {
  const docs = fs.readFileSync(path.join(root, 'docs/mcp-tools.md'), 'utf8');
  for (const text of ['hypertask_chat_inbox', 'hypertask_chat_reply', 'original sidebar conversation', '/api/mcp/chat/heartbeat', 'once per 30 seconds', 'MCP-only agent stays Online', 'unanswered=true']) assert.ok(docs.includes(text), text);
});
