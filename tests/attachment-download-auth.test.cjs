const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");

const base = "https://files.hypertask.app/";
const key = "tasks/attachments/123_private.png";
const source = base + key;
const board = { id: 7049, ownerId: 985, members: [
  { userId: 986, agentId: null },
  { userId: 987, agentId: "agent-only" },
] };

function harness({ userId = 985, attachments = [], descriptions = [], comments = [], pages = [], chatSessions = [], mode = "pages-off" } = {}) {
  const calls = [];
  function accessible(where) {
    assert.deepEqual(where, { OR: [
      { ownerId: userId }, { members: { some: { userId, agentId: null } } },
    ] }, "use the real canonical human board scope");
    return board.ownerId === userId || board.members.some(member => member.userId === userId && member.agentId === null);
  }
  const storageKey = url => {
    const parsed = new URL(url);
    if (!["files.hypertask.app", "hypertasks.s3.us-east-2.amazonaws.com"].includes(parsed.hostname)) return null;
    return parsed.pathname.slice(1);
  };
  function attachmentMatches(row, where) {
    return (where.OR ?? [where]).some(branch => typeof branch.fileSource === "string"
      ? row.fileSource === branch.fileSource
      : row.fileSource.endsWith(branch.fileSource.endsWith));
  }
  const mocks = {
    "@/lib/prisma": { default: {
      attachment: {
        findFirst: async query => { calls.push(["attachment", query]); return attachments.find(row => attachmentMatches(row, query.where)) ?? null; },
        findMany: async query => { calls.push(["attachment", query]); return attachments.filter(row => attachmentMatches(row, query.where)); },
      },
      project: { findFirst: async query => {
        calls.push(["project", query]);
        const { id, ...scope } = query.where;
        return (typeof id === "number" ? id === board.id : id.in.includes(board.id)) && accessible(scope) ? { id: board.id } : null;
      } },
      description: { findMany: async query => {
        calls.push(["description", query]);
        return accessible(query.where.task.project) ? descriptions.filter(row => query.where.OR.some(branch => row.content.includes(branch.content.contains))) : [];
      } },
      comment: { findMany: async query => {
        calls.push(["comment", query]);
        return accessible(query.where.task.project) ? comments.filter(row => query.where.OR.some(branch => row.text.includes(branch.text.contains))) : [];
      } },
      page: { findMany: async query => {
        calls.push(["page", query]);
        return accessible(query.where.project) ? pages.filter(row => query.where.OR.some(branch => row.contentHtml.includes(branch.contentHtml.contains))) : [];
      } },
      chatSession: { findFirst: async query => {
        calls.push(["chat-session", query]);
        return chatSessions.find(row => row.id === query.where.id && row.userId === query.where.userId) ?? null;
      } },
    } },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => userId === null ? null : { userId, source: "better-auth" } },
    "@/lib/flags": { isFeatureEnabled: async () => {
      if (mode === "pages-outage") throw new Error("Flag unavailable");
      return mode === "pages-on";
    } },
    "@/lib/storage/hypertasksS3": {
      HYPERTASKS_S3_BUCKET: "bucket",
      parseHypertasksStorageKeyFromUrl: storageKey,
      getHypertasksS3Client: () => ({ getSignedUrl: (operation, params) => {
        calls.push(["sign", operation, params]);
        return "https://storage.invalid/download";
      } }),
    },
    "@/lib/agents/publicAgent": {},
    "@/lib/cycles": {},
    "@/lib/agents/visibility": {},
    "@/utils/controllers/notifications/visibleInboxScope": {},
  };
  const typed = load("src/lib/api/task-writes/download-attachment.ts", mocks).GET;
  mocks["@/lib/api/task-writes/download-attachment"] = { GET: typed };
  async function request(fileSource = source) {
    const query = { fileSource, fileName: "private café.png", userId: "985", projectId: "7049", uploaderId: "985" };
    if (mode === "typed") {
      const response = await typed({ url: `https://app.invalid/api/tasks/downloadAttachment?${new URLSearchParams(query)}`, headers: new Headers() });
      const text = await response.text();
      return { statusCode: response.status, body: response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : text, headers: Object.fromEntries(response.headers) };
    }
    const handler = load("src/pages/api/tasks/downloadAttachment.ts", mocks).default;
    const res = { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
      status(code) { this.statusCode = code; return this; },
      json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; } };
    await handler({ method: "GET", headers: {}, query }, res);
    return res;
  }
  return { request, calls };
}

for (const mode of ["pages-off", "pages-on", "typed"]) {
  for (const relation of ["task", "description", "comment", "AI_Custom_Instructions"]) {
    const linked = ["task", "AI_Custom_Instructions"].includes(relation) ? { projectId: board.id } : { task: { projectId: board.id } };
    for (const userId of [985, 986, 2343, 987]) {
      test(`${mode}: ${relation} file allows owner/member and denies outsider/agent-only human ${userId}`, async () => {
        const h = harness({ mode, userId, attachments: [{ fileSource: source, [relation]: linked }] });
        const response = await h.request();
        assert.equal(response.statusCode, [985, 986].includes(userId) ? 200 : 404);
        assert.equal(h.calls.filter(([kind]) => kind === "sign").length, [985, 986].includes(userId) ? 1 : 0);
      });
    }
  }
  for (const attachments of [[], [{ fileSource: source }]]) {
    test(`${mode}: unknown/ownerless file is 404 even with forged ownership parameters`, async () => {
      const h = harness({ mode, attachments });
      assert.equal((await h.request()).statusCode, 404);
      assert.ok(!h.calls.some(([kind]) => kind === "sign"));
    });
    for (const userId of [986, 2343]) {
      for (const kind of ["description", "comment", "page"]) {
        test(`${mode}: ${kind}-referenced ownerless file allows member and denies outsider ${userId}, row=${attachments.length}`, async () => {
          const html = `<img src="${source}">`;
          const h = harness({ mode, userId, attachments,
            descriptions: kind === "description" ? [{ content: html }] : [],
            comments: kind === "comment" ? [{ text: html }] : [],
            pages: kind === "page" ? [{ contentHtml: html }] : [],
          });
          assert.equal((await h.request()).statusCode, userId === 986 ? 200 : 404);
          assert.equal(h.calls.filter(([call]) => call === "sign").length, userId === 986 ? 1 : 0);
        });
      }
    }
  }
  for (const userId of [985, 2343]) {
    test(`${mode}: legacy raw filename spaces still resolve the board row ${userId}`, async () => {
      const rawSource = base + "tasks/attachments/123_private image.png";
      const h = harness({ mode, userId, attachments: [{ fileSource: rawSource, task: { projectId: board.id } }] });
      assert.equal((await h.request(rawSource.replaceAll(" ", "%20"))).statusCode, userId === 985 ? 200 : 404);
    });
  }
  test(`${mode}: raw-space description references and HEIC original URLs remain supported`, async () => {
    for (const html of [
      `<img src="${base}tasks/attachments/123_private image.png">`,
      `<img src="${source}.preview.jpg" data-original-src="${source}">`,
    ]) {
      const h = harness({ mode, descriptions: [{ content: html }] });
      const requested = html.includes("data-original-src") ? source : base + "tasks/attachments/123_private%20image.png";
      assert.equal((await h.request(requested)).statusCode, 200);
    }
  });
  test(`${mode}: an accessible reference does not override a denied board-bound row`, async () => {
    const h = harness({ mode, attachments: [{ fileSource: source, task: { projectId: 9000 } }], descriptions: [{ content: `<img src="${source}">` }] });
    assert.equal((await h.request()).statusCode, 404);
    assert.ok(!h.calls.some(([kind]) => kind === "description" || kind === "sign"));
  });
  test(`${mode}: a longer referenced key does not authorize its prefix`, async () => {
    const h = harness({ mode, descriptions: [{ content: `<img src="${source}.other">` }], comments: [{ text: `<a href="${source}.other">other</a>` }] });
    assert.equal((await h.request()).statusCode, 404);
    assert.ok(!h.calls.some(([kind]) => kind === "sign"));
  });
  test(`${mode}: a storage-host alias still finds the bound private attachment`, async () => {
    const h = harness({ mode, userId: 2343, attachments: [{ fileSource: source, task: { projectId: board.id } }] });
    assert.equal((await h.request(`https://hypertasks.s3.us-east-2.amazonaws.com/${key}`)).statusCode, 404);
    assert.ok(h.calls.some(([kind]) => kind === "project"));
  });
  test(`${mode}: duplicate rows do not hide a member's accessible file`, async () => {
    const h = harness({ mode, attachments: [
      { fileSource: source }, { fileSource: source, task: { projectId: board.id } },
    ] });
    assert.equal((await h.request()).statusCode, 200);
  });
  test(`${mode}: chat relation cannot override a denied board relation`, async () => {
    const h = harness({ mode, userId: 2343, attachments: [{ fileSource: source, task: { projectId: board.id }, chatMessage: { session: { userId: 2343 } } }] });
    assert.equal((await h.request()).statusCode, 404);
    assert.ok(!h.calls.some(([kind]) => kind === "sign"));
  });
  for (const userId of [985, 2343]) {
    test(`${mode}: supported chat attachment is private to its owner ${userId}`, async () => {
      const h = harness({ mode, userId, attachments: [{ fileSource: source, chatMessage: { session: { userId: 985 } } }] });
      assert.equal((await h.request()).statusCode, userId === 985 ? 200 : 404);
    });
    test(`${mode}: uploader's independently owned chat key works without an attachment row ${userId}`, async () => {
      const h = harness({ mode, userId, chatSessions: [{ id: "chat-985", userId: 985 }] });
      assert.equal((await h.request(base + "ai-chat/attachments/chat-985/123_upload.png")).statusCode, userId === 985 ? 200 : 404);
    });
    test(`${mode}: canvas page image remains scoped to its board ${userId}`, async () => {
      const payload = Buffer.from(`<img src="${source}">`).toString("base64");
      const h = harness({ mode, userId, pages: [{ contentHtml: `<div data-html-block="true" data-html="${payload}"></div>` }] });
      assert.equal((await h.request()).statusCode, userId === 985 ? 200 : 404);
    });
  }
  test(`${mode}: failed chat ownership does not block an accessible content reference`, async () => {
    const chatSource = base + "ai-chat/attachments/other-chat/123_image.png";
    const h = harness({ mode, descriptions: [{ content: `<img src="${chatSource}">` }] });
    assert.equal((await h.request(chatSource)).statusCode, 200);
  });
  test(`${mode}: missing chat session, unknown key and unsupported host fail closed`, async () => {
    for (const url of [base + "ai-chat/attachments/missing/123_file.png", base + "ai-chat/attachments/chat-985/nested/123_file.png", "https://external.invalid/file.png"]) {
      const h = harness({ mode, chatSessions: [{ id: "chat-985", userId: 985 }] });
      assert.equal((await h.request(url)).statusCode, 404);
      assert.ok(!h.calls.some(([kind]) => kind === "sign"));
    }
  });
  test(`${mode}: authorized download retains expiry, filename disposition and cache headers`, async () => {
    const h = harness({ mode, attachments: [{ fileSource: source, task: { projectId: board.id } }] });
    const response = await h.request();
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { downloadUrl: "https://storage.invalid/download" });
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers.pragma, "no-cache");
    assert.equal(response.headers.expires, "0");
    assert.deepEqual(h.calls.find(([kind]) => kind === "sign"), ["sign", "getObject", {
      Bucket: "bucket", Key: key, Expires: 60, ResponseContentDisposition: "attachment; filename=private%20caf%C3%A9.png",
    }]);
  });
  test(`${mode}: anonymous callers cannot reach attachment or storage queries`, async () => {
    const h = harness({ mode, userId: null });
    assert.equal((await h.request()).statusCode, 401);
    assert.deepEqual(h.calls, []);
  });
}

test("flag outage cannot restore the unknown-file bypass", async () => {
  const h = harness({ mode: "pages-outage" });
  assert.equal((await h.request()).statusCode, 404);
  assert.ok(!h.calls.some(([kind]) => kind === "sign"));
});
