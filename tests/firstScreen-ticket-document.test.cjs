const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
require('tsx/cjs');
process.env.SESSION_SECRET = 'disposable-ticket-shell-test-secret';
const root = path.resolve(__dirname, '..');
const mock = (name, exports) => {
  const id = name.startsWith('src/') ? path.join(root, name) : require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
};
const Module = require('node:module');
const originalLoad = Module._load;
Module._load = function (id, ...args) { return id === 'server-only' ? {} : originalLoad.call(this, id, ...args); };
test.after(() => { Module._load = originalLoad; });
let cookieValues, requestHeaders, flags, calls, resolveFlags, failRead, foundUser;
const user = { id: 985, email: 'qa@example.invalid', stripe_customer_id: 'private-billing', UserSetting: { snippets: 'private-settings' } };
mock('next/headers', {
  cookies: async () => ({ get: key => cookieValues[key] ? { value: cookieValues[key] } : undefined }),
  headers: async () => requestHeaders,
});
mock('src/lib/prisma.ts', { __esModule: true, default: { user: { findUnique: async ({ where }) => {
  calls.push(['user', where.id]); return foundUser && where.id === 985 ? user : null;
} } } });
mock('src/lib/auth/sessionRevocation.ts', { isSessionTokenRevoked: async () => false });
mock('src/lib/flags.ts', { featureFlagsForUser: async id => {
  calls.push(['flags', id]); assert.equal(id, 985);
  if (failRead) throw Error('Flags unavailable');
  return resolveFlags ? new Promise(resolve => { resolveFlags.release = () => resolve(flags); }) : flags;
}, isFeatureEnabled: async (key, id) => {
  assert.equal(id, 985);
  if (failRead) throw Error('Flags unavailable');
  return flags[key] === true;
} });
const { signSession } = require('../src/lib/auth/session.ts');
const { DEFAULT_TABLE_COLUMNS } = require('../src/utils/helperFunctions/Views/TableColumnsHelperFunctions.ts');
const { BOARD_DISPLAY_COOKIE } = require('../src/lib/firstScreen/boardDisplay.ts');
const { BOARD_FIRST_SCREEN_FLAG } = require('../src/lib/firstScreen/boardDocument.ts');
const { HTPR_7627_TICKET_FIRST_SCREEN_FLAG: ticketFlag, default: definition } = require('../src/lib/flags/definitions/htpr-7627-ticket-first-screen.ts');
const { readTicketShell, getServerTicketShell } = require('../src/lib/firstScreen/serverTicketShell.ts');
const { getTicketShellSeed } = require('../src/lib/firstScreen/ticketShell.ts');
const display = { version: 1, accountId: 985, timeZone: 'UTC', locale: 'en-US', boardLayout: 'table', theme: 'graphite',
  railCollapsed: true, quickTips: false, draftsFirst: false, isMobile: false,
  board: { railOn: false, showEmptyViewTabs: false, hiddenViewTabIds: {}, viewTabsOrder: {}, tableColumns: DEFAULT_TABLE_COLUMNS,
    tableWidths: {}, tableTitleWrap: true, openChat: true, keepChatClosed: true, chatSuppressed: false, chatPinned: false,
    chatWidth: 517, chatSidebarMode: true } };
function reset(route = '/detail/project-8190/26?hash=comment') {
  cookieValues = { ht_session: signSession({ id: 985 }), nookies_user: JSON.stringify({ id: 985 }), [BOARD_DISPLAY_COOKIE]: JSON.stringify(display) };
  requestHeaders = new Headers({ 'x-ht-ticket-document-route': route });
  flags = { [BOARD_FIRST_SCREEN_FLAG]: true, [ticketFlag]: true, 'other-flag': true };
  calls = []; resolveFlags = null; failRead = false; foundUser = true;
}

test('ticket document now gets only its cookie user flags and display, including desktop open-chat preferences', async () => {
  reset(); const seed = await getServerTicketShell();
  assert.deepEqual(Object.keys(seed).sort(), ['accountId', 'display', 'flags']);
  assert.equal(seed.accountId, 985); assert.equal(seed.flags.accountId, 985);
  assert.deepEqual(seed.flags.values, flags); assert.ok(Number.isFinite(Date.parse(seed.flags.evaluatedAt)));
  assert.deepEqual(seed.display, display); assert.equal(getTicketShellSeed(seed, 985), seed);
  assert.deepEqual(calls, [['user', 985], ['flags', 985]]);
  for (const secret of ['private-billing', 'private-settings', cookieValues.ht_session]) assert.equal(JSON.stringify(seed).includes(secret), false);
});

test('numeric, ticket-prefix aliases, trailing slash and catch-all detail suffixes are ticket documents', async () => {
  for (const route of ['/detail/project-15/7627', '/detail/project-15/HTPR-7627', '/detail/project-15/htpr-7627/', '/detail/project-15/7627/comment']) {
    reset(route); assert.ok(await getServerTicketShell(), route);
  }
});

test('RSC, absent header, missing display cookie and non-ticket paths still get no shell', async () => {
  for (const mutate of [() => requestHeaders.set('rsc', '1'), () => requestHeaders.delete('x-ht-ticket-document-route'),
    () => { delete cookieValues[BOARD_DISPLAY_COOKIE]; }]) {
    reset(); mutate(); assert.equal(await getServerTicketShell(), null); assert.deepEqual(calls, []);
  }
  for (const route of ['/project?id=15', '/inbox', '/detail', '/detail/project-15', '/detail/project-15/no-ticket', '/share/project-15/7627', '/settings']) {
    reset(route); assert.equal(await getServerTicketShell(), null, route); assert.deepEqual(calls, []);
  }
});

test('either server flag Off and invalid or other-account display preferences still refuse the shell', async () => {
  for (const flag of [ticketFlag, BOARD_FIRST_SCREEN_FLAG]) {
    reset(); flags[flag] = false; assert.equal(await getServerTicketShell(), null);
  }
  for (const value of ['{}', JSON.stringify({ ...display, accountId: 6 }), JSON.stringify({ ...display, railCollapsed: 'true' })]) {
    reset(); cookieValues[BOARD_DISPLAY_COOKIE] = value; assert.equal(await getServerTicketShell(), null);
    assert.deepEqual(calls, [['user', 985]]);
  }
});

test('missing, forged, expired or mismatched identity and a missing database user never produce flags', async () => {
  for (const mutate of [() => { delete cookieValues.ht_session; }, () => { delete cookieValues.nookies_user; },
    () => { cookieValues.ht_session += 'forged'; }, () => { cookieValues.ht_session = signSession({ id: 985 }, -1); },
    () => { cookieValues.nookies_user = JSON.stringify({ id: 6 }); }, () => { foundUser = false; }]) {
    reset(); mutate(); assert.equal(await getServerTicketShell(), null); assert.ok(calls.every(([name]) => name !== 'flags'));
  }
});

test('an expired deadline or failed flag read returns no partial shell', async () => {
  reset(); assert.equal(await readTicketShell('/detail/project-15/7627', JSON.stringify(display), performance.now() - 1), null);
  assert.ok(calls.every(([name]) => name !== 'flags'));
  reset(); failRead = true; assert.equal(await getServerTicketShell(), null);
  reset(); assert.ok(await getServerTicketShell());
});

test('slow flags fall back within the board document budget and cannot publish after the deadline', async () => {
  reset(); resolveFlags = {};
  const start = performance.now();
  const result = await getServerTicketShell();
  assert.equal(result, null); assert.ok(performance.now() - start >= 790); assert.ok(performance.now() - start < 1000);
  assert.equal(typeof resolveFlags.release, 'function'); resolveFlags.release();
  await new Promise(resolve => setImmediate(resolve)); assert.equal(result, null);
});

test('client shell validation ignores any account mismatch or disabled flag', async () => {
  reset(); const seed = await getServerTicketShell();
  assert.equal(getTicketShellSeed(seed, 6), null);
  for (const bad of [{ ...seed, accountId: 6 }, { ...seed, flags: { ...seed.flags, accountId: 6 } },
    { ...seed, display: { ...seed.display, accountId: 6 } }, { ...seed, flags: { ...seed.flags, evaluatedAt: 'invalid' } }])
    assert.equal(getTicketShellSeed(bad, 985), null);
  for (const flag of [ticketFlag, BOARD_FIRST_SCREEN_FLAG])
    assert.equal(getTicketShellSeed({ ...seed, flags: { ...seed.flags, values: { ...flags, [flag]: false } } }, 985), null);
});

test('per-user HTML rollout is Owner + QA with explicit access risk', () => {
  assert.equal(definition.key, ticketFlag); assert.equal(definition.kind, 'improvement');
  assert.equal(definition.defaultMode, 'OWNER_AND_QA'); assert.equal(definition.releaseRisk.highRisk, 'access');
  assert.ok(definition.releaseRisk.reason);
});
