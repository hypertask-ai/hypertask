const assert = require('node:assert/strict');
const test = require('node:test');
const React = require('react');
const { JSDOM } = require('jsdom');
const { loadModule } = require('./helpers/loadModule.cjs');
const flagKey = 'htpr-8139-comment-dictation-scroll';

async function mount(t, enabled) {
  const dom = new JSDOM('<!doctype html><div id="root"></div><input id="other"><textarea></textarea><div contenteditable="true" id="other-editor"></div>', { url: 'https://app.hypertask.ai' });
  const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, MutationObserver: dom.window.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(global, key));
    Object.defineProperty(global, key, { configurable: true, writable: true, value });
  }
  Object.defineProperty(dom.window.HTMLElement.prototype, 'isContentEditable', { get() { return this.getAttribute('contenteditable') === 'true'; } });
  const events = [];
  const userAtom = {};
  const MobileViewContext = React.createContext(false);
  const task = { id: 42 };
  const Recorder = () => React.createElement('div', { id: 'comment-input' },
    React.createElement('div', { contentEditable: true, suppressContentEditableWarning: true }, 'Existing draft'),
    ...['', '-improve'].map(suffix => React.createElement('button', { key: suffix, id: `create-comment-audio-button${suffix}`, onClick: event => { event.stopPropagation(); events.push(`record${suffix}`); } }, 'Mic')));
  const Component = loadModule('src/components/PageComponents/TaskDetail/CommentAndDescription/CommentContainer/NewCommentComponent.tsx', {
    'next/dynamic': { default: () => Recorder },
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
    '@/lib/snippets': { getTiptapEditorForMode: () => null, subscribeTiptapEditorReady: () => () => {}, OPEN_COMMENT_SNIPPET_EVENT: 'open-snippet' },
    '@/lib/mobileCommentViewport': {},
    '@/components/Global/mobileShellVisibility': { shouldShowMobileDock: () => false },
    'next/navigation': { usePathname: () => '/detail/project-7049/42' },
    '@/components/RTE/draftSync': { getTaskDraftContent: () => '' },
    '@/components/RTE/Components/AudioButton': { AudioButton: () => null },
    '@/hooks/useFlag': { useFlag: key => key === flagKey && enabled },
    '@/lib/flags/keys': { HTPR_8139_COMMENT_DICTATION_SCROLL_FLAG: flagKey },
  }).default;
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  await React.act(async () => root.render(React.createElement(Component)));
  document.getElementById('comment').scrollIntoView = options => events.push(['scroll', options]);
  t.after(async () => {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  });
  return { events, press: (keyCode, modifiers = {}) => document.dispatchEvent(new window.KeyboardEvent('keydown', { keyCode, ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true, ...modifiers })) };
}

for (const enabled of [true, false]) {
  test(`desktop dictation reveals the composer before either recorder, flag ${enabled}`, async t => {
    const view = await mount(t, enabled);
    for (const modifiers of [{}, { ctrlKey: false, metaKey: true }]) {
      for (const [key, recorder] of [[68, 'record'], [70, 'record-improve']]) {
        view.events.length = 0;
        assert.equal(view.press(key, modifiers), false);
        assert.deepEqual(view.events, enabled ? [['scroll', { block: 'center', behavior: 'instant' }], recorder] : [recorder]);
        assert.equal(document.querySelector('[contenteditable]').textContent, 'Existing draft');
      }
    }
  });
}

test('dictation shortcuts leave another focused field and the active comment alone', async t => {
  const view = await mount(t, true);
  for (const selector of ['input', 'textarea', '#other-editor', '#comment button']) {
    document.querySelector(selector).focus();
    view.press(68);
    view.press(70);
    assert.deepEqual(view.events, [], selector);
  }
  document.activeElement.blur();
  view.press(68, { shiftKey: false });
  view.press(65);
  assert.deepEqual(view.events, []);
  document.getElementById('create-comment-audio-button').remove();
  view.press(68);
  assert.deepEqual(view.events, []);
});

test('scroll restoration is a reversible Everyone bugfix', () => {
  const flag = loadModule('src/lib/flags/definitions/htpr-8139-comment-dictation-scroll.ts').default;
  assert.equal(flag.key, flagKey);
  assert.equal(flag.kind, 'bugfix');
  assert.equal(flag.defaultMode, 'EVERYONE');
});
