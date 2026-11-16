const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const { loadModule } = require('./helpers/loadModule.cjs');

const FLAG = 'htpr-6555-idle-comment-mic';

async function mount(t, mobile) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://app.hypertask.ai/detail/project-7049/42' });
  const previous = new Map();
  const globals = {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    MutationObserver: dom.window.MutationObserver,
    IS_REACT_ACT_ENVIRONMENT: true,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
  };
  for (const [key, value] of Object.entries(globals)) {
    previous.set(key, Object.getOwnPropertyDescriptor(global, key));
    Object.defineProperty(global, key, { configurable: true, writable: true, value });
  }
  dom.window.requestAnimationFrame = () => 1;
  dom.window.cancelAnimationFrame = () => {};
  Object.defineProperty(dom.window.HTMLElement.prototype, 'isContentEditable', { get() { return this.getAttribute('contenteditable') === 'true'; } });
  const flagReads = [];
  const userAtom = {};
  const MobileViewContext = React.createContext(mobile);
  const task = { id: 42 };
  const Component = loadModule('src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/NewCommentComponent.tsx', {
    'next/dynamic': { default: () => () => null },
    '@/models/model': {},
    '@/lib/state': { useRecoilState: atom => React.useState(atom === userAtom ? { id: 985 } : false) },
    '@/store': { currentUserAtom: userAtom, mobileCommentComposerOpenAtom: {} },
    '@/hooks/Task Detail/CommentAndDescriptionHooks/useSaveContent': { default: () => ({ redirectAPI() {} }) },
    '@/lib/contexts/mobileContext': { MobileViewContext },
    '@/lib/contexts/TaskDetail/TaskProvider': { useTaskContext: () => ({ parsedTask: JSON.stringify(task), currentTask: task, setCurrentId() {}, forceOpenEdit() {}, setLoading() {}, draftsFromTQ: [] }) },
    '@/lib/contexts/TaskDetail/DescriptionProvider': { useDescriptionAndCommentsContext: () => ({}) },
    'lucide-react': { Check: () => null },
    '@/components/Global/MobileCreateTaskButton': { default: () => null },
    '@/lib/IconsLocal': { ArchiveNotificationIcon: () => null },
    '@/hooks/Task Detail/useArchiveAndNavigate': { default: () => ({}) },
    '../../TaskOptions/RemindMeTaskDetail': { default: () => null },
    '@/lib/snippets': { getTiptapEditorForMode: () => null, subscribeTiptapEditorReady: () => () => {}, openSnippetPicker: () => {}, OPEN_COMMENT_SNIPPET_EVENT: 'open-snippet' },
    '@/lib/mobileCommentViewport': { getMobileCommentViewportGeometry: () => ({ bottomInset: 0, autoEditorMaxHeight: 400, renderedEditorHeight: 40, manualEditorMaxHeight: 500 }), MOBILE_COMMENT_MIN_EDITOR_HEIGHT: 80 },
    '@/components/Global/mobileShellVisibility': { shouldShowMobileDock: () => false },
    'next/navigation': { usePathname: () => '/detail/project-7049/42' },
    '@/components/RTE/draftSync': { getTaskDraftContent: () => '' },
    '@/components/RTE/Components/AudioButton': { AudioButton: () => React.createElement('button', { id: 'create-comment-audio-button' }, 'Mic') },
    '@/hooks/useFlag': { useFlag: key => { flagReads.push(key); return false; } },
    '@/lib/flags/keys': { HTPR_7379_INBOX_ACTIONS_NO_OUTLINE_FLAG: 'htpr-7379-inbox-actions-no-outline', HTPR_8139_COMMENT_DICTATION_SCROLL_FLAG: 'htpr-8139-comment-dictation-scroll' },
  }).default;
  const root = createRoot(document.getElementById('root'));
  await React.act(async () => root.render(React.createElement(Component)));
  t.after(async () => {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  });
  return { flagReads };
}

test('the mobile comment bar keeps its dictation microphone without a safety switch', async t => {
  const { flagReads } = await mount(t, true);
  assert.ok(document.getElementById('create-comment-audio-button'));
  assert.equal(flagReads.includes(FLAG), false);
});
