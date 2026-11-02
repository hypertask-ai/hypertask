const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { loadModule } = require('./helpers/loadModule.cjs');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const FLAG = 'HTPR_8263_FULL_SCREEN_CHAT_CLEANUP_FLAG';

test('HTPR-8263 full-screen chat cleanup is a reversible improvement for everyone', () => {
  const { default: flag } = loadModule('src/lib/flags/definitions/htpr-8263-full-screen-chat-cleanup.ts');
  assert.equal(flag.key, 'htpr-8263-full-screen-chat-cleanup');
  assert.equal(flag.kind, 'improvement');
  assert.equal(flag.defaultMode, 'EVERYONE');
  assert.equal(flag.releaseRisk.risk, 'small');
  assert.equal(flag.releaseRisk.highRisk, undefined);
});

test('the full-screen header drops the sparkle only behind the flag', () => {
  const chat = read('src/app/chat/Chat.tsx');
  assert.match(chat, new RegExp(`useFlag\\(${FLAG}\\)`));
  assert.match(chat, /\{!cleanupEnabled && \(\s*<Sparkles/, 'the sparkle renders only when the flag is off');
  assert.match(chat, /cleanupEnabled \? "h-\[29px\] px-1" : "px-3 py-2"/, 'chat rows use the 29px row height');
  assert.match(chat, /cleanupEnabled \? "space-y-2" : "space-y-0\.5"/, 'chat rows use an 8px gap');
  assert.match(chat, /cleanupEnabled \? "mb-4" : "mb-3"/, 'chat groups use a 16px gap');
  assert.match(chat, /cleanupEnabled \? "px-4" : "px-2"/, 'the chat list uses 16px padding');
});

test('desktop composer puts the mic left of Send behind the flag', () => {
  const row = read('src/components/AI_CHAT/AiChatComposerActionRow.tsx');
  assert.match(row, new RegExp(`useFlag\\(${FLAG}\\)`));
  const cleanupBranch = row.slice(row.indexOf(') : cleanup ? ('), row.indexOf(') : (\n          <>'));
  const order = ['{attachmentControl}', '{contextControl}', '{recorder}', '{streamControl}', '{sendControl}']
    .map((token) => cleanupBranch.indexOf(token));
  assert.ok(order.every((index) => index >= 0), 'the cleanup branch renders every control');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'order is attach, context, mic, stream, Send');
  const previousBranch = row.slice(row.indexOf(') : (\n          <>'));
  assert.ok(
    previousBranch.indexOf('{recorder}') < previousBranch.indexOf('{contextControl}'),
    'the old order survives behind the flag',
  );
});

test('the text Send button keeps the mobile arrow and an icon fallback', () => {
  const button = read('src/components/AI_CHAT/SendMessageButton.tsx');
  assert.match(button, new RegExp(`useFlag\\(${FLAG}\\)`));
  assert.match(button, /const textLabel = cleanup \? label : undefined;/);
  assert.match(button, /\) : textLabel \? \(\s*<span>\{textLabel\}<\/span>/, 'desktop renders the text label');
  assert.match(button, /\{mobile \? \(\s*<SendArrow size=\{22\} \/>/, 'mobile keeps the arrow button');
  assert.match(button, /<Send size=\{16\} strokeWidth=\{1\.75\} \/>/, 'callers without a label keep the paper plane');
  const composer = read('src/components/AI_CHAT/AI_Tiptap_Container.tsx');
  assert.equal((composer.match(/label=\{fullScreenCleanup \? "Send" : undefined\}/g) ?? []).length, 2);
  assert.match(composer, /const fullScreenCleanup = cleanupFlag && \(pathname\?\.startsWith\("\/chat"\) \?\? false\)/);
});

test('the full-screen placeholder loses the shortcut text and the focus hint becomes a tooltip', () => {
  const tiptap = read('src/hooks/MultiPages/AIChat/useAiTiptap.ts');
  assert.match(tiptap, new RegExp(`useFlag\\(${FLAG}\\)`));
  assert.match(tiptap, /if \(fullScreenChatRef\.current\) return `Ask anything, @ for context`;/);
  assert.match(tiptap, /chatCleanup && \(usePathname\(\) \?\? ""\)\.startsWith\("\/chat"\)/);
  assert.match(tiptap, /return `Focus with CTRL \+ Q, @ for context`;/, 'the docked chat keeps its placeholder');
  const composer = read('src/components/AI_CHAT/AI_Tiptap_Container.tsx');
  assert.match(composer, /`Focus · \$\{chatShortcutHint\("focus"\)\}`/);
});

test('dictation chrome is words-only: no device chevron, a Dictate tooltip and an elapsed pill', () => {
  const audio = read('src/components/RTE/Components/AudioButton.tsx');
  assert.match(audio, new RegExp(`useFlag\\(${FLAG}\\)`));
  assert.match(audio, /const aiChatCleanup = isAiChat && chatCleanup;/);
  assert.match(audio, /\{!isMobileView && !aiChatCleanup && \(/, 'the chat mic has no device chevron');
  assert.match(audio, /text=\{"Dictate"\}/);
  assert.match(audio, /\{aiChatCleanup && \(\s*<span\s*data-ai-chat-recording-elapsed/);
  assert.match(audio, /const \[elapsedSeconds, setElapsedSeconds\] = useState\(0\);/);
  assert.match(audio, /\}, \[recording\]\);/, 'the timer ticks only while recording');
});
