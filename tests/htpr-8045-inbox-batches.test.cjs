const test = require("node:test");
const assert = require("node:assert/strict");
const { load } = require("./task-route-loader.cjs");

function fixture({ enabled = true, count = 601, agentId = null } = {}) {
  const rows = Array.from({ length: count }, (_, i) => ({
    id: i + 1, taskId: i + 101, userId: 985, agentId,
    status: "Normal", archivedAt: null, type: "Comment",
    createdAt: "2026-10-26T00:00:00.000Z", message: null, comment: { id: i + 1, text: "Update" },
    task: { id: i + 101, title: `Ticket ${i + 1}`, ticketNumber: `QA-${i + 1}`, projectId: 99, uniqueIndex: i + 1 },
  }));
  const values = new Map();
  const redis = {
    set: async (key, value) => values.set(key, value),
    get: async (key) => values.get(key) ?? null,
    del: async (key) => values.delete(key),
    getdel: async (key) => { const value = values.get(key) ?? null; values.delete(key); return value; },
  };
  function matches(row, where) {
    return Object.entries(where).every(([key, value]) => {
      if (key === "OR") return value.some((clause) => matches(row, clause));
      if (value && typeof value === "object") {
        if ("in" in value) return value.in.includes(row[key]);
        if ("notIn" in value) return !value.notIn.includes(row[key]);
        if ("not" in value) return row[key] !== value.not;
      }
      return row[key] === value;
    });
  }
  let broadcasts = 0;
  const notification = {
    findMany: async ({ where, skip = 0, take }) => rows.filter((row) => matches(row, where)).sort((a, b) => a.id - b.id).slice(skip, take === undefined ? undefined : skip + take).map((row) => ({ ...row })),
    count: async ({ where }) => rows.filter((row) => matches(row, where)).length,
    updateMany: async ({ where, data }) => {
      const selected = rows.filter((row) => matches(row, where));
      for (const row of selected) Object.assign(row, data);
      return { count: selected.length };
    },
  };
  const prisma = { notification, $transaction: async (run, options) => {
    assert.equal(options.isolationLevel, "Serializable");
    return run({ notification });
  } };
  const mocks = {
    ai: { tool: (definition) => definition },
    "@/lib/prisma": { default: prisma },
    "@/lib/redis": { getRedis: async () => redis },
    "@/lib/flags": { isFeatureEnabled: async () => enabled },
    "@/lib/realtime/server": { broadcastInboxChange: async () => { broadcasts++; } },
    "@/lib/ai/tools/execution": { withToolErrors: (execute) => execute },
    "@/lib/ai/tools/helpers": { sanitizeForJson: (value) => JSON.parse(JSON.stringify(value)) },
    "@/utils/controllers/notifications/getAll": {
      default: async () => ({ status: 200, json: { notifications: rows.filter((row) => row.userId === 985 && row.agentId === null && row.status === "Normal") } }),
      notificationInboxInclude: () => ({}),
    },
    "@/utils/controllers/notifications/getStructuredInboxForAgent": {
      getStructuredInboxForAgent: async () => ({ ok: true, notifications: rows.filter((row) => row.agentId === agentId && row.status === "Normal") }),
    },
    "@/lib/nativeAgent/heartbeatTurnEnvelope": { isNotificationInHeartbeatWindow: (createdAt, after, through) => (!after || createdAt > after) && createdAt <= through },
  };
  const { createInboxListTool } = load("src/lib/ai/tools/inboxList.ts", mocks);
  const { createInboxArchiveTool } = load("src/lib/ai/tools/inboxArchive.ts", mocks);
  function turn({ userId = 985, sessionId = "chat-8045", heartbeatTurn } = {}) {
    const context = { user: { id: userId }, actingAgentId: agentId, confirmationSessionId: sessionId, bulkPreviewsIssued: new Set(), sendStatus() {}, heartbeatTurn };
    const list = createInboxListTool(context).hypertask_inbox_list;
    const archive = createInboxArchiveTool(context).hypertask_inbox_archive;
    return {
      list: (input = {}) => list.execute(list.inputSchema.parse(input)),
      archive: (input) => archive.execute(archive.inputSchema.parse(input)),
    };
  }
  return { rows, values, turn, broadcasts: () => broadcasts };
}

for (const agentId of [null, "agent-13"]) {
  test(`pages through 601 ${agentId ? "agent" : "human"} notifications without confirmation or repeats`, async () => {
    const f = fixture({ agentId });
    const turn = f.turn();
    const first = await turn.list({ limit: 500 });
    assert.equal(first.success, true);
    assert.equal(first.confirmation_required, undefined);
    assert.equal(first.user_notifications.length, 500);
    assert.equal(first.next_offset, 500);
    const last = await turn.list({ limit: 500, offset: first.next_offset });
    assert.equal(last.next_offset, null);
    assert.equal(last.total, 601);
    assert.deepEqual([...first.user_notifications, ...last.user_notifications].map((row) => row.id), Array.from({ length: 601 }, (_, i) => i + 1));
    assert.equal(f.broadcasts(), 0);
  });
}

test("one later confirmation archives exactly the preview, names tickets and discloses siblings", async () => {
  const f = fixture({ count: 3 });
  f.rows[1].taskId = f.rows[0].taskId;
  f.rows[1].task = f.rows[0].task;
  const first = f.turn();
  const listed = await first.list();
  const input = { notification_ids: [1], list_tokens: [listed.list_token] };
  const preview = await first.archive(input);
  assert.equal(preview.confirmation_required, true);
  assert.equal(preview.archive_count, 2);
  assert.equal(preview.sibling_count, 1);
  assert.deepEqual(preview.notifications.map((row) => [row.id, row.task.ticketNumber, row.sibling]), [[1, "QA-1", false], [2, "QA-1", true]]);
  assert.equal((await first.archive({ ...input, confirmed: true })).confirmation_required, true);
  assert.equal(f.rows.filter((row) => row.status === "Archive").length, 0);
  const result = await f.turn().archive({ ...input, confirmed: true });
  assert.equal(result.success, true);
  assert.equal(result.archived_count, 2);
  assert.deepEqual(result.notifications, preview.notifications);
  assert.deepEqual(f.rows.map((row) => row.status), ["Archive", "Archive", "Normal"]);
  assert.equal(f.broadcasts(), 1);
  assert.equal((await f.turn().archive({ ...input, confirmed: true })).success, false);
});

test("wrong batch, wrong user, another session and expired receipts cannot archive", async () => {
  const f = fixture({ count: 3 });
  const listed = await f.turn().list({ limit: 1 });
  for (const [turn, ids] of [[f.turn(), [2]], [f.turn({ userId: 42 }), [1]], [f.turn({ sessionId: "other" }), [1]]]) {
    const result = await turn.archive({ notification_ids: ids, list_tokens: [listed.list_token], confirmed: true });
    assert.equal(result.success, false);
    assert.match(result.error, /List this exact batch/);
  }
  f.values.clear();
  assert.equal((await f.turn().archive({ notification_ids: [1], list_tokens: [listed.list_token], confirmed: true })).success, false);
  assert.ok(f.rows.every((row) => row.status === "Normal"));
});

for (const drift of ["new sibling", "changed comment", "changed title", "archived target", "wrong batch"]) {
  test(`refuses ${drift} after preview without archiving anything else`, async () => {
    const f = fixture({ count: 3 });
    const listed = await f.turn().list();
    const input = { notification_ids: [1], list_tokens: [listed.list_token] };
    assert.equal((await f.turn().archive(input)).confirmation_required, true);
    if (drift === "new sibling") f.rows[1].taskId = f.rows[0].taskId;
    if (drift === "changed comment") f.rows[0].comment = { id: 1, text: "New question" };
    if (drift === "changed title") f.rows[0].task = { ...f.rows[0].task, title: "Changed" };
    if (drift === "archived target") f.rows[0].status = "Archive";
    if (drift === "wrong batch") input.notification_ids = [3];
    const result = await f.turn().archive({ ...input, confirmed: true });
    assert.equal(result.success, false);
    assert.equal(f.broadcasts(), 0);
    assert.ok(f.rows.slice(1).every((row) => row.status === "Normal"));
  });
}

test("confirmation does not apply to a different session or a second batch", async () => {
  const f = fixture({ count: 3 });
  const listed = await f.turn().list();
  const input = { notification_ids: [1], list_tokens: [listed.list_token] };
  await f.turn().archive(input);
  assert.equal((await f.turn({ sessionId: "other" }).archive({ ...input, confirmed: true })).success, false);
  assert.equal((await f.turn().archive({ ...input, notification_ids: [2], confirmed: true })).confirmation_required, true);
  assert.equal((await f.turn().archive({ ...input, confirmed: true })).success, true);
  assert.equal(f.rows[1].status, "Normal");
});

test("multiple page receipts allow a batch spanning pages, but not an unlisted id", async () => {
  const f = fixture({ count: 601 });
  const a = await f.turn().list({ limit: 500 });
  const b = await f.turn().list({ limit: 500, offset: 500 });
  const input = { notification_ids: [1, 601], list_tokens: [a.list_token, b.list_token] };
  assert.equal((await f.turn().archive(input)).archive_count, 2);
  const result = await f.turn().archive({ ...input, confirmed: true });
  assert.equal(result.archived_count, 2);
  assert.deepEqual(result.notifications.map((row) => row.task.ticketNumber), ["QA-1", "QA-601"]);
});

test("human archive leaves same-task agent and other-user messages alone", async () => {
  const f = fixture({ count: 3 });
  f.rows[1].taskId = f.rows[0].taskId;
  f.rows[1].agentId = "another-agent";
  f.rows[2].taskId = f.rows[0].taskId;
  f.rows[2].userId = 42;
  const listed = await f.turn().list();
  const input = { notification_ids: [1], list_tokens: [listed.list_token] };
  assert.equal((await f.turn().archive(input)).archive_count, 1);
  assert.equal((await f.turn().archive({ ...input, confirmed: true })).archived_count, 1);
  assert.deepEqual(f.rows.map((row) => row.status), ["Archive", "Normal", "Normal"]);
});

test("heartbeat reads stay inside the invocation window when paging", async () => {
  const f = fixture({ agentId: "agent-13", count: 3 });
  f.rows[0].createdAt = "2026-10-25T00:00:00.000Z";
  const result = await f.turn({ heartbeatTurn: { previousHeartbeatAt: "2026-10-25T12:00:00.000Z", scanWatermark: "2026-10-26T01:00:00.000Z" } }).list({ limit: 1, offset: 1 });
  assert.deepEqual(result.user_notifications.map((row) => row.id), [3]);
  assert.equal(result.next_offset, null);
});

test("flag off preserves the 50 default, 100 cap, old archive response and no receipts", async () => {
  const f = fixture({ enabled: false });
  const turn = f.turn();
  assert.equal((await turn.list()).user_notifications.length, 50);
  const result = await turn.list({ limit: 500, offset: 500 });
  assert.deepEqual(result.user_notifications.map((row) => row.id), Array.from({ length: 100 }, (_, i) => i + 1));
  assert.equal(result.list_token, undefined);
  assert.equal(result.next_offset, undefined);
  assert.deepEqual(await turn.archive({ notification_ids: [1] }), { success: true, archived_count: 1 });
  assert.equal(f.values.size, 0);
});

test("ticket flag is an Everyone improvement with explicit rollback risk", () => {
  const { default: flag } = load("src/lib/flags/definitions/htpr-8045-inbox-batches.ts", {});
  assert.equal(flag.defaultMode, "EVERYONE");
  assert.equal(flag.kind, "improvement");
  assert.equal(flag.releaseRisk.risk, "small");
});

test("stable cursor does not skip later messages after archiving an earlier page", async () => {
  const f = fixture({ count: 601 });
  const turn = f.turn();
  const first = await turn.list({ limit: 500 });
  const input = { notification_ids: [1], list_tokens: [first.list_token] };
  await turn.archive(input);
  assert.equal((await f.turn().archive({ ...input, confirmed: true })).success, true);
  const next = await f.turn().list({ limit: 500, cursor: first.next_cursor });
  assert.deepEqual(next.user_notifications.map((row) => row.id), Array.from({ length: 101 }, (_, i) => i + 501));
  assert.equal(next.next_cursor, null);
  assert.equal(next.total, 600);
  assert.equal(next.snapshot_total, 601);
  assert.equal((await f.turn().archive({ notification_ids: [601], list_tokens: [first.next_cursor.token] })).success, false);
});

test("compact read retains message-only content and marks truncated comments", async () => {
  const f = fixture({ count: 1 });
  f.rows[0].task = null;
  f.rows[0].taskId = null;
  f.rows[0].message = "A direct agent question";
  f.rows[0].comment.text = "x".repeat(1000);
  const result = await f.turn().list();
  assert.equal(result.user_notifications[0].message, "A direct agent question");
  assert.equal(result.user_notifications[0].comment_text.length, 500);
  assert.equal(result.user_notifications[0].comment_truncated, true);
  assert.equal(result.user_notifications[0].task, null);
});


test("an empty model reply still reports exact archived counts and every cleared ticket", () => {
  const { buildEmptyCompletionSummary } = load("src/app/api/ai/chat/stream/bulkTools.ts", {});
  const summary = buildEmptyCompletionSummary({
    toolExecutions: [{ name: "hypertask_inbox_archive", result: { success: true, archived_count: 3, notifications: [
      { task: { ticketNumber: "QA-1", title: "First" } },
      { task: { ticketNumber: "QA-1", title: "First" } },
      { task: { ticketNumber: "QA-2", title: "Second" } },
    ] } }],
    writeToolNames: new Set(["hypertask_inbox_archive"]), reachedStepLimit: false, maxToolSteps: 32,
  });
  assert.match(summary, /Archived 3 inbox messages/);
  assert.match(summary, /QA-1: First; QA-2: Second/);
});


test("an empty model reply preserves archive previews and failed calls", () => {
  const { buildEmptyCompletionSummary } = load("src/app/api/ai/chat/stream/bulkTools.ts", {});
  const summarize = (results) => buildEmptyCompletionSummary({
    toolExecutions: results.map((result) => ({ name: "hypertask_inbox_archive", result })),
    writeToolNames: new Set(["hypertask_inbox_archive"]), reachedStepLimit: false, maxToolSteps: 32,
  });
  const preview = { success: false, confirmation_required: true, archive_count: 2, sibling_count: 1, notifications: [
    { task: { ticketNumber: "QA-1", title: "Pending" } },
    { task: { ticketNumber: "QA-2", title: "Sibling" } },
  ] };
  const pendingOnly = summarize([preview]);
  assert.match(pendingOnly, /2 inbox messages.*approval/i);
  assert.match(pendingOnly, /QA-1: Pending; QA-2: Sibling/);
  assert.match(pendingOnly, /1 sibling/);
  assert.match(pendingOnly, /confirm/i);
  assert.doesNotMatch(pendingOnly, /Archived 0/);
  assert.doesNotMatch(pendingOnly, /call failed/);
  const mixed = summarize([
    { success: true, archived_count: 1, notifications: [{ task: { ticketNumber: "QA-3", title: "Cleared" } }] },
    preview,
    { success: false, error: "The listed batch changed. Nothing was archived." },
  ]);
  assert.match(mixed, /Archived 1 inbox message.*QA-3: Cleared/);
  assert.match(mixed, /2 inbox messages.*approval/i);
  assert.match(mixed, /1 tool call failed/);
  assert.match(mixed, /listed batch changed/);
});

test("a plain later yes replays the server-saved batch without model-retained IDs or receipts", async () => {
  const f = fixture({ count: 3 });
  const turn = f.turn();
  const listed = await turn.list();
  assert.equal((await turn.archive({ notification_ids: [1, 2], list_tokens: [listed.list_token] })).confirmation_required, true);
  assert.equal((await turn.archive({ confirmed: true })).confirmation_required, true);
  assert.ok(f.rows.every((row) => row.status === "Normal"));
  assert.equal((await f.turn({ sessionId: "other" }).archive({ confirmed: true })).success, false);
  const result = await f.turn().archive({ confirmed: true });
  assert.equal(result.success, true);
  assert.equal(result.archived_count, 2);
  assert.deepEqual(result.notifications.map((row) => row.id), [1, 2]);
  assert.equal(f.rows[2].status, "Normal");
  assert.equal((await f.turn().archive({ confirmed: true })).success, false);
});


test("next page works across plain user turns without retaining a cursor UUID", async () => {
  const f = fixture({ count: 601 });
  const first = await f.turn().list({ limit: 500 });
  assert.equal(first.next_offset, 500);
  const next = await f.turn().list({ limit: 500, continue: true });
  assert.deepEqual(next.user_notifications.map((row) => row.id), Array.from({ length: 101 }, (_, i) => i + 501));
  assert.equal(next.next_cursor, null);
  assert.deepEqual((await f.turn().list({ continue: true })).user_notifications, []);
  assert.equal((await f.turn({ sessionId: "other" }).list({ continue: true })).success, false);
});
