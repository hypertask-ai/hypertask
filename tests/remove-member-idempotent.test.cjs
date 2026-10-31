const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/remove-member-jiti-${++jitiEntryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") } },
  );
  return jiti(path.join(root, relativePath));
}

process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";

const prismaModule = loadTs("src/lib/prisma.ts");
const prisma = prismaModule.default ?? prismaModule;
const removeMemberModule = loadTs("src/utils/controllers/projects/removeMember.ts");
const membersRemove = removeMemberModule.default ?? removeMemberModule;

function stubPrisma({ member, admin = true }) {
  const deleted = [];
  prisma.project.findFirst = async () => (admin ? { id: 3 } : null);
  prisma.user.findUnique = async () => ({ id: 2 });
  prisma.project.findUnique = async () => ({ id: 3, ownerId: 99, teamId: null });
  prisma.member.findFirst = async () => member;
  prisma.member.findMany = async () => [];
  prisma.member.delete = async ({ where }) => {
    if (where.id === undefined) {
      throw new Error("Argument `id` is missing.");
    }
    deleted.push(where.id);
    return { id: where.id };
  };
  return deleted;
}

test("a non-admin cannot remove a project member", async () => {
  const deleted = stubPrisma({ member: { id: 42, userId: 2 }, admin: false });
  const res = await membersRemove(2, 3, 1);

  assert.equal(res.status, 401);
  assert.deepEqual(deleted, []);
});

test("removing a member that is present succeeds and deletes the row", async () => {
  const deleted = stubPrisma({ member: { id: 42, userId: 2 } });
  const res = await membersRemove(2, 3, 1);

  assert.equal(res.status, 200);
  assert.deepEqual(deleted, [42]);
});

test("removing a member that is already gone succeeds instead of 400ing", async () => {
  const deleted = stubPrisma({ member: null });
  const res = await membersRemove(2, 3, 1);

  assert.equal(
    res.status,
    200,
    "no member row means the caller already has the end state they asked for",
  );
  assert.deepEqual(deleted, [], "nothing to delete");
});
