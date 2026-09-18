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

test("QA login hashes the password with async scrypt, not SHA-256", () => {
  const source = fs.readFileSync(
    path.join(root, "src/lib/auth/qaLogin.ts"),
    "utf8",
  );
  assert.match(source, /scryptAsync/);
  assert.match(source, /promisify\(scrypt\)/);
  assert.match(source, /timingSafeEqual/);
  assert.doesNotMatch(source, /scryptSync/);
  assert.doesNotMatch(source, /createHash/);
  assert.doesNotMatch(source, /sha256/);
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

test("the QA login page and route stay hidden without the secrets", () => {
  const page = fs.readFileSync(
    path.join(root, "src/app/qa/login/page.tsx"),
    "utf8",
  );
  const route = fs.readFileSync(
    path.join(root, "src/app/api/auth/qa-login/route.ts"),
    "utf8",
  );
  const form = fs.readFileSync(
    path.join(root, "src/app/qa/login/QaLoginForm.tsx"),
    "utf8",
  );
  const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  const qaLogin = fs.readFileSync(
    path.join(root, "src/lib/auth/qaLogin.ts"),
    "utf8",
  );

  assert.match(page, /isQaLoginConfigured/);
  assert.match(page, /const flagged = await isFeatureEnabled/);
  assert.match(page, /HTPR_6536_QA_LOGIN_FLAG/);
  assert.match(page, /notFound\(\)/);
  assert.match(page, /shouldShowMobileTabBar\("\/qa\/login"\)/);
  assert.match(page, /bg-pageBackground/);
  assert.match(page, /text-heading/);
  assert.doesNotMatch(page, /flagged = true/);
  assert.match(route, /if \(!isQaLoginConfigured\(\)\)/);
  assert.match(route, /const flagged = await isFeatureEnabled/);
  assert.match(route, /status: 404/);
  assert.match(route, /await qaLoginCredentialsMatch/);
  assert.match(route, /QA_LOGIN_USER_ID/);
  assert.match(route, /onboardingTourStatus: true/);
  assert.match(route, /console\.info\("\[qa-login\]"/);
  assert.doesNotMatch(route, /password:/);
  assert.doesNotMatch(route, /return true;/);
  assert.match(form, /htmlFor="email"/);
  assert.match(form, /htmlFor="password"/);
  assert.match(form, /type="password"/);
  assert.match(form, /Sign in/);
  assert.match(form, /rounded-sm/);
  assert.match(form, /px-4/);
  assert.doesNotMatch(form, /px-5/);
  assert.match(form, /bg-shadcn-primary/);
  assert.match(form, /text-destructive/);
  assert.match(form, /\/api\/auth\/qa-login/);
  assert.doesNotMatch(form, /rounded-full/);
  assert.doesNotMatch(form, /#4c5362/);
  assert.match(qaLogin, /QA_LOGIN_PASSWORD_MIN_BYTES = 32/);
  assert.match(envExample, /openssl rand -base64 32/);
  const eslintConfig = fs.readFileSync(
    path.join(root, "eslint.config.mjs"),
    "utf8",
  );
  assert.match(eslintConfig, /src\/app\/qa\/login\/page\.tsx/);
});

test("logged-out visitors can reach /qa/login", () => {
  const proxy = fs.readFileSync(path.join(root, "src/proxy.ts"), "utf8");
  const unauthenticatedAllow = proxy.indexOf("currentPath === '/qa/login'");
  const onboardingExempt = proxy.indexOf("currentPath !== '/qa/login'");
  assert.notEqual(unauthenticatedAllow, -1);
  assert.notEqual(onboardingExempt, -1);
  assert.ok(unauthenticatedAllow < onboardingExempt);
});
