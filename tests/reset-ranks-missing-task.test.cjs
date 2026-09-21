const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const stubModule = (relativePath, exports) => {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
};

const response = () => {
  const result = { statusCode: 200, body: undefined };
  return {
    result,
    status(statusCode) {
      result.statusCode = statusCode;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
};

test("resetRanks skips a task deleted concurrently instead of 500ing (HTPR-5310)", async () => {
  const updated = [];
  const prisma = {
    task: {
      findMany: async () => [
        { projectId: 15 },
        { projectId: 15 },
        { projectId: 15 },
      ],
      update: async ({ where, data }) => {
        if (where.id === "missing") {
          const err = new Error("An operation failed because it depends on one or more records that were required but not found.");
          err.code = "P2025";
          throw err;
        }
        updated.push(where.id);
        return { id: where.id, ...data };
      },
    },
  };

  delete require.cache[path.join(root, "src/lib/prisma.ts")];
  delete require.cache[path.join(root, "src/lib/realtime/server.ts")];
  delete require.cache[path.join(root, "src/pages/api/section/resetRanks.ts")];
  stubModule("src/lib/prisma.ts", { default: prisma });
  stubModule("src/lib/realtime/server.ts", { broadcastBoardChange: async () => {} });
  const jiti = require("jiti")(__filename, {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  });
  const handler = jiti(
    path.join(root, "src/pages/api/section/resetRanks.ts"),
  ).default;

  const req = {
    method: "POST",
    body: { taskIds: ["a", "missing", "b"] },
    cookies: { nookies_user: JSON.stringify({ id: 6 }) },
  };
  const res = response();

  await handler(req, res);

  assert.equal(res.result.statusCode, 200);
  assert.deepEqual(updated, ["a", "b"]);
});
