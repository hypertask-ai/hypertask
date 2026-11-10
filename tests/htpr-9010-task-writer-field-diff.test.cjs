const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");
const { NextRequest } = require("next/server");
const { stubModule } = require("./helpers/loadModule.cjs");

const root = path.resolve(__dirname, "..");

test("Task Writer field diff signal", async (t) => {
  let flagOn = true;
  const flagChecks = [];
  const learned = [];

  stubModule(t, "src/app/api/ai/_lib/editorAi.ts", {
    getCurrentUserFromCookies: async () => ({ id: 6 }),
  });
  stubModule(t, "src/app/api/ai/_lib/boardMemory.ts", {
    BoardMemoryProjectAccessError: class extends Error {},
    deleteBoardMemory: async () => ({ success: true }),
    getBoardMemoryState: async () => ({ enabled: true, memories: [] }),
    learnBoardMemoryFromSignal: async (input) => {
      learned.push(input);
      return { enabled: true, learned: [] };
    },
    setBoardMemoryEnabled: async () => ({ enabled: true }),
  });
  stubModule(t, "src/lib/flags.ts", {
    isFeatureEnabled: async (key, userId) => {
      flagChecks.push([key, userId]);
      return flagOn;
    },
  });

  const jiti = createJiti(__filename, {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  });
  const route = jiti(path.join(root, "src/app/api/ai/project/memory/route.ts"));
  const { prepareTaskWriterFieldDiffSignal } = jiti(
    path.join(root, "src/app/api/ai/_lib/taskWriterFieldDiff.ts"),
  );
  const { TASK_WRITER_NOTE_MAX_LENGTH, createTaskWriterFieldDiffTracker } = jiti(
    path.join(root, "src/lib/ai/boardMemoryClient.ts"),
  );
  const { HTPR_9010_TASK_WRITER_MEMORY_FLAG } = jiti(
    path.join(root, "src/lib/flags/definitions/htpr-9010-task-writer-memory.ts"),
  );

  function reset() {
    flagOn = true;
    flagChecks.length = 0;
    learned.length = 0;
  }

  function post(body) {
    return route.POST(
      new NextRequest("https://app.hypertask.ai/api/ai/project/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  const diffBody = (note) => ({
    projectId: 15,
    type: "task_writer_field_diff",
    note,
    draft: { priority: "Low", labels: ["Bug"] },
    saved: { priority: "High", labels: ["Bug", "Billing"] },
  });

  await t.test("the flag key is the one the ticket names", () => {
    reset();
    assert.equal(HTPR_9010_TASK_WRITER_MEMORY_FLAG, "htpr-9010-task-writer-memory");
  });

  await t.test("flag off: the route sends nothing to board memory", async () => {
    reset();
    flagOn = false;
    const response = await post(diffBody("fix the billing export"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { enabled: false, learned: [] });
    assert.deepEqual(learned, []);
    assert.deepEqual(flagChecks, [[HTPR_9010_TASK_WRITER_MEMORY_FLAG, 6]]);
  });

  await t.test("flag on: the route forwards the diff with the note capped at 2,000 characters", async () => {
    reset();
    const response = await post(diffBody("a".repeat(5_000)));
    assert.equal(response.status, 200);
    assert.equal(learned.length, 1);
    assert.equal(learned[0].signal.type, "task_writer_field_diff");
    assert.equal(learned[0].signal.note.length, TASK_WRITER_NOTE_MAX_LENGTH);
    assert.equal(TASK_WRITER_NOTE_MAX_LENGTH, 2_000);
    assert.deepEqual(learned[0].signal.saved.labels, ["Bug", "Billing"]);
  });

  await t.test("other signal types never touch the flag", async () => {
    reset();
    flagOn = false;
    const response = await post({
      projectId: 15,
      type: "edited_ai_title",
      originalText: "Customer import",
      correctedText: "Member import",
    });
    assert.equal(response.status, 200);
    assert.equal(learned.length, 1);
    assert.deepEqual(flagChecks, []);
  });

  await t.test("a note that holds a secret or personal data is dropped whole", async () => {
    reset();
    const signal = (note) => ({ type: "task_writer_field_diff", note, draft: {}, saved: { title: "x" } });
    const on = async () => true;
    assert.equal(await prepareTaskWriterFieldDiffSignal(signal("key is sk-abcdefghijklmnopqrstuvwx"), 6, on), null);
    assert.equal(await prepareTaskWriterFieldDiffSignal(signal("mail me at a@b.com"), 6, on), null);
    assert.equal((await prepareTaskWriterFieldDiffSignal(signal("plain note"), 6, on)).note, "plain note");
    assert.equal(
      await prepareTaskWriterFieldDiffSignal(
        { type: "task_writer_field_diff", note: "plain", draft: {}, saved: { title: "password: hunter2" } },
        6,
        on,
      ),
      null,
    );
  });

  await t.test("the client tracker caps the note and emits only changed fields", () => {
    reset();
    const tracker = createTaskWriterFieldDiffTracker();
    const label = (value) => ({ id: value, value, createdAt: new Date(), projectId: 15 });
    tracker.record("n".repeat(3_000), {
      title: "Draft title",
      priority: { priority_index: 1, Priority_Value: "Low", colorCode: "" },
      tags: [label("Bug")],
    });
    const signal = tracker.takeSignal({
      title: "Draft title",
      priority: { priority_index: 3, Priority_Value: "High", colorCode: "" },
      tags: [label("Bug")],
    });
    assert.equal(signal.type, "task_writer_field_diff");
    assert.equal(signal.note.length, 2_000);
    assert.deepEqual(signal.draft, { priority: "Low" });
    assert.deepEqual(signal.saved, { priority: "High" });
    assert.equal(tracker.takeSignal({ title: "Draft title" }), null);
  });

  await t.test("the client tracker stays silent without a note or without a change", () => {
    reset();
    const tracker = createTaskWriterFieldDiffTracker();
    tracker.record("   ", { title: "A" });
    assert.equal(tracker.takeSignal({ title: "B" }), null);
    tracker.record("note", { title: "A" });
    assert.equal(tracker.takeSignal({ title: "A" }), null);
    tracker.record("note", { title: "A" });
    tracker.reset();
    assert.equal(tracker.takeSignal({ title: "B" }), null);
  });

  await t.test("the client tracker drops a draft saved on a different board", () => {
    reset();
    const tracker = createTaskWriterFieldDiffTracker();
    tracker.record("note", { title: "A" }, 15);
    assert.equal(tracker.takeSignal({ title: "B" }, 16), null);
    tracker.record("note", { title: "A" }, 15);
    assert.equal(tracker.takeSignal({ title: "B" }, 15).type, "task_writer_field_diff");
  });
});
