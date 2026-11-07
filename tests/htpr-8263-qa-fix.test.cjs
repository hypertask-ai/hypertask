const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadModule } = require('./helpers/loadModule.cjs');

const chain = () => ({ configure: () => ({}), extend: () => ({}), create: () => ({}) });

const loadTiptapHook = ({ pathname, flagOn }) => {
  const captured = { effects: [], dispatches: 0 };
  const editor = {
    isDestroyed: false,
    state: { tr: {} },
    view: { dispatch: () => { captured.dispatches += 1; } },
  };
  const stubs = {
    react: { useRef: (initial) => ({ current: initial }), useContext: () => false, useEffect: (fn) => captured.effects.push(fn) },
    'next/navigation': { usePathname: () => pathname },
    '@/hooks/useFlag': { useFlag: () => flagOn },
    '@/lib/flags/keys': { HTPR_6906_AUTOCAP_UNDO_FLAG: 'a', LOCAL_WRITING_ASSISTANCE_FLAG: 'b' },
    '@/lib/flags/definitions/htpr-5908-retype-lowercase': { HTPR_5908_RETYPE_LOWERCASE_FLAG: 'c' },
    '@/lib/flags/definitions/htpr-8263-full-screen-chat-cleanup': { HTPR_8263_FULL_SCREEN_CHAT_CLEANUP_FLAG: 'd' },
    '@/lib/contexts/mobileContext': { MobileViewContext: {} },
    '@/components/RTE/Components/AI_Chat/MentionData': { createMentionData: () => ({}) },
    '@/components/RTE/Extensions/LinkableMention': { LinkableMention: chain() },
    '@/components/RTE/Extensions/SlashCommands/SlashCommands': { __esModule: true, default: () => ({}) },
    '@/components/RTE/writingAssistance': { writingAssistanceEditorProps: {}, LocalWritingAssistance: chain() },
    '@/components/RTE/Extensions/SafeSplitBlock': { SafeSplitBlock: {} },
    '@/styles/tiptap.module.scss': { __esModule: true, default: {} },
    '@tiptap/extension-highlight': { __esModule: true, default: chain() },
    '@tiptap/extension-ordered-list': { __esModule: true, default: chain() },
    '@tiptap/extension-task-item': { __esModule: true, default: chain() },
    '@tiptap/extension-task-list': { __esModule: true, default: chain() },
    '@tiptap/extension-underline': { __esModule: true, default: chain() },
    '@tiptap/extension-gapcursor': { __esModule: true, default: {} },
    '@tiptap/starter-kit': { __esModule: true, default: chain() },
    '@tiptap/extension-placeholder': {
      __esModule: true,
      default: { configure: (options) => { captured.placeholder = options.placeholder; return {}; } },
    },
    '@tiptap/react': { Extension: chain(), useEditor: () => editor },
  };
  const { default: useTiptapForAI } = loadModule('src/hooks/MultiPages/AIChat/useAiTiptap.ts', stubs);
  return { useTiptapForAI, captured };
};

test('full-screen placeholder reads Listening... while dictating and redraws on change', () => {
  const idle = loadTiptapHook({ pathname: '/chat/1', flagOn: true });
  idle.useTiptapForAI({ contextCallback: () => {}, listening: false });
  assert.equal(idle.captured.placeholder(), 'Ask anything, @ for context');

  const live = loadTiptapHook({ pathname: '/chat/1', flagOn: true });
  live.useTiptapForAI({ contextCallback: () => {}, listening: true });
  assert.equal(live.captured.placeholder(), 'Listening...');
  live.captured.effects.forEach((effect) => effect());
  assert.equal(live.captured.dispatches, 1);
});

test('docked chat and flag-off keep their placeholder while dictating', () => {
  const docked = loadTiptapHook({ pathname: '/tasks', flagOn: true });
  docked.useTiptapForAI({ contextCallback: () => {}, listening: true });
  assert.equal(docked.captured.placeholder(), 'Focus with CTRL + Q, @ for context');
  docked.captured.effects.forEach((effect) => effect());
  assert.equal(docked.captured.dispatches, 0);

  const off = loadTiptapHook({ pathname: '/chat/1', flagOn: false });
  off.useTiptapForAI({ contextCallback: () => {}, listening: true });
  assert.equal(off.captured.placeholder(), 'Focus with CTRL + Q, @ for context');
});

test('the labelled Send button renders with a 4px corner and no 6px class', () => {
  const { SendMessageButton } = loadModule('src/components/AI_CHAT/SendMessageButton.tsx', {
    '../Common/Tooltip': { __esModule: true, default: () => null },
  });
  for (const textOnMobile of [false, true]) {
    const html = renderToStaticMarkup(
      React.createElement(SendMessageButton, { disabled: false, mobile: false, label: 'Send', textOnMobile, onClick: () => {} }),
    );
    assert.match(html, /rounded-\[4px\]/);
    assert.doesNotMatch(html, /class="[^"]*\srounded\s/);
  }
});
