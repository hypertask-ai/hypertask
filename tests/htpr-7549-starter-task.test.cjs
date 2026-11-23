const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { loadModule: load } = require("./helpers/loadModule.cjs");
const legacy = require("./fixtures/cli-install/legacy.json");
const key = "htpr-7549-first-task-pointer";
const cliKey = "htpr-7033-cli-install-command";
const browserKey = "htpr-9530-cli-browser-signin";
const commands = load("src/lib/onboarding/installCommands.ts");

async function seed(enabled, cliEnabled, browserSignIn = false) {
  const tasks = [];
  const markers = [];
  const assignments = [];
  const reads = [];
  let nextSection = 10;
  const prisma = {
    section: { create: async ({ data }) => ({ id: nextSection++, ...data }) },
    user: { findUnique: async () => ({ id: 900 }) },
    project: { update: async ({ where, data }) => { assert.equal(where.id, 7); markers.push(data); return data; } },
  };
  const { createOnboardingSampleBoardProject } = load("src/utils/controllers/users/completeOnboardingStep.ts", {
    "@/lib/planLimits": { isPlanLimitsEnabled: async () => false, isPlanLimitReachedError: () => false },
    "@/lib/mcp/boards/createBoardFromManifest": {},
    "@/lib/telemetry/savedWork": { enqueueBoardCreated: async () => "seed", processAnalyticsIntentSoon() {} },
    "@/utils/helperFunctions/helperFunctions": { getSequentialLetters: () => "MYB" },
    "@/utils/controllers/logs/createLog": { __esModule: true, default() {} },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/subscription": { stripe: {} },
    "../projects/create": { createProjectViewAndCreateDefault() {} },
    "@/lib/configs/general.config": { generalConfig: { hyperAiId: 900 } },
    "../projects/createProjectWithStableName": { createProvisionedProjectWithStableName: async () => ({ id: 7, uniqueIdentifier: "MYB" }) },
    "../tasks/createTaskCore": { createProvisionedTaskCore: async (options) => { tasks.push(options); return { task: { id: 71 } }; } },
    "../assignees/assign": { __esModule: true, default: async (...args) => assignments.push(args) },
    "@/lib/stripeCustomerName": { stripeCustomerName() {} },
    "@/lib/onboarding/installCommands": commands,
    "@/lib/flags": {
      HTPR_7549_FIRST_TASK_POINTER_FLAG: key,
      HTPR_7033_CLI_INSTALL_COMMAND_FLAG: cliKey,
      HTPR_9530_CLI_BROWSER_SIGNIN_FLAG: browserKey,
      isFeatureEnabled: async (flag, userId) => {
        assert.equal(userId, 2343);
        reads.push(flag);
        assert.ok([key, cliKey, browserKey].includes(flag));
        if (flag === key) return enabled;
        if (flag === browserKey) return browserSignIn;
        return cliEnabled;
      },
    },
  });
  await createOnboardingSampleBoardProject({ exist_user: { id: 2343 }, boardTitle: "MyBoard", Team: { id: "team", title: "MyTeam" }, googleAccount: { id: "google" } });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].sectionId, 10);
  assert.equal(tasks[0].userId, 900);
  assert.equal(tasks[0].projectId, 7);
  assert.equal(assignments[0][2], 71);
  return { task: tasks[0], markers, reads };
}

for (const cliEnabled of [false, true]) {
  test(`browser sign-in replaces the token step with CLI flag ${cliEnabled}`, async () => {
    const { task, markers, reads } = await seed(true, cliEnabled, true);
    assert.equal(task.title, "Connect your AI to Hypertask");
    const dom = new JSDOM(task.description);
    const text = dom.window.document.body.textContent;
    for (const tool of ["Claude", "ChatGPT", "Claude Code", "Codex", "Cursor", "VS Code"]) assert.ok(text.includes(tool));
    const code = [...dom.window.document.querySelectorAll("code")].map((node) => node.textContent);
    assert.equal(code.find((value) => value === "https://mcp.hypertask.ai/mcp"), "https://mcp.hypertask.ai/mcp");
    assert.equal(code.find((value) => value === "claude mcp add --transport http hypertask https://mcp.hypertask.ai/mcp"), "claude mcp add --transport http hypertask https://mcp.hypertask.ai/mcp");
    assert.equal(code.find((value) => value === "curl -fsSL https://hypertask.ai/install | sh"), "curl -fsSL https://hypertask.ai/install | sh");
    assert.equal(code.find((value) => value === "irm https://hypertask.ai/install.ps1 | iex"), "irm https://hypertask.ai/install.ps1 | iex");
    assert.deepEqual(code.filter((value) => value.startsWith("hypertask login")), ["hypertask login"]);
    assert.match(text, /It opens your browser to authorize the CLI for your account/);
    assert.match(text, /Approve and connect/);
    assert.match(text, /Never post the token in a task or chat/);
    assert.doesNotMatch(text, /does not sign in/);
    assert.doesNotMatch(task.description, /login --token|npm|login --code/);
    assert.deepEqual(reads, [key, browserKey]);
    assert.deepEqual(markers, [{ firstTaskPointerTaskId: 71, firstTaskPointerSectionId: 10 }]);
    dom.window.close();
  });

  test(`flag off keeps the token sign-in step with CLI flag ${cliEnabled}`, async () => {
    const { task, reads } = await seed(true, cliEnabled, false);
    const dom = new JSDOM(task.description);
    const text = dom.window.document.body.textContent;
    const code = [...dom.window.document.querySelectorAll("code")].map((node) => node.textContent);
    assert.ok(code.includes("hypertask login --token <your-agent-token>"));
    assert.match(text, /Bare hypertask login does not sign in today/);
    assert.doesNotMatch(text, /opens your browser/);
    assert.deepEqual(reads, [key, browserKey]);
    dom.window.close();
  });

  test(`normal user with flag off is still refused new copy and preserves old CLI ${cliEnabled} bytes`, async () => {
    const { task, markers } = await seed(false, cliEnabled);
    const expected = cliEnabled
      ? legacy.onboarding.replace("<li><strong>npm install -g @hypertask/hypertask_cli</strong></li>", `<li><code>${commands.CLI_INSTALL_COMMAND}</code></li>`) + `<p>${commands.CLI_WINDOWS_NOTE}</p>`
      : legacy.onboarding;
    assert.equal(task.title, "Connect Hypertask to Claude or ChatGPT");
    assert.equal(task.description, expected);
    assert.deepEqual(markers, []);
  });
}

test("cli browser sign-in flag ships to everyone as a small bugfix", () => {
  const file = path.join(__dirname, "../src/lib/flags/definitions/htpr-9530-cli-browser-signin.ts");
  if (!fs.existsSync(file)) return;
  const mod = load("src/lib/flags/definitions/htpr-9530-cli-browser-signin.ts");
  assert.equal(mod.HTPR_9530_CLI_BROWSER_SIGNIN_FLAG, browserKey);
  assert.equal(mod.default.key, browserKey);
  assert.equal(mod.default.kind, "bugfix");
  assert.equal(mod.default.defaultMode, "EVERYONE");
  assert.equal(mod.default.releaseRisk.risk, "small");
});

test("legacy factory remains byte-identical to the production baseline", () => {
  const { createHash } = require("node:crypto");
  const file = "src/utils/controllers/users/completeOnboardingStep.ts";
  const current = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const start = current.indexOf("const CONNECT_AI_TASK =");
  const factory = current.slice(start, current.indexOf("\n\n", start));
  assert.equal(createHash("sha256").update(factory).digest("hex"), "2170a227f120b8313cc3b9afc78085d9076a5840c9b00dadc1ecb9ca353eaf6b");
});
