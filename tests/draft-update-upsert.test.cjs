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

test("concurrent first autosaves use the atomic draft upsert key", async () => {
  const calls = [];
  const prisma = {
    drafts: {
      upsert: async (args) => {
        calls.push(args);
        await new Promise((resolve) => setImmediate(resolve));
        return { id: calls.length, ...args.create };
      },
    },
  };

  delete require.cache[path.join(root, "src/lib/prisma.ts")];
  delete require.cache[path.join(root, "src/pages/api/drafts/updateDraft.ts")];
  stubModule("src/lib/prisma.ts", { default: prisma });
  const jiti = require("jiti")(__filename, {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  });
  const handler = jiti(
    path.join(root, "src/pages/api/drafts/updateDraft.ts"),
  ).default;

  const request = (content) => ({
    method: "POST",
    cookies: { nookies_user: JSON.stringify({ id: 6 }) },
    body: {
      content,
      taskId: 123,
      type: "Description",
      projectId: 15,
    },
  });
  const first = response();
  const second = response();

  await Promise.all([
    handler(request("first"), first),
    handler(request("second"), second),
  ]);

  assert.equal(first.result.statusCode, 200);
  assert.equal(second.result.statusCode, 200);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.where, {
      taskId_type_userId: {
        taskId: 123,
        type: "Description",
        userId: 6,
      },
    });
    assert.equal(call.create.projectId, 15);
    assert.equal(call.update.projectId, 15);
  }
});
