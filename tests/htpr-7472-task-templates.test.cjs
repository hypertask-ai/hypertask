const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const ts = require("typescript");
const ai = require("ai");
const React = require("react");
const { JSDOM } = require("jsdom");
const root = process.env.HTPR_7472_TEST_ROOT ?? path.resolve(__dirname, "..");
const jiti = require("jiti")(__filename, { alias: { "@": path.join(root, "src") }, interopDefault: true, fsCache: false });
const keys = jiti(path.join(root, "src/lib/flags/keys.ts"));
const flag = "htpr-7472-task-templates";
const plain = (value) => JSON.parse(JSON.stringify(value));
const dom = new JSDOM("", { url: "http://localhost" });
const load = (file) => jiti(path.join(root, file));
function moduleWithStubs(file, stubs = {}) {
  const filename = path.join(root, file);
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports, console, Error, Date, Response, Headers, ReadableStream, TextEncoder, TextDecoder,
    DOMParser: dom.window.DOMParser,
    require: (id) => {
      if (id in stubs) {
        const stub = stubs[id];
        return stub?.default ? { __esModule: true, ...stub } : stub;
      }
      if (id.startsWith("@/") || id.startsWith(".")) throw new Error(`Unstubbed ${id} in ${file}`);
      return require(id);
    },
  }, { filename });
  return loadedModule.exports;
}
const editing = moduleWithStubs("src/lib/taskTemplateEditing.ts", { "@/utils/htmlEscape": load("src/utils/htmlEscape.ts") });
const finished = '<h1 id="ai-generated-task-title">[TAG] Welcome ICE 21/30</h1><h2>Variations</h2><ul>' + Array.from({ length: 5 }, (_, i) => `<li>Finished headline ${i + 1}</li>`).join("") + '</ul><p>Estimated Impact 7/10, Confidence 6/10, Ease 8/10 = 21/30.</p>';
function writerHarness(options = {}) {
  const calls = [], checks = [];
  const model = {
    specificationVersion: "v4", provider: "fixture", modelId: "writer-model", supportedUrls: {},
    async doGenerate(params) {
      calls.push(params);
      const text = options.outputs?.[Math.min(calls.length - 1, options.outputs.length - 1)] ?? finished;
      return { content: [{ type: "text", text }], usage: { inputTokens: { total: 10 }, outputTokens: { total: 20 } }, finishReason: { unified: "stop" } };
    },
    async doStream(params) {
      const result = await this.doGenerate(params);
      return { stream: new ReadableStream({ start(controller) {
        controller.enqueue({ type: "text-start", id: "t" });
        controller.enqueue({ type: "text-delta", id: "t", delta: result.content[0].text });
        controller.enqueue({ type: "text-end", id: "t" });
        controller.enqueue({ type: "finish", finishReason: result.finishReason, usage: result.usage });
        controller.close();
      } }) };
    },
  };
  const editor = {
    ...load("src/app/api/ai/_lib/editorAiPrompts.ts"),
    selectTaskWriterModel: async () => ({ model, modelId: "writer-model", teamId: "team", usageProvider: "fixture", settings: {} }),
    retrieveTaskWriterContext: async () => "BOARD_TICKET_CONTEXT: kitchen cloths. BOARD_MEMORY: warm practical voice. INSTRUCTION_FILE: no unsupported claims.",
    createDocumentAttachmentSummary: () => "BOARD_DOC_CONTEXT: reusable kitchen products.",
    createTaskWriterUserContent: (input) => input,
    extractImgSrcs: () => new Set(), filterOneImagePass: (text) => ({ emit: text }),
    SSE_HEADERS: { "content-type": "text/event-stream" }, sseFrame: (event, value) => `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`,
    errorMessage: (error) => error.message, createSseErrorResponse: (error, status) => Response.json({ error }, { status }),
  };
  const run = moduleWithStubs("src/app/api/ai/_lib/taskWriterRun.ts", {
    "@/lib/ai/taskWriterDueDate": {}, "@/lib/flags/keys": keys,
    "@/utils/controllers/projects/getAllIncludes": { projectContentAccessWhere: () => ({}), taskWriteAccessWhere: () => ({}) },
    "@/lib/ai/composeTaskTarget": {}, "@/app/api/ai/_lib/editorAi": editor,
    "@/app/api/ai/_lib/currentTaskContext": { loadCurrentTaskContext: async () => "", resolveAiUsageTaskId: async () => null },
    "@/app/api/ai/_lib/taskWriterPrompt": load("src/app/api/ai/_lib/taskWriterPrompt.ts"),
    "@/app/api/ai/_lib/taskWriterBoardResearch": load("src/app/api/ai/_lib/taskWriterBoardResearch.ts"),
    "@/app/api/ai/_lib/skills": { resolveSkills: async (text) => ({ cleanedText: text, skills: [], systemPromptAddition: "" }) },
    "@/app/api/ai/_lib/providerGate": { getProjectTeamProviderContext: async () => ({ settings: {} }) },
    "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true },
    "@/lib/flags": { ...keys, isFeatureEnabled: async (key, userId) => {
      checks.push([key, userId]);
      if (key === flag) return options.enabled !== false;
      if (key === keys.HTPR_7500_WRITER_OLD_STRUCTURE_FLAG) return Boolean(options.oldStructure);
      if (key === keys.HTPR_6929_COMPOSE_TASK_WRITER_FLAG) return true;
      if (key === keys.HTPR_7471_WRITER_BOARD_FORMAT_FLAG) return options.boardFormat !== false;
      if (key === keys.HTPR_7342_WEB_WRITING_TASK_WRITER_FLAG) return options.web !== false;
      return key === keys.HTPR_7056_CTRLJ_SPLIT_TASKS_FLAG && Boolean(options.split);
    } },
    "@/lib/ai/prompts/registry": load("src/lib/ai/prompts/registry.ts"),
    "@/lib/doneColumns": { doneColumnTitles: () => new Set() },
    "@/lib/prisma": { default: {
      project: { findFirst: async () => ({ id: 15, title: "Kitchen", section: [], labels: [] }) },
      customField: { findMany: async () => [] }, section: { findMany: async () => [] },
      taskTemplate: { findMany: async () => [{ name: "A/B test", title: "[TAG] {idea} ICE {score}/30", descriptionHtml: "<h2>Variations</h2>" }] },
    } },
    "@/app/api/ai/_lib/boardTemplateContext": load("src/app/api/ai/_lib/boardTemplateContext.ts"),
    "@/utils/controllers/turbopuffer/turbopufferHelper": { searchTasks: async () => [] },
    "@/app/api/ai/_lib/promptCache": { cachedInstructionsForUser: async (_user, args) => args.fixed + args.suffix },
    "@/app/api/ai/_lib/customInstructions": { loadCustomInstructionText: async () => "BOARD_INSTRUCTIONS: practical kitchen voice" },
  });
  const properties = load("src/app/api/ai/_lib/taskWriterProperties.ts");
  const draft = moduleWithStubs("src/app/api/ai/_lib/taskWriterDraft.ts", {
    "@/lib/ai/taskWriterCustomFields": load("src/lib/ai/taskWriterCustomFields.ts"),
    ai, "./modelProvider": { configureAiModelUsage() {} }, "./editorAi": editor, "./taskWriterRun": run,
    "./taskWriterProperties": properties, "@/lib/ai/taskWriterDuplicateGuard": load("src/lib/ai/taskWriterDuplicateGuard.ts"),
  });
  const request = run.taskWriterRequestSchema.parse({ projectId: 15, PROMPT: "A/B test: 5 headlines for the welcome page", customInstructions: options.enabled === false ? "Existing instruction" : "", ...(options.split ? { requestKind: "compose-task" } : {}) });
  const route = moduleWithStubs("src/app/api/ai/task-writer/route.ts", {
    ai, "@/lib/ai/taskWriterDueDate": load("src/lib/ai/taskWriterDueDate.ts"),
    "@/lib/ai/taskWriterTicketType": load("src/lib/ai/taskWriterTicketType.ts"), "@/lib/errors/reportError": { reportError: async () => {} },
    "@/app/api/ai/_lib/modelProvider": { configureAiModelUsage() {} }, "next/server": { NextResponse: { json: Response.json } },
    "@/app/api/ai/_lib/editorAi": editor, "@/app/api/ai/_lib/requestUser": { getAiRequestUser: async () => ({ id: 985 }) },
    "@/app/api/ai/_lib/taskWriterProperties": properties, "@/app/api/ai/_lib/taskWriterRun": run,
  });
  return { calls, checks, run, request, draft: () => draft.generateTaskWriterDraft(request, 985), web: async () => route.POST({ json: async () => request }) };
}
const promptText = (call) => JSON.stringify(call.prompt);

test("template headings and paragraphs round-trip without losing HTML or entities", () => {
  const html = '<h2>Problem &amp; goal</h2><p>Keep &lt;facts&gt; and "quotes".</p><h2>Variations</h2><p>Write five lines.</p>';
  const parsed = editing.readTaskTemplateDescription(html);
  assert.equal(parsed.editable, true);
  assert.deepEqual(plain(parsed.headings), ["Problem & goal", "Variations"]);
  assert.equal(editing.writeTaskTemplateDescription(parsed.text, html), html);
  assert.equal(editing.writeTaskTemplateDescription("Problem & goal\nNew <text>\n\nVariations\nFive finished lines.", html), '<h2>Problem &amp; goal</h2><p>New &lt;text&gt;</p><h2>Variations</h2><p>Five finished lines.</p>');
});
test("rich templates are read-only and cannot be damaged by the plain text writer", () => {
  for (const html of ['<p><strong>Bold</strong></p>', '<ul><li>Item</li></ul>', '<p class="rich">Text</p>', '<p>A<br>B</p>', 'Plain text', '<!--metadata--><p>Text</p>']) {
    assert.equal(editing.readTaskTemplateDescription(html).editable, false, html);
    assert.equal(editing.writeTaskTemplateDescription("Changed", html), html);
  }
});
function patchHarness({ userId = 1, enabled = true } = {}) {
  const updates = [], accessCalls = [];
  let stored = { name: "Bug", title: "[BUG] {problem}", descriptionHtml: "<h2>Steps</h2><p>Reproduce.</p>" };
  const route = moduleWithStubs("src/app/api/task-templates/route.ts", {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => userId ? { userId } : null },
    "@/lib/flags": { isFeatureEnabled: async (key, id) => { assert.equal(key, flag); assert.equal(id, userId); return enabled; } },
    "@/lib/flags/keys": keys, "next/server": { NextResponse: { json: Response.json } },
    "@/lib/taskTemplatePrefill": {},
    "@/utils/controllers/projects/getAllIncludes": { getProjectWhere: (id) => { accessCalls.push(id); return { OR: [{ ownerId: id }, { members: { some: { userId: id } } }] }; } },
    "@/lib/prisma": { default: { taskTemplate: {
      updateMany: async (args) => {
        updates.push(plain(args));
        const allowed = args.where.id === 7 && args.where.project.OR.some((entry) => entry.ownerId === 1 || entry.members?.some.userId === 2);
        if (allowed) stored = args.data;
        return { count: allowed ? 1 : 0 };
      },
    } } },
  });
  return { updates, accessCalls, stored: () => stored, patch: (body = { templateId: 7, name: " A/B test ", title: "[TAG] {idea} ICE {score}/30", descriptionHtml: "<h2>Variations</h2>" }) => route.PATCH({ headers: new Headers(), json: async () => body }) };
}
test("PATCH still allows both board owner and editor, preserving board-scoped authorization", async () => {
  for (const userId of [1, 2]) {
    const h = patchHarness({ userId });
    assert.equal((await h.patch()).status, 200);
    assert.deepEqual(h.accessCalls, [userId]);
    assert.deepEqual(h.updates[0].where, { id: 7, project: { OR: [{ ownerId: userId }, { members: { some: { userId } } }] } });
    assert.equal(h.stored().name, "A/B test");
    assert.equal(h.stored().title, "[TAG] {idea} ICE {score}/30");
  }
});
test("PATCH now refuses users without access to the template board and leaves it unchanged", async () => {
  const h = patchHarness({ userId: 3 });
  const original = h.stored();
  assert.equal((await h.patch()).status, 404);
  assert.deepEqual(h.accessCalls, [3]);
  assert.equal(h.stored(), original);
});
test("PATCH flag off, missing session and malformed updates never write", async () => {
  for (const options of [{ enabled: false }, { userId: null }]) {
    const h = patchHarness(options);
    assert.equal((await h.patch()).status, options.enabled === false ? 403 : 401);
    assert.deepEqual(h.updates, []);
  }
  const h = patchHarness();
  for (const body of [null, {}, { templateId: 7, name: " ", title: "", descriptionHtml: "" }, { templateId: -1, name: "A", title: "", descriptionHtml: "" }, { templateId: 7, name: "A", title: 12, descriptionHtml: "" }]) {
    assert.equal((await h.patch(body)).status, 400);
  }
  assert.deepEqual(h.updates, []);
});
for (const oldStructure of [false, true]) for (const boardFormat of [false, true]) for (const web of [true, false]) {
  test(`flag on injects explicit ideation precedence, board context and matched title pattern (oldStructure=${oldStructure}, boardFormat=${boardFormat}, web=${web})`, async () => {
    const h = writerHarness({ oldStructure, boardFormat, web });
    const result = await h.draft();
    assert.equal(result.success, true);
    assert.equal(h.calls.length, 1);
    const prompt = promptText(h.calls[0]);
    for (const text of ["FINISHED IDEAS AND TEMPLATE TITLES", "exact number of finished items", "overrides SOURCE FIDELITY", "invented page copy", "180-240 visible-word budget", "one-sentence-per-section limit", "only as needed", "Without an explicit ideation/copy request", "Impact, Confidence and Ease", "BOARD_TICKET_CONTEXT", "BOARD_MEMORY", "INSTRUCTION_FILE", "BOARD_DOC_CONTEXT", "BOARD_INSTRUCTIONS", "[TAG] {idea} ICE {score}/30", "When the brief matches a board template by name or intent"]) assert.ok(prompt.includes(text), text);
    assert.equal(prompt.includes("Restore the board's complete ticket structure"), web && oldStructure);
    assert.equal(prompt.includes("When the board's example tickets share a recurring section skeleton"), boardFormat);
    if (web && oldStructure) assert.match(prompt, /BOARD RESEARCH \(structure and source fidelity outrank brevity\)/);
    assert.equal((result.html.match(/<li>/g) ?? []).length, 5);
    assert.equal(result.title, "[TAG] Welcome ICE 21/30");
    assert.ok(h.checks.some(([key, id]) => key === flag && id === 985));
  });
}
test("placeholder drafts retry exactly once, naming each placeholder and retaining request/context", async () => {
  const unfinished = '<p>Headline TO BE WRITTEN. TBD. To be defined. Placeholder. Lorem ipsum.</p>';
  for (const second of [finished, unfinished]) {
    const h = writerHarness({ outputs: [unfinished, second] });
    const result = await h.draft();
    assert.equal(h.calls.length, 2);
    const retry = promptText(h.calls[1]);
    assert.match(retry, /to be written, tbd, to be defined, placeholder, lorem ipsum/);
    assert.match(retry, /5 headlines/);
    assert.match(retry, /BOARD_MEMORY/);
    assert.equal(result.success, true);
  }
});
test("Ctrl+J holds placeholder output and never retries more than once", async () => {
  for (const second of [finished, "<p>TBD</p>"]) {
    const h = writerHarness({ outputs: ["<p>TBD</p>", second] });
    const response = await h.web();
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(h.calls.length, 2);
    if (second === finished) {
      assert.doesNotMatch(text, /TBD/);
      assert.match(text, /Finished headline 5/);
    } else {
      assert.equal(text, second);
    }
  }
});
test("structured Ctrl+J retries once with the same output schema", async () => {
  const h = writerHarness({ split: true, outputs: [JSON.stringify({ tasks: [{ title: "A/B test", description: "<p>TBD</p>" }] }), JSON.stringify({ tasks: [{ title: "[TAG] Welcome ICE 21/30", description: "<p>Finished ideas.</p>" }] })] });
  const response = await h.web();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.tasks[0].description, "<p>Finished ideas.</p>");
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.calls[0].responseFormat, h.calls[1].responseFormat);
});
test("flag off retains the already-released board-format rule without adding ideation or retries", async () => {
  const h = writerHarness({ enabled: false, outputs: ["<p>TBD</p>"] });
  assert.equal((await h.draft()).html, "<p>TBD</p>");
  assert.equal(h.calls.length, 1);
  const prompt = promptText(h.calls[0]);
  assert.match(prompt, /When the board's example tickets share a recurring section skeleton/);
  assert.doesNotMatch(prompt, /FINISHED IDEAS AND TEMPLATE TITLES/);
});
const productionPromptHashes = {
  "false/false/false": "d6c7f5dbf6f0d5e3f2803c541eaf791975bc881770d58832e2a983b6483863a6",
  "false/false/true": "7258852b9c4974bc530eafff29c85b164f2dda6b18abc8499ac45db1623b3794",
  "false/true/false": "4df0baca1d375e6554a4ae62a4160612ba1007905dec572619461e0113b3e258",
  "false/true/true": "31d97f39ea4f08ac3053f7e99aedc4cbaa1431b08a8fd64d10a3358d38f63a0b",
  "true/false/false": "d6c7f5dbf6f0d5e3f2803c541eaf791975bc881770d58832e2a983b6483863a6",
  "true/false/true": "7258852b9c4974bc530eafff29c85b164f2dda6b18abc8499ac45db1623b3794",
  "true/true/false": "a36bbc7434b72d12df26a35e7116b4a7a17f380bfcd26d7efcc13a698c9350eb",
  "true/true/true": "8326ea1356969091d7c5ff0a8199da18d1d9eff7dffa1e300c2341b01a919b37"
};
for (const oldStructure of [false, true]) for (const web of [false, true]) for (const boardFormat of [false, true]) {
  test(`flag off preserves production prompts and one model call (oldStructure=${oldStructure}, web=${web}, boardFormat=${boardFormat})`, async () => {
    const options = { enabled: false, oldStructure, web, boardFormat, outputs: ["<p>TBD</p>"] };
    const h = writerHarness(options);
    assert.equal((await h.draft()).html, "<p>TBD</p>");
    assert.equal(h.calls.length, 1);
    const prompt = promptText(h.calls[0]);
    assert.doesNotMatch(prompt, /FINISHED IDEAS AND TEMPLATE TITLES|Rewrite the complete draft once/);
    const styles = load("src/app/api/ai/_lib/editorAiPrompts.ts");
    assert.equal(styles.createTaskAuthoringStyle(true, false, false, false), styles.TASK_AUTHORING_WEB_STYLE);
    assert.equal(styles.createTaskAuthoringStyle(false, false, false, false), styles.TASK_AUTHORING_STYLE);
    const digest = crypto.createHash("sha256").update(prompt).digest("hex");
    assert.equal(digest, productionPromptHashes[`${oldStructure}/${web}/${boardFormat}`]);
    const stream = writerHarness(options);
    assert.equal(await (await stream.web()).text(), "<p>TBD</p>");
    assert.equal(stream.calls.length, 1);
    assert.equal(promptText(stream.calls[0]), prompt);
  });
}
test("placeholder matching uses the explicit list, not partial words or HTML attributes", () => {
  const { taskWriterPlaceholderFeedback } = writerHarness().run;
  assert.equal(taskWriterPlaceholderFeedback('<p title="placeholder">A household keeps its placeholders documented.</p>'), null);
  for (const text of ["to be written", "TBD", "to be defined", "placeholder", "lorem ipsum"]) assert.match(taskWriterPlaceholderFeedback(`<p>${text.toUpperCase()}</p>`), new RegExp(text, "i"));
});
test("ticket flag is registered through its definition, with requested Owner + QA rollout", () => {
  const definition = load("src/lib/flags/definitions/htpr-7472-task-templates.ts").default;
  assert.equal(definition.key, flag);
  assert.equal(definition.kind, "feature");
  assert.equal(definition.defaultMode, "OWNER_AND_QA");
  assert.equal(definition.releaseRisk.risk, "small");
  assert.equal(keys.HTPR_7472_TASK_TEMPLATES_FLAG, flag);
});

const { renderToStaticMarkup } = require("react-dom/server");
const promptContext = React.createContext(undefined);
const promptInput = moduleWithStubs("src/components/Modals/AICustomPrompt/AICustomPromptInput.tsx", {
  "@/hooks/General/useAutosizeTextarea": { default() {} },
  "@/lib/contexts/Multipages/customAiInstructionContext": { CustomAIPromptContext: promptContext },
}).default;
const actionButton = moduleWithStubs("src/components/Modals/AICustomPrompt/ActionRow.tsx", {
  "@/hooks/MultiPages/useUpdateTaskInBoards": {}, "@/lib/state": {}, "@/store": {},
  "@/lib/contexts/Multipages/customAiInstructionContext": {},
}).ActionButton;
function renderSettings(options = {}) {
  const queries = [], mutations = [];
  const component = moduleWithStubs("src/components/Modals/Settings/BoardTaskTemplatesSection.tsx", {
    react: { ...React, useState: () => [options.editing ?? null, () => {}] },
    "@/hooks/useFlag": { useFlag: (key) => { assert.equal(key, flag); return options.enabled !== false; } },
    "@/lib/flags/keys": keys,
    "@/lib/taskTemplateEditing": editing,
    "@/components/Modals/AICustomPrompt/AICustomPromptInput": { default: promptInput },
    "@/components/Modals/AICustomPrompt/ActionRow": { ActionButton: actionButton },
    "./SettingsSectionShell": { default: moduleWithStubs("src/components/Modals/Settings/SettingsSectionShell.tsx", {
      "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
    }).default },
    "./SettingsCard": { default: moduleWithStubs("src/components/Modals/Settings/SettingsCard.tsx").default },
    "./useSettingsTeam": { useSettingsTeam: () => ({ project: { id: 15 } }) },
    "@tanstack/react-query": {
      useQueryClient: () => ({ invalidateQueries: async () => {} }),
      useQuery: (query) => { queries.push(query); return { data: { templates: options.templates ?? [] } }; },
      useMutation: (mutation) => { mutations.push(mutation); return { isPending: false, mutate() {} }; },
    },
    axios: { default: { patch: async (...args) => { options.writes?.push(args); } } },
  }).default;
  const html = renderToStaticMarkup(React.createElement(component));
  return { html, queries, mutations };
}
test("settings render saved rows with heading summaries, shared actions and board knowledge note", () => {
  const { html } = renderSettings({ templates: [{ id: 7, name: "A/B test", title: "[TAG] {idea} ICE {score}/30", descriptionHtml: "<h2>Problem</h2><p>Explain.</p><h2>Variations</h2>" }] });
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector("h2").textContent, "Task templates");
  const row = document.querySelector("button");
  assert.match(row.textContent, /A\/B testProblem · Variations · \[TAG\] \{idea\} ICE \{score\}\/30Edit/);
  assert.ok(row.querySelector(".font-semibold"));
  assert.match(document.body.textContent, /Board knowledge stays in Custom instructions, Memory and Files\. You do not need to paste it into each template\./);
  assert.match(renderSettings().html, /Save a ticket as a template with Ctrl\+K/);
});
test("flag off renders no section and disables its template query", () => {
  const result = renderSettings({ enabled: false });
  assert.equal(result.html, "");
  assert.equal(result.queries[0].enabled, false);
});
test("editor renders approved fields and saves plain-text edits through PATCH", async () => {
  const writes = [];
  const template = { id: 7, projectId: 15, name: "A/B test", title: "[TAG] {idea}", descriptionHtml: "<h2>Ideas</h2><p>Original.</p>", text: "Ideas\n\nFinished copy." };
  const { html, mutations } = renderSettings({ editing: template, writes });
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelector("h2").textContent, "A/B test template");
  assert.deepEqual(Array.from(document.querySelectorAll("label"), (node) => node.textContent), ["Template name", "Title pattern", "Description structure"]);
  assert.deepEqual(Array.from(document.querySelectorAll("button"), (node) => node.textContent.trim()), ["‹ Task templates", "Cancel", "Save template"]);
  assert.equal(document.querySelector("textarea").readOnly, false);
  await mutations[0].mutationFn(template);
  assert.deepEqual(plain(writes), [["/api/task-templates", { templateId: 7, name: "A/B test", title: "[TAG] {idea}", descriptionHtml: "<h2>Ideas</h2><p>Finished copy.</p>" }]]);
});
test("rich editor shows a read-only note and preserves its HTML when other fields save", async () => {
  const writes = [];
  const template = { id: 7, projectId: 15, name: "Rich", title: "Title", descriptionHtml: '<h2>Ideas</h2><p><strong>Keep this</strong></p>', text: "Changed" };
  const { html, mutations } = renderSettings({ editing: template, writes });
  assert.equal(new JSDOM(html).window.document.querySelector("textarea").readOnly, true);
  assert.match(html, /rich formatting and is read-only here to preserve it/);
  await mutations[0].mutationFn(template);
  assert.equal(writes[0][1].descriptionHtml, template.descriptionHtml);
});
test("shared instruction textarea retains context defaults, fillHeight and controlled empty values", () => {
  const render = (props, context) => renderToStaticMarkup(React.createElement(promptContext.Provider, { value: context }, React.createElement(promptInput, props)));
  const defaultHtml = render({}, { value: "Existing instructions", handleChange() {} });
  assert.match(defaultHtml, /placeholder="e.g. Keep the responses concise"/);
  assert.match(defaultHtml, />Existing instructions<\/textarea>/);
  assert.match(defaultHtml, /min-h-\[180px\]/);
  assert.match(render({ fillHeight: true }, { value: "Existing instructions", handleChange() {} }), /h-full min-h-0 flex-1/);
  assert.match(render({ value: "", id: "controlled" }), /id="controlled"/);
  assert.doesNotMatch(render({ value: "" }, { value: "Must not leak" }), /Must not leak/);
  assert.throws(() => render({}), /must be used within a CustomAiProvider/);
});
test("settings navigation places templates directly after Custom instructions in Board scope", () => {
  const navigation = moduleWithStubs("src/components/Modals/Settings/settingsNavigation.ts", {
    "next/navigation": {}, "nookies": {}, "@/lib/state": {}, "@/store": {},
    "@/lib/demo/isGuestClient": {}, "@/lib/searchArchive": {},
    "@/utils/api/global/apiHelpers/getAllProjectsMinimal": {}, "@tanstack/react-query": {},
  });
  const board = navigation.SETTINGS_TABS.find((tab) => tab.id === "board");
  const ids = board.groups.flatMap((group) => group.items.map((item) => item.id));
  assert.equal(ids[ids.indexOf("board-ai") + 1], "board-task-templates");
});
