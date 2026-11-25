const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadModule: load } = require("./helpers/loadModule.cjs");

const FLAG_KEY = "htpr-9399-archived-board-tickets";
const ARCHIVED_BOARD = { id: 11514, name: "project-11514", title: "Fleet CI & Infra", status: "Archive" };
const ARCHIVED_MESSAGE = 'Board "Fleet CI & Infra" is archived, so it cannot take new tickets.';

function globalCreate(board, flagEnabled) {
  const writes = [];
  const prisma = {
    user: { findUnique: async () => ({ id: 6, displayName: "Val", photoURL: null, email: "v@example.com" }) },
    project: { findFirst: async () => board },
    task: { create: async (input) => { writes.push(input); return { id: 77 }; } },
  };
  const { POST } = load("src/lib/api/task-writes/create-global.ts", {
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/flags": { isFeatureEnabled: async (key) => flagEnabled && key === FLAG_KEY },
  });
  const call = () => POST({
    headers: new Headers(),
    cookies: {},
    json: async () => ({ projectId: board.id, title: "A ticket", description: "A note" }),
  }, { userId: 6 });
  return { call, writes };
}

test("creating a ticket through the app on an archived board is refused by name when the flag is on", async () => {
  const { call, writes } = globalCreate(ARCHIVED_BOARD, true);
  const response = await call();
  assert.equal(response.status, 400);
  assert.equal((await response.json()).message, ARCHIVED_MESSAGE);
  assert.equal(writes.length, 0);
});

test("creating a ticket through the app on an archived board stays forbidden when the flag is off", async () => {
  const { call, writes } = globalCreate(ARCHIVED_BOARD, false);
  const response = await call();
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { message: "Forbidden" });
  assert.equal(writes.length, 0);
});
