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
  assert.match(chat, /cleanupEnabled \? "mb-\[16px\]" : "mb-3"/, 'chat groups use a 16px gap');
  assert.match(chat, /<div className=\{cleanupEnabled \? "px-2" : undefined\}>/, 'the chat list gains 16px padding behind the flag');
  assert.match(chat, /className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 scrollbar-thin/, 'the scroll container keeps its style-token line');
});

test('desktop composer puts the mic left of Send behind the flag', () => {
  const row = read('src/components/AI_CHAT/AiChatComposerActionRow.tsx');
  assert.match(row, new RegExp(`useFlag\\(${FLAG}\\)`));
  const cleanupStart = row.indexOf(') : cleanup ? (');
  const previousStart = row.indexOf(') : (\n          <>', cleanupStart);
  assert.ok(cleanupStart >= 0 && previousStart > cleanupStart, 'both branches exist');
  const cleanupBranch = row.slice(cleanupStart, previousStart);
  const order = ['{attachmentControl}', '{contextControl}', '{recorder}', '{streamControl}', '{sendControl}']
    .map((token) => cleanupBranch.indexOf(token));
  assert.ok(order.every((index) => index >= 0), 'the cleanup branch renders every control');
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'order is attach, context, mic, stream, Send');
  const previousBranch = row.slice(previousStart);
  const previousRecorder = previousBranch.indexOf('{recorder}');
  const previousContext = previousBranch.indexOf('{contextControl}');
  assert.ok(previousRecorder >= 0 && previousContext >= 0, 'the old branch renders both controls');
  assert.ok(
    previousRecorder < previousContext,
    'the old order survives behind the flag',
  );
});

test('the text Send button keeps the mobile arrow and an icon fallback', () => {
  const button = read('src/components/AI_CHAT/SendMessageButton.tsx');
  assert.match(button, /aria-label=\{queueMode \? "Queue message" : label \? label : "Send message"\}/);
  assert.match(button, /bg-shadcn-primary px-2 text-dense text-primary-foreground/, 'the labelled Send keeps primary action styling');
  assert.match(button, /label && \(!mobile \|\| textOnMobile\) \? \(\s*<span>\{label\}<\/span>/, 'desktop renders the text label');
  assert.match(button, /: mobile \? \(\s*<SendArrow size=\{22\} \/>/, 'mobile keeps the arrow button');
  assert.match(button, /<Send size=\{16\} strokeWidth=\{1\.75\} \/>/, 'callers without a label keep the paper plane');
  const composer = read('src/components/AI_CHAT/AI_Tiptap_Container.tsx');
  assert.match(composer, /label=\{plusLayout \|\| fullScreenCleanup \|\| chatCleanupEnabled \? "Send" : undefined\}/);
  assert.match(composer, /const fullScreenCleanup = cleanupFlag && \(pathname\?\.startsWith\("\/chat"\) \?\? false\)/);
});

test('the full-screen placeholder loses the shortcut text and the focus hint becomes a tooltip', () => {
  const tiptap = read('src/hooks/MultiPages/AIChat/useAiTiptap.ts');
  assert.match(tiptap, new RegExp(`useFlag\\(${FLAG}\\)`));
  assert.match(tiptap, /if \(fullScreenChatRef\.current\) return `Ask anything, @ for context`;/);
  assert.match(tiptap, /const pathname = usePathname\(\);\n  const chatCleanup = useFlag/);
  assert.match(tiptap, /const fullScreenChat = chatCleanup && \(pathname \?\? ""\)\.startsWith\("\/chat"\);/);
  assert.match(tiptap, /return `Focus with CTRL \+ Q, @ for context`;/, 'the docked chat keeps its placeholder');
  const composer = read('src/components/AI_CHAT/AI_Tiptap_Container.tsx');
  assert.match(composer, /`Focus · \$\{chatShortcutHint\("focus"\)\}`/);
});

test('dictation chrome is words-only: no device chevron, a Dictate tooltip and an elapsed pill', () => {
  const audio = read('src/components/RTE/Components/AudioButton.tsx');
  assert.match(audio, new RegExp(`useFlag\\(${FLAG}\\)`));
  assert.match(audio, /\{!isMobileView && !hideDevicePicker && \(/, 'the device chevron is hidden only where the surface asks');
  assert.match(audio, /text=\{"Dictate"\}/);
  assert.match(audio, /\{isAiChat && chatCleanup && \(\s*<span\s*data-ai-chat-recording-elapsed/);
  assert.match(audio, /const \[elapsedSeconds, setElapsedSeconds\] = useState\(0\);/);
  assert.match(audio, /\}, \[recording\]\);/, 'the timer ticks only while recording');
});
