const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

const loadAttachWaitingOnUsers = (prisma) => {
  const source = fs.readFileSync(
    path.join(root, "src/utils/controllers/tasks/attachWaitingOnUsers.ts"),
    "utf8",
  );
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function("module", "exports", "require", javascript)(
    mod,
    mod.exports,
    (request) =>
      request === "@/lib/prisma"
        ? { __esModule: true, default: prisma }
        : require(request),
  );
  return mod.exports.attachWaitingOnUsers;
};

test("task payloads resolve blockers directly without project membership", async () => {
  const calls = [];
  const jacqueline = {
    id: 42,
    displayName: "Jacqueline Bolz",
    photoURL: "https://example.com/jacqueline.jpg",
  };
  const attachWaitingOnUsers = loadAttachWaitingOnUsers({
    user: {
      findMany: async (args) => {
        calls.push(args);
        return [jacqueline];
      },
    },
  });

  const tasks = await attachWaitingOnUsers([
    { id: 1577, waitingOnUserId: 42 },
    { id: 1578, waitingOnUserId: null },
  ]);

  assert.deepEqual(calls, [
    {
      where: { id: { in: [42] } },
      select: { id: true, displayName: true, photoURL: true },
    },
  ]);
  assert.deepEqual(tasks, [
    { id: 1577, waitingOnUserId: 42, waitingOnUser: jacqueline },
    { id: 1578, waitingOnUserId: null, waitingOnUser: null },
  ]);
});

test("task payloads skip the user query when no task is blocked", async () => {
  const attachWaitingOnUsers = loadAttachWaitingOnUsers({
    user: {
      findMany: async () => assert.fail("unexpected user query"),
    },
  });

  assert.deepEqual(await attachWaitingOnUsers([{ id: 1 }]), [
    { id: 1, waitingOnUser: null },
  ]);
});
