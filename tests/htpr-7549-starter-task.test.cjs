const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { loadModule: load } = require("./helpers/loadModule.cjs");
const legacy = require("./fixtures/cli-install/legacy.json");
const key = "htpr-7549-first-task-pointer";
const cliKey = "htpr-7033-cli-install-command";
const browserKey = "htpr-9530-onboarding-cli-browser-login";
const commands = load("src/lib/onboarding/installCommands.ts");

async function seed(enabled, cliEnabled, browserLoginEnabled = true) {
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
      HTPR_9530_ONBOARDING_CLI_BROWSER_LOGIN_FLAG: browserKey,
      isFeatureEnabled: async (flag, userId) => {
        assert.equal(userId, 2343);
        reads.push(flag);
        assert.ok([key, cliKey, browserKey].includes(flag));
        if (flag === browserKey) return browserLoginEnabled;
        return flag === key ? enabled : cliEnabled;
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
  test(`new copy wins with CLI flag ${cliEnabled} and stores immutable task/column IDs`, async () => {
    const { task, markers, reads } = await seed(true, cliEnabled);
    assert.equal(task.title, "Connect your AI to Hypertask");
    const dom = new JSDOM(task.description);
    const text = dom.window.document.body.textContent;
    for (const tool of ["Claude", "ChatGPT", "Claude Code", "Codex", "Cursor", "VS Code"]) assert.ok(text.includes(tool));
    const code = [...dom.window.document.querySelectorAll("code")].map((node) => node.textContent);
    assert.equal(code.find((value) => value === "https://mcp.hypertask.ai/mcp"), "https://mcp.hypertask.ai/mcp");
    assert.equal(code.find((value) => value === "claude mcp add --transport http hypertask https://mcp.hypertask.ai/mcp"), "claude mcp add --transport http hypertask https://mcp.hypertask.ai/mcp");
    assert.equal(code.find((value) => value === "curl -fsSL https://hypertask.ai/install | sh"), "curl -fsSL https://hypertask.ai/install | sh");
    assert.equal(code.find((value) => value === "irm https://hypertask.ai/install.ps1 | iex"), "irm https://hypertask.ai/install.ps1 | iex");
    assert.ok(code.includes("hypertask login"));
    assert.match(text, /Approve and connect/);
    assert.match(text, /Never post the token in a task or chat/);
    assert.match(text, /hypertask login: it opens your browser to authorize/);
    assert.doesNotMatch(text, /does not sign in today/);
    assert.doesNotMatch(text, /login --token/);
    assert.doesNotMatch(task.description, /npm|login --code/);
    assert.deepEqual(reads, [key, browserKey]);
    assert.deepEqual(markers, [{ firstTaskPointerTaskId: 71, firstTaskPointerSectionId: 10 }]);
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

test("HTPR-9530 onboarding CLI step uses browser sign-in", async () => {
  const { task, reads } = await seed(true, true);
  const dom = new JSDOM(task.description);
  const text = dom.window.document.body.textContent;
  assert.match(text, /hypertask login: it opens your browser to authorize/);
  assert.doesNotMatch(text, /does not sign in today/);
  assert.doesNotMatch(text, /login --token/);
  assert.doesNotMatch(text, /--token/);
  assert.doesNotMatch(text, /app\.hypertask\.ai\/agents/);
  assert.deepEqual(reads, [key, browserKey]);
  dom.window.close();
});

test("HTPR-9530 off keeps the previous token sentence, agents page included", async () => {
  const { task } = await seed(true, true, false);
  const dom = new JSDOM(task.description);
  const text = dom.window.document.body.textContent;
  assert.match(text, /https:\/\/app\.hypertask\.ai\/agents/);
  assert.match(text, /hypertask login --token <your-agent-token>/);
  assert.match(text, /Bare hypertask login does not sign in today/);
  assert.doesNotMatch(text, /hypertask login: it opens your browser/);
  dom.window.close();
});

test("HTPR-9530 browser sign-in copy does not depend on the CLI install flag", async () => {
  const { task, reads } = await seed(true, false, true);
  const dom = new JSDOM(task.description);
  const text = dom.window.document.body.textContent;
  assert.match(text, /hypertask login: it opens your browser to authorize/);
  assert.doesNotMatch(text, /--token/);
  assert.deepEqual(reads, [key, browserKey]);
  dom.window.close();
});

test("HTPR-9530 no onboarding sign-in step prescribes a token", async () => {
  const { task } = await seed(true, true);
  const dom = new JSDOM(task.description);
  assert.doesNotMatch(dom.window.document.body.textContent, /login --token/);
  dom.window.close();
  const surfaces = [
    "src/components/PageComponents/Onboarding/Screens/ConnectAIOnboardingScreen.tsx",
    "public/llms.txt",
  ];
  for (const file of surfaces) {
    const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    assert.ok(source.includes("hypertask login"), file);
    assert.doesNotMatch(source, /login --token/, file);
  }
});

test("legacy factory remains byte-identical to the production baseline", () => {
  const { createHash } = require("node:crypto");
  const file = "src/utils/controllers/users/completeOnboardingStep.ts";
  const current = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const start = current.indexOf("const CONNECT_AI_TASK =");
  const factory = current.slice(start, current.indexOf("\n\n", start));
  assert.equal(createHash("sha256").update(factory).digest("hex"), "2170a227f120b8313cc3b9afc78085d9076a5840c9b00dadc1ecb9ca353eaf6b");
});
