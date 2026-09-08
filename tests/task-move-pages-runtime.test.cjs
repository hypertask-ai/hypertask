// A Pages Router task move must stay loadable in the plain Node runtime.
// Importing Next's `server-only` marker anywhere in this dependency graph
// crashes the route before it can handle a request.
const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function setSafeImportEnvironment() {
  process.env.DATABASE_URL =
    "postgresql://unused:unused@localhost:5432/unused";
  process.env.SESSION_SECRET = "task-move-pages-runtime-test-secret";

  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  process.env.FIREBASE_SERVICE_ACCOUNT_B64 = Buffer.from(
    JSON.stringify({
      project_id: "test-project",
      client_email: "test@example.invalid",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    }),
  ).toString("base64");
}

test("the legacy task-move route loads in its Node server runtime", () => {
  setSafeImportEnvironment();

  const jiti = require("jiti")(
    path.join(root, "tests/task-move-pages-runtime-jiti-entry.cjs"),
    { interopDefault: true, alias: { "@": path.join(root, "src") } },
  );
  const route = jiti(path.join(root, "src/pages/api/tasks/moveTask.ts"));

  assert.equal(typeof route.default, "function");
});
