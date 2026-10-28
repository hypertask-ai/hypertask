const assert = require('node:assert/strict');
const test = require('node:test');
const { load } = require('./task-route-loader.cjs');
const { loadModule, findElement } = require('./helpers/loadModule.cjs');
const key = 'htpr-8148-inbox-tab-selection';

function selectionFixture(enabled = true, count = 2) {
  const visible = Array.from({ length: count }, (_, i) => ({ id: 11 + i }));
  let selected = new Set([11]);
  const context = {
    get selectedIds() { return selected; },
    setSelectedIds: next => { selected = typeof next === 'function' ? next(selected) : next; },
    selectAllFromAllTabs: () => { selected = new Set([...visible.map(row => row.id), 9001, 9002]); },
  };
  const hooks = load('src/hooks/MultiPages/useBulkActions.ts', {
    react: { useCallback: fn => fn, useEffect: fn => fn(), useRef: current => ({ current }), useState: initial => [initial, () => {}] },
    '@/lib/contexts/Inbox/BulkSelectionContext': { useBulkSelectionContext: () => context },
    '@/lib/contexts/deviceContext': { useDeviceContext: () => false },
    '@/utils/helperFunctions/helperFunctions': { returnIfModalOrInputActive: () => false },
  }).useBulkActions({ items: visible, actions: [] });
  const hookReact = { useCallback: fn => fn, useEffect() {}, useMemo: fn => fn(), useRef: current => ({ current }), useState: initial => [initial, () => {}], useContext: () => false };
  const mocks = new Proxy({
    react: hookReact,
    'next/navigation': { useRouter: () => ({}) },
    '@/lib/contexts/deviceContext': { useDeviceContext: () => false },
    '@/hooks/Inbox/usePrefetchInboxTaskDetail': { usePrefetchInboxTaskDetail: () => () => {} },
    '@/hooks/MultiPages/useBulkActions': { useBulkActions: props => load('src/hooks/MultiPages/useBulkActions.ts', {
      react: hookReact,
      '@/lib/contexts/Inbox/BulkSelectionContext': { useBulkSelectionContext: () => context },
      '@/lib/contexts/deviceContext': { useDeviceContext: () => false },
      '@/utils/helperFunctions/helperFunctions': { returnIfModalOrInputActive: () => false },
    }).useBulkActions(props) },
    '@/lib/contexts/Inbox/BulkSelectionContext': { useBulkSelectionContext: () => ({ ...context, selectedIdsArray: [...selected], isAllSelected: selected.size === 4 }) },
    '@/hooks/useFlag': { useFlag: flag => flag === key && enabled },
    '@/lib/firstScreen/SurfaceContext': { useFirstScreenSurface: () => null },
    '@/lib/firstScreen/inboxDocument': { getInboxDocument: () => null },
    '@/lib/state': { useRecoilState: () => [{ currIdx: 0, show: false }, () => {}] },
    '@/hooks/General/useProjectQuery': { useProjectQuery: () => ({}) },
    '@/hooks/Inbox/useUpdateInView': { default: () => ({}) },
    '@tanstack/react-query': { useQueryClient: () => ({}) },
    '@/hooks/useShortcutTipsSetting': { useShortcutTipsSetting: () => ({}) },
    '@/hooks/MultiPages/Route/useHypertasksNavigate': { default: () => ({}) },
    '@/hooks/General/useCurrentUserCheckFromCookies': { default: () => ({ id: 985 }) },
    '@/hooks/General/useGetUserPreferences': { useGetUserPreferences: () => ({}) },
    '@/hooks/General/useGetUserDrafts': { useGetUserDrafts: () => ({ drafts: [] }) },
    '@/lib/inboxKeyboardNavigation': { reconcileInboxKeyboardRow: () => null },
    '@/lib/constants': { default: { multipleKeys: {} } },
    '@/lib/constants/keyboard-handler': loadModule('src/lib/constants/keyboard-handler.ts'),
    '@/components/Common/selection-checkbox': { default: 'checkbox' },
    '@/lib/configs/inbox.config': loadModule('src/lib/configs/inbox.config.ts'),
    '@/lib/inbox/inboxDateGroups': { groupInboxItemsByDate: () => ({ today: { label: 'Today', items: [] } }) },
    '@/utils/undoActions/helperFuncs': { cn: () => '' },
    '@/lib/inboxTasksPlaylist': { buildInboxTasksPlaylist: () => [] },
    'next/dynamic': { default: () => 'dynamic' },
    '@/lib/contexts/InboxZeroContext': { useInboxZero: () => ({}) },
  }, {
    has: (target, id) => id in target || (id !== 'react/jsx-runtime' && !String(id).includes('/flags/definitions/')),
    get: (target, id) => target[id] ?? {},
  });
  const Component = loadModule('src/components/notifications/inboxSplit/index.tsx', mocks).default;
  const render = () => findElement(Component({ _notifications: visible.map(n => ({ id: String(n.id) })), selectedSplit: 'Agents', value: 0, index: 0 }), 'checkbox');
  return { render, selected: () => [...selected], hooks };
}

test('checkbox selects the current split, checks itself, and toggles off', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = selectionFixture();
  f.render().props.onClick();
  assert.deepEqual(f.selected(), [11, 12]);
  assert.equal(f.render().props.isChecked, true);
  f.render().props.onClick();
  t.mock.timers.tick(2);
  assert.deepEqual(f.selected(), []);
});

test('Ctrl+A stays within the split; Ctrl+Shift+A remains explicitly global', () => {
  const f = selectionFixture();
  const event = { keyCode: 65, ctrlKey: true, metaKey: false, shiftKey: false, preventDefault() {} };
  f.hooks.handleKeyDown(event, 0);
  assert.deepEqual(f.selected(), [11, 12]);
  f.hooks.handleKeyDown({ ...event, shiftKey: true }, 0);
  assert.deepEqual(f.selected(), [11, 12, 9001, 9002]);
});

test('flag off keeps the previous global checkbox', () => {
  const f = selectionFixture(false);
  f.render().props.onClick();
  assert.deepEqual(f.selected(), [11, 12, 9001, 9002]);
});

async function archiveFixture(enabled = true) {
  const rows = [{ id: 11, taskId: 7, userId: 985, status: 'Normal' }, { id: 21, taskId: 7, userId: 985, status: 'Normal' }, { id: 22, taskId: 8, userId: 985, status: 'Normal' }];
  const notification = {
    findFirst: async ({ where }) => rows.find(r => where.id.in.includes(r.id) && r.userId !== where.userId.not) ?? null,
    updateMany: async ({ where, data }) => {
      const matches = rows.filter(r => r.userId === where.userId && r.status !== 'Deleted' && (!where.id?.in || where.id.in.includes(r.id)) && (!where.id?.notIn || !where.id.notIn.includes(r.id)) && (!where.taskId?.in || where.taskId.in.includes(r.taskId)));
      matches.forEach(r => Object.assign(r, data));
      return { count: matches.length };
    },
  };
  const prisma = { notification, $transaction: fn => fn(prisma) };
  const { POST } = load('src/lib/api/notification-writes/archive-bulk.ts', {
    '@/lib/prisma': { default: prisma },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => ({ userId: 985 }) },
    '@/lib/auth/agentScope': { withAgentScopeRequest: (_request, fn) => fn(), prepareAgentScope: async () => {} },
    '@/lib/auth/session': {},
    '@/lib/flags': { isFeatureEnabled: async flag => { assert.equal(flag, key); return enabled; } },
    '@/lib/realtime/server': { broadcastInboxChange: async () => {}, socketIdFromHeader: () => null },
  });
  const post = async (ids, status = 'Archive') => POST({ headers: new Headers(), json: async () => ({ notificationIds: ids.map(id => ({ notificationId: id, taskId: rows.find(r => r.id === id)?.taskId, userId: 985 })), status }) });
  return { rows, post };
}

test('bulk POST archives selected IDs only, preserving another split on the same task', async () => {
  const f = await archiveFixture();
  assert.equal((await f.post([11])).status, 200);
  assert.deepEqual(f.rows.map(r => r.status), ['Archive', 'Normal', 'Normal']);
  assert.equal((await f.post([11], 'Normal')).status, 200);
  assert.deepEqual(f.rows.map(r => r.status), ['Normal', 'Normal', 'Normal']);
});

test('flag off keeps recoverable sibling archive', async () => {
  const f = await archiveFixture(false);
  assert.equal((await f.post([11])).status, 200);
  assert.deepEqual(f.rows.map(r => r.status), ['Archive', 'Archive', 'Normal']);
});

test('bulk POST still refuses another user notification', async () => {
  const f = await archiveFixture();
  f.rows[0].userId = 2343;
  assert.equal((await f.post([11])).status, 403);
  assert.deepEqual(f.rows.map(r => r.status), ['Normal', 'Normal', 'Normal']);
});


test('scoped optimistic bulk archive preserves unselected sibling messages', async t => {
  const { QueryClient } = require('@tanstack/react-query');
  const queryClient = new QueryClient();
  const queryKey = ['inbox', 'data', 985];
  const rows = [{ id: '11', taskId: 7 }, { id: '21', taskId: 7 }, { id: '22', taskId: 8 }];
  const payload = notifications => ({ notifications, structuredData: { tabs: [{ project: 'All' }], data: [notifications] } });
  queryClient.setQueryData(queryKey, payload(rows));
  queryClient.invalidateQueries = async () => {};
  t.mock.method(global, 'fetch', async () => ({ ok: true }));
  const handler = load('src/hooks/Inbox/useGlobalFocusHandler.tsx', {
    '@/lib/api/typedClient': {},
    '@/hooks/useFlag': { useFlag: flag => flag === key },
    '@/store': {},
    '@/lib/state': { useRecoilState: () => [{ currSplit: 0, currIdx: 0 }, () => {}], useRecoilValue: () => ({ id: 985 }), useSetRecoilState: () => () => {} },
    '@tanstack/react-query': { useQueryClient: () => queryClient },
    '@/utils/helperFunctions/helperFunctions': {},
    '../General/useUndo': { useUndoContext: () => ({ performActionAndStoreUndoData() {} }) },
    'next/navigation': { usePathname: () => '/inbox', useRouter: () => ({ refresh() {} }), useSearchParams: () => new URLSearchParams() },
    axios: {}, '@prisma/client': {},
    '@/utils/axiosClient': { default: { post: async () => {} } },
    '@/lib/realtime/client': { realtimeEchoHeaders: () => ({}) },
    './useGetNotifications': { inboxDataQueryKey: () => queryKey },
    '@/lib/inboxSync/optimistic': load('src/lib/inboxSync/optimistic.ts', { '@/lib/boardSync/pilot': {}, '@/utils/helperFunctions/helperFunctions': { buildInboxQueryCache: payload }, './revision': { isInboxReadModelRevision: () => false } }),
  }).default();
  await handler.bulkArchiveNotifications([rows[0]], 'Notification', () => {});
  assert.deepEqual(queryClient.getQueryData(queryKey).notifications.map(row => row.id), ['21', '22']);
  queryClient.clear();
});

test('tab scope bugfix defaults to Everyone', () => {
  const { default: flag } = load('src/lib/flags/definitions/htpr-8148-inbox-tab-selection.ts', {});
  assert.equal(flag.key, key);
  assert.equal(flag.kind, 'bugfix');
  assert.equal(flag.defaultMode, 'EVERYONE');
});


test('the reported 384-row split excludes other-tab rows', () => {
  const f = selectionFixture(true, 384);
  f.render().props.onClick();
  assert.equal(f.selected().length, 384);
  assert.deepEqual(f.selected(), Array.from({ length: 384 }, (_, i) => 11 + i));
});
