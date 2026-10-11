const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const originalCache = new Map(Object.entries(require.cache));
let flagEnabled = true;
const noop = () => {};
const context = {
  currentFocusedElement: null, editMode: null, setEditMode: noop,
  formValues: { title: '', description: '' }, handleChange: noop,
  setCurrentFocusedElement: noop, closeHandler: noop,
};
const stub = (file, exports) => {
  const filename = path.join(root, file);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
stub('src/hooks/useFlag.tsx', { useFlag: () => flagEnabled });
stub('src/lib/contexts/deviceContext.tsx', { useDeviceContext: () => false });
stub('src/hooks/Task Detail/useSetStickyHeight.ts', { default: () => ({ dynamicElementRef: React.createRef() }) });
stub('src/hooks/MultiPages/useClickOutside.ts', { default: noop });
stub('src/lib/tours/context/TourContext.tsx', { useTourContext: () => ({ endTour: noop }) });
stub('src/components/RTE/Components/AudioButton.tsx', { AudioButton: () => null });
stub('src/lib/contexts/Multipages/CreateTaskGloballyContexts/useContextCreateTaskModal.tsx', { useContextCreateTaskModal: () => context });
const jiti = require('jiti')(__filename, { interopDefault: true, jsx: true, alias: { '@': path.join(root, 'src') } });
const { MobileViewContext } = jiti(path.join(root, 'src/lib/contexts/mobileContext.tsx'));
const titleModule = jiti(path.join(root, 'src/components/Modals/CreateTaskGloballyModal/TaskTitleModal.tsx'));
const TaskTitleModal = titleModule.default ?? titleModule;
for (const filename of Object.keys(require.cache)) if (!originalCache.has(filename)) delete require.cache[filename];
for (const [filename, cached] of originalCache) require.cache[filename] = cached;

async function checkExpansion({ mobile, flag }) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://app.hypertask.ai' });
  const globals = ['window', 'document', 'navigator', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(global, key)]));
  Object.defineProperty(global, 'window', { configurable: true, value: dom.window });
  Object.defineProperty(global, 'document', { configurable: true, value: dom.window.document });
  Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator });
  global.requestAnimationFrame = () => 1;
  global.cancelAnimationFrame = noop;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLElement.prototype.attachEvent = noop;
  dom.window.HTMLElement.prototype.detachEvent = noop;
  // JSDOM has no layout: model only the browser measurement boundary. The real
  // component and real autosize hook must react to the visibility transition.
  Object.defineProperty(dom.window.HTMLTextAreaElement.prototype, 'scrollHeight', {
    get() { return this.closest('[data-title-wrapper]').style.display === 'none' ? 0 : (this.value.length > 40 ? 81 : 37); },
  });
  flagEnabled = flag;
  context.formValues.title = '';
  const reactRoot = createRoot(document.getElementById('root'));
  const render = visible => React.createElement(MobileViewContext.Provider, { value: mobile },
    React.createElement('div', { 'data-title-wrapper': true, style: { display: visible ? 'contents' : 'none' } },
      React.createElement(TaskTitleModal, { mobileCompact: mobile, mobileTitleVisible: visible })));
  try {
    await act(async () => reactRoot.render(render(false)));
    // Mirror the context rerender during modal initialization, attaching the legacy ref.
    await act(async () => reactRoot.render(render(false)));
    const textarea = document.querySelector('textarea');
    assert.equal(textarea.style.height, '0px', 'hidden mount measures zero');
    await act(async () => reactRoot.render(render(true)));
    if (mobile && flag) {
      assert.ok(parseFloat(textarea.style.height) >= 24, 'expanded phone title must regain a real height');
      context.formValues.title = 'A long title that wraps onto several lines on the phone screen';
      await act(async () => reactRoot.render(render(true)));
      assert.equal(textarea.style.height, '81px', 'typed titles still autosize');
      await act(async () => reactRoot.render(render(false)));
      await act(async () => reactRoot.render(render(true)));
      assert.equal(textarea.style.height, '81px', 'reopening restores the wrapped title height');
    } else {
      assert.equal(textarea.style.height, '0px', 'flag off and desktop retain the existing autosize triggers');
    }
  } finally {
    await act(async () => reactRoot.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
  }
}

test('phone New Task title remeasures when expanded after hidden mount', () => checkExpansion({ mobile: true, flag: true }));
test('phone New Task title flag off preserves existing behavior', () => checkExpansion({ mobile: true, flag: false }));
test('desktop New Task title retains existing measurement triggers', () => checkExpansion({ mobile: false, flag: true }));
