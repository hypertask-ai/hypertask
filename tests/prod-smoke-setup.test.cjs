const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const stateDirectory = path.join(root, "e2e/smoke/.state");
const preflightFile = path.join(stateDirectory, "preflight.json");
const fixtureFile = path.join(stateDirectory, "fixture.json");
const storageStateFile = path.join(stateDirectory, "smoke-state.json");

function response({ status = 200, body = {}, headers = {} } = {}) {
  return {
    ok: () => status >= 200 && status < 300,
    status: () => status,
    headers: () => headers,
    json: async () => body,
  };
}

function loadGlobalSetup(chromium) {
  const filename = path.join(root, "e2e/smoke/global-setup.ts");
  const source = fs.readFileSync(filename, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  const module_ = { exports: {} };
  const localRequire = (specifier) =>
    specifier === "@playwright/test" ? { chromium } : require(specifier);
  new Function("require", "module", "exports", "__dirname", javascript)(
    localRequire,
    module_,
    module_.exports,
    path.dirname(filename),
  );
  return module_.exports.default;
}

function config() {
  return {
    projects: [
      {
        use: {
          baseURL: "https://app.hypertask.ai",
          storageState: "e2e/smoke/.state/smoke-state.json",
        },
      },
    ],
  };
}

function mockChromium({ tasks = [{ uniqueIndex: 7 }, { uniqueIndex: 8 }] } = {}) {
  const requests = [];
  const context = {
    request: {
      post: async (url, options) => {
        requests.push({ url, options });
        if (url === "/api/auth/qa-login") {
          return response({ body: { success: true, redirectUrl: "/project?id=42" } });
        }
        if (url === "/api/projects/boardTasks") {
          return response({ body: { tasks } });
        }
        throw new Error(`unexpected request: ${url}`);
      },
    },
    storageState: async ({ path: output }) => {
      fs.writeFileSync(path.resolve(root, output), '{"cookies":[]}');
    },
    newPage: async () => ({
      goto: async () => response(),
      waitForURL: async () => {
        const error = new Error("not redirected");
        error.name = "TimeoutError";
        throw error;
      },
      url: () => "https://app.hypertask.ai/inbox",
    }),
  };
  return {
    requests,
    chromium: {
      launch: async () => ({
        newContext: async () => context,
        close: async () => {},
      }),
    },
  };
}

test.beforeEach(() => {
  fs.rmSync(stateDirectory, { recursive: true, force: true });
  process.env.QA_LOGIN_EMAIL = "qa@example.test";
  process.env.QA_LOGIN_PASSWORD = "q".repeat(32);
});

test.after(() => {
  fs.rmSync(stateDirectory, { recursive: true, force: true });
  delete process.env.QA_LOGIN_EMAIL;
  delete process.env.QA_LOGIN_PASSWORD;
});

test("production workflow supplies the dedicated QA login instead of skipping", () => {
  const workflow = fs.readFileSync(
    path.join(root, ".github/workflows/prod-health.yml"),
    "utf8",
  );
  const smokeStart = workflow.indexOf("\n  smoke:");
  const nextJob = workflow.indexOf("\n  # ── GLM exploratory QA", smokeStart);
  const smokeJob = workflow.slice(smokeStart, nextJob);

  assert.match(smokeJob, /QA_LOGIN_EMAIL: \$\{\{ secrets\.QA_LOGIN_EMAIL \}\}/);
  assert.match(smokeJob, /QA_LOGIN_PASSWORD: \$\{\{ secrets\.QA_LOGIN_PASSWORD \}\}/);
  assert.doesNotMatch(smokeJob, /SMOKE_SESSION_STATE/);
  assert.doesNotMatch(smokeJob, /Not provisioned yet/);
});

test("production smoke logs in and resolves the seeded board and task", async () => {
  const mock = mockChromium();
  await loadGlobalSetup(mock.chromium)(config());

  assert.deepEqual(
    mock.requests.map(({ url }) => url),
    ["/api/auth/qa-login", "/api/projects/boardTasks"],
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(fixtureFile, "utf8")), {
    boardPath: "/detail/project-42",
    taskPath: "/detail/project-42/7",
  });
  assert.equal(JSON.parse(fs.readFileSync(preflightFile, "utf8")).ok, true);
  assert.equal(fs.existsSync(storageStateFile), true);
});

test("a missing seeded card is unrunnable instead of authorizing rollback", async () => {
  const mock = mockChromium({ tasks: [{ uniqueIndex: 7 }] });

  await assert.rejects(
    loadGlobalSetup(mock.chromium)(config()),
    /at least two seeded cards/,
  );
  const preflight = JSON.parse(fs.readFileSync(preflightFile, "utf8"));
  assert.equal(preflight.ok, false);
  assert.match(preflight.reason, /at least two seeded cards/);
});
