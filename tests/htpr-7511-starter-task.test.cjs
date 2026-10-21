const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { load } = require("./helpers/agent-connection.cjs");
const legacy = require("./fixtures/cli-install/legacy.json");
const key = "htpr-7511-signup-straight-to-board";
const cliKey = "htpr-7033-cli-install-command";
const commands = load("src/lib/onboarding/installCommands.ts");

async function seed(enabled, cliEnabled) {
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
    "@/lib/telemetry/savedWork": { enqueueBoardCreated: async () => "seed", processAnalyticsIntentSoon() {} },
    "@/utils/helperFunctions/helperFunctions": { getSequentialLetters: () => "MYB" },
    "@/utils/controllers/logs/createLog": { __esModule: true, default() {} },
    "@/lib/prisma": { __esModule: true, default: prisma },
    "@/lib/subscription": { stripe: {} },
    "../projects/create": { createProjectViewAndCreateDefault() {} },
    "@/lib/configs/general.config": { generalConfig: { hyperAiId: 900 } },
    "../projects/createProjectWithStableName": { createProjectWithStableName: async () => ({ id: 7, uniqueIdentifier: "MYB" }) },
    "../tasks/createTaskCore": { createTaskCore: async (options) => { tasks.push(options); return { task: { id: 71 } }; } },
    "../assignees/assign": { __esModule: true, default: async (...args) => assignments.push(args) },
    "@/lib/stripeCustomerName": { stripeCustomerName() {} },
    "@/lib/onboarding/installCommands": commands,
    "@/lib/flags": {
      HTPR_7511_SIGNUP_STRAIGHT_TO_BOARD_FLAG: key,
      HTPR_7033_CLI_INSTALL_COMMAND_FLAG: cliKey,
      isFeatureEnabled: async (flag, userId) => {
        assert.equal(userId, 2343);
        reads.push(flag);
        assert.ok([key, cliKey].includes(flag));
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
    assert.ok(code.includes("https://mcp.hypertask.ai/mcp"));
    assert.ok(code.includes("claude mcp add --transport http hypertask https://mcp.hypertask.ai/mcp"));
    assert.ok(code.includes("curl -fsSL https://hypertask.ai/install | sh"));
    assert.ok(code.includes("irm https://hypertask.ai/install.ps1 | iex"));
    assert.ok(code.includes("hypertask login --token <your-agent-token>"));
    assert.match(text, /Approve and connect/);
    assert.match(text, /Never post the token in a task or chat/);
    assert.match(text, /Bare hypertask login does not sign in today/);
    assert.doesNotMatch(task.description, /npm|login --code/);
    assert.deepEqual(reads, [key]);
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

test("legacy factory remains byte-identical to the production baseline", () => {
  const { createHash } = require("node:crypto");
  const file = "src/utils/controllers/users/completeOnboardingStep.ts";
  const current = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const start = current.indexOf("const CONNECT_AI_TASK =");
  const factory = current.slice(start, current.indexOf("\n\n", start));
  assert.equal(createHash("sha256").update(factory).digest("hex"), "2170a227f120b8313cc3b9afc78085d9076a5840c9b00dadc1ecb9ca353eaf6b");
});
