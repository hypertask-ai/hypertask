// HTPR-7175: the manual reminder route must not let a stranger fire someone
// else's reminder, with or without a login.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let session = null;
let lookups = [];
let invoked = [];
const rows = [{ id: 11, userId: 6, taskId: 100, projectId: 15, status: "Normal" }];

function stub(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stub("src/lib/prisma.ts", {
  default: {
    reminder: {
      findFirst: async ({ where }) => {
        lookups.push(where);
        return rows.find((r) => r.id === where.id && r.userId === where.userId && r.status === where.status) ?? null;
      },
    },
  },
});
stub("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => session });
stub("src/utils/controllers/reminders/invokeReminder.ts", {
  default: async (reminder) => { invoked.push(reminder); return "invoked"; },
});

const loaded = createJiti(path.join(root, "tests/htpr-7175.cjs"), {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
})(path.join(root, "src/pages/api/reminders/invokeReminder.ts"));
const handler = loaded.default ?? loaded;

async function call(body, method = "POST") {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ method, headers: {}, body }, res);
  return res;
}

test.beforeEach(() => { session = null; lookups = []; invoked = []; });

test("a caller with no login cannot fire a reminder", async () => {
  const res = await call({ reminder: { id: 11, userId: 6, taskId: 100, projectId: 15 } });
  assert.equal(res.statusCode, 401);
  assert.equal(invoked.length, 0);
  assert.equal(lookups.length, 0);
});

test("a logged-in stranger cannot fire someone else's reminder by sending its ids", async () => {
  session = { userId: 99 };
  const res = await call({ reminder: { id: 11, userId: 6, taskId: 100, projectId: 15 } });
  assert.equal(res.statusCode, 404);
  assert.equal(invoked.length, 0);
  assert.deepEqual(lookups[0], { id: 11, userId: 99, status: "Normal" });
});

test("the owner fires their own reminder using the stored row, not the submitted fields", async () => {
  session = { userId: 6 };
  const res = await call({ reminder: { id: 11, userId: 6, taskId: 999, projectId: 1 } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(invoked, [rows[0]]);
});

test("a missing id or a non-POST request is refused", async () => {
  session = { userId: 6 };
  assert.equal((await call({})).statusCode, 400);
  assert.equal((await call({ reminder: { id: 11 } }, "GET")).statusCode, 405);
  assert.equal(invoked.length, 0);
});
