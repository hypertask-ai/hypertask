const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
require('tsx/cjs');
process.env.SESSION_SECRET = 'disposable-first-screen-test-secret';
const root = path.resolve(__dirname, '..');
const mock = (name, exports) => {
  const id = name.startsWith('src/') ? path.join(root, name) : require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
let cookieValues = {}, enabled = true, desktopChat = false, response, calls = [], delay = 0, failRead = false, assigneeFix;
const user = { id: 985, uid: 'qa', displayName: 'QA', email: 'qa@example.invalid', stripe_customer_id: 'billing-secret',
  UserSetting: { id: 1, onboardingTourStatus: true, snippets: 'private-settings' } };
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (id, ...args) { return id === 'server-only' ? {} : originalLoad.call(this, id, ...args); };
mock('next/headers', { cookies: async () => ({ get: key => cookieValues[key] ? { value: cookieValues[key] } : undefined }),
  headers: async () => new Headers({ 'x-ht-board-document-route': '/project?id=15&view=default' }) });
mock('src/lib/auth/getSessionUser.ts', { getSessionUser: async () => {
  const user = await require('../src/lib/auth/serverUser.ts').getServerCookieUser();
  return user ? { userId: user.id, source: 'better-auth' } : null;
} });
mock('src/lib/agents/boardAccessRequests/service.ts', { getOwnerBoardAccessNotifications: async () => [] });
mock('src/lib/prisma.ts', { __esModule: true, default: { user: { findUnique: async ({ where }) => where.id === user.id ? user : null } } });
mock('src/lib/flags.ts', { featureFlagsForUser: async id => { assert.equal(id, 985); return { 'htpr-6934-server-first-screen': enabled, 'other-flag': true, 'htpr-7406-desktop-server-board': desktopChat, ...(assigneeFix === undefined ? {} : { 'htpr-7725-saved-view-assignee': assigneeFix }) }; } });
mock('src/utils/controllers/projects/getBoardTasks.ts', { __esModule: true, default: async (...args) => {
  calls.push(args); if (failRead) throw Error('Disposable read failure');
  if (delay) await new Promise(resolve => setTimeout(resolve, delay)); return response;
} });
mock('src/utils/controllers/projects/getFirst.ts', { __esModule: true, default: async () => ({ json: { id: 15 } }) });
mock('src/utils/controllers/notifications/getCount.ts', { __esModule: true, default: async id => {
  assert.equal(id, 985); return { status: 200, json: { all: 3, unseen: 1 } };
} });
const { signSession } = require('../src/lib/auth/session.ts');
const { DEFAULT_TABLE_COLUMNS } = require('../src/utils/helperFunctions/Views/TableColumnsHelperFunctions.ts');
const { BOARD_DISPLAY_COOKIE, parseBoardDisplay } = require('../src/lib/firstScreen/boardDisplay.ts');
const { readBoardDocument, getServerBoardDocument } = require('../src/lib/firstScreen/serverBoardDocument.ts');
const display = { version: 1, accountId: 985, timeZone: 'UTC', locale: 'en-US', boardLayout: 'board', theme: 'porcelain',
  railCollapsed: true, quickTips: true, draftsFirst: false, isMobile: true,
  board: { railOn: true, showEmptyViewTabs: false, hiddenViewTabIds: {}, viewTabsOrder: {}, tableColumns: DEFAULT_TABLE_COLUMNS,
    tableWidths: {}, tableTitleWrap: true, openChat: true, chatSuppressed: false, chatPinned: false } };
const fixture = { project: { id: 15, title: 'Authorized board', section: [{ id: 1, section_title: 'To do', visibility: false, ranking: 'A0100' }],
  sections: ['To do'], owner: { id: 985, email: 'owner-private@example.invalid' }, members: [{ user: { id: 985, email: 'member-private@example.invalid' } }],
  team: { id: 'team', stripe_customer_id: 'billing-secret', googleAccount: { userId: 985 }, allowedEmailDomains: ['private.invalid'], subscriptionPlan: [{ subscriptionId: 'subscription-secret', subscriptionStatus: 'active' }] },
  ai_custom_instructions: { customInstruction: 'instruction-secret' } },
  tasks: [{ id: 1, title: 'Authorized card', projectId: 15, sectionId: 1, ranking: 'A0100', status: 'Normal',
    taskLabels: [], assignees: [], notifications: [], subTasks: [], description_: { content: '<p>API-flagged instant open</p>' } }], allViews: [] };
function reset() {
  enabled = true; desktopChat = false; assigneeFix = undefined; calls = []; delay = 0; failRead = false; response = { status: 200, json: structuredClone(fixture) };
  cookieValues = { nookies_user: JSON.stringify({ id: 985 }), ht_session: signSession({ id: 985, email: user.email }), [BOARD_DISPLAY_COOKIE]: JSON.stringify(display) };
}

test('matching signed user uses the exact controller arguments and complete live board projection', async () => {
  reset();
  const snapshot = await readBoardDocument('/project?id=15', JSON.stringify(display));
  assert.ok(snapshot);
  assert.deepEqual(calls, [[15, 985, 985]]);
  assert.equal(snapshot.scope.accountId, 985);
  assert.equal(snapshot.completeness, 'complete');
  assert.equal(snapshot.projectsCompleteness, 'active-board-only');
  assert.equal(snapshot.data.projects.updatedProjects[0].tasks[0].title, 'Authorized card');
  assert.equal(snapshot.data.projects.serverDocumentGeneration, snapshot.scope.generation);
  assert.equal(snapshot.flags.values['other-flag'], true);
  assert.deepEqual(snapshot.data.projects.notificationsCount, { all: 3, unseen: 1 });
  const htmlPayload = JSON.stringify(snapshot);
  for (const secret of ['billing-secret', 'subscription-secret', 'instruction-secret', 'private-settings', 'owner-private', 'member-private', 'private.invalid', cookieValues.ht_session])
    assert.equal(htmlPayload.includes(secret), false, secret);
  assert.ok(htmlPayload.includes('API-flagged instant open'));
});

test('flag OFF and unknown display preferences read no board and return the unchanged path', async () => {
  reset(); enabled = false;
  assert.equal(await readBoardDocument('/project?id=15', JSON.stringify(display)), null);
  assert.deepEqual(calls, []);
  reset();
  assert.equal(await readBoardDocument('/project?id=15', undefined), null);
  assert.deepEqual(calls, []);
  assert.equal(await readBoardDocument('/inbox', JSON.stringify(display)), null);
});

test('forged, mismatched, expired and absent sessions never authorize a board payload', async () => {
  for (const mutate of [
    () => { delete cookieValues.ht_session; },
    () => { cookieValues.ht_session += 'forged'; },
    () => { cookieValues.nookies_user = JSON.stringify({ id: 6 }); },
    () => { cookieValues.ht_session = signSession({ id: 985, email: user.email }, -1); },
    () => { delete cookieValues.nookies_user; },
  ]) {
    reset(); mutate();
    assert.equal(await readBoardDocument('/project?id=15', JSON.stringify(display)), null);
    assert.deepEqual(calls, []);
  }
});

test('non-member and failed controller outcomes produce no document payload', async () => {
  for (const status of [403, 400, 500]) {
    reset(); response = { status, json: { message: 'No access' } };
    assert.equal(await readBoardDocument('/project?id=15', JSON.stringify(display)), null);
  }
  reset(); response.json.project.id = 99;
  assert.equal(await readBoardDocument('/project?id=15', JSON.stringify(display)), null);
});

test('guest document contains only the tasks, sections and private views returned by the guest board API', async () => {
  reset(); user.email = 'guest@demo.hypertask.ai';
  response.json.tasks = [{ ...fixture.tasks[0], title: 'Guest API visible task' }];
  response.json.allViews = [];
  const snapshot = await readBoardDocument('/project?id=15', JSON.stringify(display));
  assert.deepEqual(snapshot.data.payload.tasks, response.json.tasks);
  assert.deepEqual(snapshot.data.payload.allViews, response.json.allViews);
  assert.deepEqual(snapshot.data.payload.project.section, response.json.project.section);
  assert.deepEqual(calls, [[15, 985, 985]]);
  user.email = 'qa@example.invalid';
});

test('slow server read falls back within the 800ms budget and cannot publish later', async () => {
  reset(); delay = 1000;
  const start = performance.now();
  const result = await getServerBoardDocument();
  assert.equal(result, null);
  assert.ok(performance.now() - start >= 790);
  assert.ok(performance.now() - start < 950);
  assert.equal(result, null);
});

test('a thrown read failure returns no partial document and leaves the old path usable', async () => {
  reset(); failRead = true;
  assert.equal(await getServerBoardDocument(), null);
  failRead = false;
  assert.ok(await getServerBoardDocument());
});

test('display cookie is account scoped, validated and rejects unsupported open desktop chat', () => {
  assert.ok(parseBoardDisplay(JSON.stringify(display), 985));
  for (const value of [undefined, '{}', JSON.stringify({ ...display, accountId: 6 }),
    JSON.stringify({ ...display, isMobile: false }), JSON.stringify({ ...display, board: { ...display.board, tableWidths: { title: -1 } } }),
    JSON.stringify({ ...display, board: { ...display.board, hiddenViewTabIds: { '<script>': true } } })])
    assert.equal(parseBoardDisplay(value, 985), null);
});

test('Plex names no font file of its own, so Next decides the URL at build time', () => {
  const layout = fs.readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
  assert.match(layout, /\$\{ibmPlexSans\.variable\}/);
  assert.doesNotMatch(layout, /_next\/static\/media/);
  const font = fs.readFileSync(path.join(root, 'src/lib/fonts/ibmPlexSans.ts'), 'utf8');
  assert.match(font, /preload: true/);
  assert.doesNotMatch(font, /\.woff2/);
});

test('personalized HTML and Flight are dynamic and explicitly private no-store; proxy overwrites route spoofing', () => {
  const proxy = fs.readFileSync(path.join(root, 'src/proxy.ts'), 'utf8');
  assert.ok(proxy.includes("forwardedHeaders.delete('x-ht-board-document-route')"));
  assert.match(proxy, /if \(request\.headers\.get\('sec-fetch-dest'\) === 'document'\)/);
  assert.match(proxy, /forwardedHeaders\.set\(request\.nextUrl\.pathname === '\/inbox' \? 'x-ht-inbox-document-route' : 'x-ht-board-document-route'/);
  for (const header of ['Cache-Control', 'CDN-Cache-Control', 'Vercel-CDN-Cache-Control']) assert.ok(proxy.includes(`response.headers.set('${header}'`));
  assert.ok(proxy.includes("'private, no-store'"));
  const page = fs.readFileSync(path.join(root, 'src/app/[...boardURL]/page.tsx'), 'utf8');
  assert.match(page, /export const dynamic = "force-dynamic"/);
  assert.match(page, /export const revalidate = 0/);
});test('desktop default-open and pinned chat board documents require the desktop server-board flag', async () => {
  for (const chat of [{ openChat: true, chatPinned: false }, { openChat: false, chatPinned: true, chatSuppressed: true }]) {
    reset();
    const value = JSON.stringify({ ...display, isMobile: false,
      board: { ...display.board, ...chat, chatWidth: 517, chatSidebarMode: true } });
    assert.equal(await readBoardDocument('/project?id=15', value), null);
    assert.deepEqual(calls, []);
    desktopChat = true;
    const snapshot = await readBoardDocument('/project?id=15', value);
    assert.ok(snapshot);
    assert.equal(snapshot.display.board.chatWidth, 517);
    assert.equal(snapshot.display.board.chatSidebarMode, true);
    assert.deepEqual(calls, [[15, 985, 985]]);
  }
});

test('the board document is still allowed without the ticket flag and never produces a ticket shell', async () => {
  reset();
  const document = await getServerBoardDocument();
  assert.ok(document);
  assert.equal(document.flags.values['htpr-7627-ticket-first-screen'], undefined);
  const { getServerTicketShell } = require('../src/lib/firstScreen/serverTicketShell.ts');
  assert.equal(await getServerTicketShell(), null);
});

test('server first paint applies the URL human assignee filter by default and honors flag Off', async () => {
  for (const flag of [undefined, true, false]) {
    reset(); assigneeFix = flag;
    const column = { ...fixture.project.section[0], visibility: true };
    const defaultView = {
      id: 'default-view', slug: 'all-tasks', board_columns_view: [column],
      board_filters: { matchFilters: 'ANY', addedFilters: [] },
      board_sorting_mode: 'Manual', board_subtask_setting: 'None', board_empty_sections: 'Show',
    };
    const humanView = {
      ...defaultView, id: 'human-view', slug: 'human-only',
      board_filters: { matchFilters: 'ANY', addedFilters: [
        { type: 'Assignees', searchPayload: [{ id: 985, uid: 'qa' }] },
      ] },
    };
    response.json.project.section = [column];
    response.json.project.project_view = {
      default_view_id: defaultView.id, default_view: defaultView, user_project_views: [],
    };
    response.json.allViews = [defaultView, humanView];
    response.json.tasks = [
      { ...fixture.tasks[0], id: 1, assignees: [{ userId: 985, agentId: 'runner-5' }] },
      { ...fixture.tasks[0], id: 2, assignees: [{ userId: 985, agentId: null }] },
    ];
    const snapshot = await readBoardDocument('/project?id=15&view=human-only', JSON.stringify(display));
    assert.ok(snapshot);
    const project = snapshot.data.projects.updatedProjects[0];
    assert.equal(project.project_view.user_project_views[0].appliedView.id, humanView.id);
    assert.deepEqual(project.filteredSections.flatMap(section => section.items.map(task => task.id)), flag === false ? [1, 2] : [2]);
  }
});
