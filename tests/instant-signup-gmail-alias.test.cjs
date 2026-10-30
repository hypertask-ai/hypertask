const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/instant-signup-alias-jiti-${++jitiEntryId}.cjs`),
    { interopDefault: true, alias: { "@": path.join(root, "src") } },
  );
  return jiti(path.join(root, relativePath));
}

process.env.DATABASE_URL = "postgresql://unused:unused@localhost:5432/unused";
process.env.JWT_SECRET = "test-only-secret";
process.env.RESEND_API_KEY = "";

const prismaModule = loadTs("src/lib/prisma.ts");
const prisma = prismaModule.default ?? prismaModule;
const { POST } = loadTs("src/app/api/auth/instant-signup/route.ts");

const STORED = { id: 1, uid: "uid_owner", email: "firstlast@gmail.com", displayName: "Owner" };

const WRITE_OPS = ["create", "createMany", "update", "updateMany", "upsert", "delete", "deleteMany"];
const MODELS = ["user", "userSetting", "profilePicture", "googleAccount", "team", "project"];

function stubDatabase() {
  const writes = [];
  prisma.featureFlag.findUnique = async () => ({ mode: "OFF" });
  for (const model of MODELS) {
    const delegate = prisma[model];
    if (!delegate) continue;
    for (const op of WRITE_OPS) {
      delegate[op] = async () => {
        writes.push(`${model}.${op}`);
        return {};
      };
    }
  }
  prisma.$transaction = async () => {
    writes.push("$transaction");
    return [];
  };
  prisma.user.findFirst = async ({ where }) => (where?.email === STORED.email ? STORED : null);
  prisma.user.findMany = async () => [STORED];
  prisma.user.findUnique = async () => STORED;
  return writes;
}

let ip = 0;
function request(email) {
  const headers = new Headers({ "x-forwarded-for": `10.0.0.${++ip}` });
  return {
    json: async () => ({ email }),
    headers,
    cookies: { get: () => undefined },
  };
}

for (const alias of [
  "firstlast@gmail.com",
  "first.last@gmail.com",
  "firstlast+x@gmail.com",
  "First.Last+x@GoogleMail.com",
]) {
  test(`an existing Gmail account is never mutated via "${alias}"`, async () => {
    const writes = stubDatabase();
    const res = await POST(request(alias));
    const body = await res.json();
    assert.equal(body.success, true, JSON.stringify(body));
    assert.deepEqual(writes, [], `instant-signup wrote to the database for ${alias}`);
  });
}
