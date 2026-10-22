const assert = require("node:assert/strict");
const test = require("node:test");
const { NextRequest } = require("next/server");
const { fixture, matches, hydrate } = require("./helpers/agent-board-scope.cjs");

function harness({ actor = "agent", enforce = true, grant = "none", teamless = false, names = true, bearer = false, bypassTask = false, recentViewer = false, sessionAgent = false, authenticated = true, profile = true } = {}) {
  const f = fixture();
  f.state.enforce = enforce;
  if (actor !== "agent") f.state.ctx.agentId = null;
  const project = f.projects[2];
  project.team = { aiProviderSettings: {} };
  if (teamless) project.teamId = null;
  if (actor === "member" || actor === "guest") {
    project.ownerId = 99;
    project.owner = { id: 99, agents: [] };
    project.members.push({ userId: f.user.id, agentId: null, status: "Accepted", role: actor === "guest" ? "Guest" : "Member", user: f.user });
  }
  if (grant !== "none") {
    const board = grant === "wrong-board" ? f.projects[0] : project;
    board.members.push({ agentId: f.agent.id, status: grant === "invited" ? "Invited" : "Accepted", agent: f.agent });
    if (grant === "revoked") f.agent.revokedAt = new Date();
    if (grant === "wrong-owner") f.agent.userId = 99;
  }
  const task = f.tasks[2];
  task.deletedAt = null;
  const older = { id: 10, taskId: task.id, task, creatorId: f.user.id, agentId: null, text: "Older viewer source", createdAt: new Date("2026-10-01"), creator: f.user, agent: null, agentDisplayName: null };
  const newer = { ...older, id: 11, creatorId: 7, text: "Newer reply", createdAt: new Date("2026-10-02") };
  task.comments = recentViewer ? [newer, older] : [newer];
  const queries = [];
  const generateCalls = [];
  const posted = [];
  const sourceChecks = [];
  f.prisma.task.findFirst = async args => {
    queries.push({ model: "task", ...args });
    const row = f.tasks.find(row => bypassTask ? row.id === args.where.id : matches(row, args.where));
    return hydrate(row, args);
  };
  f.prisma.project.findFirst = async args => {
    queries.push({ model: "project", ...args });
    return hydrate(f.projects.find(row => matches(row, args.where)), args);
  };
  f.prisma.comment = {
    findFirst: async args => {
      queries.push({ model: "comment", method: "findFirst", ...args });
      return hydrate([older, newer].find(row => matches(row, args.where)), args);
    },
    findMany: async args => {
      queries.push({ model: "comment", method: "findMany", ...args });
      return [newer, older].filter(row => matches(row, args.where)).map(row => hydrate(row, args));
    },
    count: async args => {
      queries.push({ model: "comment", method: "count", ...args });
      return [newer, older].filter(row => matches(row, args.where)).length;
    },
  };
  f.prisma.chatSession = { create: async ({ data }) => ({ id: "new-session", title: "New AI Chat", ...data }) };
  const session = async () => {
    if (!authenticated) return null;
    const agentId = sessionAgent ? f.agent.id : f.state.ctx.agentId;
    await f.scope.prepareAgentScope(f.user.id, agentId);
    return { userId: f.user.id, agentId };
  };
  const modelProvider = { configureAiModelUsage: () => {}, resolveAiModel: () => ({}), providerOptionsForAiModel: () => ({}), aiUsageProviderForCredential: () => "fixture" };
  const mocks = {
    "@/lib/auth/getSessionUser": { getSessionUser: session },
    "@/lib/auth/cookieIdentity": { verifyCookieIdentity: async () => ({ status: "missing" }) },
    "@/lib/auth/session": { SESSION_COOKIE: "session" },
    "@/lib/mcp/auth": { validateMcpAuth: async () => f.state.ctx },
    "@/lib/api/rateLimit": { checkRestRateLimit: async () => null },
    "@/lib/agents/visibility": {},
    "@/utils/controllers/agents/boardMembers": {},
    "@/lib/agents/chatAccess": {},
    "@/lib/flags": { isFeatureEnabled: async key => key === "htpr-7052-chat-names" && names },
    "@/lib/errors/reportError": { reportError: async report => { throw new Error(`Unexpected report: ${report.message}`); } },
    "@/app/api/ai/_lib/modelProvider": modelProvider,
    "@/app/api/ai/_lib/planGate": { haiku55ModelEnabled: async () => false },
    "@/app/api/ai/_lib/promptCache": { cachedInstructionsForUser: async (_id, args) => args.fixed },
    "@/app/api/ai/_lib/byokKeys": { getAiDefaultModelContext: async () => ({ haiku55Enabled: false }), getTeamGatewayApiKey: async () => "fixture" },
    "@/app/api/ai/_lib/systemModelLadder": { resolveSystemModel: () => ({ provider: "fixture", model: "fixture" }) },
    "@/app/api/ai/_lib/taskContent": { convertHtmlToText: text => text, isSessionNoise: () => false },
    "@/lib/ai/prompts/registry": { renderPrompt: (key, ...values) => [key, ...values].join("\n") },
    "@/lib/ai/hyperAiConfirmation": { isUneditedHyperAiComment: async args => { sourceChecks.push(args); return true; } },
    "@/app/api/ai/_lib/editorAi": {
      getCurrentUserFromCookies: async () => profile ? f.user : null,
      errorMessage: error => error.message,
      HOUSE_OUTPUT_STYLE: "fixture",
      createTaskWriterUserContent: text => text,
      retrieveTaskWriterContext: async () => "",
      selectTaskWriterModel: async () => ({ model: {}, modelId: "fixture" }),
      selectTiptapModel: async () => ({ model: {} }),
      extractHtmlBlocks: text => ({ stripped: text, blocks: [] }),
      reattachHtmlBlocks: text => text,
      normalizeTiptapOutput: (_input, text) => text,
      createPromptForTiptapForwardSlash: () => "fixture",
    },
    "@/app/api/ai/_lib/providerGate": { getProjectTeamProviderContext: async projectId => ({ projectId, settings: {} }) },
    "@/lib/systemModelLadder": { isAiFeatureEnabled: () => true },
    "@/app/api/ai/_lib/currentTaskContext": { resolveAiUsageTaskId: async () => task.id, loadCurrentTaskContext: async () => "", loadCurrentTaskImages: async () => [], htmlToText: text => text },
    "@/app/api/ai/_lib/skills": { resolveSkills: async text => ({ cleanedText: text }) },
    "@/lib/aiModelOptions": { aiModelOptions: [], resolveAiModelMention: () => null },
    "@/app/api/ai/_lib/hyperAiTools": { createHyperAiTools: () => ({}), HYPER_AI_TOOL_COUNT: 0 },
    "@/utils/controllers/comments/createCommentService": { createCommentService: async args => posted.push(args) },
    "@/utils/controllers/comments/linkifyTicketRefs": { linkifyTicketRefs: async text => text },
    "@/utils/controllers/comments/ticketRefLinker": { markAiDetailAnchors: text => text },
    "@/utils/helperFunctions/sanitizeRichHtml": { sanitizeRichHtml: text => text },
    ai: { generateText: async args => { generateCalls.push(args); return { text: "Fixture response", output: { questions: ["Next?"] }, steps: [] }; }, stepCountIs: () => () => false, Output: { object: () => ({}) }, NoObjectGeneratedError: { isInstance: () => false }, NoOutputGeneratedError: { isInstance: () => false } },
  };
  mocks["@/app/api/ai/_lib/taskWriterRun"] = f.load("src/app/api/ai/_lib/taskWriterRun.ts", {
    ...mocks,
    "@/lib/ai/taskWriterDueDate": {},
    "@/lib/ai/composeTaskTarget": {},
    "@/app/api/ai/_lib/taskWriterPrompt": {},
    "@/app/api/ai/_lib/taskWriterBoardResearch": {},
    "@/lib/doneColumns": {},
    "@/app/api/ai/_lib/boardTemplateContext": {},
    "@/utils/controllers/turbopuffer/turbopufferHelper": {},
  });
  const userFind = f.prisma.user.findUnique;
  f.prisma.user.findUnique = async args => args.where.id === 332 ? { id: 332 } : userFind(args);
  const routes = {};
  const paths = { naming: "ai-chat/create-session", hyper: "ai/hyper-mentioned", questions: "ai/task-questions", editor: "ai/tiptap-forwardslash" };
  async function request(area, overrides = {}) {
    routes[area] ??= f.load(`src/app/api/${paths[area]}/route.ts`, mocks);
    const body = {
      naming: { taskId: task.id },
      hyper: { projectId: project.id, taskId: task.id, text: "Source", sourceType: "Comment", sourceCommentId: 10 },
      questions: { taskId: task.id },
      editor: { projectId: project.id, taskId: task.id, content: "Draft", command: "Improve" },
    }[area];
    const req = new NextRequest(`https://app.hypertask.ai/api/${paths[area]}?userId=999&agentId=body-agent`, {
      method: "POST", headers: { "Content-Type": "application/json", ...(bearer ? { Authorization: "Bearer fixture" } : {}) },
      body: JSON.stringify({ ...body, userId: 999, actingAgentId: "body-agent", ...overrides }),
    });
    return routes[area].POST(req);
  }
  return { ...f, project, task, older, newer, queries, generateCalls, posted, sourceChecks, request };
}

async function allowed(h, area) {
  const response = await h.request(area);
  assert.equal(response.status, 200);
  const body = await response.json();
  if (area === "naming") assert.equal(body.session.title, h.task.title);
  else if (area === "hyper") assert.equal(h.posted.length, 1);
  else if (area === "questions") assert.deepEqual(body.questions, ["Next?"]);
  else assert.equal(body.corrected_html, "Fixture response");
}

for (const area of ["naming", "hyper", "questions", "editor"]) {
  test(`${area}: ungranted internal agent now refused in ENFORCE`, async () => {
    const h = harness();
    const response = await h.request(area);
    if (area === "naming") {
      assert.equal(response.status, 200);
      assert.equal((await response.json()).session.title, "New AI Chat");
    } else assert.equal(response.status, area === "editor" ? 403 : 404);
    assert.equal(h.generateCalls.length, 0);
    assert.equal(h.state.flagReads, 1);
  });

  test(`${area}: same ungranted internal agent allowed in WATCH`, async () => {
    const h = harness({ enforce: false });
    await allowed(h, area);
    assert.equal(h.state.flagReads, 1);
  });

  test(`${area}: Accepted authenticated agent grant allowed in ENFORCE`, async () => {
    const h = harness({ grant: "accepted" });
    await allowed(h, area);
    assert.equal(h.state.flagReads, 1);
  });

  for (const grant of ["invited", "revoked", "wrong-owner", "wrong-board"]) {
    test(`${area}: ${grant} agent is still refused in ENFORCE`, async () => {
      const h = harness({ grant });
      const response = await h.request(area);
      if (area === "naming") assert.equal((await response.json()).session.title, "New AI Chat");
      else assert.equal(response.status, area === "editor" ? 403 : 404);
      assert.equal(h.generateCalls.length, 0);
    });
  }

  for (const actor of ["owner", "member", "guest"]) {
    test(`${area}: human ${actor} still allowed`, async () => {
      const h = harness({ actor });
      await allowed(h, area);
      assert.equal(h.state.flagReads, 0);
    });
    test(`${area}: teamless human ${actor} retains existing eligibility`, async () => {
      const h = harness({ actor, teamless: true });
      if (area === "editor" || area === "hyper") await allowed(h, area);
      else {
        const response = await h.request(area);
        if (area === "naming") assert.equal((await response.json()).session.title, "New AI Chat");
        else assert.equal(response.status, 404);
      }
    });
  }
}

test("naming: names flag Off keeps default title and performs no naming reads", async () => {
  const h = harness({ actor: "owner", names: false });
  const response = await h.request("naming");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).session.title, "New AI Chat");
  assert.deepEqual(h.queries, []);
});

test("naming: project fallback is also scoped to the authenticated actor", async () => {
  for (const enforce of [true, false]) {
    const h = harness({ enforce });
    const response = await h.request("naming", { taskId: undefined, projectId: h.project.id });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).session.title, enforce ? "New AI Chat" : h.project.title);
  }
});

test("hyper: recorded source-comment query independently refuses ungranted ENFORCE access", async () => {
  const h = harness({ bypassTask: true });
  const response = await h.request("hyper");
  assert.equal(response.status, 403);
  assert.equal(h.queries.filter(query => query.model === "comment").length, 1);
  assert.equal(h.generateCalls.length, 0);
});

for (const mutation of [{ creatorId: 99 }, { taskId: 999 }, { agentId: "another-agent" }, { id: 999 }]) {
  test(`hyper: original source predicate ${JSON.stringify(mutation)} is retained`, async () => {
    const h = harness({ actor: "owner" });
    Object.assign(h.older, mutation);
    const response = await h.request("hyper");
    assert.equal(response.status, 403);
    assert.equal(h.generateCalls.length, 0);
  });
}

test("hyper: own source text, author and timestamp still reach immutable-source verification", async () => {
  const h = harness({ actor: "owner" });
  await allowed(h, "hyper");
  assert.deepEqual(h.sourceChecks, [{ commentId: h.older.id, userId: h.user.id, taskId: h.task.id, agentId: null, text: h.older.text, createdAt: h.older.createdAt }]);
});

test("hyper: human OAuth bearer stays allowed even when the cookie session names an agent", async () => {
  const h = harness({ actor: "owner", bearer: true, sessionAgent: true });
  await allowed(h, "hyper");
});

test("hyper: agent and management bearer stay 401 in both scope modes", async () => {
  for (const enforce of [true, false]) {
    const agent = harness({ bearer: true, enforce, grant: "accepted" });
    assert.equal((await agent.request("hyper")).status, 401);
    assert.equal(agent.queries.length, 0);
    const management = harness({ actor: "owner", bearer: true, enforce });
    management.state.ctx.management = true;
    assert.equal((await management.request("hyper")).status, 401);
    assert.equal(management.queries.length, 0);
  }
});

for (const recentViewer of [false, true]) {
  test(`questions: recorded ${recentViewer ? "newer count" : "older viewer comments"} independently scoped in ENFORCE and WATCH`, async () => {
    for (const enforce of [true, false]) {
      const h = harness({ bypassTask: true, recentViewer, enforce });
      await allowed(h, "questions");
      const prompt = h.generateCalls[0].prompt;
      assert.ok(prompt.includes(recentViewer || !enforce ? "Last comment: Older viewer source" : "Last comment: none"));
      assert.ok(prompt.includes(`Comments newer than the viewer's last comment: ${enforce ? 0 : 1}`));
      const query = h.queries.find(query => query.method === (recentViewer ? "count" : "findMany"));
      assert.ok(query);
      assert.equal(matches(recentViewer ? h.newer : h.older, query.where), !enforce);
    }
  });
}

test("questions: older/newer query restrictions and ordering remain conjunctive", async () => {
  const h = harness({ actor: "member" });
  await allowed(h, "questions");
  const olderQuery = h.queries.find(query => query.method === "findMany");
  const countQuery = h.queries.find(query => query.method === "count");
  assert.equal(olderQuery.take, 30);
  assert.deepEqual(olderQuery.orderBy, { createdAt: "desc" });
  assert.equal(matches(h.older, olderQuery.where), true);
  assert.equal(matches(h.newer, olderQuery.where), false);
  assert.equal(matches({ ...h.older, taskId: 999 }, olderQuery.where), false);
  assert.equal(matches(h.newer, countQuery.where), true);
  assert.equal(matches(h.older, countQuery.where), false);
  assert.equal(matches({ ...h.newer, taskId: 999 }, countQuery.where), false);
});


test("hyper: human OAuth bearer without profile or session cookies still allowed", async () => {
  const h = harness({ actor: "owner", bearer: true, authenticated: false, profile: false });
  await allowed(h, "hyper");
});

for (const area of ["naming", "hyper", "questions", "editor"]) {
  test(`${area}: Accepted agent grant cannot widen the original human access predicate`, async () => {
    const h = harness({ grant: "accepted" });
    h.project.ownerId = 99;
    h.project.owner = { id: 99, agents: [] };
    const response = await h.request(area);
    if (area === "naming") assert.equal((await response.json()).session.title, "New AI Chat");
    else assert.equal(response.status, area === "editor" ? 403 : 404);
  });
}

test("hyper: task ID, project ID and deleted restriction still enforced", async () => {
  for (const mutation of [{ id: 999 }, { projectId: 999 }, { deletedAt: new Date() }]) {
    const h = harness({ actor: "owner" });
    Object.assign(h.task, mutation);
    const response = await h.request("hyper", { taskId: 21280, projectId: 2128 });
    assert.equal(response.status, 404);
    assert.equal(h.generateCalls.length, 0);
  }
});

test("HTTP tagged agent cookies remain refused on every N06 route in WATCH and ENFORCE", async () => {
  const { harness: proxyHarness } = require("./helpers/agent-cookie-bridge.cjs");
  for (const enforce of [false, true]) {
    const h = proxyHarness({ enforce });
    for (const route of ["ai-chat/create-session", "ai/hyper-mentioned", "ai/task-questions", "ai/tiptap-forwardslash"]) {
      const response = await h.proxy(h.request(`/api/${route}`, { method: "POST" }));
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "AGENT_COOKIE_ROUTE");
    }
    assert.equal(h.calls.flags, 0);
  }
});
