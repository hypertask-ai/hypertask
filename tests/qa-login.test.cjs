const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const strongQaPassword = "q".repeat(32);

function loadTypescriptModule(relativePath, aliases = {}) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module_ = { exports: {} };
  const localRequire = (specifier) => aliases[specifier] ?? require(specifier);
  new Function("require", "module", "exports", javascript)(
    localRequire,
    module_,
    module_.exports,
  );
  return module_.exports;
}

function loadQaLogin(env = {}) {
  if (env.QA_LOGIN_EMAIL === undefined) delete process.env.QA_LOGIN_EMAIL;
  else process.env.QA_LOGIN_EMAIL = env.QA_LOGIN_EMAIL;
  if (env.QA_LOGIN_PASSWORD === undefined) delete process.env.QA_LOGIN_PASSWORD;
  else process.env.QA_LOGIN_PASSWORD = env.QA_LOGIN_PASSWORD;

  return loadTypescriptModule("src/lib/auth/qaLogin.ts", {
    "@/lib/flags": { FEATURE_FLAG_QA_USER_ID: 985 },
  });
}

test("QA login is off when either secret is missing", () => {
  const missingBoth = loadQaLogin({});
  assert.equal(missingBoth.isQaLoginConfigured(), false);
  assert.equal(missingBoth.getQaLoginConfig(), null);

  const missingPassword = loadQaLogin({ QA_LOGIN_EMAIL: "qa@example.test" });
  assert.equal(missingPassword.isQaLoginConfigured(), false);

  const shortPassword = loadQaLogin({
    QA_LOGIN_EMAIL: "qa@example.test",
    QA_LOGIN_PASSWORD: "correct-horse",
  });
  assert.equal(shortPassword.isQaLoginConfigured(), false);
});

test("QA login accepts only the configured email and password", async () => {
  const {
    getQaLoginConfig,
    qaLoginCredentialsMatch,
    isQaLoginConfigured,
  } = loadQaLogin({
    QA_LOGIN_EMAIL: "  QA@Example.TEST ",
    QA_LOGIN_PASSWORD: strongQaPassword,
  });

  assert.equal(isQaLoginConfigured(), true);
  const config = getQaLoginConfig();
  assert.deepEqual(config, {
    email: "qa@example.test",
    password: strongQaPassword,
  });
  assert.equal(
    await qaLoginCredentialsMatch(
      "qa@example.test",
      strongQaPassword,
      config,
    ),
    true,
  );
  assert.equal(
    await qaLoginCredentialsMatch(
      "other@example.test",
      strongQaPassword,
      config,
    ),
    false,
  );
  assert.equal(
    await qaLoginCredentialsMatch("qa@example.test", "wrong-password", config),
    false,
  );
});

test("QA login rate limit refuses a burst after the IP or email budget", () => {
  const {
    decideQaLoginAttempt,
    QA_LOGIN_EMAIL_ATTEMPT_LIMIT,
    QA_LOGIN_IP_ATTEMPT_LIMIT,
  } = loadTypescriptModule("src/lib/auth/qaLoginRateLimit.ts", {
    "@/lib/redis": { getRedis: async () => ({}) },
    "@/lib/auth/emailCodeRateLimit": { getEmailCodeClientIp: () => "1.1.1.1" },
  });

  assert.equal(decideQaLoginAttempt(1, 1).allowed, true);
  assert.equal(
    decideQaLoginAttempt(QA_LOGIN_EMAIL_ATTEMPT_LIMIT + 1, 1).allowed,
    false,
  );
  assert.equal(
    decideQaLoginAttempt(1, QA_LOGIN_IP_ATTEMPT_LIMIT + 1).allowed,
    false,
  );
});
