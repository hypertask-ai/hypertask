const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { fixture, loader, source, ctx, session, NOW, ID, FLAG, root } = require('./htpr-7582-fixtures.cjs');
const { loadModule } = require('./helpers/loadModule.cjs');
const { NextResponse } = require('next/server');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const create = async f => (await f.create()).request.id;
const taskRow = { id: '90', type: 'Comment', userId: 6, taskId: 11, projectId: 15, status: 'Normal', seen: false, createdAt: NOW.toISOString(), project: { id: 15, title: 'Software Factory' }, task: { id: 11, projectId: 15, title: 'Deploy', status: 'Normal', section: 'Todo' } };

function humanAdapters(f) {
  const splits = [];
  const load = loader({ ...f.stubs, '@/lib/agents/boardAccessRequests/service': f.service,
    '@/utils/controllers/notifications/getAll': { __esModule: true, default: async () => ({ status: 200, json: { notifications: [taskRow], splitsNoImportant: [], showImportantSplit: false } }) },
    './getCount': { __esModule: true, default: async () => ({ status: 200, json: { all: 1, unseen: 0 } }) },
    '@/utils/controllers/notifications/visibleInboxScope': { visibleUserInboxWhere: () => ({}) },
    '@/utils/controllers/notifications/decisionTasks': { getDecisionComments: async () => new Map() },
    '@/utils/helperFunctions/helperFunctions': { getInboxTabs: rows => { splits.push(rows); return {}; } },
  });
  return { list: load('src/utils/controllers/notifications/getAllWithDecisions.ts').default, count: load('src/utils/controllers/notifications/getCountWithBoardAccessRequests.ts').default, splits };
}
test('human owner-only list/count refuse agent, CLI and foreign owner slices', async () => {
  const f = fixture(); await create(f); const adapters = humanAdapters(f);
  for (const principal of [undefined, session({ agentId: 'agent-1' }), session({ source: 'cli-bearer' }), session({ userId: 7 })]) {
    assert.equal((await adapters.list('6', principal)).json.notifications.length, 1);
    assert.equal((await adapters.count(6, principal)).json.all, 1);
  }
});
test('human owner list/count include distinct taskless requests and identical visibility', async () => {
  const f = fixture(); await create(f); const adapters = humanAdapters(f);
  const list = await adapters.list('6', session()); const count = await adapters.count(6, session());
  assert.equal(list.json.notifications.length, 2); assert.equal(count.json.all, 2); assert.equal(count.json.unseen, 1);
  assert.equal(list.json.notifications.find(row => row.type === 'AgentBoardAccessRequest').taskId, null);
  assert.equal(adapters.splits.at(-1).length, 2);
});
test('flag off hides owner list/count even with pending stored notification', async () => {
  const f = fixture(); await create(f); f.state.flag = false; const adapters = humanAdapters(f);
  assert.equal((await adapters.list('6', session())).json.notifications.length, 1);
  assert.equal((await adapters.count(6, session())).json.all, 1);
});
test('flag on still includes owner request in list/count', async () => {
  const f = fixture(); await create(f); const adapters = humanAdapters(f);
  assert.equal((await adapters.list('6', session())).json.notifications.length, 2); assert.equal((await adapters.count(6, session())).json.all, 2);
});
test('live owner/team/access/deletion checks hide stale cards and prevent metadata leaks', async () => {
  for (const mutate of [f => { f.state.agent.userId = 7; }, f => { f.state.agent = null; }, f => { f.state.board = null; }, f => { f.state.noAccess = true; }, f => { f.state.board.teamId = 'moved'; }, f => { f.state.agent.runtimeGeneration++; }]) {
    const f = fixture(); await create(f); mutate(f);
    assert.deepEqual(await f.service.getOwnerBoardAccessNotifications(session(), 'Normal', NOW), []);
    assert.equal(f.state.requests[0].status, 'cancelled');
  }
});
test('live owner with unchanged board sees card, reason as plain text and no token state', async () => {
  const f = fixture(); await f.create({ reason: '<img onerror=bad>' });
  const [row] = await f.service.getOwnerBoardAccessNotifications(session(), 'Normal', NOW);
  assert.equal(row.boardAccessRequest.reason, '<img onerror=bad>'); assert.equal(row.boardAccessRequest.agentName, 'Grok Bot'); assert.equal(row.boardAccessRequest.boardName, 'Software Factory');
  assert.equal(row.boardAccessRequest.tokenGeneration, undefined); assert.equal(row.boardAccessRequest.ownerUserIdAtRequest, undefined);
});
test('expired requests remain visible as terminal and cannot expose live action buttons', async () => {
  const f = fixture(); await create(f);
  const [row] = await f.service.getOwnerBoardAccessNotifications(session(), 'Normal', new Date(+NOW + 7 * 86400000));
  assert.equal(row.boardAccessRequest.status, 'expired'); assert.equal(row.boardAccessRequest.canApprove, false);
});
test('pending same-team requests remain actionable', async () => {
  const f = fixture(); await create(f); const [row] = await f.service.getOwnerBoardAccessNotifications(session(), 'Normal', NOW);
  assert.equal(row.boardAccessRequest.status, 'pending'); assert.equal(row.boardAccessRequest.canApprove, true);
});
test('one request per notification survives taskless siblings and terminal retention is bounded', async () => {
  const f = fixture(); const id = await create(f); await f.service.decideBoardAccessRequest(session(), id, 'decline', NOW);
  const first = f.state.requests[0]; f.state.requests.push({ ...first, id: ID, reason: 'Another request' });
  f.state.notifications.push({ ...f.state.notifications[0], id: 2, boardAccessRequestId: ID });
  assert.equal((await f.service.getOwnerBoardAccessNotifications(session(), 'Normal', new Date(+NOW + 86400000))).length, 2);
  assert.equal((await f.service.getOwnerBoardAccessNotifications(session(), 'Normal', new Date(+NOW + 30 * 86400000))).length, 0);
});
test('archiving or seen changes never resolve a request or grant membership and target only one ID', async () => {
  const f = fixture(); await create(f);
  const first = structuredClone(f.state.notifications[0]); f.state.notifications.push({ ...first, id: 2 });
  await f.service.mutateBoardAccessNotification(session(), 1, null, { seen: true });
  await f.service.mutateBoardAccessNotification(session(), 1, null, { status: 'Archive' });
  assert.equal(f.state.notifications[0].status, 'Archive'); assert.equal(f.state.notifications[1].status, first.status);
  assert.equal(f.state.notifications[1].seen, first.seen); assert.equal(f.state.requests[0].status, 'pending'); assert.equal(f.state.grants, 0);
  await f.service.mutateBoardAccessNotification(session(), 1, null, { status: 'Normal' });
  assert.equal(f.state.notifications[0].status, 'Normal'); assert.equal(f.state.notifications.length, 2);
});
test('forged taskId, agent, CLI and foreign owner cannot mutate request notification', async () => {
  for (const [principal, taskId] of [[session(), 88], [session({ agentId: 'agent-1' }), null], [session({ source: 'cli-bearer' }), null], [session({ userId: 7 }), null]]) {
    const f = fixture(); await create(f);
    await assert.rejects(f.service.mutateBoardAccessNotification(principal, 1, taskId, { status: 'Archive' }));
    assert.equal(f.state.requests[0].status, 'pending'); assert.notEqual(f.state.notifications[0].status, 'Archive');
  }
});
test('human owner with nullable taskId may archive and restore without deciding', async () => {
  const f = fixture(); await create(f);
  assert.ok(await f.service.mutateBoardAccessNotification(session(), 1, null, { status: 'Archive' }));
  assert.ok(await f.service.mutateBoardAccessNotification(session(), 1, null, { status: 'Normal' }));
  assert.equal(f.state.grants, 0);
});
function writeRoutes(f, principal = session()) {
  const calls = [];
  const load = loader({ ...f.stubs, '@/lib/agents/boardAccessRequests/service': f.service,
    '@/lib/api/task-writes/route': { taskWriteRoute: options => async (request, actor) => options.operation(await request.json(), actor, request) },
    '@/lib/api/task-writes/read-query': { taskReadQuery: request => request.query },
    '@/lib/auth/getSessionUser': { getSessionUser: async () => principal },
  });
  return { load, calls, request: body => ({ headers: new Headers(), query: body, json: async () => body }) };
}
test('all reused ID mutations reject forged taskId before generic sibling operations', async () => {
  for (const [file, method, body] of [['mark-done', 'GET', { id: 1, taskId: 88 }], ['mark-unseen', 'GET', { notificationId: 1, taskId: 88, seen: '1' }], ['unarchive-by-id', 'POST', { notificationId: 1, taskId: 88 }], ['archive-bulk', 'POST', { notificationIds: [{ notificationId: 1, taskId: 88 }], status: 'Archive' }]]) {
    const f = fixture(); await create(f); const routes = writeRoutes(f);
    const response = await routes.load('src/lib/api/notification-writes/' + file + '.ts')[method](routes.request(body), session());
    assert.equal(response.status, 403, file); assert.equal(f.state.requests[0].status, 'pending');
  }
});
test('all reused ID mutations still allow authorized nullable-task owner controls', async () => {
  for (const [file, method, body] of [['mark-done', 'GET', { id: 1, taskId: null }], ['mark-unseen', 'GET', { notificationId: 1, taskId: null, seen: '1' }], ['unarchive-by-id', 'POST', { notificationId: 1 }], ['archive-bulk', 'POST', { notificationIds: [{ notificationId: 1, taskId: null }], status: 'Archive' }]]) {
    const f = fixture(); await create(f); const routes = writeRoutes(f);
    const response = await routes.load('src/lib/api/notification-writes/' + file + '.ts')[method](routes.request(body), session());
    assert.equal(response.status, 200, file); assert.equal(f.state.requests[0].status, 'pending'); assert.equal(f.state.grants, 0);
  }
});
test('malformed notification IDs cannot reach request or task writes', async () => {
  for (const [file, field] of [['mark-done', 'id'], ['mark-unseen', 'notificationId']]) {
    for (const id of ['', '1tail', '1.5', '1e0', ['1'], '9007199254740992']) {
      const f = fixture(); await create(f); const routes = writeRoutes(f);
      const response = await routes.load('src/lib/api/notification-writes/' + file + '.ts').GET(routes.request({ [field]: id, taskId: 88 }), session());
      assert.equal(response.status, 400, `${file}: ${id}`);
      assert.equal(f.state.notifications[0].status, 'Normal');
      assert.equal(f.state.notifications[0].seen, false);
    }
  }
});
test('cleanup expires due rows, cancels invalid live authority, and purges terminal retention in bounded batches', async () => {
  const f = fixture(); await create(f);
  await f.service.cleanupBoardAccessRequests(new Date(+NOW + 7 * 86400000)); assert.equal(f.state.requests[0].status, 'expired');
  await f.service.cleanupBoardAccessRequests(new Date(+NOW + 37 * 86400000)); assert.equal(f.state.requests.length, 0);
  const other = fixture(); await create(other); other.state.agent = null;
  await other.service.cleanupBoardAccessRequests(NOW); assert.equal(other.state.requests[0].status, 'cancelled');
  const code = source('src/lib/agents/boardAccessRequests/service.ts'); assert.ok((code.match(/take: 100/g) ?? []).length >= 2);
});
test('cleanup preserves current pending requests and recent terminal records', async () => {
  const f = fixture(); await create(f); await f.service.cleanupBoardAccessRequests(NOW); assert.equal(f.state.requests[0].status, 'pending');
});
test('taskless requests classify into Decisions and All only, without task/project assumptions', () => {
  const load = loader({ '@prisma/client': { NotificationType: {} } });
  const { getInboxTabs } = load('src/utils/helperFunctions/inboxHelpers.ts');
  const row = { ...taskRow, type: 'AgentBoardAccessRequest', projectId: null, project: null, taskId: null, task: null, isDecision: true };
  const splits = getInboxTabs([row], ['system:Decisions'], false);
  assert.deepEqual(splits.tabs.map(tab => tab.project), ['Decisions', 'All']); assert.deepEqual(splits.data, [[0], [0]]);
});
test('ordinary task notification classification remains present', () => {
  const load = loader({ '@prisma/client': { NotificationType: {} } });
  const { getInboxTabs } = load('src/utils/helperFunctions/inboxHelpers.ts');
  const splits = getInboxTabs([taskRow]); assert.ok(splits.tabs.some(tab => tab.project === 'All')); assert.ok(splits.tabs.some(tab => tab.projectId === 15));
});
test('web routes and first-screen documents pass freshly validated full principal', () => {
  assert.match(source('src/lib/api/notification-writes/all-read.ts'), /notificationGetAll\(String\(session.userId\), session\)/);
  assert.match(source('src/lib/api/notification-writes/count-read.ts'), /notificationGetCount\(session.userId, session\)/);
  for (const file of ['serverInboxDocument.ts', 'serverBoardDocument.ts']) {
    const code = source('src/lib/firstScreen/' + file);
    assert.match(code, /getSessionUser\(await headers\(\)\)/); assert.match(code, /principal.userId !== user.id/);
  }
  assert.match(source('src/lib/firstScreen/serverInboxDocument.ts'), /!principal.agentId && row.type === "AgentBoardAccessRequest"/);
});
function card(summary, { enabled = true } = {}) {
  const { AgentBoardAccessDecision } = loadModule('src/components/notifications/NotificationRow.tsx', {
    __esModuleDummy: undefined,
    'next/link': { __esModule: true, default: ({ href, children, ...props }) => React.createElement('a', { href, ...props }, children) },
    'next/dynamic': { __esModule: true, default: () => () => null },
    '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: () => Promise.resolve() }) },
    '@/hooks/useFlag': { useFlag: () => enabled },
    '@/lib/firstScreen/SurfaceContext': { useFirstScreenSurface: () => null },
    '@/lib/contexts/NotificationContext': { useNotificationContext: () => ({ notification: { userId: 6, createdAt: NOW.toISOString(), boardAccessRequest: summary } }) },
  });
  return renderToStaticMarkup(React.createElement(AgentBoardAccessDecision));
}
const summary = (extra = {}) => ({ id: ID, status: 'pending', expiresAt: new Date(Date.now() + 86400000).toISOString(), resolutionReason: null, canApprove: true, accessPresent: false, nextStep: 'Waiting for owner', agentId: 'agent-1', agentName: 'Grok Bot', agentPhotoURL: null, projectId: 15, boardName: 'Software Factory', sameTeam: true, reason: 'Investigate failing deployment', ...extra });
test('Option A card renders only approved question, explanation, link and two buttons with existing tokens', () => {
  const html = card(summary()); assert.match(html, /Grok Bot asks to join Software Factory as a member/); assert.match(html, /Question: Investigate failing deployment/);
  assert.match(html, /Only you, this agent’s owner, can approve/); assert.match(html, /Board access →/); assert.match(html, /boardAccess=15/);
  assert.equal((html.match(/<button/g) ?? []).length, 2); assert.match(html, />Decline<\/button>/); assert.match(html, />Approve<\/button>/);
  assert.match(html, /<article(?=[^>]*bg-comment-description)(?=[^>]*border-comment-description-border)[^>]*>/); assert.match(html, /bg-shadcn-primary/); assert.doesNotMatch(html, /<input|<textarea|<select|dialog|Send request|Option B/);
});
test('other-team card disables only Approve and renders reason as escaped plain text', () => {
  const html = card(summary({ sameTeam: false, canApprove: false, reason: '<img src=x onerror=attack>' }));
  assert.match(html, /Agent belongs to another team/); assert.match(html, /disabled=""[^>]*>Approve/); assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /disabled=""[^>]*>Decline/);
});
test('same-team card keeps Approve enabled and flag-off renders no feature UI', () => {
  assert.doesNotMatch(card(summary()), /disabled=""[^>]*>Approve/); assert.equal(card(summary(), { enabled: false }), '');
});
test('terminal, expired and removed-membership cards never retain action buttons or falsely claim access', () => {
  for (const status of ['approved', 'declined', 'expired', 'cancelled']) {
    const html = card(summary({ status, canApprove: false, nextStep: status === 'approved' ? 'This request was approved, but access is no longer present.' : 'No access added' }));
    assert.doesNotMatch(html, /<button/); assert.match(html, /role="status"/);
    if (status === 'approved') { assert.match(html, /no longer present/); assert.doesNotMatch(html, /added to Software Factory/); }
  }
  const html = card(summary({ expiresAt: new Date(Date.now() - 1).toISOString() })); assert.doesNotMatch(html, /<button/); assert.match(html, /request has expired/);
});
test('pending card still exposes both actions and the failure slot is inline', () => {
  assert.equal((card(summary()).match(/<button/g) ?? []).length, 2); assert.match(source('src/components/notifications/NotificationRow.tsx'), /role="status" className="text-dense text-text-light-gray">\{error \?\?/);
});
test('Inbox mounts variant outside task Link; double-submit and task-only keyboard actions are guarded', () => {
  const code = source('src/components/notifications/inboxSplit/index.tsx');
  assert.match(code, /boardAccessDecisions \|\| item.notification.type !== "AgentBoardAccessRequest"/);
  assert.match(code, /id=\{`inbox-\$\{notification.id\}`\}/);
  assert.match(code, /!clickTarget \|\| clickTarget.type === "AgentBoardAccessRequest"/); assert.match(code, /!selectedKeyboardRow.item.notification.task/);
  assert.match(source('src/components/notifications/NotificationRow.tsx'), /if \(submitting.current\) return/);
  const board = source('src/app/agents/[agentId]/AgentBoardAccess.tsx'); assert.match(board, /Number.isSafeInteger\(rawBoardId\)/); assert.match(board, /agent.boardAccess.some/); assert.match(board, /setBoardAccessOpen\(true\)/);
});
test('additive migration has taskless unique relation, deletion-safe FKs and pending partial unique index', () => {
  const migration = source('src/prisma/migrations/20261024170000_agent_board_access_requests/migration.sql');
  assert.match(migration, /WHERE "status" = 'pending'/); assert.equal((migration.match(/ON DELETE SET NULL/g) ?? []).length, 3);
  assert.match(migration, /Notification_boardAccessRequestId_key/); assert.match(migration, /ON DELETE CASCADE/); assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN/);
  const schema = source('src/prisma/schema.prisma'); assert.match(schema, /boardAccessRequestId String\? @unique/);
  assert.match(source('src/lib/agents/boardAccessRequests/service.ts'), /taskId: null, projectId: board.id/);
});
test('flag OFF transition writes durable cutoff and cancels requests in its own transaction', async () => {
  const f = fixture(); await create(f);
  f.db.$executeRaw = async () => 0; f.db.task = { findMany: async () => [] };
  f.db.featureFlag = { findUnique: async () => ({ key: FLAG, mode: 'OWNER_AND_QA' }), upsert: async ({ update }) => ({ key: FLAG, ...update }) };
  const load = loader({ ...f.stubs, '@/lib/flags/definitions': { FEATURE_FLAG_DEFINITIONS: [{ key: FLAG, defaultMode: 'OWNER_AND_QA' }] }, '@/lib/flags/keys': {},
    '@/lib/flags/modeCache': { withFlagModeInvalidation: run => run() }, react: { cache: run => run }, '@prisma/client': {} });
  const original = f.db.$transaction; f.db.$transaction = run => original(run, { isolationLevel: 'Serializable' });
  await load('src/lib/flags.ts').setFeatureFlagMode(FLAG, 'OFF');
  assert.equal(f.state.requests[0].status, 'cancelled'); assert.ok(f.state.logs.some(row => row.marker === 'agent_board_access_requests_disabled'));
});
test('non-OFF targeting change preserves pending requests', async () => {
  const f = fixture(); await create(f); f.db.$executeRaw = async () => 0; f.db.task = { findMany: async () => [] };
  f.db.featureFlag = { findUnique: async () => ({ key: FLAG, mode: 'OWNER_AND_QA' }), upsert: async ({ update }) => ({ key: FLAG, ...update }) };
  const original = f.db.$transaction; f.db.$transaction = run => original(run, { isolationLevel: 'Serializable' });
  const load = loader({ ...f.stubs, '@/lib/flags/definitions': { FEATURE_FLAG_DEFINITIONS: [{ key: FLAG, defaultMode: 'OWNER_AND_QA' }] }, '@/lib/flags/keys': {}, '@/lib/flags/modeCache': { withFlagModeInvalidation: run => run() }, react: { cache: run => run }, '@prisma/client': {} });
  await load('src/lib/flags.ts').setFeatureFlagMode(FLAG, 'EVERYONE'); assert.equal(f.state.requests[0].status, 'pending');
});
test('all changed source files parse and added source comments are forbidden with a positive rejection control', () => {
  const { execFileSync } = require('node:child_process');
  const changed = [...execFileSync('git', ['diff', '--name-only'], { cwd: root, encoding: 'utf8' }).trim().split('\n'), ...execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).trim().split('\n')];
  const hasComment = code => { const scan = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, code); let kind; while ((kind = scan.scan()) !== ts.SyntaxKind.EndOfFileToken) if ([ts.SyntaxKind.SingleLineCommentTrivia, ts.SyntaxKind.MultiLineCommentTrivia].includes(kind)) return true; return false; };
  assert.equal(hasComment('// a historical forbidden explanatory comment'), true); assert.equal(hasComment('const safe = 1;'), false);
  for (const file of changed.filter(file => /^src\/.*\.tsx?$/.test(file))) {
    const parsed = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    assert.deepEqual(parsed.parseDiagnostics, [], file);
    const added = execFileSync('git', ['diff', '--unified=0', '--', file], { cwd: root, encoding: 'utf8' }).split('\n').filter(line => line.startsWith('+') && !line.startsWith('+++')).map(line => line.slice(1));
    if (execFileSync('git', ['ls-files', '--', file], { cwd: root, encoding: 'utf8' }).trim()) {
      assert.ok(!added.some(line => /^\s*(\/\/|\/\*|\*)/.test(line)), file);
    }
  }
  assert.ok(!changed.some(file => file.endsWith('index.generated.ts')));
});

test('overdue pending rows outside terminal retention cannot reappear on first late read', async () => {
  const f = fixture(); await create(f);
  assert.deepEqual(await f.service.getOwnerBoardAccessNotifications(session(), 'Normal', new Date(+NOW + 38 * 86400000)), []);
});
