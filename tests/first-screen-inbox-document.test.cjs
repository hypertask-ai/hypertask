const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
require('tsx/cjs');
process.env.SESSION_SECRET = 'disposable-inbox-document-test-secret';
const root = path.resolve(__dirname, '..');
const mock = (name, exports) => {
  const id = name.startsWith('src/') ? path.join(root, name) : require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (id, ...args) { return id === 'server-only' ? {} : originalLoad.call(this, id, ...args); };
let cookies = {}, requestHeaders, enabled, calls, response, delay, fail, drafts, access;
const user = { id: 985, uid: 'qa', displayName: 'QA', email: 'qa@example.invalid', stripe_customer_id: 'billing-secret',
  UserSetting: { id: 1, onboardingTourStatus: true, snippets: 'private-settings' } };
mock('next/headers', { cookies: async () => ({ get: key => cookies[key] ? { value: cookies[key] } : undefined }), headers: async () => requestHeaders });
mock('src/lib/prisma.ts', { __esModule: true, default: { user: { findUnique: async ({ where }) => where.id === 985 ? user : null } } });
mock('src/lib/flags.ts', { featureFlagsForUser: async id => { assert.equal(id, 985); return { 'htpr-6934-server-first-screen': enabled, 'other-flag': true }; } });
mock('src/utils/controllers/notifications/getAll.ts', { __esModule: true, default: async id => {
  calls.push(['notifications', id]); if (fail) throw Error('read failed');
  if (delay) await new Promise(resolve => setTimeout(resolve, delay)); return response;
} });
mock('src/utils/controllers/notifications/getAccessibleProjectIds.ts', { getInboxAccessibleProjectIds: async id => { calls.push(['access', id]); return access; } });
mock('src/utils/controllers/drafts/getUserDrafts.ts', { __esModule: true, default: async id => { calls.push(['drafts', id]); return drafts; } });
mock('src/utils/controllers/users/fetch_preferences.ts', { fetchUserPreferenceController: async id => {
  calls.push(['preferences', id]); return { status: 200, res: { displayAvatar: 'Show', snippets: ['private-snippet'], aiModelPreferences: 'private-models' } };
} });
const { signSession } = require('../src/lib/auth/session.ts');
const { DEFAULT_TABLE_COLUMNS } = require('../src/utils/helperFunctions/Views/TableColumnsHelperFunctions.ts');
const { BOARD_DISPLAY_COOKIE } = require('../src/lib/firstScreen/boardDisplay.ts');
const { readInboxDocument, getServerInboxDocument } = require('../src/lib/firstScreen/serverInboxDocument.ts');
const { getInboxDocument } = require('../src/lib/firstScreen/inboxDocument.ts');
const { projectInboxDateGroup } = require('../src/lib/firstScreen/inbox.ts');
const display = { version: 1, accountId: 985, timeZone: 'America/Los_Angeles', locale: 'en-US', boardLayout: 'board', theme: 'porcelain',
  railCollapsed: true, quickTips: false, draftsFirst: false, isMobile: true,
  inbox: { nudgeDismissed: false, pushPermission: "default", pushEnabled: false },
  board: { railOn: true, showEmptyViewTabs: false, hiddenViewTabIds: {}, viewTabsOrder: {}, tableColumns: DEFAULT_TABLE_COLUMNS,
    tableWidths: {}, tableTitleWrap: true, openChat: true, chatSuppressed: false, chatPinned: false } };
const row = (id, projectId = 15, overrides = {}) => ({ id, userId: 985, type: 'Comment', createdAt: '2026-10-04T00:30:00.000Z',
  seen: false, status: 'Normal', taskId: id, projectId, project: { id: projectId, title: `Board ${projectId}`, name: `Board ${projectId}` },
  task: { id, projectId, uniqueIndex: id, title: `Visible ${id}`, ticketNumber: `QA-${id}`, status: 'Normal', section: 'To do' },
  fromUser: { id: 986, displayName: 'Sender', email: 'sender-private@example.invalid' }, ...overrides });
function reset() {
  enabled = true; calls = []; fail = false; delay = 0; access = [15];
  response = { status: 200, json: { notifications: [row(1)], structuredData: { tabs: [{ project: 'unsafe stale tabs' }], data: [[777]] }, splitsNoImportant: [], showImportantSplit: false } };
  drafts = [{ id: 1, userId: 985, taskId: 1, type: 'Comment', saved: false, content: '<p>Draft preview</p>', updatedAt: '2026-10-04T01:30:00.000Z', task: row(1).task }];
  cookies = { ht_session: signSession({ id: 985, email: user.email }), nookies_user: JSON.stringify({ id: 985 }), [BOARD_DISPLAY_COOKIE]: JSON.stringify(display) };
  requestHeaders = new Headers({ 'x-ht-inbox-document-route': '/inbox?split=All' });
}

test('signed inbox uses existing controllers with verified identity, complete live projection and selected split', async () => {
  reset(); const snapshot = await readInboxDocument('/inbox?split=All', JSON.stringify(display));
  assert.ok(snapshot); assert.ok(getInboxDocument(snapshot, 985)); assert.equal(getInboxDocument(snapshot, 986), null);
  assert.deepEqual(calls, [['notifications', '985'], ['access', 985], ['drafts', 985], ['preferences', 985]]);
  assert.equal(snapshot.data.payload.structuredData.tabs[snapshot.selection.split].project, 'All');
  assert.equal(snapshot.data.payload.structuredData.data[snapshot.selection.split][0].task.title, 'Visible 1');
  assert.equal(snapshot.data.drafts[0].content, '<p>Draft preview</p>');
  assert.deepEqual(snapshot.data.counts, { all: 1, unseen: 1 });
  assert.equal(snapshot.data.displayAvatar, 'Show'); assert.equal(snapshot.completeness, 'complete');
  assert.equal(snapshot.data.isInboxZero, false); assert.equal(snapshot.data.zeroImage, null);
  assert.equal(snapshot.data.payload.readModelRevision, undefined, 'server timestamps are not browser revisions');
  assert.equal(projectInboxDateGroup('2026-10-03T23:30:00.000Z', '2026-10-04T00:30:00.000Z', display.timeZone), 'today');
  const wire = JSON.stringify(snapshot);
  for (const secret of ['billing-secret', 'private-settings', 'private-snippet', 'private-models', 'sender-private', 'unsafe stale tabs', cookies.ht_session]) assert.equal(wire.includes(secret), false, secret);
});

test('other user and revoked project/task rows and drafts never reach serialized payload, rebuilt tabs or counts', async () => {
  reset(); response.json.notifications.push(row(2, 15, { userId: 986, task: { ...row(2).task, title: 'OTHER USER SECRET' } }),
    row(3, 99), row(4, 15, { task: { ...row(4).task, projectId: 99, title: 'MISMATCH SECRET' } }));
  drafts.push({ ...drafts[0], id: 2, userId: 986, content: 'OTHER DRAFT SECRET' }, { ...drafts[0], id: 3, task: row(3, 99).task, content: 'REVOKED DRAFT SECRET' });
  const snapshot = await readInboxDocument('/inbox?projectId=15', JSON.stringify(display));
  assert.deepEqual(snapshot.data.payload.notifications.map(r => r.id), [1]); assert.equal(snapshot.data.drafts.length, 1);
  assert.deepEqual(snapshot.data.counts, { all: 1, unseen: 1 });
  assert.equal(snapshot.data.payload.structuredData.tabs[snapshot.selection.split].projectId, 15);
  assert.doesNotMatch(JSON.stringify(snapshot), /OTHER USER SECRET|MISMATCH SECRET|OTHER DRAFT SECRET|REVOKED DRAFT SECRET|Board 99/);
  access = []; const empty = await readInboxDocument('/inbox', JSON.stringify(display));
  assert.equal(empty.data.payload.notifications.length, 0); assert.equal(empty.data.isInboxZero, true);
});

test('controller visibility is retained for guest, hidden section, archived reminder and synthetic waiting-on rows', async () => {
  reset(); user.email = 'guest@demo.hypertask.ai';
  response.json.notifications = [row(1, 15, { returnedFromReminders: true, task: { ...row(1).task, status: 'Archive', section: 'API-visible section' } }),
    row(-2, 15, { waitingOnSynthetic: true, type: 'TaskReminder', seen: true })];
  const snapshot = await readInboxDocument('/inbox?showAll=true', JSON.stringify(display));
  assert.deepEqual(snapshot.data.payload.notifications.map(r => r.id), [1, -2]);
  assert.equal(snapshot.data.payload.notifications[0].task.status, 'Archive');
  assert.equal(snapshot.data.counts.all, 1); user.email = 'qa@example.invalid';
});

test('projectless agent messages keep the complete legacy path instead of silently losing rows and counts', async () => {
  reset(); response.json.notifications.push(row(2, null, { type: 'AgentMessage', taskId: null, task: null, project: null, fromAgentId: 42 }));
  assert.equal(await readInboxDocument('/inbox?split=All', JSON.stringify(display)), null);
  assert.equal(response.json.notifications.length, 2, 'the signed controller response is untouched');
});

test('authoritative empty selection seeds the existing zero image once, but an All draft prevents false zero', async () => {
  reset(); response.json.notifications = []; drafts = [];
  const empty = await readInboxDocument('/inbox', JSON.stringify(display));
  assert.equal(empty.data.isInboxZero, true); assert.match(empty.data.zeroImage, /^https:\/\//);
  reset(); response.json.notifications = [];
  const all = await readInboxDocument('/inbox?split=All', JSON.stringify(display));
  assert.equal(all.data.isInboxZero, false); assert.equal(all.data.zeroImage, null);
});

test('flag OFF, unknown or wrong-account preferences and tutorial routes use the unchanged path without inbox reads', async () => {
  reset(); enabled = false; assert.equal(await readInboxDocument('/inbox', JSON.stringify(display)), null); assert.deepEqual(calls, []);
  for (const value of [undefined, '{}', JSON.stringify({ ...display, accountId: 986 })]) {
    reset(); assert.equal(await readInboxDocument('/inbox', value), null); assert.deepEqual(calls, []);
  }
  reset(); assert.equal(await readInboxDocument('/inbox?tutorial=1', JSON.stringify(display)), null); assert.deepEqual(calls, []);
});

test('forged, mismatched, expired, Better-Auth-only and missing sessions expose no inbox payload', async () => {
  for (const change of [() => { delete cookies.ht_session; }, () => { cookies.ht_session += 'forged'; },
    () => { cookies.nookies_user = JSON.stringify({ id: 986 }); }, () => { cookies.ht_session = signSession({ id: 985, email: user.email }, -1); },
    () => { delete cookies.nookies_user; cookies['better-auth.session_token'] = 'not-a-legacy-session'; }]) {
    reset(); change(); assert.equal(await readInboxDocument('/inbox', JSON.stringify(display)), null); assert.deepEqual(calls, []);
  }
});

test('failure and 800ms deadline return the old path and a late read cannot publish', async () => {
  reset(); fail = true; assert.equal(await getServerInboxDocument(), null);
  reset(); response = { status: 500, json: [] }; assert.equal(await getServerInboxDocument(), null);
  reset(); delay = 1000; const start = performance.now(); const result = await getServerInboxDocument();
  assert.equal(result, null); assert.ok(performance.now() - start >= 790); assert.ok(performance.now() - start < 950);
});

test('RSC navigation and requests without the proxy document hint cannot initialize the live root', async () => {
  reset(); requestHeaders.set('rsc', '1'); assert.equal(await getServerInboxDocument(), null); assert.deepEqual(calls, []);
  reset(); requestHeaders.delete('x-ht-inbox-document-route'); assert.equal(await getServerInboxDocument(), null); assert.deepEqual(calls, []);
});

test('inbox HTML and Flight use dynamic private no-store with replaced caller route hints', () => {
  const page = fs.readFileSync(path.join(root, 'src/app/inbox/page.tsx'), 'utf8');
  assert.match(page, /export const dynamic = "force-dynamic"/); assert.match(page, /export const revalidate = 0/);
  const proxy = fs.readFileSync(path.join(root, 'src/proxy.ts'), 'utf8');
  assert.match(proxy, /forwardedHeaders.delete\('x-ht-inbox-document-route'\)/);
  assert.match(proxy, /request.nextUrl.pathname === '\/inbox'/);
  for (const header of ['Cache-Control', 'CDN-Cache-Control', 'Vercel-CDN-Cache-Control']) assert.ok(proxy.includes(`response.headers.set('${header}'`));
});
