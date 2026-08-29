// HTPR-4156: Gmail ignores dots and +suffixes, so valentinyeo@gmail.com and
// valentin.yeo+work@gmail.com are one inbox. Comparing raw strings meant a user
// who typed their own address a different way got the magic link (same inbox),
// clicked it, and landed in a brand new empty account instead of their own.
//
// Normalisation is for LOOKUP only. What the user typed is still what we store,
// mail and display.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/gmail-dots-jiti-${++jitiEntryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") } },
  );
  return jiti(path.join(root, relativePath));
}

process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";

const { canonicalizeEmail, isGmailAddress, findUserByEmail } = loadTs(
  "src/utils/controllers/users/findUserByEmail.ts",
);
const prismaModule = loadTs("src/lib/prisma.ts");
const prisma = prismaModule.default ?? prismaModule;

test("gmail dot and +suffix variants collapse to one inbox", () => {
  const same = [
    "valentinyeo@gmail.com",
    "valentin.yeo@gmail.com",
    "v.a.l.e.n.t.i.n.y.e.o@gmail.com",
    "valentinyeo+hypertask@gmail.com",
    "Valentin.Yeo+work@GoogleMail.com",
    "  valentin.yeo@gmail.com  ",
  ];
  const canonical = same.map(canonicalizeEmail);
  assert.deepEqual(
    [...new Set(canonical)],
    ["valentinyeo@gmail.com"],
    `expected one inbox, got ${JSON.stringify(canonical)}`,
  );
});

test("non-gmail addresses are left alone", () => {
  // Dots are significant almost everywhere else. Stripping them would merge two
  // genuinely different people, which is far worse than the bug being fixed.
  assert.equal(canonicalizeEmail("first.last@hypertask.ai"), "first.last@hypertask.ai");
  assert.equal(canonicalizeEmail("a.b+tag@outlook.com"), "a.b+tag@outlook.com");
  assert.equal(isGmailAddress("first.last@hypertask.ai"), false);
  assert.equal(isGmailAddress("x@googlemail.com"), true);
});

test("an exact match always wins over a dot-variant", async () => {
  // A duplicate created before this fix must still sign in to itself rather than
  // being silently merged into the other account.
  const exact = { id: 2, email: "valentin.yeo@gmail.com" };
  const variant = { id: 1, email: "valentinyeo@gmail.com" };
  prisma.user.findFirst = async ({ where }) =>
    where.email === exact.email ? exact : null;
  prisma.user.findMany = async () => [variant, exact];

  const found = await findUserByEmail("valentin.yeo@gmail.com");
  assert.equal(found.id, 2);
});

test("a dot-variant signs in to the existing account instead of creating one", async () => {
  const existing = { id: 1, email: "valentin.yeo@gmail.com" };
  prisma.user.findFirst = async () => null; // no exact row for the typed form
  prisma.user.findMany = async () => [existing];

  const found = await findUserByEmail("valentinyeo@gmail.com");
  assert.equal(found?.id, 1, "the dot-free form must resolve to the same account");
});

test("an unrelated gmail user is never matched", async () => {
  prisma.user.findFirst = async () => null;
  prisma.user.findMany = async () => [{ id: 9, email: "someone.else@gmail.com" }];

  const found = await findUserByEmail("valentinyeo@gmail.com");
  assert.equal(found, null, "different inbox must not be treated as the same account");
});

test("a brand new non-gmail address does not trigger the fallback scan", async () => {
  let scanned = false;
  prisma.user.findFirst = async () => null;
  prisma.user.findMany = async () => {
    scanned = true;
    return [];
  };

  const found = await findUserByEmail("new.person@hypertask.ai");
  assert.equal(found, null);
  assert.equal(scanned, false, "the scan must only run for Gmail addresses that missed");
});
