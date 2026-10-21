const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { load } = require("./task-route-loader.cjs");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const rule = load("src/lib/media/inlineAgentImages.ts", {});
const image = "https://files.hypertask.app/tasks/attachments/screenshot.png?version=1&size=2";
const html = `<p>Compare <a href="${image.replaceAll("&", "&amp;")}">screenshot</a>.</p>`;
const count = (value) => (value.match(/<img\b/g) ?? []).length;
const png = { url: image, fileName: "Screenshot.png", mimeType: "image/png" };
const flag = "htpr-7514-inline-agent-images";
const server = (enabled) => load("src/lib/media/inlineAgentImages.server.ts", {
  "@/lib/flags": { isFeatureEnabled: async (key, userId) => {
    assert.equal(key, flag);
    assert.equal(userId, 985);
    return enabled;
  } },
});

for (const enabled of [false, true]) {
  test(`shared image rule: linked/bare URLs, metadata and legacy state (${enabled})`, async () => {
    for (const content of [html, `<p>Compare ${image} with the previous version.</p>`]) {
      const output = rule.inlineAgentImages(content, { enabled });
      assert.ok(output.startsWith(content));
      assert.equal(count(output), enabled ? 1 : 0);
      if (enabled) assert.ok(output.includes(`src="${image.replaceAll("&", "&amp;")}"`));
      assert.equal(await server(enabled).inlineAgentImagesForUser(content, 985), output);
    }
    const file = { url: "https://files.hypertask.app/tasks/attachments/opaque-id", fileName: "Screenshot.png", mimeType: "image/png" };
    const output = rule.inlineAgentImages("<p>Evidence</p>", { enabled, attachments: [file] });
    assert.equal(count(output), enabled ? 1 : 0);
    assert.equal(rule.inlineAgentImages("<p>Text only &amp; unchanged.</p>", { enabled }), "<p>Text only &amp; unchanged.</p>");
  });
}

for (const wording of ["attachment only", "link only", "ATTACHMENT-ONLY", "attachments only", "only attach", "only link", "do not embed", "don't inline", "don’t embed", "never embed", "as attachment", "as an attachment", "just attach", "just link", "not inline", "attach it as a file"]) {
  test(`explicit opt-out: ${wording}`, () => {
    assert.equal(rule.inlineAgentImages(html, { enabled: true, instructions: `Please use ${wording}.`, attachments: [png] }), html);
    assert.equal(count(rule.inlineAgentImages(`<p>${wording}</p>${html}`, { enabled: true, attachments: [png] })), 1);
  });
}

test("boolean opt-out wins without adding an instruction to saved content", () => {
  assert.equal(rule.inlineAgentImages(html, { enabled: true, inlineImages: false, attachments: [png] }), html);
});

test("never inline non-images, unsupported images, unsafe schemes or credential URLs", () => {
  for (const file of [
    { url: image, mimeType: "application/pdf", fileName: "misleading.png" },
    { url: "https://files.hypertask.app/report.pdf", mimeType: "application/pdf" },
    { url: "https://files.hypertask.app/photo.heic", mimeType: "image/heic" },
    { url: "data:image/png;base64,AAAA", mimeType: "image/png" },
    { url: "javascript:alert(1)", mimeType: "image/png" },
    { url: Object.assign(new URL("https://files.hypertask.app/image.png"), { username: "user", password: "pw" }).href, mimeType: "image/png" },
  ]) assert.equal(rule.inlineAgentImages("<p>File</p>", { enabled: true, attachments: [file] }), "<p>File</p>");
  assert.equal(rule.inlineAgentImages("<p>https://files.hypertask.app/report.pdf</p>", { enabled: true }), "<p>https://files.hypertask.app/report.pdf</p>");
});

test("existing editor images, repeated links and uploaded metadata are deduplicated without rewriting HTML", () => {
  const inline = `<figure><img src="${image.replaceAll("&", "&amp;")}" alt="Existing" media-type="img" width="100%"></figure>${html}`;
  assert.equal(rule.inlineAgentImages(inline, { enabled: true, attachments: [png, png] }), inline);
  const once = rule.inlineAgentImages(html + html, { enabled: true, attachments: [png, png] });
  assert.equal(count(once), 1);
  assert.equal(rule.inlineAgentImages(once, { enabled: true, attachments: [png] }), once);
  const escaped = rule.inlineAgentImages("<p>Image</p>", { enabled: true, attachments: [{ ...png, fileName: '\"><script>alert(1)</script>' }] });
  assert.equal(count(escaped), 1);
  assert.doesNotMatch(escaped, /<script|onerror=/);
});

for (const enabled of [false, true]) {
  test(`request text cannot supply unrelated image candidates, flag ${enabled}`, () => {
    assert.equal(count(rule.inlineAgentImages("<p>Summary</p>", { enabled, instructions: `Compare this ${image}.` })), 0);
    for (const text of ["Links only for admins", "Please link the documentation", "Attach the report"]) {
      assert.equal(count(rule.inlineAgentImages(`<p>${text}</p>${html}`, { enabled, instructions: "Please attach the image and link the task" })), enabled ? 1 : 0);
    }
  });
}

for (const enabled of [false, true]) {
  for (const comment of [false, true]) {
    test(`upload persistence embeds into ${comment ? "comment" : "description"}, flag ${enabled}, idempotently`, async () => {
      const { persistAttachmentRows } = load("src/lib/mcp/attachments/persistBatch.ts", {});
      let content = "<p>Links only for admins</p>";
      const rows = [];
      let writes = 0;
      const db = {
        attachment: {
          findFirst: async ({ where }) => rows.find((row) => row.fileSource === where.fileSource),
          create: async ({ data }) => { const row = { id: rows.length + 1, ...data }; rows.push(row); return row; },
        },
        comment: {
          findUniqueOrThrow: async () => ({ text: content }),
          updateMany: async ({ where, data }) => { assert.equal(where.text, content); content = data.text; writes++; return { count: 1 }; },
        },
        description: {
          findUniqueOrThrow: async () => ({ content }),
          updateMany: async ({ where, data }) => { assert.equal(where.content, content); content = data.content; writes++; return { count: 1 }; },
        },
      };
      const uploads = [{ url: image, filename: "Screenshot.png", contentType: "image/png", fileSize: 12 }];
      const target = { taskId: 91, commentId: comment ? 44 : null, descriptionId: comment ? null : "desc", inlineImages: enabled };
      await persistAttachmentRows(db, uploads, target);
      await persistAttachmentRows(db, uploads, target);
      assert.equal(rows.length, 1);
      assert.equal(count(content), enabled ? 1 : 0);
      assert.equal(writes, enabled ? 1 : 0);
    });
  }
}

for (const enabled of [false, true]) {
  for (const comment of [false, true]) {
    test(`upload CAS miss keeps rows and the human edit, comment ${comment}, flag ${enabled}`, async () => {
      const { persistAttachmentRows } = load("src/lib/mcp/attachments/persistBatch.ts", {});
      const rows = [];
      let content = "<p>Links only for admins</p>";
      let writes = 0;
      const targetDelegate = {
        findUniqueOrThrow: async () => comment ? { text: content } : { content },
        updateMany: async () => { writes++; content = "<p>Human saved meanwhile</p>"; return { count: 0 }; },
      };
      const db = {
        attachment: {
          findFirst: async () => rows[0],
          create: async ({ data }) => { const row = { id: 1, ...data }; rows.push(row); return row; },
        },
        description: targetDelegate,
        comment: targetDelegate,
      };
      const target = { taskId: 91, commentId: comment ? 44 : null, descriptionId: comment ? null : "desc", inlineImages: enabled };
      const result = await persistAttachmentRows(db, [{ url: image, filename: "Screenshot.png", contentType: "image/png", fileSize: 12 }], target);
      assert.equal(result.length, 1);
      assert.equal(rows.length, 1);
      assert.equal(writes, enabled ? 1 : 0);
      assert.equal(content, enabled ? "<p>Human saved meanwhile</p>" : "<p>Links only for admins</p>");
    });
  }
}

for (const enabled of [false, true]) {
  for (const [optOut, attached] of [[false, false], [true, false], [false, true], [true, true]]) {
    test(`Ctrl+J mixed prose URL, upload ${attached}, flag ${enabled}, opt-out ${optOut}`, async () => {
      const dom = new JSDOM("");
      const previous = { fetch: global.fetch, DOMParser: global.DOMParser };
      const saved = [];
      global.DOMParser = dom.window.DOMParser;
      global.fetch = async () => ({ ok: true, headers: new Headers(), text: async () => `<h1 id="ai-generated-task-title">Compare screenshot</h1><p>Compare the layout.</p>${enabled ? `<img src="${image.replaceAll("&", "&amp;")}">` : ""}` });
      try {
        const { createComposedTask } = load("src/lib/ai/composeTask.ts", {
          axios: { default: { get: async () => ({ data: { sectionId: 7, section: "Inbox", ranking: "a" } }) } },
          "@/lib/deriveCurrentBoardBilling": { deriveCurrentBoardBilling: () => ({}) },
          "@/lib/createTaskAttachmentUploads": {
            startCreateTaskUpload: () => ({ id: "upload", promise: Promise.resolve({ url: image }) }),
            createTaskUploadById() {}, retryCreateTaskUpload() {}, bindCreateTaskUploads() {},
          },
          "@/utils/api/global/apiHelpers/createTaskGloballycontroller": { default: async (body) => {
            saved.push(body);
            return { resposne: { newTask: { id: 91, projectId: 15, uniqueIndex: 91 } } };
          } },
          "@/utils/helperFunctions/Views/ViewsHelperFunctions": {},
          "@/utils/helperFunctions/Views/NewTaskViewDefaults": {},
        });
        await createComposedTask({
          text: `Compare this screenshot ${image}${optOut ? ". Link only." : ""}`,
          files: attached ? [{ name: "Screenshot.png", type: "image/png" }] : [],
          project: { id: 15, uniqueIdentifier: "HTPR" }, userId: 985,
          inlineAgentImages: enabled, unfurlImageUrls: true,
        });
        assert.equal(saved.length, 1);
        assert.equal(count(saved[0].description), attached ? enabled && optOut ? 0 : 1 : enabled && !optOut ? 1 : 0);
      } finally {
        global.fetch = previous.fetch;
        global.DOMParser = previous.DOMParser;
        dom.window.close();
      }
    });
  }
}

for (const enabled of [false, true]) {
  test(`MCP v1/v2 shared text update passes inline result and opt-out through REST, flag ${enabled}`, async () => {
    const writes = [];
    const previous = global.fetch;
    global.fetch = async (_url, options) => { writes.push(JSON.parse(options.body)); return { ok: true, json: async () => ({}) }; };
    try {
      const { updateTaskText } = load("src/lib/mcp/tasks/fields/text.ts", {
        "@/lib/media/inlineAgentImages.server": server(enabled),
        "@/utils/controllers/urls/extractUrlsFromContent": { persistUrlsForDescription: async () => {} },
      });
      for (const inlineImages of [undefined, false]) {
        await updateTaskText({ requestBody: { description: html, inline_images: inlineImages }, hasTextOrParentUpdate: true, hasDescriptionUpdate: true, baseUrl: "https://app.hypertask.ai", ctx: { user: { id: 985 } } }, { id: 91 });
      }
      assert.equal(count(writes[0].newTask.description), enabled ? 1 : 0);
      assert.equal(count(writes[1].newTask.description), 0);
      assert.equal(writes[1].newTask.inline_images, false);
    } finally { global.fetch = previous; }
  });
}

for (const inlineImages of [undefined, false]) {
  test(`MCP services preserve inline_images through task/comment writes and subsequent uploads (${inlineImages})`, async () => {
    const requests = [];
    const client = { makeRequest: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      if (url.includes("attachments")) return { success: true, attachments: [{ id: 1 }] };
      if (url.includes("comments")) return { success: true, comment: { id: 44 } };
      return { success: true, task: { id: 91, ticketNumber: "HTPR-91", projectId: 15 } };
    } };
    const { TaskService } = load("src/lib/mcp-server/lib/services/task.service.ts", {});
    const { CommentService } = load("src/lib/mcp-server/lib/services/comment.service.ts", {});
    const file = { filename: "Screenshot.png", content_type: "image/png", url: image };
    await new TaskService(client).createTask({ project_id: 15, title: "Evidence", description: html, inline_images: inlineImages, attachments: [file] });
    await new TaskService(client).updateTask({ task_id: 91, description: html, inline_images: inlineImages, attachments: [file] });
    await new CommentService(client).addComment({ task_id: 91, text: html, inline_images: inlineImages, attachments: [file] });
    await new CommentService(client).updateComment({ comment_id: 44, text: html, inline_images: inlineImages });
    assert.equal(requests.filter(({ url }) => url.includes("attachments")).length, 3);
    for (const request of requests) assert.equal(request.body.inline_images, inlineImages);
    assert.equal(Object.hasOwn(requests.find(({ url }) => url === "/mcp/comments").body, "has_image_attachments"), false);
    assert.equal(Object.hasOwn(requests.find(({ url }) => url === "/mcp/comments").body, "attachments"), false);
  });
}

test("direct attachment schema accepts opt-out, rejects non-boolean, preserves existing shape when absent", () => {
  const { parseAndValidateAttachmentsBody } = load("src/lib/mcp/attachments/validateBody.ts", {});
  const body = { task_id: 91, files: [{ filename: "Screenshot.png", content_type: "image/png", url: image }] };
  assert.equal(parseAndValidateAttachmentsBody({ ...body, inline_images: false }).inline_images, false);
  assert.equal(Object.hasOwn(parseAndValidateAttachmentsBody(body), "inline_images"), false);
  assert.throws(() => parseAndValidateAttachmentsBody({ ...body, inline_images: "false" }), /boolean/);
});

const surfaces = [
  ["src/lib/ai/tools/createTask.ts", /description: await inlineAgentImagesForUser/],
  ["src/lib/ai/tools/updateOneTask.ts", /patch\.description = await inlineAgentImagesForUser/],
  ["src/lib/ai/tools/addComment.ts", /sanitizedText = await inlineAgentImagesForUser/],
  ["src/lib/ai/tools/updateComment.ts", /sanitizedText = await inlineAgentImagesForUser/],
  ["src/lib/ai/tools/draft.ts", /await inlineAgentImagesForUser/],
  ["src/lib/mcp/operations/tasks/create/operation.ts", /description: await inlineAgentImagesForUser/],
  ["src/lib/mcp/operations/comments/operation.ts", /sanitizedText = await inlineAgentImagesForUser/],
  ["src/lib/mcp/operations/comments/[comment_id]/operation.ts", /sanitizedText = await inlineAgentImagesForUser/],
  ["src/lib/api/task-writes/create-global.ts", /content: storedDescription/],
  ["src/lib/api/task-writes/create.ts", /description: agentId \? await inlineAgentImagesForUser/],
  ["src/lib/api/task-writes/update.ts", /newTask.description = await inlineAgentImagesForUser/],
  ["src/pages/api/comments/create.ts", /text: agentId \? await inlineAgentImagesForUser/],
  ["src/pages/api/comments/updateComment.ts", /text: session.agentId \? await inlineAgentImagesForUser/],
];
for (const [file, pattern] of surfaces) test(`write surface uses shared rule: ${file}`, () => assert.match(read(file), pattern));

test("flag-gated entrypoints, upload transaction and prompts stay wired to the ticket flag", () => {
  assert.match(read("src/components/Modals/commands/HTC/ComposeTaskWriter.tsx"), /useFlag\(HTPR_7514_INLINE_AGENT_IMAGES_FLAG\)/);
  assert.match(read("src/lib/mcp/operations/tasks/attachments/operation.ts"), /parsed.inline_images !== false && await isFeatureEnabled\(HTPR_7514_INLINE_AGENT_IMAGES_FLAG, user.id\)/);
  assert.match(read("src/lib/mcp/attachments/storeLockedBatch.ts"), /persistAttachmentRows\(tx, uploads, persistenceTarget\)/);
  assert.match(read("src/lib/api/task-writes/update.ts"), /delete newTask.inline_images/);
  for (const file of ["src/lib/ai/chatStream/modelTurn.ts", "src/app/api/ai/_lib/taskWriterRun.ts"]) {
    assert.match(read(file), /isFeatureEnabled\(HTPR_7514_INLINE_AGENT_IMAGES_FLAG,/);
    assert.match(read(file), /renderPrompt\("inline-agent-images"\)/);
  }
  const { PROMPTS } = load("src/lib/ai/prompts/definitions.ts", {});
  assert.match(PROMPTS["inline-agent-images"].parts[0], /attachment only, link only/);
  assert.match(PROMPTS["inline-agent-images"].parts[0], /inline_images: false/);
  const definition = load("src/lib/flags/definitions/htpr-7514-inline-agent-images.ts", {}).default;
  assert.equal(definition.key, flag);
  assert.equal(definition.defaultMode, "EVERYONE");
  assert.equal(definition.kind, "feature");
  assert.equal(definition.releaseRisk.risk, "small");
});

for (const enabled of [false, true]) {
  for (const optOut of [false, true]) {
    test(`AI create/update/comment/draft execution: flag ${enabled}, explicit opt-out ${optOut}`, async () => {
      const writes = [];
      const task = { id: 91, projectId: 15, userId: 985, uniqueIndex: 91, title: "Evidence", sectionId: 7 };
      const comment = { id: 44, creatorId: 985, taskId: 91, task: { id: 91, projectId: 15, project: {} } };
      const context = { inlineAgentImagesEnabled: enabled, user: { id: 985 }, actingAgentId: null, sendStatus() {}, body: { message: optOut ? "Add these screenshots, attachment only." : `Create two tasks using ${image} and https://files.hypertask.app/other.png.`, images64: [png, { url: "https://files.hypertask.app/other.png", mimeType: "image/png" }] } };
      const stubs = {
        ai: { tool: (definition) => definition },
        "@/lib/media/inlineAgentImages.server": server(enabled),
        "@/lib/prisma": { default: {
          task: { findUnique: async () => task },
          user: { findUnique: async () => ({ id: 985 }) },
          comment: { findUnique: async () => comment },
          drafts: { update: async ({ data }) => { writes.push(data.content); return { id: 1, ...data }; }, findFirst: async () => null, create: async ({ data }) => { writes.push(data.content); return { id: 1, ...data }; } },
        } },
        "@/lib/mcp/tasks/services": {
          validateProjectAccess: async () => ({ project: { uniqueIdentifier: "HTPR" } }),
          getSectionForTask: async () => ({ section: { id: 7, section_title: "Inbox" } }),
          validateParentTask: async () => ({}),
          createTask: async (payload) => { writes.push(payload.description); return task; },
        },
        "@/lib/mcp/tasks/mappers": { taskDetailInclude: () => ({}) },
        "@/lib/ai/bulkConfirmation": {},
        "@/lib/flags": { isFeatureEnabled: async () => false },
        "@/lib/ai/tools/execution": { withToolErrors: (fn) => fn, dropEmptyPadding: (value) => value, resolveTaskForTool: async () => ({ task }) },
        "@/lib/ai/tools/helpers": {
          sanitizeForJson: (value) => value, mapTaskToDetail: (value) => value, buildActivityUser: (value) => value,
          findDraftWithAccess: async () => ({ id: 1, content: "<p>Old draft</p>", type: "Description", userId: 985, taskId: 91, projectId: 15, task: { projectId: 15, project: {} } }), userHasProjectAccess: () => true, validateMentionUsers: async () => null, validateMentionUserIds: async () => null,
          commentInclude: () => ({}), mapCommentToResponse: (value) => value, applyDurableCommentAttribution: (value) => value, mapDraftToResponse: (value) => value,
        },
        "@/utils/controllers/tasks/single": { updateTaskSingle: async (patch) => { writes.push(patch.description); return { status: 200, json: task }; } },
        "@/utils/controllers/comments/processMentions": { resolveTextMentions: async (value) => value },
        "@/utils/controllers/comments/linkifyTicketRefs": { linkifyTicketRefs: async (value) => value },
        "@/utils/controllers/comments/createCommentService": { createCommentService: async (payload) => { writes.push(payload.text); return { id: 44 }; } },
        "@/utils/controllers/comments/updateCommentService": { updateCommentService: async (payload) => { writes.push(payload.text); } },
        "@/utils/controllers/urls/extractUrlsFromContent": { persistUrlsForComment: async () => {}, persistUrlsForDescription: async () => {} },
        "@/lib/realtime/server": { broadcastTaskComment() {}, broadcastBoardChange() {}, broadcastTaskChange() {} },
        "@/lib/ai/chatStream/prompt": { COMMENT_TASK_LINK_RULE: "" },
        "@/app/api/ai/_lib/taskWriterDraft": {},
        "@/app/api/ai/_lib/taskWriterRun": {},
        "@/utils/controllers/agents/boardMembers": {},
        "@/utils/controllers/getMemberAndOwnerForBoard": {},
        "@/utils/controllers/notifications/creation-service/createAndSendNotificationTaskMove": {},
        "@/utils/controllers/activities/createArchiveActivity": {},
        "@/pages/api/queues/duedateQueue": {},
        "@/utils/controllers/activities/createTaskDueDateActivity": {},
      };
      const { createCreateTaskTool } = load("src/lib/ai/tools/createTask.ts", stubs);
      const { createTaskUpdater } = load("src/lib/ai/tools/updateOneTask.ts", stubs);
      const { createAddCommentTool } = load("src/lib/ai/tools/addComment.ts", stubs);
      const { createUpdateCommentTool } = load("src/lib/ai/tools/updateComment.ts", stubs);
      const { createDraftTool } = load("src/lib/ai/tools/draft.ts", stubs);
      assert.equal((await createCreateTaskTool(context).hypertask_create_task.execute({ project_id: 15, title: "Evidence", description: html })).success, true);
      assert.equal((await createTaskUpdater(context, { description: html })({ task_id: 91 })).success, true);
      assert.equal((await createAddCommentTool(context).hypertask_add_comment.execute({ task_id: 91, text: html })).success, true);
      assert.equal((await createUpdateCommentTool(context).hypertask_update_comment.execute({ comment_id: 44, text: html })).success, true);
      assert.equal((await createDraftTool(context).hypertask_draft.execute({ action: "create", task_id: 91, draft_type: "description", text: html })).success, true);
      assert.equal(writes.length, 5);
      for (const value of writes) {
        assert.equal(count(value), enabled && !optOut ? 1 : 0);
        assert.ok(!value.includes("other.png"));
      }
      const createTool = createCreateTaskTool(context).hypertask_create_task;
      const other = "https://files.hypertask.app/other.png";
      assert.equal((await createTool.execute({ tasks: [
        { project_id: 15, title: "First", description: html },
        { project_id: 15, title: "Second", description: "<p>Second evidence</p>", ...(enabled ? { image_urls: [other] } : {}) },
      ] })).success, true);
      assert.equal(count(writes[5]), enabled && !optOut ? 1 : 0);
      assert.ok(!writes[5].includes("other.png"));
      assert.equal(count(writes[6]), enabled && !optOut ? 1 : 0);
      assert.ok(!writes[6].includes("screenshot.png"));
      assert.equal((await createUpdateCommentTool(context).hypertask_update_comment.execute({ comment_id: 44, text: "<p>Correct an old typo</p>" })).success, true);
      assert.equal(writes[7], "<p>Correct an old typo</p>");
      assert.equal((await createDraftTool(context).hypertask_draft.execute({ action: "create", task_id: 91, draft_type: "description", text: "<p>Unrelated draft</p>" })).success, true);
      assert.equal(writes[8], "<p>Unrelated draft</p>");
      assert.equal((await createTaskUpdater(context, { description: "<p>Text-only update</p>" })({ task_id: 91 })).success, true);
      assert.equal(writes[9], "<p>Text-only update</p>");
      assert.equal((await createAddCommentTool(context).hypertask_add_comment.execute({ task_id: 91, text: "<p>Text-only comment</p>" })).success, true);
      assert.equal(writes[10], "<p>Text-only comment</p>");
      assert.equal((await createDraftTool(context).hypertask_draft.execute({ action: "update", draft_id: 1, text: "<p>Text-only draft edit</p>" })).success, true);
      assert.equal(writes[11], "<p>Text-only draft edit</p>");
      assert.equal((await createDraftTool(context).hypertask_draft.execute({ action: "publish", draft_id: 1 })).success, true);
      assert.equal(writes[12], "<p>Old draft</p>");
      const { z } = require("zod");
      const { getUpdateTaskSchema } = load("src/lib/ai/tools/updateTaskSchema.ts", {});
      for (const tool of [createTool, createAddCommentTool(context).hypertask_add_comment, createUpdateCommentTool(context).hypertask_update_comment, createDraftTool(context).hypertask_draft, { inputSchema: getUpdateTaskSchema(enabled) }]) {
        const schema = z.toJSONSchema(tool.inputSchema);
        const encoded = JSON.stringify(schema);
        assert.equal(encoded.includes('"inline_images"'), enabled);
        assert.equal(encoded.includes('"image_urls"'), enabled);
        assert.equal(encoded.includes("images are embedded inline by default"), enabled);
      }
      const withoutImageFields = (value) => Array.isArray(value) ? value.map(withoutImageFields)
        : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter(([key]) => !["inline_images", "image_urls"].includes(key)).map(([key, child]) => [key, withoutImageFields(child)])) : value;
      const toolSchemas = (flagState) => {
        const ctx = { ...context, inlineAgentImagesEnabled: flagState };
        return [createCreateTaskTool(ctx).hypertask_create_task, createAddCommentTool(ctx).hypertask_add_comment, createUpdateCommentTool(ctx).hypertask_update_comment, createDraftTool(ctx).hypertask_draft, { inputSchema: getUpdateTaskSchema(flagState) }].map((tool) => z.toJSONSchema(tool.inputSchema));
      };
      assert.deepEqual(toolSchemas(false), toolSchemas(true).map(withoutImageFields));
    });
  }
}

test("attachment MIME classification wins over a misleading .png link", () => {
  assert.equal(rule.inlineAgentImages(html, { enabled: true, attachments: [{ ...png, mimeType: "application/pdf" }] }), html);
});

for (const enabled of [false, true]) {
  test(`comment service sends actual attachment specs only with flag on (${enabled})`, async () => {
    const calls = [];
    const client = { makeRequest: async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return url.includes("attachments") ? { success: true, attachments: [{ id: 1 }] } : { success: true, comment: { id: 44 } };
    } };
    const { CommentService } = load("src/lib/mcp-server/lib/services/comment.service.ts", {});
    const attachments = [{ filename: "Screenshot.png", content_type: "image/png", url: image }];
    await new CommentService(client).addComment({ task_id: 91, text: "<p>Evidence</p>", attachments }, undefined, { inlineAgentImages: enabled });
    assert.deepEqual(calls[0].body, { task_id: 91, text: "<p>Evidence</p>", ...(enabled ? { attachments } : {}) });
    assert.equal(Object.hasOwn(calls[0].body, "has_image_attachments"), false);
    assert.equal(calls[1].url, "/mcp/tasks/attachments");
  });

  test(`cookie upload with an agent cookie claim still links without a body agentId (${enabled})`, async () => {
    const calls = [];
    const receipt = { userId: 985, key: "tasks/attachments/image.png", fileName: "image.png", contentType: "image/png", fileSize: 12 };
    const { POST } = load("src/lib/api/task-writes/upload-finalize.ts", {
      "@/lib/auth/agentScope": { withAgentScopeRequest: (_request, fn) => fn(), prepareAgentScope: async () => {} },
      "@/lib/auth/session": { SESSION_COOKIE: "ht_session", verifySession: () => ({ id: 985, agentId: "cookie-agent" }) },
      "@/lib/auth/getSessionUser": { getSessionUser: async () => null },
      "@/lib/flags": { isFeatureEnabled: async () => enabled },
      "@/lib/storage/uploadGrant": { verifyTaskAttachmentLinkReceipt: () => receipt },
      "@/lib/storage/linkTaskAttachment": { linkTaskAttachment: async (...args) => { calls.push(args); return { id: 1 }; }, TaskAttachmentLinkError: class extends Error {} },
      "@/lib/realtime/server": { broadcastTaskChange: async () => {} },
      "@/lib/storage/hypertasksS3": {},
      "@/lib/storage/uploadTaskAttachmentToS3": { TASK_ATTACHMENT_PREFIX: "tasks/attachments" },
    });
    const response = await POST({ cookies: { ht_session: "cookie" }, headers: new Headers(), json: async () => ({ action: "link-task-attachment", taskId: 91, receipt: "receipt" }) });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [[91, 985, receipt]]);
  });
}

for (const enabled of [false, true]) {
  for (const branch of ["fullscreen", "existing-section-task", "empty-section"]) {
    test(`legacy ${branch} creation still saves an empty description, flag ${enabled}`, async () => {
      const writes = [];
      const { POST } = load("src/lib/api/task-writes/create.ts", {
        "./route": { taskWriteRoute: (options) => (body) => options.operation(body, { user: { id: 985 }, session: { userId: 985, agentId: "agent" } }) },
        "@/lib/auth/sessionUserRecord": {},
        "@/lib/auth/resolveActingAgent": { resolveActingAgent: () => ({ ok: true, agentId: "agent" }) },
        "@/lib/media/inlineAgentImages.server": server(enabled),
        "@/utils/controllers/tasks/create": { default: async (payload) => { writes.push(payload); return { status: 200, json: { id: 91 } }; } },
        "@/utils/generateRank": { default: () => "a" },
        "@/lib/prisma": { default: {
          task: { findFirst: async () => branch === "empty-section" ? null : { id: 90, section: "Inbox", ranking: "b" }, findUnique: async () => ({ id: 91 }) },
          section: { findFirst: async () => ({ id: 7, section_title: "Inbox" }) },
          description: { findUnique: async () => ({ id: "desc", content: "" }) },
        } },
        "@/lib/realtime/server": { broadcastBoardChange() {} },
      });
      const response = await POST({ title: "Legacy", description: html, projectId: 15, sectionId: 7, userId: 985, ...(branch === "fullscreen" ? { fullScreenTask: true } : {}) });
      assert.equal(response.status, 200);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].description, "");
    });
  }
}
