const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const { z } = require("zod");
const { Output } = require("ai");
const { createJiti } = require("jiti");
const { load } = require("./helpers/create-view-context.cjs");
const root = path.resolve(__dirname, "..");
const flag = "htpr-7056-ctrlj-split-tasks";
const dueDateFlag = "htpr-7054-ctrlj-due-date";
const jiti = createJiti(__filename, { alias: { "@": path.join(root, "src") }, fsCache: false });
const dates = jiti(path.join(root, "src/lib/ai/taskWriterDueDate.ts"));
const { escapeHtml } = jiti(path.join(root, "src/utils/htmlEscape.ts"));
const multiPrompt = "Create three separate tasks: focus search with a shortcut, export CSV, and fix the settings typo.";
const drafts = ["Focus search", "Export CSV", "Fix settings typo"].map(title => ({ title, description: `<p>${title}</p>` }));
const labels = [{ id: "label-1", value: "Frontend" }];
const assignees = [{ id: 42, displayName: "Member" }];
const priority = { priority_index: 2, priority_title: "High" };
const estimate = { estimate_index: 4, estimate_title: "Large" };
const board = { id: 15, uniqueIdentifier: "HTPR" };

function harness({ enabled = true, dueDates = false, tasks = drafts, failAt = [], sonnet = true, malformed = false } = {}) {
  const checks = [], calls = [], creates = [], bindings = [], usage = [];
  const flags = {
    HTPR_6929_COMPOSE_TASK_WRITER_FLAG: "compose", HTPR_6937_NEW_TASK_WINDOW_FLAG: "new-window",
    HTPR_7056_CTRLJ_SPLIT_TASKS_FLAG: flag,
    HTPR_7060_TASK_WRITER_EMPTY_AND_RESEARCH_FLAG: "empty-research",
    isFeatureEnabled: async (key, userId) => { checks.push([key, userId]); return key === flag ? enabled : key === dueDateFlag ? dueDates : key === "compose" || key === "new-window"; },
  };
  const editor = {
    selectTaskWriterModel: async () => ({ model: sonnet ? "sonnet-5.5-medium" : "saved-model", settings: { maxOutputTokens: 16000 }, teamId: "team", usageProvider: "fixture" }),
    retrieveTaskWriterContext: async () => "",
    createTaskWriterPromptParts: () => ({ instructions: "Return one HTML title and body.", input: "Source note" }),
    createTaskWriterUserContent: (input) => input,
    createDocumentAttachmentSummary: () => "", extractImgSrcs: () => new Set(),
    filterOneImagePass: (html) => ({ emit: html.replace(/<img[^>]*>/g, ""), leftover: "" }),
    errorMessage: (error) => error.message,
    createSseErrorResponse: (error, status) => Response.json({ error }, { status }),
    SSE_HEADERS: { "content-type": "text/event-stream" }, sseFrame: () => "event: error\n",
  };
  const run = load("src/app/api/ai/_lib/taskWriterRun.ts", {
    zod: { z }, "@/lib/flags": flags,
    "@/lib/ai/prompts/registry": { renderPrompt: () => "output language rule" },
    "@/lib/flags/keys": { HTPR_7054_CTRLJ_DUE_DATE_FLAG: dueDateFlag },
    "@/lib/ai/taskWriterDueDate": dates,
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}), taskWriteAccessWhere: () => ({}) },
    "@/lib/ai/composeTaskTarget": { isEmptyComposeTarget: () => true },
    "@/app/api/ai/_lib/editorAi": editor,
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "", resolveAiUsageTaskId: async () => null },
    "@/app/api/ai/_lib/taskWriterPrompt": { formatTaskWriterRetrievedContext: () => "", TASK_WRITER_RESEARCH_REQUEST_RULE: "" },
    "@/app/api/ai/_lib/taskWriterBoardResearch": { HTPR_6363_TASK_WRITER_RESEARCH_FLAG: "research" },
    "@/app/api/ai/_lib/skills": { resolveSkills: async text => ({ cleanedText: text, skills: [] }) },
    "@/app/api/ai/_lib/providerGate": { getProjectTeamProviderContext: async () => ({ teamId: "team", settings: {} }) },
    "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true },
    "@/lib/doneColumns": {},
    "@/lib/prisma": { default: { project: { findFirst: async () => board }, task: { findFirst: async () => ({ id: 91 }) }, taskTemplate: { findMany: async () => [] } } },
    "@/app/api/ai/_lib/boardTemplateContext": { BOARD_TEMPLATE_LIMIT: 10 },
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
  });
  const route = load("src/app/api/ai/task-writer/route.ts", {
    zod: { z },
    "@/lib/ai/taskWriterDueDate": dates,
    "@/utils/htmlEscape": { escapeHtml },
    ai: {
      Output,
      generateText: async options => { calls.push({ kind: "structured", ...options }); return { output: malformed ? { tasks: [{ title: "", description: "" }] } : { tasks } }; },
      streamText: options => {
        calls.push({ kind: "legacy", ...options });
        return { textStream: (async function* () { yield '<h1 id="ai-generated-task-title">Legacy task</h1><p>Original body</p>'; })() };
      },
    },
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/errors/reportError": { reportError: async () => {} },
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage: (...args) => usage.push(args) },
    "@/app/api/ai/_lib/editorAi": editor,
    "@/app/api/ai/_lib/requestUser": { getAiRequestUser: async () => ({ id: 985 }) },
    "@/app/api/ai/_lib/taskWriterRun": run,
    "@/app/api/ai/_lib/taskWriterProperties": { extractTaskWriterProperties: html => ({ description: html }), hasUsableTaskWriterDraft: () => true, TASK_WRITER_EMPTY_DRAFT_MESSAGE: "" },
  });
  const composer = load("src/lib/ai/composeTask.ts", {
    "@/lib/media/browserRenderableImage": { isBrowserRenderableImage: () => false },
    axios: { default: { get: async () => ({ data: { sectionId: 12, section: "Todo", ranking: "a" } }) } },
    "@/lib/constants/APIRouteConstants": { taskWriterRoute: "/api/ai/task-writer" },
    "./taskWriterBoardContext": { buildTaskWriterRequestScope: project => ({ projectId: project.id }) },
    "@/lib/deriveCurrentBoardBilling": { deriveCurrentBoardBilling: () => ({}) },
    "@/utils/aiWriterUtils": { extractTitleAndDescription: html => ({ title: html.match(/<h1[^>]*>(.*?)<\/h1>/)?.[1], description: html.replace(/<h1[^>]*>.*?<\/h1>/, "") }) },
    "@/utils/htmlEscape": { escapeHtml },
    "./taskWriterMedia": { extractTaskWriterMedia: html => ({ html, media: [] }), createTaskWriterMediaTokenFactory() {}, restoreTaskWriterMedia: html => html },
    "@/lib/createTaskAttachmentUploads": { bindCreateTaskUploads: id => bindings.push(id) },
    "@/utils/helperFunctions/Views/ViewsHelperFunctions": { getActiveFiltersFromProject: () => ({ addedFilters: ["view"] }) },
    "@/utils/helperFunctions/Views/NewTaskViewDefaults": { getNewTaskViewDefaults: () => ({ tags: labels, assignees, priority, estimate }) },
    "@/utils/api/global/apiHelpers/createTaskGloballycontroller": { default: async body => {
      creates.push(body);
      if (failAt.includes(creates.length)) {
        if (creates.length === 2) throw new Error("Creation failed");
        return { error: true };
      }
      return { resposne: { newTask: { id: 90 + creates.length, uniqueIndex: 100 + creates.length, ticketNumber: `HTPR-${100 + creates.length}`, title: body.title, projectId: 15, sectionId: 12 } } };
    } },
  });
  async function compose(text = multiPrompt, extra = {}) {
    const original = global.fetch;
    global.fetch = async (_url, options) => route.POST({ json: async () => JSON.parse(options.body) });
    try { return await composer.createComposedTask({ text, files: [], project: board, viewProject: board, userId: 985, ...extra }); }
    finally { global.fetch = original; }
  }
  return { ...composer, compose, route, run, checks, calls, creates, bindings, usage };
}

for (const sonnet of [true, false]) {
  test(`three-task prompt creates three tickets with identical view defaults (${sonnet ? "Sonnet" : "default"} path)`, async () => {
    const h = harness({ sonnet });
    const result = await h.compose();
    assert.equal(result.writerFailed, false);
    assert.equal(result.tasks.length, 3);
    assert.equal(h.calls[0].model, sonnet ? "sonnet-5.5-medium" : "saved-model");
    assert.equal(h.calls[0].kind, "structured");
    assert.equal(h.usage.length, 1);
    assert.match(h.calls[0].instructions, /Split only.*independently deliverable tasks/);
    assert.match(h.calls[0].instructions, /sub-steps.*exactly one task/);
    for (const [index, create] of h.creates.entries()) {
      assert.equal(create.title, drafts[index].title);
      assert.equal(create.description, drafts[index].description);
      assert.deepEqual({ tags: create.tags, assignees: create.assignees, priority: create.priority, estimate: create.estimate }, { tags: labels, assignees, priority, estimate });
      assert.equal(create.requestKind, "compose-task");
      assert.equal(create.sectionId, 12);
    }
    assert.deepEqual(h.bindings, [91, 92, 93]);
    assert.ok(h.checks.some(([key, userId]) => key === flag && userId === 985));
    const message = h.composeTaskAssistantMessage("HTPR-101", false, false, result);
    for (const task of result.tasks) assert.ok(message.includes(`<a href="/detail/project-15/${task.uniqueIndex}">${task.ticketNumber}: ${task.title}</a>`));
  });
}

const inDays = (days) => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

test("both flags keep each split task's own model date and save it with the browser time zone", async () => {
  const first = inDays(4), second = inDays(6);
  const tasks = [
    { title: "Focus search", description: "<p>Focus search</p>", dueDate: first },
    { title: "Export CSV", description: "<p>Export CSV</p>", dueDate: second },
    { ...drafts[2], dueDate: null },
  ];
  const h = harness({ dueDates: true, tasks });
  const result = await h.compose("Create separate tasks: focus search, due soon; export CSV, due later; fix the settings typo.");
  assert.equal(result.writerFailed, false);
  assert.equal(result.tasks.length, 3);
  assert.deepEqual(h.creates.map(body => body.writerDueDate), [first, second, undefined]);
  assert.deepEqual(h.creates.map(body => body.title), ["Focus search", "Export CSV", "Fix settings typo"]);
  for (const body of h.creates.slice(0, 2)) assert.equal(body.writerTimeZone, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(h.creates[2].writerTimeZone, undefined);
  assert.match(h.calls[0].instructions, /Today's local date is \d{4}-\d{2}-\d{2}/);
  assert.match(h.calls[0].instructions, /dueDate field/);
});

test("a single structured task keeps its own model date and an invalid or past date is dropped", async () => {
  const date = inDays(3);
  const one = harness({ dueDates: true, tasks: [{ title: "Export CSV", description: "<p>Export CSV</p>", dueDate: date }] });
  assert.equal((await one.compose("Export CSV by Friday")).writerFailed, false);
  assert.equal(one.creates[0].writerDueDate, date);
  assert.equal(one.creates.length, 1);
  for (const bad of ["2026-02-30", inDays(-3), inDays(900), "soon", null]) {
    const h = harness({ dueDates: true, tasks: [{ ...drafts[0], dueDate: bad }, drafts[1]] });
    assert.equal((await h.compose(multiPrompt)).writerFailed, false);
    for (const body of h.creates) assert.equal(body.writerDueDate, undefined);
  }
});

test("due-date flag off preserves the upstream structured output and save payload", async () => {
  const tasks = [{ title: "Export CSV, due 2026-10-16", description: '<p>Export CSV</p><span id="ai-generated-task-due-date">2026-10-16</span>' }];
  const h = harness({ dueDates: false, tasks });
  const response = await h.route.POST({ json: async () => ({ projectId: 15, PROMPT: "Export CSV, due 2026-10-16", requestKind: "compose-task" }) });
  assert.equal(response.headers.get("X-Task-Writer-Due-Date"), null);
  assert.deepEqual(await response.json(), { tasks });
  const stray = harness({ dueDates: false, tasks: [{ ...tasks[0], dueDate: inDays(3) }] });
  const strayBody = await (await stray.route.POST({ json: async () => ({ projectId: 15, PROMPT: "Export CSV", requestKind: "compose-task" }) })).json();
  assert.equal(strayBody.tasks[0].dueDate, undefined);
  const result = await h.compose("Export CSV, due 2026-10-16");
  assert.equal(result.writerFailed, false);
  assert.equal(h.creates[0].title, tasks[0].title);
  assert.equal(h.creates[0].description, tasks[0].description);
  assert.equal(h.creates[0].writerDueDate, undefined);
  assert.equal(h.creates[0].writerTimeZone, undefined);
  assert.doesNotMatch(h.calls[0].instructions, /Today's local date/);
});

test("single task with sub-steps creates one ticket and keeps the exact existing result", async () => {
  const h = harness({ tasks: [{ title: "Export CSV", description: "<p>Add a button, serialize columns, and test quoting.</p>" }] });
  const result = await h.compose("Export CSV: add a button, serialize columns, test quoting.");
  assert.equal(h.creates.length, 1);
  assert.equal(result.tasks.length, 1);
  assert.equal(h.composeTaskAssistantMessage("HTPR-101", false, false, result), h.composeTaskAssistantMessage("HTPR-101"));
  assert.match(h.calls[0].instructions, /If uncertain, return one task/);
});

test("server flag off returns the legacy stream and creates exactly one ticket", async () => {
  const h = harness({ enabled: false });
  const result = await h.compose();
  assert.equal(h.creates.length, 1);
  assert.equal(h.creates[0].title, "Legacy task");
  assert.equal(result.writerFailed, false);
  assert.equal(h.calls[0].kind, "legacy");
  assert.equal(h.calls[0].instructions, "Return one HTML title and body.");
  assert.equal(h.calls[0].output, undefined);
});

test("more than ten tasks are capped by both the output schema and defensive server limit", async () => {
  const tasks = Array.from({ length: 13 }, (_, i) => ({ title: `Task ${i + 1}`, description: `<p>Deliverable ${i + 1}</p>` }));
  const h = harness({ tasks });
  const result = await h.compose("Create 13 separate tasks");
  assert.equal(result.tasks.length, 10);
  assert.equal(h.creates.length, 10);
  assert.equal(h.creates.at(-1).title, "Task 10");
  const prepared = await h.run.prepareTaskWriterRun(h.run.taskWriterRequestSchema.parse({ projectId: 15, PROMPT: "Create 13 tasks", requestKind: "compose-task" }), 985);
  assert.match(prepared.instructions, /only the first 10 in request order/);
  const schema = await h.calls[0].output.responseFormat;
  assert.equal(schema.schema.properties.tasks.maxItems, 10);
  assert.equal(schema.schema.properties.tasks.minItems, 1);
});

test("partial save failure reports only confirmed successes with links and names the failed task", async () => {
  for (const failAt of [[2], [1, 3]]) {
    const h = harness({ failAt });
    const result = await h.compose();
    assert.equal(result.tasks.length, 3 - failAt.length);
    assert.equal(result.failedTitles.length, failAt.length);
    assert.equal(h.bindings.length, result.tasks.length);
    const message = h.composeTaskAssistantMessage(result.task.ticketNumber, false, false, result);
    assert.match(message, /Could not save these tasks/);
    for (const index of failAt) {
      assert.ok(result.failedTitles.includes(drafts[index - 1].title));
      assert.ok(!message.includes(`/detail/project-15/${100 + index}`));
    }
  }
});

test("all save failures reject instead of announcing success", async () => {
  const h = harness({ failAt: [1, 2, 3] });
  await assert.rejects(h.compose(), /Couldn’t create the tasks/);
  assert.equal(h.bindings.length, 0);
});

test("invalid model output falls back to one original note, not partial tasks", async () => {
  const h = harness({ malformed: true });
  const result = await h.compose();
  assert.equal(result.writerFailed, true);
  assert.equal(h.creates.length, 1);
  assert.equal(h.creates[0].title, multiPrompt);
});

test("manual and Write with AI requests keep their legacy output even when the split flag is on", async () => {
  const h = harness();
  for (const input of [{ requestKind: "manual" }, { requestKind: "compose-task", aiMode: "WriteWithAI" }]) {
    const response = await h.route.POST({ json: async () => ({ projectId: 15, PROMPT: multiPrompt, ...input }) });
    assert.match(await response.text(), /Legacy task/);
    assert.equal(h.calls.at(-1).kind, "legacy");
  }
  assert.ok(!h.checks.some(([key]) => key === flag));
});

test("empty existing task is filled once and the other deliverables create new tickets", async () => {
  const h = harness();
  const result = await h.compose(multiPrompt, { existingTaskId: 91 });
  assert.equal(h.creates[0].existingTaskId, 91);
  assert.ok(h.creates.slice(1).every(body => body.existingTaskId === undefined));
  assert.equal(result.tasks.length, 3);
  const failing = harness({ failAt: [1] });
  await assert.rejects(failing.compose(multiPrompt, { existingTaskId: 91 }));
  assert.equal(failing.creates.length, 1);
});

test("batch result escapes model titles instead of injecting HTML", () => {
  const h = harness();
  const tasks = [{ id: 1, projectId: 15, uniqueIndex: 1, title: '<img src="evil">', ticketNumber: "HTPR-1" }, { id: 2, projectId: 15, uniqueIndex: 2, title: "Safe", ticketNumber: "HTPR-2" }];
  const message = h.composeTaskAssistantMessage("HTPR-1", false, false, { tasks, failedTitles: ["<script>bad</script>"] });
  assert.ok(!message.includes('<img src="evil">'));
  assert.match(message, /&lt;img/);
  assert.match(message, /&lt;script&gt;/);
});

test("actual composer send caches every saved ticket and publishes the complete result in the existing intro", async () => {
  const h = harness({ failAt: [2] });
  const result = await h.compose();
  const source = fs.readFileSync(path.join(root, "src/components/Modals/commands/HTC/ComposeTaskWriter.tsx"), "utf8");
  const ast = ts.createSourceFile("writer.tsx", source, ts.ScriptTarget.Latest, true);
  let send;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "send") send = node.initializer.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert.ok(send);
  const cache = [], intros = [], navigations = [];
  const context = {
    enabled: true, sending: { current: false }, pendingImages: { current: 0 }, dictating: false, text: multiPrompt,
    files: [], showProgress: false, composer: { current: null }, setWritingHeight() {}, setWriting() {}, setStage() {}, onBusyChange() {},
    setError(error) { if (error) throw new Error(error); }, taskContextRef: { current: null }, newTaskWindow: true, destinationProject: board,
    window: { location: { pathname: "/project", href: "https://app.hypertask.ai/project?id=15" } }, inView: null,
    user: { id: 985 }, currentProject: board, mounted: { current: true }, viewContextEnabled: true, splitTasksEnabled: true,
    createComposedTask: async () => result,
    createTaskGlobally: body => cache.push(body.task), mobile: false, onCreated() {},
    setIntro: value => intros.push(value), composeTaskAssistantMessage: h.composeTaskAssistantMessage,
    updateActiveItemAndItemInView() {}, setScope() {}, setSidebar() {}, setSuppressed() {}, setExplicitOpen() {}, setShowChat() {},
    router: { push: url => navigations.push(url) },
  };
  const compiled = ts.transpileModule(`return (${send});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  await new Function(...Object.keys(context), compiled)(...Object.values(context))();
  assert.deepEqual(cache, result.tasks);
  assert.equal(intros[0].content, h.composeTaskAssistantMessage("HTPR-101", false, false, result));
  assert.equal(navigations[0], "/detail/project-15/101");
  assert.ok(!intros[0].content.includes("/detail/project-15/102"));

  context.splitTasksEnabled = false;
  cache.length = 0;
  intros.length = 0;
  navigations.length = 0;
  await new Function(...Object.keys(context), compiled)(...Object.values(context))();
  assert.deepEqual(cache, [result.task]);
  assert.equal(intros[0].content, h.composeTaskAssistantMessage("HTPR-101", false, false));
  assert.equal(navigations[0], "/detail/project-15/101");
});
