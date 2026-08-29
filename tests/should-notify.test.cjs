const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
let jitiEntryId = 0;

// shouldNotify itself must be evicted too: it binds prisma at module scope, so
// a cached copy would keep the previous test's stub.
const stubbedModulePaths = [
  "src/lib/prisma.ts",
  "src/utils/controllers/notifications/shouldNotify.ts",
];

function resetModules() {
  for (const relativePath of stubbedModulePaths) {
    delete require.cache[path.join(root, relativePath)];
  }
}

function stubModule(relativePath, exports) {
  const filename = path.join(root, relativePath);
  require.cache[filename] = {
    id: filename,
    filename,
    loaded: true,
    exports,
  };
}

// cache/requireCache off: each test re-loads shouldNotify against a different
// prisma stub, and a cached module would keep the first stub's binding.
function loadTs(relativePath) {
  const jiti = require("jiti")(
    path.join(root, `tests/jiti-entry-${++jitiEntryId}.cjs`),
    {
      interopDefault: true,
      alias: { "@": path.join(root, "src") },
      cache: false,
    },
  );
  return jiti(path.join(root, relativePath));
}

// Loads shouldNotify with a prisma stub returning the given UserSetting row.
function loadWithSetting(setting) {
  resetModules();
  stubModule("src/lib/prisma.ts", {
    default: {
      userSetting: {
        findUnique: async () => setting,
      },
    },
  });
  return loadTs("src/utils/controllers/notifications/shouldNotify.ts")
    .shouldNotify;
}

const setting = (over = {}) => ({
  notification: true,
  notificationMatrix: {},
  notificationPreference: "all",
  ...over,
});

test("no settings row means no notification", async () => {
  const shouldNotify = loadWithSetting(null);
  assert.equal(await shouldNotify(1, "Mentioned", "email"), false);
});

test("master toggle kills email but leaves push alone", async () => {
  const shouldNotify = loadWithSetting(setting({ notification: false }));
  assert.equal(await shouldNotify(1, "Mentioned", "email"), false);
  assert.equal(await shouldNotify(1, "Mentioned", "push"), true);
});

test("matrix wins over the legacy preference", async () => {
  const shouldNotify = loadWithSetting(
    setting({
      notificationPreference: "nothing",
      notificationMatrix: { moves: { email: true, push: false } },
    }),
  );
  assert.equal(await shouldNotify(1, "TaskMoved", "email"), true);
  assert.equal(await shouldNotify(1, "TaskMoved", "push"), false);
});

test("categories the matrix omits fall back to the legacy preference", async () => {
  const shouldNotify = loadWithSetting(
    setting({
      notificationPreference: "nothing",
      notificationMatrix: { moves: { email: true, push: true } },
    }),
  );
  assert.equal(await shouldNotify(1, "Comment", "email"), false);
});

// The bug that started this work: users on "Only @mentions" were still getting
// an email for every card move.
test("'direct' blocks task-move email, 'all' allows it", async () => {
  const direct = loadWithSetting(setting({ notificationPreference: "direct" }));
  assert.equal(await direct(1, "TaskMoved", "email"), false);

  const all = loadWithSetting(setting({ notificationPreference: "all" }));
  assert.equal(await all(1, "TaskMoved", "email"), true);
});

// "direct" means aimed at you personally: a real @mention or an assignment.
// Being added as a follower is neither, so it must not email.
test("'direct' allows mentions and assignments, not follower adds or comments", async () => {
  const shouldNotify = loadWithSetting(
    setting({ notificationPreference: "direct" }),
  );
  assert.equal(await shouldNotify(1, "Mentioned", "email"), true);
  assert.equal(await shouldNotify(1, "Assigned", "email"), true);
  assert.equal(await shouldNotify(1, "AddedToFollowerInTask", "email"), false);
  assert.equal(await shouldNotify(1, "Comment", "email"), false);
});

test("'nothing' blocks everything, mentions included", async () => {
  const shouldNotify = loadWithSetting(
    setting({ notificationPreference: "nothing" }),
  );
  assert.equal(await shouldNotify(1, "Mentioned", "email"), false);
  assert.equal(await shouldNotify(1, "Mentioned", "push"), false);
});

test("a malformed matrix entry is ignored rather than thrown on", async () => {
  const shouldNotify = loadWithSetting(
    setting({
      notificationPreference: "all",
      notificationMatrix: { moves: "yes please" },
    }),
  );
  assert.equal(await shouldNotify(1, "TaskMoved", "email"), true);
});
