const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

function blockingTaskChildren() {
  const schema = fs.readFileSync(path.join(root, "src/prisma/schema.prisma"), "utf8");
  const models = [];
  for (const match of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const [, name, body] = match;
    if (name === "Task") continue;
    const blocks = body
      .split("\n")
      .some((line) => /^\s+\w+\s+Task\??\s+@relation\(/.test(line) && !/onDelete/.test(line));
    if (blocks) models.push(name[0].toLowerCase() + name.slice(1));
  }
  return models;
}

function loadCleanup(calls) {
  const guest = { uid: "guest_test" };
  const model = (name) =>
    new Proxy(
      {},
      {
        get: (_target, method) => async (args) => {
          calls.push(`${name}.${String(method)}`);
          if (name === "user" && method === "findUnique") return guest;
          if (name === "user" && method === "findMany") return [];
          if (name === "project" && method === "findUnique") return { owner: guest };
          if (name === "project" && method === "findMany") return [{ id: 7 }];
          if (name === "task" && method === "findMany") return [{ id: 70 }, { id: 71 }];
          if (method === "findMany") return [];
          return args;
        },
      },
    );
  const prisma = new Proxy({}, { get: (_target, name) => model(String(name)) });
  delete require.cache[path.join(root, "src/lib/demo/cleanupGuest.ts")];
  stubModule("src/lib/prisma.ts", { __esModule: true, default: prisma });
  stubModule("src/lib/googleCalendar/connection.ts", {
    googleCalendarDisconnectData: () => ({}),
  });
  const jiti = require("jiti")(path.join(root, "tests/jiti-cleanup-guest-children.cjs"), {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
    cache: false,
  });
  return jiti(path.join(root, "src/lib/demo/cleanupGuest.ts"));
}

test("schema still has the tables this sweep must clear", () => {
  const children = blockingTaskChildren();
  for (const name of ["drafts", "task_Summary"]) {
    assert.ok(children.includes(name), `${name} should block task deletes`);
  }
});

test("every blocking task child is deleted before tasks, on both paths", async () => {
  const calls = [];
  const cleanup = loadCleanup(calls);
  await cleanup.deleteGuestCascade(1);

  const taskDeletes = calls.flatMap((call, index) => (call === "task.deleteMany" ? [index] : []));
  assert.equal(taskDeletes.length, 2, "board path and user path both delete tasks");

  let start = 0;
  for (const taskDelete of taskDeletes) {
    const before = calls.slice(start, taskDelete);
    for (const child of blockingTaskChildren()) {
      assert.ok(before.includes(`${child}.deleteMany`), `${child} rows must go before task.deleteMany`);
    }
    const readStatus = before.indexOf("readStatus.deleteMany");
    const notification = before.indexOf("notification.deleteMany");
    assert.ok(readStatus < notification, "readStatus before notification");
    start = taskDelete + 1;
  }
});
