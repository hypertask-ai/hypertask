const assert = require("node:assert/strict");
const test = require("node:test");
const { load } = require("./task-route-loader.cjs");
const { fixture, pages, relationFields } = require("./legacy-task-relations-fixture.cjs");
const contract = require("./legacy-task-relations-contract.json");

for (const [name, options] of [
  ["flag OFF ignores opt-in", { compat: "htpr-6924" }],
  ["flag ON without opt-in", { enabled: true }],
  ["flag ON with wrong opt-in", { enabled: true, compat: "other" }],
  ["flag ON with duplicate opt-in", { enabled: true, compat: ["htpr-6924", "htpr-6924"] }],
  ["failed flag lookup", { enabled: true, compat: "htpr-6924", failFlag: true }],
]) {
  test(`${name} retains frozen task-list bytes, headers and Prisma selection`, async () => {
    const f = fixture(options);
    const response = await f.invoke({ projectId: 15, userId: 999, contract: "compact", compact: true });
    assert.equal(response.status, contract.status);
    assert.equal(response.text, contract.text);
    assert.deepEqual(response.headers, {});
    assert.deepEqual(f.calls.queries, [contract.args]);
    assert.deepEqual(f.calls.flags, options.compat === "htpr-6924" ? [["htpr-6924-rest-compat", 7]] : []);
  });
}

test("two-argument controller and explicit legacy argument keep the original full rows", async () => {
  for (const args of [[15, 7], [15, 7, "legacy"]]) {
    const f = fixture();
    assert.equal(JSON.stringify((await f.controller(...args)).json), contract.text);
    assert.deepEqual(f.calls.queries, [contract.args]);
  }
});

for (const access of ["owner", "member", "denied"]) {
  for (const compact of [false, true]) {
    test(`${access} board scope is unchanged in ${compact ? "compact" : "legacy"} mode`, async () => {
      const f = fixture({ access, enabled: compact, compat: "htpr-6924" });
      const result = await f.invoke();
      assert.equal(result.status, 200);
      assert.equal(result.body.length, access === "denied" ? 0 : 2);
      assert.deepEqual(f.calls.queries[0].where, contract.args.where);
      assert.deepEqual(f.calls.queries[0].select.assignees, contract.args.select.assignees);
      assert.deepEqual(f.calls.queries[0].select.comments, contract.args.select.comments);
    });
  }
}

test("flag ON plus explicit opt-in returns only the complete compact relation fields", async () => {
  const f = fixture({ enabled: true, compat: "htpr-6924" });
  const result = await f.invoke({ projectId: 15, userId: 999, contract: "legacy" });
  assert.equal(result.status, 200);
  assert.deepEqual(result.headers, {});
  assert.deepEqual(f.calls.flags, [["htpr-6924-rest-compat", 7]]);
  const legacy = JSON.parse(contract.text);
  for (const [index, item] of result.body.entries()) {
    const { subTasks, parentTask, ...top } = item;
    const { subTasks: ignoredChildren, parentTask: ignoredParent, ...oldTop } = legacy[index];
    assert.equal(JSON.stringify(top), JSON.stringify(oldTop));
    for (const child of subTasks) assert.deepEqual(Object.keys(child), [...relationFields, "createdAt"]);
    if (parentTask) {
      assert.deepEqual(Object.keys(parentTask), [...relationFields, "subTasks"]);
      for (const sibling of parentTask.subTasks) assert.deepEqual(Object.keys(sibling), relationFields);
    }
  }
  assert.deepEqual(result.body[0].subTasks.map(({ id, status }) => [id, status]), [[52, "Normal"], [53, "Archive"]]);
  assert.deepEqual(result.body[0].parentTask.subTasks.map(({ id }) => id), [55, 50, 51]);
  assert.equal(result.body[1].parentTask, null);
  assert.deepEqual(result.body[1].subTasks, []);
});

for (const enabled of [false, true]) {
  test(`legacy missing-body, malformed-ID, failure and method contracts survive flag ${enabled}`, async () => {
    const options = { enabled, compat: "htpr-6924" };
    assert.equal((await fixture(options).invoke({})).text, '"Missing Required Data"');
    for (const projectId of ["bad", "0", "-1", "1.5", [15]]) {
      const f = fixture(options);
      const response = await f.invoke({ projectId });
      assert.equal(response.status, 200);
      assert.equal(response.text, "[]");
      assert.equal(f.calls.queries.length, 0);
    }
    const failure = await fixture({ ...options, failQuery: true }).invoke();
    assert.equal(failure.status, 200);
    assert.equal(failure.text, "[]");
    const method = fixture(options);
    assert.equal((await method.invoke({}, "GET")).text, '{"message":"Method not allowed"}');
    assert.equal((await method.invoke({}, "GET")).status, 405);
    assert.deepEqual(method.calls, { queries: [], flags: [], auth: [] });
    const unauthorized = fixture({ ...options, userId: null });
    const response = await unauthorized.invoke({ projectId: 15, userId: 7, contract: "compact" });
    assert.equal(response.status, 401);
    assert.equal(response.text, '{"message":"Unauthorized"}');
    assert.deepEqual(unauthorized.calls.flags, []);
    assert.deepEqual(unauthorized.calls.queries, []);
  });
}


test("real signed-session resolver rejects forged/expired opt-in and ignores body/profile identity", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "isolated-task-relations-test-secret";
  try {
    const { signSession } = load("src/lib/auth/session.ts", {});
    for (const [token, authorized] of [[undefined, false], ["forged", false], [signSession({ id: 7 }, -1), false], [signSession({ id: 7 }), true]]) {
      const f = fixture({ enabled: true });
      const { ["@/lib/auth/currentUser"]: ignoredAuth, ...mocks } = f.mocks;
      const handler = load("src/pages/api/tasks/getAll.ts", {
        ...mocks,
        "@/lib/auth/betterAuth": { auth: { api: { getSession: async () => null } } },
        "next/headers": { cookies: async () => ({ get: () => ({ value: JSON.stringify({ id: 999 }) }) }) },
      }).default;
      const result = await pages(handler, {
        method: "POST", body: { projectId: 15, userId: 999, contract: "compact" }, query: { compat: "htpr-6924", userId: "6" },
        headers: token ? { cookie: `ht_session=${token}` } : {},
      });
      assert.equal(result.status, authorized ? 200 : 401);
      assert.deepEqual(f.calls.flags, authorized ? [["htpr-6924-rest-compat", 7]] : []);
      assert.equal(f.calls.queries.length, authorized ? 1 : 0);
      if (authorized) assert.deepEqual(Object.keys(result.body[0].subTasks[0]), [...relationFields, "createdAt"]);
      else assert.equal(result.text, '{"message":"Unauthorized"}');
    }
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});
