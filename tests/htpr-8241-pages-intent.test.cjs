const assert = require('node:assert/strict');
const test = require('node:test');
const { JSDOM } = require('jsdom');
const React = require('react');

const { loadModule } = require('./helpers/loadModule.cjs');

const intents = loadModule('src/lib/pages/intents.ts');
const PANEL = 'src/components/PageComponents/TaskDetail/CommentAndDescription/DescriptionContainer/DescriptionSubTasks/DescriptionPages.tsx';
const SURFACE = intents.taskSurface({ projectId: 15, uniqueIndex: 8241 });

function reset() {
  intents.forgetPagesIntent('link');
  intents.forgetPagesIntent('new');
}

function withDom() {
  const dom = new JSDOM("<div id='root'></div>", { url: 'https://app.hypertask.ai/detail/project-15/8241' });
  const previous = {
    window: global.window,
    document: global.document,
    Event: global.Event,
    IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT,
  };
  global.window = dom.window;
  global.document = dom.window.document;
  global.Event = dom.window.Event;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  return {
    dom,
    restore() {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete global[key];
        else global[key] = value;
      }
    },
  };
}

function loadPanel({ flags = { pages: true, standalone: true, hold: true }, created, requested, gate, taskRef } = {}) {
  const calls = created || [];
  const fetched = requested || [];
  const task = taskRef || { current: { id: 42, projectId: 15, uniqueIndex: 8241, title: 'Link page click' } };
  return loadModule(PANEL, {
    'date-fns': { formatDistanceToNow: () => 'now' },
    'lucide-react': { FileText: () => null, Plus: () => null },
    'next/link': { default: (props) => React.createElement('a', null, props.children) },
    'next/navigation': { useRouter: () => ({ push: () => {} }) },
    'react-hot-toast': { default: { error: () => {}, success: () => {}, promise: (value) => value } },
    '@/components/Modals/OptionPicker': {
      default: (props) => React.createElement('div', { 'data-picker': props.header }),
    },
    '@/hooks/useFlag': {
      useFlag: (key) => ({
        pages: flags.pages,
        standalone: flags.standalone,
        hold: flags.hold,
      })[key] ?? false,
    },
    '@/lib/flags/definitions/htpr-7309-pages-screens': { HTPR_7309_PAGES_SCREENS_FLAG: 'pages' },
    '@/lib/flags/definitions/htpr-7298-standalone-pages': { HTPR_7298_STANDALONE_PAGES_FLAG: 'standalone' },
    '@/lib/flags/definitions/htpr-8241-pages-intent-hold': { HTPR_8241_PAGES_INTENT_HOLD_FLAG: 'hold' },
    '@/lib/pages/intents': intents,
    '@/lib/pages/browser': {
      listBrowserPages: async () => {
        if (gate) await gate();
        fetched.push(true);
        return [{ id: 4, publicId: 'page-4', title: 'Notes', project: { id: 15, title: 'Board' }, updatedAt: null }];
      },
      changePageLink: async () => {},
    },
    '@/lib/configs/taskDetail.config': { taskDetailSpacing: { mobile: { descriptionContainer: '' } } },
    '@/lib/contexts/TaskDetail/TaskProvider': {
      useTaskContext: () => ({ editMode: 'view', currentTask: task.current }),
    },
    '@/lib/navigation/pageReturn': { createPageReturnHref: () => '/page/page-4' },
    '@/utils/undoActions/helperFuncs': { cn: (...parts) => parts.filter(Boolean).join(' ') },
    './TaskPagesContext': {
      useTaskPages: () => ({
        pages: [],
        loading: false,
        hasPages: false,
        createAndOpenPage: async () => {
          calls.push(true);
          return undefined;
        },
        refetch: () => {},
      }),
    },
  });
}

async function mountPanel(options) {
  const { createRoot } = require('react-dom/client');
  const Panel = loadPanel(options).default;
  const root = createRoot(document.getElementById('root'));
  await React.act(async () => root.render(React.createElement(Panel)));
  return {
    picker: () => document.querySelector('[data-picker]'),
    rerender: () => React.act(async () => root.render(React.createElement(Panel))),
    unmount: () => React.act(async () => root.unmount()),
  };
}

test('Link page held before the panel mounts opens the chooser on screen and only once', async () => {
  const dom = withDom();
  reset();
  try {
    assert.equal(intents.requestPagesIntent('link', SURFACE), true);
    const panel = await mountPanel();
    assert.equal(panel.picker()?.getAttribute('data-picker'), 'Link page to ticket');
    await panel.unmount();
    const again = await mountPanel();
    assert.equal(again.picker(), null);
    await again.unmount();
  } finally {
    dom.restore();
  }
});

test('a Link page click fired on another ticket never opens the chooser here', async () => {
  const dom = withDom();
  reset();
  try {
    const fetched = [];
    intents.requestPagesIntent('link', intents.taskSurface({ projectId: 15, uniqueIndex: 9001 }));
    const panel = await mountPanel({ requested: fetched });
    assert.equal(panel.picker(), null);
    assert.deepEqual(fetched, []);
    await panel.unmount();
  } finally {
    dom.restore();
  }
});

test('a Link page click heard while the panel is mounted still opens the chooser', async () => {
  const dom = withDom();
  reset();
  try {
    const panel = await mountPanel();
    assert.equal(panel.picker(), null);
    await React.act(async () => intents.requestPagesIntent('link', SURFACE));
    assert.equal(panel.picker()?.getAttribute('data-picker'), 'Link page to ticket');
    await panel.unmount();
  } finally {
    dom.restore();
  }
});

test('New page held before the panel mounts creates one page, and a remount creates none', async () => {
  const dom = withDom();
  reset();
  try {
    const created = [];
    intents.requestPagesIntent('new', SURFACE);
    const panel = await mountPanel({ created });
    assert.deepEqual(created, [true]);
    await panel.unmount();
    const again = await mountPanel({ created });
    assert.deepEqual(created, [true]);
    await again.unmount();
  } finally {
    dom.restore();
  }
});

test('with the flag off a held click is ignored, waiting for nothing to arrive', async () => {
  const dom = withDom();
  reset();
  try {
    const created = [];
    const fetched = [];
    intents.requestPagesIntent('link', SURFACE);
    intents.requestPagesIntent('new', SURFACE);
    const panel = await mountPanel({
      flags: { pages: true, standalone: true, hold: false },
      created,
      requested: fetched,
    });
    assert.equal(panel.picker(), null);
    assert.deepEqual(created, []);
    assert.deepEqual(fetched, []);
    await panel.unmount();
  } finally {
    dom.restore();
  }
});

test('a click held while the ticket is still unknown opens once the ticket arrives', async () => {
  const dom = withDom();
  reset();
  try {
    const taskRef = { current: null };
    intents.holdPagesIntent('link', SURFACE);
    const panel = await mountPanel({ taskRef });
    await panel.rerender();
    assert.equal(panel.picker(), null);
    taskRef.current = { id: 42, projectId: 15, uniqueIndex: 8241, title: 'Link page click' };
    await panel.rerender();
    assert.equal(panel.picker()?.getAttribute('data-picker'), 'Link page to ticket');
    await panel.unmount();
  } finally {
    dom.restore();
  }
});

test('a click whose chooser is cut off mid-load opens in the replacement panel and is not held twice', async () => {
  const dom = withDom();
  reset();
  try {
    let release;
    const first = await mountPanel({ gate: () => new Promise((resolve) => { release = resolve; }) });
    await React.act(async () => intents.requestPagesIntent('link', SURFACE));
    await first.unmount();
    const second = await mountPanel();
    assert.equal(second.picker()?.getAttribute('data-picker'), 'Link page to ticket');
    release();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(intents.claimPagesIntent('link', SURFACE), false);
    await second.unmount();
  } finally {
    dom.restore();
  }
});
