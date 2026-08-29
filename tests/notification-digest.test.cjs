const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

// digest.ts binds redis/qstash at module scope, so it must be evicted alongside
// its stubs or a cached copy keeps the previous test's fakes.
const stubbedModulePaths = [
  "src/lib/redis.ts",
  "src/lib/qstash.ts",
  "src/utils/controllers/notifications/digest.ts",
];

function resetModules() {
  for (const relativePath of stubbedModulePaths) {
    delete require.cache[path.join(root, relativePath)];
  }
}

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/jiti-entry-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  return jiti(path.join(root, relativePath));
}

/**
 * Loads digest.ts against a fake Redis and a recording publishJob.
 * `setResults` queues the return of each redis.set call ("OK" = window claimed).
 */
function loadDigest({
  setResults = ["OK"],
  publishThrows = false,
  store = {},
} = {}) {
  resetModules();
  const calls = { published: [], deleted: [], set: [] };
  const queued = [...setResults];

  stubModule("src/lib/redis.ts", {
    getRedis: async () => ({
      set: async (key, value, ...rest) => {
        calls.set.push({ key, value, rest });
        store[key] = value;
        return queued.length ? queued.shift() : null;
      },
      get: async (key) => store[key] ?? null,
      del: async (key) => {
        calls.deleted.push(key);
        delete store[key];
        return 1;
      },
    }),
  });

  stubModule("src/lib/qstash.ts", {
    publishJob: async (opts) => {
      if (publishThrows) throw new Error("qstash down");
      calls.published.push(opts);
      return { messageId: "msg_1" };
    },
  });

  const mod = loadTs("src/utils/controllers/notifications/digest.ts");
  return { mod, calls, store };
}

test("first event opens a window and schedules one job", async () => {
  const { mod, calls } = loadDigest({ setResults: ["OK"] });

  const bundled = await mod.enqueueDigest(6, 4242);

  assert.equal(bundled, true, "caller must not send its own email");
  assert.equal(calls.published.length, 1);
  assert.equal(
    calls.published[0].path,
    "/api/queues/notificationDigestQueue",
  );
  assert.equal(calls.published[0].body.userId, 6);
  assert.equal(calls.published[0].body.taskId, 4242);
});

test("second event joins the open window without scheduling again", async () => {
  // set() returns null: the NX claim failed, so a job is already pending.
  const { mod, calls } = loadDigest({ setResults: [null] });

  const bundled = await mod.enqueueDigest(6, 4242);

  assert.equal(bundled, true, "the event is still covered by the open window");
  assert.equal(
    calls.published.length,
    0,
    "a second job would deliver the same events twice",
  );
});

test("the window is claimed with NX so concurrent events cannot both open one", async () => {
  const { mod, calls } = loadDigest({ setResults: ["OK"] });
  await mod.enqueueDigest(6, 4242);

  assert.deepEqual(calls.set[0].rest, ["EX", 420, "NX"]);
});

test("a failed publish falls back to sending immediately", async () => {
  const { mod, calls } = loadDigest({
    setResults: ["OK"],
    publishThrows: true,
  });

  const bundled = await mod.enqueueDigest(6, 4242);

  assert.equal(
    bundled,
    false,
    "dropping the email silently is worse than sending it now",
  );
  assert.ok(
    calls.deleted.length > 0,
    "the claim must be released or the next event waits out the TTL",
  );
});

test("the window start is backdated so the triggering notification is included", async () => {
  const { mod, calls } = loadDigest({ setResults: ["OK"] });
  const before = Date.now();

  await mod.enqueueDigest(6, 4242);

  const since = new Date(calls.published[0].body.since).getTime();
  assert.ok(
    since <= before,
    "senders create the Notification row before emailing, so `since` must precede now",
  );
});

test("the watermark bounds the next window past the last emailed event", async () => {
  // The regression this guards: events at t=0 and t=250 are both sent by the
  // digest at t=300. An event at t=301 opens a window backdated to t=181, whose
  // query would otherwise pick the t=250 row up a second time. The watermark is
  // the only thing that excludes it, since emailing never mutates the row.
  const { mod } = loadDigest({ setResults: ["OK"] });
  const lastEmailed = new Date("2026-07-20T12:04:10Z");

  await mod.setLastDigestedAt(6, 4242, lastEmailed);
  const watermark = await mod.getLastDigestedAt(6, 4242);

  assert.equal(watermark.toISOString(), lastEmailed.toISOString());
});

test("a missing watermark reads as undefined rather than throwing", async () => {
  // Redis loss must degrade to a possible duplicate, never to a dropped email.
  const { mod } = loadDigest({ setResults: ["OK"] });
  assert.equal(await mod.getLastDigestedAt(6, 999), undefined);
});

test("the watermark survives independently per user and task", async () => {
  const { mod } = loadDigest({ setResults: ["OK"] });
  await mod.setLastDigestedAt(6, 1, new Date("2026-07-20T12:00:00Z"));
  await mod.setLastDigestedAt(7, 1, new Date("2026-07-20T13:00:00Z"));

  const a = await mod.getLastDigestedAt(6, 1);
  const b = await mod.getLastDigestedAt(7, 1);
  assert.notEqual(a.toISOString(), b.toISOString());
});

test("the window keeps the email it replaced so an insert failure cannot lose it", async () => {
  // Email used to be independent of the Notification insert. The digest makes
  // it depend on it, so a swallowed insert error would turn a lost inbox row
  // into a lost email too. The stored payload is what restores that redundancy.
  const { mod } = loadDigest({ setResults: ["OK"] });

  await mod.enqueueDigest(6, 4242, {
    type: "Comment",
    body: { recipient: "a@b.test", sender: "Alice", title: "T", link: "L" },
  });

  const fallback = await mod.getDigestFallback(6, 4242);
  assert.equal(fallback.type, "Comment");
  assert.equal(fallback.body.recipient, "a@b.test");
});

test("clearing the window drops the stored payload", async () => {
  const { mod } = loadDigest({ setResults: ["OK"] });
  await mod.enqueueDigest(6, 4242, {
    type: "Comment",
    body: { recipient: "a@b.test" },
  });

  await mod.clearDigestWindow(6, 4242);

  assert.equal(await mod.getDigestFallback(6, 4242), undefined);
});

test("a window opened without a payload still reads back cleanly", async () => {
  const { mod } = loadDigest({ setResults: ["OK"] });
  await mod.enqueueDigest(6, 4242);
  assert.equal(await mod.getDigestFallback(6, 4242), undefined);
});

// --- event dedupe ---

function loadEvents() {
  resetModules();
  return loadTs("src/utils/controllers/notifications/digestEvents.ts");
}

test("a mention that also produced a comment row counts as one update", () => {
  // A follower who is also mentioned gets Comment + Mentioned for one comment.
  // Listing both would say "2 updates" for a single action.
  const { dedupePerComment } = loadEvents();

  const rows = dedupePerComment([
    { type: "Comment", commentId: 77 },
    { type: "Mentioned", commentId: 77 },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, "Mentioned", "the more specific row must win");
});

test("dedupe is order-independent", () => {
  const { dedupePerComment } = loadEvents();

  const rows = dedupePerComment([
    { type: "Mentioned", commentId: 77 },
    { type: "Comment", commentId: 77 },
  ]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, "Mentioned");
});

test("distinct comments and comment-less events are all kept", () => {
  const { dedupePerComment } = loadEvents();

  const rows = dedupePerComment([
    { type: "Comment", commentId: 1 },
    { type: "Comment", commentId: 2 },
    { type: "TaskMoved", commentId: null },
    { type: "Assigned", commentId: null },
  ]);

  assert.equal(rows.length, 4, "only same-comment rows may collapse");
});

test("every notification type has digest phrasing", () => {
  // A missing entry renders "Alice undefined" in a user-facing email.
  const { verbByType } = loadEvents();
  for (const type of [
    "Comment",
    "Reacted",
    "Mentioned",
    "AddedToFollowerInTask",
    "Assigned",
    "TaskMoved",
    "TaskArchived",
    "TaskMovedToInbox",
    "TaskUpdateDescription",
    "TaskDueDate",
    "TaskOverdue",
    "TaskReminder",
    "Invited",
  ]) {
    assert.equal(typeof verbByType[type], "string", `missing verb for ${type}`);
  }
});

// --- template ---

function loadTemplates() {
  resetModules();
  return loadTs("src/utils/controllers/notifications/emailTemplates.ts");
}

test("digest subject counts the updates and stays singular at one", () => {
  const { renderDigestEmail } = loadTemplates();

  const one = renderDigestEmail("Ship it", "https://x.test/t/1", [
    { line: "Alice commented" },
  ]);
  assert.equal(one.subject, '1 update on "Ship it"');

  const many = renderDigestEmail("Ship it", "https://x.test/t/1", [
    { line: "Alice commented" },
    { line: "Bob moved this task" },
  ]);
  assert.equal(many.subject, '2 updates on "Ship it"');
});

test("digest renders every event and its comment preview", () => {
  const { renderDigestEmail } = loadTemplates();

  const { html } = renderDigestEmail("Ship it", "https://x.test/t/1", [
    { line: "Alice commented", commentText: "<p>first</p><p>second</p>" },
    { line: "Bob moved this task" },
  ]);

  assert.match(html, /Alice commented/);
  assert.match(html, /Bob moved this task/);
  // Block boundaries must become spaces, otherwise Tiptap paragraphs glue.
  assert.match(html, /first second/);
  assert.match(html, /https:\/\/x\.test\/t\/1/);
});

test("digest escapes task titles and event lines", () => {
  const { renderDigestEmail } = loadTemplates();

  const { html } = renderDigestEmail(
    '<img src=x onerror=alert(1)>',
    "https://x.test/t/1",
    [{ line: "<script>alert(2)</script> commented" }],
  );

  assert.ok(!html.includes("<img src=x"), "task title must be escaped");
  assert.ok(!html.includes("<script>alert(2)"), "event line must be escaped");
});
