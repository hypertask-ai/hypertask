const assert = require("node:assert/strict");
const test = require("node:test");
const { fixture, matches, hydrate } = require("./helpers/agent-board-scope.cjs");

function harness(area, { actor = "agent", enforce = true, teamless = false, grant = "none", bypassTaskGate = false, authenticated = true } = {}) {
  const f = fixture();
  f.state.enforce = enforce;
  const project = f.projects[2];
  const task = f.tasks[2];
  project.teamId = teamless ? null : "team";
  if (actor !== "agent") f.state.ctx.agentId = null;
  if (["member", "guest", "outsider"].includes(actor)) f.state.ctx.user = { id: 7, isGuest: actor === "guest" };
  if (["member", "guest"].includes(actor)) project.members.push({ userId: 7, agentId: null, status: "Accepted", role: actor === "guest" ? "Guest" : "Member" });
  if (grant !== "none") {
    project.members.push({ userId: 6, agentId: f.agent.id, status: grant === "invited" ? "Invited" : "Accepted", agent: f.agent });
    if (grant === "revoked") f.agent.revokedAt = new Date();
    if (grant === "wrong-owner") f.agent.userId = 9;
    if (grant === "wrong-agent") project.members[0].agentId = "another-agent";
  }
  const comment = { id: 123, taskId: task.id, task, creatorId: f.state.ctx.user.id, text: "Comment", seen: [6] };
  const comments = [comment];
  const queries = { task: [], comment: [], reaction: [] };
  const writes = [], saves = [], broadcasts = [];
  const findTask = f.prisma.task.findFirst;
  f.prisma.task.findFirst = async args => {
    queries.task.push(args);
    return bypassTaskGate ? hydrate(task, args) : findTask(args);
  };
  f.prisma.comment = { findFirst: async args => {
    queries.comment.push(args);
    return hydrate(comments.find(row => matches(row, args.where)), args);
  } };
  const reactions = [];
  f.prisma.reaction = {
    findMany: async args => { queries.reaction.push(args); return reactions.filter(row => matches(row, args.where)); },
    create: async ({ data }) => {
      const row = { id: "reaction", agentId: null, ...data, user: f.user, comment, task };
      reactions.push(row);
      writes.push({ operation: "reaction-create", data });
      return row;
    },
    deleteMany: async ({ where }) => {
      const selected = reactions.filter(row => matches(row, where));
      selected.forEach(row => reactions.splice(reactions.indexOf(row), 1));
      writes.push({ operation: "reaction-delete", where });
      return { count: selected.length };
    },
  };
  f.prisma.savedContent = {
    findFirst: async ({ where }) => saves.find(row => matches(row, where)) ?? null,
    create: async args => {
      const row = { id: `saved-${saves.length}`, ...args.data };
      saves.push(row);
      writes.push({ operation: "save-create", ...args });
      return row;
    },
    deleteMany: async ({ where }) => {
      const selected = saves.filter(row => matches(row, where));
      selected.forEach(row => saves.splice(saves.indexOf(row), 1));
      writes.push({ operation: "save-delete", where });
      return { count: selected.length };
    },
  };
  const file = area === "reaction" ? "src/pages/api/comments/addReaction.ts" : "src/pages/api/savedContent/toggleSaved.ts";
  const route = f.load(file, {
    "@/lib/auth/getSessionUser": { getSessionUser: async () => {
      if (!authenticated) return null;
      await f.scope.prepareAgentScope(f.state.ctx.user.id, f.state.ctx.agentId);
      return { userId: f.state.ctx.user.id, agentId: f.state.ctx.agentId };
    } },
    "@/utils/controllers/FCM": { sendDataNewCommentFCM: async () => {} },
    "@/utils/controllers/notifications/creation-service/check-reminder_create-notification": { default: async () => null },
    "@/lib/agentWebhooks/commentReaction": { prepareCommentReactionWebhook: async () => null, persistCommentReactionWebhook: async () => [] },
    "@/lib/agentWebhooks/outbox": { publishAgentWebhookDeliveries: async () => {} },
    "@/lib/realtime/server": { broadcastTaskComment: async (...args) => { broadcasts.push(args); } },
    "@/utils/controllers/savedContent/helper": { includeSavedContentComment: () => true },
    "@/lib/taskCardActions/writeLocks": { withTaskStarWriteLock: async (_id, run) => run(f.prisma) },
  }).default;
  async function request(body = {}) {
    const res = { status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
    await route({ method: "POST", url: `/api/${area}`, headers: {}, query: { userId: 999, agentId: "forged-agent" }, body: {
      taskId: task.id, commentId: comment.id, type: "Public", emoji: "👍", unified: "1f44d", userId: f.state.ctx.user.id, agentId: "forged-agent", projectId: 999, ...body,
    } }, res);
    return res;
  }
  return { ...f, project, task, comment, comments, queries, writes, saves, reactions, broadcasts, request };
}

for (const area of ["reaction", "save"]) {
  test(`${area}: ungranted agent now refused in ENFORCE`, async () => {
    const h = harness(area);
    assert.equal((await h.request()).statusCode, 404);
    assert.equal(h.state.flagReads, 1);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.broadcasts, []);
  });

  test(`${area}: same ungranted agent still allowed with flag Off (WATCH)`, async () => {
    const h = harness(area, { enforce: false });
    assert.equal((await h.request()).statusCode, 200);
    assert.equal(h.state.flagReads, 1);
    assert.equal(h.writes.length, 1);
  });

  test(`${area}: Accepted same-owner grant still allowed in ENFORCE`, async () => {
    const h = harness(area, { grant: "accepted" });
    assert.equal((await h.request()).statusCode, 200);
    assert.equal(h.state.flagReads, 1);
  });

  for (const grant of ["invited", "revoked", "wrong-owner", "wrong-agent"]) {
    test(`${area}: ${grant} grant refused in ENFORCE`, async () => {
      const h = harness(area, { grant });
      assert.equal((await h.request()).statusCode, 404);
      assert.deepEqual(h.writes, []);
    });
  }

  test(`${area}: zero board grants refuse ENFORCE and retain WATCH`, async () => {
    for (const enforce of [true, false]) {
      const h = harness(area, { enforce });
      h.projects.forEach(project => { project.members = []; });
      assert.equal((await h.request()).statusCode, enforce ? 404 : 200);
      assert.equal(h.writes.length, enforce ? 0 : 1);
    }
  });

  test(`${area}: grant on a different board does not authorize this board`, async () => {
    const h = harness(area);
    assert.equal(h.projects[0].members[0].status, "Accepted");
    assert.equal((await h.request()).statusCode, 404);
    assert.deepEqual(h.writes, []);
  });

  for (const actor of ["owner", "member", "guest"]) {
    for (const teamless of [false, true]) {
      test(`${area}: human ${actor} still allowed (teamless=${teamless})`, async () => {
        const h = harness(area, { actor, teamless });
        assert.equal((await h.request()).statusCode, 200);
        assert.equal(h.state.flagReads, 0);
        assert.equal(h.writes[0].data.userId, h.state.ctx.user.id);
      });
    }
  }

  test(`${area}: non-member human still refused`, async () => {
    const h = harness(area, { actor: "outsider" });
    assert.equal((await h.request()).statusCode, area === "reaction" ? 403 : 404);
    assert.deepEqual(h.writes, []);
  });

  test(`${area}: missing task, missing comment and mismatched task/comment still refused`, async () => {
    for (const body of [{ taskId: 999 }, { commentId: 999 }]) {
      const h = harness(area, { actor: "owner" });
      assert.equal((await h.request(body)).statusCode, area === "reaction" && body.taskId ? 403 : 404);
      assert.deepEqual(h.writes, []);
    }
    const h = harness(area, { actor: "owner" });
    h.comment.taskId = h.tasks[0].id;
    h.comment.task = h.tasks[0];
    assert.equal((await h.request()).statusCode, 404);
    assert.deepEqual(h.writes, []);
  });

  test(`${area}: recorded comment lookup itself retains id, task association and agent scope`, async () => {
    const h = harness(area, { grant: "accepted" });
    assert.equal((await h.request()).statusCode, 200);
    const query = h.queries.comment[0];
    assert.equal(matches(h.comment, query.where), true);
    assert.equal(matches({ ...h.comment, id: 999 }, query.where), false);
    assert.equal(matches({ ...h.comment, taskId: h.tasks[0].id, task: h.tasks[0] }, query.where), false);
    h.project.members = [];
    assert.equal(matches(h.comment, query.where), false);
  });

  test(`${area}: recorded comment lookup independently refuses an ungranted agent`, async () => {
    const h = harness(area, { bypassTaskGate: true });
    assert.equal((await h.request()).statusCode, 404);
    assert.equal(h.queries.comment.length, 1);
    assert.deepEqual(h.writes, []);
  });

  test(`${area}: agent-only membership never widens the original human predicate`, async () => {
    for (const enforce of [true, false]) {
      const h = harness(area, { grant: "accepted", enforce });
      h.project.ownerId = 99;
      h.project.owner = { id: 99, agents: [] };
      assert.equal((await h.request()).statusCode, area === "reaction" ? 403 : 404);
      assert.deepEqual(h.writes, []);
    }
  });

  test(`${area}: missing session and invalid ids still refused before writes`, async () => {
    const anonymous = harness(area, { authenticated: false });
    assert.equal((await anonymous.request()).statusCode, 401);
    assert.equal(anonymous.queries.task.length, 0);
    const h = harness(area, { actor: "owner" });
    assert.equal((await h.request({ taskId: 0 })).statusCode, 400);
    assert.deepEqual(h.writes, []);
  });
}

test("reaction: valid human body id still works and forged body id is refused", async () => {
  const h = harness("reaction", { actor: "owner" });
  assert.equal((await h.request({ userId: 999 })).statusCode, 403);
  assert.deepEqual(h.writes, []);
  const result = await h.request();
  assert.equal(result.statusCode, 200);
  assert.equal("seen" in result.body.comment, false);
  assert.equal(h.writes[0].data.userId, 6);
  assert.equal((await h.request()).statusCode, 202);
  assert.equal(h.reactions.length, 0);
});

test("save: Public comment save remains shared and uses the task's board", async () => {
  const h = harness("save", { actor: "member" });
  const result = await h.request({ userId: 999, projectId: 999 });
  assert.equal(result.statusCode, 200);
  assert.deepEqual(h.writes[0].data, { userId: 7, taskId: h.task.id, projectId: h.project.id, commentId: h.comment.id, type: "Public" });
  h.saves[0].userId = 99;
  assert.equal((await h.request()).statusCode, 201);
  assert.equal(h.saves.length, 0);
  assert.equal("userId" in h.writes[1].where, false);
});

test("save: Private task star stays personal and toggles without a comment", async () => {
  const h = harness("save", { actor: "owner", teamless: true });
  const body = { type: "Private", commentId: null };
  h.saves.push({ id: "other-user", userId: 99, taskId: h.task.id, type: "Private", commentId: null });
  assert.equal((await h.request(body)).statusCode, 200);
  assert.equal(h.writes[0].data.userId, 6);
  assert.equal((await h.request(body)).statusCode, 201);
  assert.equal(h.saves.length, 1);
  assert.equal(h.saves[0].userId, 99);
  assert.equal(h.writes[1].where.userId, 6);
  assert.equal("projectId" in h.writes[1].where, false);
  assert.equal((await h.request({ ...body, alwaysRemove: true })).statusCode, 201);
  assert.equal(h.writes.length, 2);
});

test("save: Private task star enforces the authenticated agent and retains WATCH", async () => {
  for (const enforce of [true, false]) {
    const h = harness("save", { enforce });
    assert.equal((await h.request({ type: "Private", commentId: null })).statusCode, enforce ? 404 : 200);
    assert.equal(h.writes.length, enforce ? 0 : 1);
  }
});

test("HTTP tagged-agent requests remain refused by the real proxy in WATCH and ENFORCE", async () => {
  const { harness: proxyHarness } = require("./helpers/agent-cookie-bridge.cjs");
  for (const enforce of [false, true]) {
    const h = proxyHarness({ enforce });
    for (const pathname of ["/api/comments/addReaction", "/api/savedContent/toggleSaved"]) {
      const response = await h.proxy(h.request(pathname, { method: "POST" }));
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "AGENT_COOKIE_ROUTE");
      const human = await h.proxy(h.request(pathname, { method: "POST", kind: "human" }));
      assert.equal(human.headers.get("x-middleware-next"), "1");
    }
  }
});
