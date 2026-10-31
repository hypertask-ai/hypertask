const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
}

const calls = [];
stubModule("src/lib/prisma.ts", {
  default: {
    user: {
      findUnique: async (args) => {
        calls.push(args);
        return { id: 6 };
      },
    },
  },
});

const jiti = require("jiti")(path.join(root, "tests/user-get-by-id-select.test.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
  cache: false,
});
const loaded = jiti(path.join(root, "src/utils/controllers/users/getById.ts"));
const getUserById = loaded.default ?? loaded;

test("the cookie-feeding user response keeps the fields cookie readers use", async () => {
  calls.length = 0;
  const response = await getUserById(6);
  assert.equal(response.status, 200);

  const { select } = calls[0];
  for (const field of [
    "id",
    "uid",
    "email",
    "displayName",
    "photoURL",
    "joinedAt",
    "accountId",
    "UserSettingId",
    "stripe_customer_id",
    "UserSetting",
  ]) {
    assert.equal(select[field], true, `${field} must stay in the response`);
  }
  assert.equal(select.mcpTokensRevokedAt, undefined);
});

test("trial-plan-confirmation still reads stripe_customer_id from the cookie user", () => {
  const page = fs.readFileSync(
    path.join(root, "src/app/trial-plan-confirmation/page.tsx"),
    "utf8",
  );
  assert.match(page, /User\??\.stripe_customer_id/);
});
