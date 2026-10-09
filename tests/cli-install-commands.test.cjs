const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const legacy = require("./fixtures/cli-install/legacy.json");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const key = "htpr-7033-cli-install-command";

function load(file, mocks = {}) {
  const javascript = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module_ = { exports: {} };
  const importModule = (name) => {
    if (Object.hasOwn(mocks, name)) return { __esModule: true, ...mocks[name] };
    if (!name.startsWith("@/") && !name.startsWith(".")) return require(name);
    const target = name.startsWith("@/") ? `src/${name.slice(2)}` : path.join(path.dirname(file), name);
    const resolved = [target, `${target}.ts`, `${target}.tsx`].find((candidate) => fs.existsSync(path.join(root, candidate)));
    assert.ok(resolved, `Missing test import ${name}`);
    return load(resolved, mocks);
  };
  new Function("require", "module", "exports", javascript)(importModule, module_, module_.exports);
  return module_.exports;
}

const commands = load("src/lib/onboarding/installCommands.ts");
const seeds = load("src/lib/demo/guestSeedTasks.ts");
const flagReads = [];
let enabled = true;
const flagsMock = {
  HTPR_7033_CLI_INSTALL_COMMAND_FLAG: key,
  isFeatureEnabled: async (flag, userId) => {
    flagReads.push([flag, userId]);
    return enabled;
  },
};
const taskCalls = [];
const prisma = {
  section: { create: async ({ data }) => ({ id: 1, ...data }) },
  user: { findUnique: async () => null },
  member: { create: async () => ({}) },
  assignees: { create: async () => ({}) },
  team_Activity: { update: async () => ({}) },
  project_View: { findUniqueOrThrow: async () => ({ default_view: { id: "view" } }), update: async () => ({}) },
  user_Project_View: { upsert: async () => ({}) },
  $transaction: async (operations) => Promise.all(operations),
  featureFlag: { findUnique: async () => null, findMany: async () => [] },
};
const mocks = {
  "@/lib/prisma": { default: prisma },
  "@/lib/flags": flagsMock,
  "@/utils/helperFunctions/helperFunctions": { getSequentialLetters: () => "TEST" },
  "@/lib/subscription": { stripe: {} },
  "@/lib/stripeCustomerName": { stripeCustomerName: () => "Test" },
  "@/utils/controllers/logs/createLog": { default: () => {} },
  "../projects/create": { createProjectViewAndCreateDefault: async () => {} },
  "@/utils/controllers/projects/create": { createProjectViewAndCreateDefault: async () => {} },
  "../projects/createProjectWithStableName": { createProjectWithStableName: async () => ({ id: 42 }) },
  "@/utils/controllers/projects/createProjectWithStableName": { createProjectWithStableName: async () => ({ id: 42 }) },
  "../tasks/createTaskCore": { createTaskCore: async (task) => { taskCalls.push(task); return { task: { id: taskCalls.length } }; } },
  "@/utils/controllers/tasks/createTaskCore": { createTaskCore: async (task) => { taskCalls.push(task); return { task: { id: taskCalls.length } }; } },
  "../assignees/assign": { default: async () => {} },
  "@/utils/controllers/projects/views/viewsHelperAPIfunctions": {},
  "@/utils/helperFunctions/Views/BoardFilterSanitizer": {},
  "./generateDemoBoard": {},
};
const onboarding = load("src/utils/controllers/users/completeOnboardingStep.ts", mocks);
const demo = load("src/lib/demo/provisionGuest.ts", mocks);
const cli = load("src/components/Modals/Settings/CliSection.tsx", {
  "@/hooks/useFlag": { useFlag: (flag) => { assert.equal(flag, key); return enabled; } },
  "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
});

const assertNoRetiredCli = (text) => assert.doesNotMatch(text, /@hypertask\/hypertask_cli/);

function assertCurrent(text) {
  assert.ok(text.includes(commands.CLI_INSTALL_COMMAND));
  assert.ok(text.includes(commands.CLI_LOGIN_COMMAND));
  assert.ok(text.indexOf(commands.CLI_INSTALL_COMMAND) < text.indexOf(commands.CLI_LOGIN_COMMAND));
  assert.ok(text.includes(commands.CLI_WINDOWS_NOTE));
  assertNoRetiredCli(text);
}

test("canonical commands keep the existing pin and Settings MCP URL", () => {
  assert.equal(commands.CLI_INSTALL_COMMAND, "curl -fsSL https://raw.githubusercontent.com/hypertask-ai/cli/8a9245246cec8ddac4ab1dfccae5c5cba5c39707/scripts/install.sh | sh");
  assert.equal(commands.CLI_LOGIN_COMMAND, "hypertask login");
  assert.equal(commands.CLI_WINDOWS_NOTE, "Windows: download hypertask-windows-x86_64.exe from https://github.com/hypertask-ai/cli/releases/latest, rename it to hypertask.exe and put it on your PATH.");
  assert.equal(commands.MCP_ADD_COMMAND, "claude mcp add --transport http hypertask https://mcp.hypertask.ai/mcp");
  const mcp = load("src/components/Modals/McpToken/utils.ts");
  assert.equal(commands.MCP_ADD_COMMAND.split(" ").at(-1), mcp.MCP_SERVER_URL);
  const constants = load("src/components/Modals/CliInstall/constants.ts");
  assert.equal(constants.INSTALL_COMMAND, commands.CLI_INSTALL_COMMAND);
  assert.equal(constants.LOGIN_COMMAND, commands.CLI_LOGIN_COMMAND);
  assert.match(read("src/components/Modals/CliInstall/CliInstallModal.tsx"), /import.*INSTALL_COMMAND.*LOGIN_COMMAND.*from "\.\/constants"/);
});

test("static help contains the real canonical CLI commands and Windows note", () => {
  assertCurrent(read("public/llms.txt"));
});

for (const flag of [true, false]) {
  test(`server seed flag ${flag ? "on shares commands" : "off keeps byte-identical fixtures"}`, async () => {
    enabled = flag;
    flagReads.length = 0;
    taskCalls.length = 0;
    await onboarding.createOnboardingSampleBoardProject({ exist_user: { id: 77 }, boardTitle: "Test", Team: { id: "team" }, googleAccount: { id: "google" } });
    assert.equal(taskCalls.length, 1);
    const onboardingText = taskCalls[0].description;
    taskCalls.length = 0;
    await demo.provisionGuestBoard("", { userId: 78, teamId: "team", googleAccountId: "google" });
    assert.equal(taskCalls.length, 4);
    const cliText = taskCalls.find((task) => task.title === "Hypertask CLI").description;
    const mcpText = taskCalls.find((task) => task.title === "Hypertask MCP").description;
    assert.deepEqual(flagReads, [[key, 77], [key, 78]]);
    if (flag) {
      for (const text of [onboardingText, cliText]) assertCurrent(text);
      assert.ok(mcpText.includes(commands.MCP_ADD_COMMAND));
    } else {
      assert.equal(onboardingText, legacy.onboarding);
      assert.equal(cliText, legacy.guestCli);
      assert.equal(mcpText, legacy.guestMcp);
      assert.deepEqual(seeds.getGuestSeedTasksInProgress(false), seeds.GUEST_SEED_TASKS_IN_PROGRESS);
    }
  });
}

test("Settings useFlag adds only the Windows note and keeps the old markup off", () => {
  enabled = true;
  const on = renderToStaticMarkup(React.createElement(cli.default));
  enabled = false;
  const off = renderToStaticMarkup(React.createElement(cli.default));
  assert.ok(on.includes(commands.CLI_WINDOWS_NOTE));
  assert.equal(on.replace(`<p class="px-2 text-dense font-medium text-text-light-gray">${commands.CLI_WINDOWS_NOTE}</p>`, ""), off);
  assert.equal(off, legacy.settingsHtml);
  assert.ok(off.includes(commands.CLI_INSTALL_COMMAND));
  assert.ok(off.includes(commands.CLI_LOGIN_COMMAND));
  assert.doesNotMatch(off, /Windows/);
});

test("ticket flag defaults to Everyone as a bugfix and respects OFF", async () => {
  let row = null;
  const registry = load("src/lib/flags.ts", {
    "@/lib/prisma": { default: { featureFlag: { findUnique: async () => row, findMany: async () => [] } } },
    "@/lib/auth/getSessionUser": {},
    "@/lib/agentRuns/model": { AGENT_CHAT_STOP_AND_TIMEOUT_FEATURE_FLAG: "htpr-6406-agent-chat-stop-and-timeout" },
  });
  assert.equal(registry.HTPR_7033_CLI_INSTALL_COMMAND_FLAG, key);
  assert.equal(registry.defaultFeatureFlagMode(key), "EVERYONE");
  const entry = (await registry.listFeatureFlagModes()).find((entry) => entry.key === key);
  assert.equal(entry.kind, "bugfix");
  assert.equal(entry.mode, "EVERYONE");
  assert.equal(await registry.isFeatureEnabled(key, 77), true);
  row = { mode: "OFF" };
  assert.equal(await registry.isFeatureEnabled(key, 77), false);
});

test("every dynamic install surface reads the shared constants, not a copied command", async () => {
  enabled = true;
  const sentinel = { CLI_INSTALL_COMMAND: "shared-install", CLI_LOGIN_COMMAND: "shared-login", CLI_WINDOWS_NOTE: "shared-windows", MCP_ADD_COMMAND: "shared-mcp" };
  const sharedMocks = {
    ...mocks,
    "@/lib/onboarding/installCommands": sentinel,
    "@/hooks/useFlag": { useFlag: () => true },
    "@/lib/contexts/mobileContext": { MobileViewContext: React.createContext(false) },
  };
  taskCalls.length = 0;
  await load("src/utils/controllers/users/completeOnboardingStep.ts", sharedMocks).createOnboardingSampleBoardProject({ exist_user: { id: 77 }, boardTitle: "Test", Team: { id: "team" }, googleAccount: { id: "google" } });
  await load("src/lib/demo/provisionGuest.ts", sharedMocks).provisionGuestBoard("", { userId: 78, teamId: "team", googleAccountId: "google" });
  const ui = renderToStaticMarkup(React.createElement(load("src/components/Modals/Settings/CliSection.tsx", sharedMocks).default));
  for (const surface of [taskCalls[0].description, taskCalls.find((task) => task.title === "Hypertask CLI").description, ui]) {
    for (const value of [sentinel.CLI_INSTALL_COMMAND, sentinel.CLI_LOGIN_COMMAND, sentinel.CLI_WINDOWS_NOTE]) assert.ok(surface.includes(value));
  }
  assert.ok(taskCalls.find((task) => task.title === "Hypertask MCP").description.includes(sentinel.MCP_ADD_COMMAND));
  assert.equal(load("src/components/Modals/CliInstall/constants.ts", sharedMocks).INSTALL_COMMAND, sentinel.CLI_INSTALL_COMMAND);
});

test("retired CLI absence check rejects the legacy positive control", () => {
  assert.throws(() => assertNoRetiredCli(legacy.guestCli));
  assert.match(legacy.guestCli, /@hypertask\/hypertask_cli/);
  for (const file of ["src/utils/controllers/users/completeOnboardingStep.ts", "src/lib/demo/guestSeedTasks.ts"]) {
    assert.match(read(file), /from "@\/lib\/onboarding\/installCommands"/);
  }
});
