const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
let signedIn = null;
const joins = [];

function stub(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

stub("src/lib/auth/getSessionUser.ts", { getSessionUser: async () => signedIn });
stub("src/utils/controllers/members/share.ts", { default: async (userId, shareId) => {
  joins.push({ userId, shareId });
  return { status: 200, json: { allowShare: true } };
} });

const jiti = createJiti(__filename, { interopDefault: true, alias: { "@": path.join(root, "src") } });
const handler = jiti(path.join(root, "src/pages/api/members/share.ts")).default;

function call(body) {
  return new Promise((resolve) => {
    const res = { status(code) { return { json: (json) => resolve({ code, json }) }; } };
    handler({ method: "POST", headers: {}, body }, res);
  });
}

test("HTPR-7178: share join without a login is refused and adds nobody", async () => {
  signedIn = null;
  joins.length = 0;
  assert.equal((await call({ userId: 234, shareId: "share-1" })).code, 401);
  assert.equal(joins.length, 0);
});

test("HTPR-7178: share join adds the signed-in user, ignoring a userId in the body", async () => {
  signedIn = { userId: 985 };
  joins.length = 0;
  assert.equal((await call({ userId: 234, shareId: "share-1" })).code, 200);
  assert.deepEqual(joins, [{ userId: 985, shareId: "share-1" }]);
  assert.equal((await call({ userId: 234 })).code, 400);
  assert.equal(joins.length, 1);
});
