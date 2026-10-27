const assert = require('node:assert/strict');
const { test } = require('node:test');
const React = require('react');
const { JSDOM } = require('jsdom');
const { load } = require('./helpers/agent-connection.cjs');

const boards = Object.freeze([
  { id: 1, title: 'Zulu' },
  { id: 2, title: 'Software Factory' },
  { id: 3, title: 'Alpha' },
  { id: 4, title: 'Hypertask Product' },
  { id: 5, title: 'Beta' },
].map(Object.freeze));

async function picker({ enabled = true, compose = true, history = { 2: 200, 4: 100 } } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.hypertask.ai/my-tasks' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  const chosen = [];
  const closed = [];
  const block = ({ children }) => React.createElement('div', null, children);
  const { default: Picker } = load('src/components/Modals/MoveTaskToBoard/index.tsx', {
    '@/components/Common/CommonModalComponents': {
      ModalContainerCustom: block,
      ModalHeaderComp: () => null,
      ModalInput: props => React.createElement('input', props),
    },
    '@/hooks/MultiPages/useGetAllProjectsMinimal': { useGetAllProjectsMinimal: () => ({ data: boards, isLoading: false }) },
    '@/hooks/General/useHandleMouse': { __esModule: true, default: () => ({ handleMouseEnter() {}, handleMouseLeave() {}, handleMouseMove() {}, elRef: { current: null } }) },
    '@/store': { inViewObjectAtom: 'inView', lastUsedBoardsAtom: 'history' },
    '@/lib/state': { useRecoilState: () => [{}, () => {}], useRecoilValue: () => history },
    '@/utils/helperFunctions/multiPages': { returnActiveOrDefaultColumnSections: () => [] },
    '@/lib/constants/APIRouteConstants': { moveTaskToDifferentBoardAPI: '/unused' },
    '@/hooks/useFlag': { useFlag: key => key === 'order' ? enabled : true },
    '@/lib/flags/keys': { HTPR_7053_COMPOSE_BOARD_CHIP_FLAG: 'chip', HTPR_8014_COMPOSE_BOARD_ORDER_FLAG: 'order' },
    'next/navigation': { usePathname: () => '/my-tasks', useRouter: () => ({}) },
    formik: { useFormik: () => ({ values: {}, setValues() {} }) },
    reactstrap: { ModalBody: block },
  });
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  await React.act(async () => root.render(React.createElement(Picker, {
    boards, closeHTC: () => closed.push(true), ...(compose ? { onSelectBoard: id => chosen.push(id) } : {}),
  })));
  return {
    rows: () => [...document.querySelectorAll('[id^="command-"]')].map(row => row.textContent.trim()),
    chosen, closed,
    async key(key) { await React.act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true }))); },
    async search(value) {
      const input = document.querySelector('input');
      await React.act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, value);
        input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    },
    async click(index) { await React.act(async () => document.getElementById(`command-${index}`).click()); },
    async cleanup() { await React.act(async () => root.unmount()); dom.window.close(); },
  };
}

test('compose picker uses navigation MRU, alphabetic ties, and Enter selects the visible row', async () => {
  const p = await picker();
  try {
    assert.deepEqual(p.rows(), ['Software Factory', 'Hypertask Product', 'Alpha', 'Beta', 'Zulu']);
    await p.search('hypertask');
    assert.deepEqual(p.rows(), ['Hypertask Product']);
    await p.key('Enter');
    assert.deepEqual(p.chosen, [4]);
    assert.deepEqual(boards.map(board => board.id), [1, 2, 3, 4, 5]);
  } finally { await p.cleanup(); }
});

test('equal usage and absent history sort A–Z; click selects the displayed board', async () => {
  const p = await picker({ history: { 2: 100, 4: 100 } });
  try {
    assert.deepEqual(p.rows(), ['Hypertask Product', 'Software Factory', 'Alpha', 'Beta', 'Zulu']);
    await p.click(0);
    assert.deepEqual(p.chosen, [4]);
    await p.key('Escape');
    assert.deepEqual(p.closed, [true]);
  } finally { await p.cleanup(); }
});

test('first use without history is alphabetical', async () => {
  const p = await picker({ history: {} });
  try { assert.deepEqual(p.rows(), ['Alpha', 'Beta', 'Hypertask Product', 'Software Factory', 'Zulu']); }
  finally { await p.cleanup(); }
});

for (const options of [{ enabled: false }, { compose: false }]) {
  test(`unchanged API order when ${options.compose === false ? 'moving an existing task' : 'the flag is off'}`, async () => {
    const p = await picker(options);
    try { assert.deepEqual(p.rows(), ['Zulu', 'Software Factory', 'Alpha', 'Hypertask Product', 'Beta']); }
    finally { await p.cleanup(); }
  });
}

test('flag is an improvement live for Everyone', () => {
  const definition = load('src/lib/flags/definitions/htpr-8014-compose-board-order.ts').default;
  assert.equal(definition.key, 'htpr-8014-compose-board-order');
  assert.equal(definition.kind, 'improvement');
  assert.equal(definition.defaultMode, 'EVERYONE');
});
