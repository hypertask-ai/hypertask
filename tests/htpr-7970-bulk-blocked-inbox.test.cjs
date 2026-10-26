const assert = require("node:assert/strict");
const test = require("node:test");
const { QueryClient } = require("@tanstack/react-query");
const { load } = require("./task-route-loader.cjs");

const key = "htpr-7970-bulk-blocked-inbox";
const blocked = id => ({ id: String(-id), taskId: id, waitingOnSynthetic: true, type: "TaskReminder", userId: 985 });
const regular = (id, taskId) => ({ id: String(id), taskId, type: "Comment", userId: 985 });
function fixture(t, { enabled = true, rows = [blocked(42), blocked(43)], failTask = null, typed = false } = {}) {
  const queryClient = new QueryClient();
  const queryKey = ["inbox", "data", 985];
  const payload = notifications => ({ notifications, structuredData: { tabs: [{ project: "All" }], data: [notifications] } });
  queryClient.setQueryData(queryKey, payload(rows));
  const requests = [], undos = [], reconciliations = [];
  queryClient.invalidateQueries = async () => { reconciliations.push(true); };
  const fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: !url.includes(`taskId=${failTask}&`), status: 200 };
  };
  t.mock.method(global, "fetch", fetch);
  const mocks = {
    "@/lib/api/typedClient": { archiveNotifications: async body => { requests.push({ body, typed: true }); return { status: 200, data: {} }; }, toggleNotificationArchive: async body => { requests.push({ body, typed: true }); return { ok: body.taskId !== failTask }; } },
    "@/hooks/useFlag": { useFlag: flag => flag === key ? enabled : flag === "htpr-7840-blocked-inbox-archive" || (typed && flag === "htpr-6979-typed-writes") },
    "@/lib/flags/keys": { HTPR_6979_TYPED_WRITES_FLAG: "htpr-6979-typed-writes" },
    "@/store": {},
    "@/lib/state": { useRecoilState: () => [{ currSplit: 0, currIdx: 0 }, () => {}], useRecoilValue: () => ({ id: 985 }), useSetRecoilState: () => () => {} },
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "@/utils/helperFunctions/helperFunctions": {},
    "../General/useUndo": { useUndoContext: () => ({ performActionAndStoreUndoData: (...args) => undos.push(args) }) },
    "next/navigation": { usePathname: () => "/inbox", useRouter: () => ({ refresh() {} }), useSearchParams: () => new URLSearchParams() },
    axios: {}, "@prisma/client": {},
    "@/utils/axiosClient": { default: { post: async (url, body) => requests.push({ url, body }) } },
    "@/lib/realtime/client": { realtimeEchoHeaders: () => ({}) },
    "./useGetNotifications": { inboxDataQueryKey: () => queryKey },
    "@/lib/inboxSync/optimistic": load("src/lib/inboxSync/optimistic.ts", { "@/lib/boardSync/pilot": {}, "@/utils/helperFunctions/helperFunctions": { buildInboxQueryCache: payload }, "./revision": { isInboxReadModelRevision: () => false } }),
  };
  const handler = load("src/hooks/Inbox/useGlobalFocusHandler.tsx", mocks).default();
  return { handler, rows, requests, undos, reconciliations, cached: () => queryClient.getQueryData(queryKey).notifications };
}

for (const typed of [false, true]) {
  test(`bulk archive dismisses all 20 synthetic rows, including optimistic state (${typed ? "typed" : "legacy"})`, async t => {
    const f = fixture(t, { rows: Array.from({ length: 20 }, (_, i) => blocked(42 + i)), typed });
    await f.handler.bulkArchiveNotifications(f.rows, "Notification", () => {});
    assert.equal(f.requests.length, 20);
    assert.deepEqual(f.cached(), []);
    assert.equal(f.undos.length, 1);
    assert.equal(f.undos[0][0].syntheticNotifications.length, 20);
    assert.deepEqual(f.undos[0][0].notificationIds, []);
    assert.equal(f.reconciliations.length, 1);
  });
}

test("mixed selection archives each blocked task once and keeps ordinary bulk", async t => {
  const f = fixture(t, { rows: [blocked(42), regular(701, 42), regular(702, 44)] });
  await f.handler.bulkArchiveNotifications(f.rows, "Notification", () => {});
  assert.equal(f.requests.length, 2);
  const bulk = f.requests.find(request => request.body);
  assert.deepEqual(bulk.body.notificationIds.map(row => row.notificationId), [702]);
  assert.deepEqual(f.cached(), []);
  assert.equal(f.undos[0][0].syntheticNotifications.length, 1);
});

test("flag off leaves synthetic rows alone and preserves regular bulk", async t => {
  const f = fixture(t, { enabled: false, rows: [blocked(42), regular(702, 44)] });
  await f.handler.bulkArchiveNotifications(f.rows, "Notification", () => {});
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requests[0].body.notificationIds.map(row => row.notificationId), [702]);
  assert.deepEqual(f.cached().map(row => row.id), ["-42"]);
});

test("failed synthetic archives are reconciled and never get an undo toggle", async t => {
  const f = fixture(t, { failTask: 43 });
  await f.handler.bulkArchiveNotifications(f.rows, "Notification", () => {});
  assert.deepEqual(f.undos[0][0].syntheticNotifications.map(row => row.taskId), [42]);
  assert.equal(f.reconciliations.length, 1);
});

test("bulk undo uses the existing synthetic undo boundary and ordinary bulk restore", async t => {
  const requests = [];
  t.mock.method(global, "fetch", async (url, options) => { requests.push({ url, options }); return { ok: true }; });
  const { UndoInboxArchive } = load("src/utils/undoActions/helperFuncs.ts", {
    "@/lib/constants/APIRouteConstants": {}, "@/lib/realtime/client": { realtimeEchoHeaders: () => ({}) }, "../api/global": {},
  });
  await UndoInboxArchive({ isBulkOperation: true, currentUser: { id: 985 }, syntheticNotifications: [blocked(42), blocked(43)], notificationIds: [{ notificationId: 702, taskId: 44, userId: 985 }] });
  assert.equal(requests.length, 3);
  assert.equal(requests.filter(request => request.url.includes("markAsDone")).length, 2);
  assert.ok(requests.filter(request => request.url.includes("markAsDone")).every(request => !request.url.includes("intent=archive")));
  assert.equal(JSON.parse(requests.find(request => request.options?.body).options.body).status, "Normal");
});

test("synthetic-only undo does not send an empty bulk restore", async t => {
  const requests = [];
  t.mock.method(global, "fetch", async url => { requests.push(url); return { ok: true }; });
  const { UndoInboxArchive } = load("src/utils/undoActions/helperFuncs.ts", { "@/lib/constants/APIRouteConstants": {}, "@/lib/realtime/client": { realtimeEchoHeaders: () => ({}) }, "../api/global": {} });
  await UndoInboxArchive({ isBulkOperation: true, currentUser: { id: 985 }, syntheticNotifications: [blocked(42)], notificationIds: [] });
  assert.equal(requests.length, 1);
  assert.ok(requests[0].includes("id=-42"));
});

test("the bugfix defaults to Everyone", () => {
  const flag = load(`src/lib/flags/definitions/${key}.ts`, {}).default;
  assert.equal(flag.kind, "bugfix");
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.releaseRisk.risk, "small");
});


test("one failed synthetic undo cannot skip unrelated restores", async t => {
  const requests = [];
  t.mock.method(global, "fetch", async (url, options) => {
    requests.push({ url, options });
    if (url.includes("id=-42&")) throw new Error("Connection lost");
    return { ok: true };
  });
  const { UndoInboxArchive } = load("src/utils/undoActions/helperFuncs.ts", { "@/lib/constants/APIRouteConstants": {}, "@/lib/realtime/client": { realtimeEchoHeaders: () => ({}) }, "../api/global": {} });
  await assert.rejects(UndoInboxArchive({ isBulkOperation: true, currentUser: { id: 985 }, syntheticNotifications: [blocked(42), blocked(43)], notificationIds: [{ notificationId: 702, taskId: 44, userId: 985 }] }), /Connection lost/);
  assert.equal(requests.length, 3);
  assert.ok(requests.some(request => request.url.endsWith("(un)archiveBulk")));
});
