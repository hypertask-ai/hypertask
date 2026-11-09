const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { loadModule, findElement } = require('./helpers/loadModule.cjs');

const FLAG = 'htpr-8824-ai-chat-one-composer';

test('HTPR-8824 flag is an improvement that defaults to Everyone', () => {
  const { default: flag, HTPR_8824_AI_CHAT_ONE_COMPOSER_FLAG: key } = loadModule('src/lib/flags/definitions/htpr-8824-ai-chat-one-composer.ts');
  assert.equal(key, FLAG);
  assert.equal(flag.key, key);
  assert.equal(flag.kind, 'improvement');
  assert.equal(flag.defaultMode, 'EVERYONE');
  assert.equal(flag.releaseRisk.risk, 'small');
});

const oneComposer = () => loadModule('src/components/AI_CHAT/AiChatOneComposer.tsx', {
  '@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context': {
    useAiChatContext: () => ({ editor: null, isTyping: false, isRecording: false, isByokBlocked: false, toggleRecording: () => {}, audioTiptapCallback: () => {} }),
  },
  '@/lib/contexts/deviceContext': { useDeviceContext: () => false },
  '@/hooks/MultiPages/useGetAllTeamsMinimal': { useGetAllTeamsMinimal: () => ({ data: [] }) },
  '@/lib/state': { useRecoilState: () => [null, () => {}], useRecoilValue: () => ({ id: 6 }) },
  '@/store': {},
  '@/utils/aiChat/sortBoardsByRecent': { sortBoardsByRecent: (teams) => teams },
  '../RTE/Components/AudioButton': { default: (props) => React.createElement('i', { 'data-mic': props.id, 'data-primary': String(props.primaryMic), 'data-compact': String(props.compactListeningPill), 'data-no-picker': String(props.hideDevicePicker) }) },
  '@/components/Modals/OptionPicker': { default: () => null },
  './ChatScopeChip': { ChatScopeChip: ({ label }) => React.createElement('u', null, label) },
  './SendMessageButton': { SendMessageButton: ({ label, textButton }) => React.createElement('b', { 'data-text-button': String(textButton) }, label) },
  'lucide-react': { Plus: () => null },
});

test('HTPR-8824 the box row holds the plus menu, the Ctrl+J mic and text Send', () => {
  const { AiChatOneComposerRow } = oneComposer();
  const html = renderToStaticMarkup(React.createElement(AiChatOneComposerRow, { active: true, audioButtonId: 'mic-1', empty: false, hasText: true, streamControl: null }));
  const plus = html.indexOf('aria-label="Add"');
  const mic = html.indexOf('data-mic="mic-1"');
  const send = html.indexOf('>Send<');
  assert.ok(plus !== -1 && mic !== -1 && send !== -1);
  assert.ok(plus < mic && mic < send);
  assert.match(html, /aria-label="Attach file"/);
  assert.match(html, /aria-label="Add context"/);
  assert.match(html, /data-primary="true" data-compact="true" data-no-picker="true"/);
  assert.match(html, /data-text-button="true"/);
});

test('HTPR-8824 the pickers sit below the box: board on the left, model on the right', () => {
  const { AiChatOneComposerBelowRow } = oneComposer();
  const render = (fullScreen) => renderToStaticMarkup(React.createElement(AiChatOneComposerBelowRow, {
    fullScreen, dockedScope: React.createElement('s', null, 'docked scope'), modelPicker: React.createElement('em', null, 'model'), onRestoreFocus: () => {},
  }));
  const docked = render(false);
  assert.ok(docked.indexOf('docked scope') !== -1 && docked.indexOf('docked scope') < docked.indexOf('model'));
  const full = render(true);
  assert.doesNotMatch(full, /docked scope/);
  assert.ok(full.indexOf('All boards') !== -1 && full.indexOf('All boards') < full.indexOf('model'));
  assert.match(full, /data-ai-chat-full-screen-scope/);
});

function container({ on, mobile = false, pathname = '/project' }) {
  const noop = () => {};
  const chat = { editor: { getHTML: () => '', getText: () => '' }, isTyping: false, isRecording: false, queuedMessages: [], contextList: [], fileItems: [], toggleRecording: noop, audioTiptapCallback: noop };
  const mocks = Object.fromEntries(['../Global/ModelSelectorDropdown', '../Common/Tooltip', '@/components/Modals/OptionPicker', '@/lib/configs/aiTaskWriter.config', '@/lib/controlledComposerEditor', 'lucide-react', '../Common/AttachmentsUpload/ImageGalleryView', '@/lib/contexts/deviceContext', '@/store', '@/hooks/MultiPages/useGetAllTeamsMinimal', '@/utils/aiChat/sortBoardsByRecent', '@/utils/aiChat/extractPastedImageFiles', './AttachmentButton', './AiComposerTextarea', './ChatScopeChip', './SendMessageButton', '@/components/Common/QueuedMessagesStrip', 'react-hot-toast', '@/utils/aiChat/focusRequestWindow', '@/hooks/MultiPages/AIChat/useDockedChatScope', '../RTE/Components/AudioButton'].map((specifier) => [specifier, {}]));
  const { AI_Tiptap_Container } = loadModule('src/components/AI_CHAT/AI_Tiptap_Container.tsx', {
    ...mocks,
    react: { useCallback: (callback) => callback, useRef: (current) => ({ current }), useEffect: noop, useContext: () => mobile, useMemo: (callback) => callback(), useState: (value) => [value, noop], useId: () => 'general' },
    '@tiptap/react': { useEditorState: () => true },
    '@/styles/tiptap.module.scss': { default: {} },
    '@/lib/contexts/Multipages/AI_Agent/AI_Agent_Chat_Context': { useAiChatContext: () => chat },
    '@/lib/contexts/mobileContext': { MobileViewContext: {} },
    './AiChatComposerActionRow': { AiChatComposerActionRow: 'ActionRow' },
    './AiChatOneComposer': { AiChatOneComposerRow: 'OneRow', AiChatOneComposerBelowRow: 'BelowRow' },
    'next/navigation': { usePathname: () => pathname },
    '@/lib/state': { useRecoilState: () => [null, noop] },
    '@/hooks/useFlag': { useFlag: (key) => key === FLAG && on },
  });
  return AI_Tiptap_Container({});
}

test('HTPR-8824 one container renders the one composer rows on the sidebar, floating and full-screen surfaces', () => {
  for (const pathname of ['/project', '/chat']) {
    const tree = container({ on: true, pathname });
    assert.equal(findElement(tree, 'ActionRow'), undefined, `${pathname}: the old row is gone`);
    const row = findElement(tree, 'OneRow');
    assert.equal(row.props.audioButtonId, 'ai-chat-audio-button-general');
    assert.equal(row.props.empty, true);
    assert.equal(findElement(tree, 'BelowRow').props.fullScreen, pathname === '/chat');
  }
});

test('HTPR-8824 flag off and mobile keep the previous composer row', () => {
  for (const options of [{ on: false }, { on: true, mobile: true }]) {
    const tree = container(options);
    assert.ok(findElement(tree, 'ActionRow'));
    assert.equal(findElement(tree, 'OneRow'), undefined);
    assert.equal(findElement(tree, 'BelowRow'), undefined);
  }
});
