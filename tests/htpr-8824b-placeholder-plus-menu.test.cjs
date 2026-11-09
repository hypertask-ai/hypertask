const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadModule } = require('./helpers/loadModule.cjs');

const ONE_COMPOSER = 'one-composer';
const chain = () => ({ configure: () => ({}), extend: () => ({}), create: () => ({}) });

const loadTiptapHook = ({ pathname, oneComposer, chatCleanup = true, mobile = false }) => {
  const captured = {};
  const editor = { isDestroyed: false, state: { tr: {} }, view: { dispatch: () => {} } };
  const stubs = {
    react: { useRef: (initial) => ({ current: initial }), useContext: () => mobile, useEffect: () => {} },
    'next/navigation': { usePathname: () => pathname },
    '@/hooks/useFlag': { useFlag: (key) => (key === ONE_COMPOSER ? oneComposer : chatCleanup) },
    '@/lib/flags/keys': { HTPR_6906_AUTOCAP_UNDO_FLAG: 'a', LOCAL_WRITING_ASSISTANCE_FLAG: 'b' },
    '@/lib/flags/definitions/htpr-5908-retype-lowercase': { HTPR_5908_RETYPE_LOWERCASE_FLAG: 'c' },
    '@/lib/flags/definitions/htpr-8263-full-screen-chat-cleanup': { HTPR_8263_FULL_SCREEN_CHAT_CLEANUP_FLAG: 'd' },
    '@/lib/flags/definitions/htpr-8824-ai-chat-one-composer': { HTPR_8824_AI_CHAT_ONE_COMPOSER_FLAG: ONE_COMPOSER },
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
  useTiptapForAI({ contextCallback: () => {}, listening: false });
  return captured.placeholder();
};

test('HTPR-8824b sidebar and floating chat read Ask anything with the flag on', () => {
  assert.equal(loadTiptapHook({ pathname: '/project', oneComposer: true }), 'Ask anything, @ for context');
});

test('HTPR-8824b flag off keeps the Ctrl+Q placeholder outside full-screen', () => {
  assert.equal(loadTiptapHook({ pathname: '/project', oneComposer: false }), 'Focus with CTRL + Q, @ for context');
});

test('HTPR-8824b mobile keeps its short placeholder with the flag on', () => {
  assert.equal(loadTiptapHook({ pathname: '/project', oneComposer: true, mobile: true }), '@ for context');
});

const plusMenu = () => loadModule('src/components/Common/ComposerPlusActions.tsx', {
  'lucide-react': { Plus: () => null },
});

const render = (props) => {
  const { ComposerPlusActions } = plusMenu();
  return renderToStaticMarkup(React.createElement(ComposerPlusActions, { onAttach: () => {}, onAddContext: () => {}, ...props }));
};

test('HTPR-8824b plus menu renders the Add group with both actions', () => {
  const html = render({});
  assert.match(html, /<summary[^>]*aria-label="Add"/);
  assert.match(html, /role="group"[^>]*aria-label="Add"/);
  assert.match(html, /aria-label="Attach file"/);
  assert.match(html, /aria-label="Add context"/);
  assert.match(html, /<span class="text-text-light-gray">@<\/span>/);
});

test('HTPR-8824b plus menu shows the attach shortcut only when given', () => {
  assert.doesNotMatch(render({}), /Ctrl\+U/);
  assert.match(render({ attachShortcut: 'Ctrl+U' }), /<span class="text-text-light-gray">Ctrl\+U<\/span>/);
});

test('HTPR-8824b plus menu marks itself disabled', () => {
  const off = render({});
  assert.doesNotMatch(off, /aria-disabled="true"/);
  assert.doesNotMatch(off, /<button[^>]*disabled=""/);
  const on = render({ disabled: true });
  assert.match(on, /aria-disabled="true"/);
  assert.match(on, /<button[^>]*aria-label="Attach file"[^>]*disabled=""/);
  assert.match(on, /<button[^>]*aria-label="Add context"[^>]*disabled=""/);
});
