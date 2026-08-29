// HTPR-4162: removeMember returned HTTP 400 even when it had done the work.
//
// The board-member delete was written as `where: { id: member?.id }`. When no
// non-agent member row existed (already removed, or the user was on the board
// only through agents), that is `id: undefined`, which Prisma rejects. The throw
// landed in the catch, which returns 400 — after the loop above had already
// deleted the user's agent rows. Callers saw a failure and a half-applied change.
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

// Minimal stand-ins: the point is the control flow, not the database.
// project.findFirst is what isProjectAdmin uses, so returning a row there makes
// the caller an admin without stubbing the module itself.
function stubPrisma({ member }) {
  const deleted = [];
  prisma.project.findFirst = async () => ({ id: 3 });
  prisma.user.findUnique = async () => ({ id: 2 });
  prisma.project.findUnique = async () => ({ id: 3, ownerId: 99, teamId: null });
  prisma.member.findFirst = async () => member;
  prisma.member.findMany = async () => [];
  prisma.member.delete = async ({ where }) => {
    // Mirror Prisma's real behaviour: an undefined id is a validation error.
    if (where.id === undefined) {
      throw new Error("Argument `id` is missing.");
    }
    deleted.push(where.id);
    return { id: where.id };
  };
  return deleted;
}

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
