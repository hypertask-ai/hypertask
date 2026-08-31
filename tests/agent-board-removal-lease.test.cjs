const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { createJiti } = require("jiti");

const root = path.resolve(__dirname, "..");
const jiti = createJiti(__filename, {
  alias: { "@": path.join(root, "src") },
  interopDefault: true,
});
const prisma = jiti(path.join(root, "src/lib/prisma.ts")).default;
const { removeAgentFromBoard } = jiti(
  path.join(root, "src/utils/controllers/agents/boardMembers.ts"),
);

function fakeDatabase(activeLease) {
  let deletes = 0;
  prisma.project.findFirst = async () => ({ id: 15, ownerId: 6 });
  prisma.member.findFirst = async () => ({
    id: 44,
    agent: { userId: 6 },
  });
  prisma.member.delete = async () => {
    deletes += 1;
  };
  prisma.taskLease.findFirst = async () => activeLease;
  return () => deletes;
}

test("board removal stops while the agent holds a live lease there", async () => {
  const deletes = fakeDatabase({
    task: { ticketNumber: "HTPR-5475", uniqueIndex: 5475 },
  });

  const result = await removeAgentFromBoard(15, "agent-1", 6);

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.match(result.message, /working HTPR-5475/);
  assert.equal(deletes(), 0);
});

test("board removal proceeds without a live lease there", async () => {
  const deletes = fakeDatabase(null);

  assert.deepEqual(await removeAgentFromBoard(15, "agent-1", 6), { ok: true });
  assert.equal(deletes(), 1);
});
