const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

// A push token identifies a browser, so it belongs to exactly one account at a
// time. Registration used to create a second row instead of taking the token
// from the previous owner, so a browser signed in as one account kept receiving
// another account's notifications, ticket titles included (HTPR-4865).

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(root, "src/pages/api/users/addDevice.ts"),
  "utf8"
);

const javascript = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const TOKEN = "fcm-token-for-this-browser";
const OLD_OWNER = 6;
const NEW_OWNER = 985;

function loadHandler(session) {
  // Stands in for the SubscribedDevices table.
  let rows = [
    { id: "r1", firebaseId: TOKEN, userId: OLD_OWNER },
    { id: "r2", firebaseId: "another-browser", userId: OLD_OWNER },
  ];
  let nextId = 3;

  const matches = (row, where) => {
    if (where.firebaseId !== undefined && row.firebaseId !== where.firebaseId)
      return false;
    if (where.userId !== undefined) {
      if (typeof where.userId === "object" && where.userId.not !== undefined) {
        if (row.userId === where.userId.not) return false;
      } else if (row.userId !== where.userId) return false;
    }
    return true;
  };

  const table = {
    deleteMany: async ({ where }) => {
      const before = rows.length;
      rows = rows.filter((r) => !matches(r, where));
      return { count: before - rows.length };
    },
    findUnique: async ({ where }) => rows.find((r) => matches(r, where)) ?? null,
    findMany: async ({ where }) => rows.filter((r) => matches(r, where)),
    delete: async ({ where }) => {
      rows = rows.filter((r) => r.id !== where.id);
      return {};
    },
    upsert: async ({ where, update, create }) => {
      const existing = rows.find((r) => matches(r, where));
      if (existing) {
        Object.assign(existing, update);
        return existing;
      }
      const row = { id: `r${nextId++}`, ...create };
      rows.push(row);
      return row;
    },
  };

  const db = {
    subscribedDevices: table,
    $transaction: async (fn) => fn({ subscribedDevices: table }),
  };

  const stubs = {
    "@/lib/prisma": { __esModule: true, default: db },
    "@/lib/auth/getSessionUser": { getSessionUser: async () => session },
  };

  const originalLoad = Module._load;
  Module._load = (request, parent, isMain) =>
    stubs[request] ?? originalLoad(request, parent, isMain);
  try {
    const mod = { exports: {} };
    new Function("module", "exports", "require", javascript)(
      mod,
      mod.exports,
      (request) => stubs[request] ?? require(request)
    );
    return { handler: mod.exports.default, rowsFor: () => rows };
  } finally {
    Module._load = originalLoad;
  }
}

function call(handler, { method, body, query }) {
  const req = { method, body: body ?? {}, query: query ?? {}, headers: {} };
  let status = 0;
  const res = {
    status(code) {
      status = code;
      return res;
    },
    json() {
      return res;
    },
  };
  return handler(req, res).then(() => status);
}

test("registering a token takes it away from the account that had it", async () => {
  const { handler, rowsFor } = loadHandler({ userId: NEW_OWNER });
  const status = await call(handler, {
    method: "POST",
    body: { fcmToken: TOKEN },
  });
  assert.equal(status, 200);

  const owners = rowsFor()
    .filter((r) => r.firebaseId === TOKEN)
    .map((r) => r.userId);
  assert.deepEqual(owners, [NEW_OWNER], "a token may only have one owner");
});

test("the previous owner's other browsers are left alone", async () => {
  const { handler, rowsFor } = loadHandler({ userId: NEW_OWNER });
  await call(handler, { method: "POST", body: { fcmToken: TOKEN } });
  assert.ok(
    rowsFor().some(
      (r) => r.firebaseId === "another-browser" && r.userId === OLD_OWNER
    ),
    "only the re-registered token changes hands"
  );
});

test("an anonymous caller cannot register a token", async () => {
  const { handler, rowsFor } = loadHandler(null);
  const status = await call(handler, {
    method: "POST",
    body: { fcmToken: "attacker-browser" },
  });
  assert.equal(status, 401);
  assert.ok(!rowsFor().some((r) => r.firebaseId === "attacker-browser"));
});

test("releasing a token only touches the caller's own row", async () => {
  const { handler, rowsFor } = loadHandler({ userId: NEW_OWNER });
  const status = await call(handler, {
    method: "DELETE",
    query: { fcmToken: TOKEN },
  });
  assert.equal(status, 200);
  assert.ok(
    rowsFor().some((r) => r.firebaseId === TOKEN && r.userId === OLD_OWNER),
    "one account must not be able to unsubscribe another's browser"
  );
});
