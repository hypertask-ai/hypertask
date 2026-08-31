const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("AI Chat inventory is formatting-independent and wrapper-independent", async () => {
  const root = path.resolve(__dirname, "..");
  const typescript = require("typescript");
  const { collectAiChatToolNames } = await import(
    path.join(root, "scripts/parity-ai-chat-inventory.mjs")
  );
  const source = `
    function buildTools(): ToolSet {
      const tools: ToolSet = {
  "hypertask_wrapped": withErrors(
      tool({ execute: async () => ({}) })
    ),
            hypertask_indented:
      buildTool(),
      unrelated: tool({}),
    };
      Object.seal(tools);
      return tools;
    }
  `;

  assert.deepEqual(collectAiChatToolNames(typescript, source), [
    "hypertask_indented",
    "hypertask_wrapped",
    "unrelated",
  ]);
});

test("AI Chat inventory rejects spreads instead of silently omitting tools", async () => {
  const root = path.resolve(__dirname, "..");
  const typescript = require("typescript");
  const { collectAiChatToolNames } = await import(
    path.join(root, "scripts/parity-ai-chat-inventory.mjs")
  );

  assert.throws(
    () =>
      collectAiChatToolNames(
        typescript,
        "function buildTools() { const tools: ToolSet = { ...otherTools() }; Object.seal(tools); return tools; }",
      ),
    /spread assignment/,
  );
});

test("AI Chat inventory rejects post-initialization catalog mutations", async () => {
  const root = path.resolve(__dirname, "..");
  const typescript = require("typescript");
  const { collectAiChatToolNames } = await import(
    path.join(root, "scripts/parity-ai-chat-inventory.mjs")
  );
  assert.throws(
    () =>
      collectAiChatToolNames(
        typescript,
        "function buildTools() { const tools: ToolSet = { hypertask_one: tool({}) }; Object.seal(tools); tools.hypertask_two = tool({}); return tools; }",
      ),
    /mutated after initialization/,
  );
  assert.throws(
    () =>
      collectAiChatToolNames(
        typescript,
        "function buildTools() { const tools: ToolSet = { hypertask_one: tool({}) }; Object.seal(tools); Object.assign(tools, { hypertask_two: tool({}) }); return tools; }",
      ),
    /mutated after initialization/,
  );
});

test("AI Chat inventory requires immediate runtime catalog sealing", async () => {
  const root = path.resolve(__dirname, "..");
  const typescript = require("typescript");
  const { collectAiChatToolNames } = await import(
    path.join(root, "scripts/parity-ai-chat-inventory.mjs")
  );
  assert.throws(
    () =>
      collectAiChatToolNames(
        typescript,
        "function buildTools() { const tools: ToolSet = { hypertask_one: tool({}) }; const alias = tools; alias.hypertask_two = tool({}); return tools; }",
      ),
    /sealed immediately/,
  );
});

test("AI Chat inventory rejects a sealed decoy outside the runtime buildTools catalog", async () => {
  const root = path.resolve(__dirname, "..");
  const typescript = require("typescript");
  const { collectAiChatToolNames } = await import(
    path.join(root, "scripts/parity-ai-chat-inventory.mjs")
  );
  assert.throws(
    () =>
      collectAiChatToolNames(
        typescript,
        "const tools: ToolSet = { hypertask_decoy: tool({}) }; Object.seal(tools); function buildTools() { const runtime = { hypertask_live: tool({}) }; return runtime; }",
      ),
    /declared by buildTools/,
  );
  assert.throws(
    () =>
      collectAiChatToolNames(
        typescript,
        "function buildTools() { const tools: ToolSet = { hypertask_decoy: tool({}) }; Object.seal(tools); const runtime = { hypertask_live: tool({}) }; return runtime; }",
      ),
    /canonical runtime path/,
  );
});

test("API inventory accepts only actual exported route methods", async () => {
  const root = path.resolve(__dirname, "..");
  const typescript = require("typescript");
  const { collectApiRouteMethods } = await import(
    path.join(root, "scripts/parity-ai-chat-inventory.mjs")
  );
  assert.deepEqual(
    collectApiRouteMethods(
      typescript,
      "export async function GET() {} const handler = () => {}; export { handler as POST }; export const DELETE = handler; const fake = value as PUT;",
    ),
    ["DELETE", "GET", "POST"],
  );
  assert.deepEqual(
    collectApiRouteMethods(
      typescript,
      "export async function POST() {} const fake = value as GET;",
    ),
    ["POST"],
  );
});

test("MCP inventory accepts formatting but rejects spreads", async () => {
  const root = path.resolve(__dirname, "..");
  const typescript = require("typescript");
  const { collectMcpRegistryVariables } = await import(
    path.join(root, "scripts/parity-ai-chat-inventory.mjs")
  );
  assert.deepEqual(
    collectMcpRegistryVariables(
      typescript,
      "import { oneTool } from './one.tool'; export const MCP_TOOLS = [oneTool]; Object.freeze(MCP_TOOLS);",
    ),
    [{ variable: "oneTool", importedFrom: "./one.tool" }],
  );
  assert.throws(
    () =>
      collectMcpRegistryVariables(
        typescript,
        "const extra = []; export const MCP_TOOLS = [...extra]; Object.freeze(MCP_TOOLS);",
      ),
    /uses a spread/,
  );
  assert.throws(
    () =>
      collectMcpRegistryVariables(
        typescript,
        "import { oneTool } from './one.tool'; let MCP_TOOLS = [oneTool]; MCP_TOOLS.push(oneTool);",
      ),
    /exported const frozen immediately/,
  );
});

test("HyperAI inventory requires a direct one-to-one MCP registry map", async () => {
  const root = path.resolve(__dirname, "..");
  const typescript = require("typescript");
  const { assertHyperAiCanonicalRegistry } = await import(
    path.join(root, "scripts/parity-ai-chat-inventory.mjs")
  );
  assert.doesNotThrow(() =>
    assertHyperAiCanonicalRegistry(
      typescript,
      "import { MCP_TOOLS } from '@/lib/mcp-server/tools'; function createHyperAiTools() { return Object.fromEntries((MCP_TOOLS as Tool[]).map((mcpTool) => { return [mcpTool.name, convert(mcpTool)]; })); }",
    ),
  );
  assert.throws(
    () =>
      assertHyperAiCanonicalRegistry(
        typescript,
        "import { MCP_TOOLS } from '@/lib/mcp-server/tools'; function createHyperAiTools() { return Object.fromEntries(MCP_TOOLS.filter(Boolean).map(convert)); }",
      ),
    /must map the canonical MCP_TOOLS registry directly/,
  );
  assert.throws(
    () =>
      assertHyperAiCanonicalRegistry(
        typescript,
        "import { MCP_TOOLS } from '@/lib/mcp-server/tools'; function createHyperAiTools() { return Object.fromEntries(MCP_TOOLS.map((mcpTool) => { return ['renamed', convert(mcpTool)]; })); }",
      ),
    /must return each canonical mcpTool.name unchanged/,
  );
  assert.throws(
    () =>
      assertHyperAiCanonicalRegistry(
        typescript,
        "import { MCP_TOOLS } from '@/lib/mcp-server/tools'; function createHyperAiTools() { return Object.fromEntries(MCP_TOOLS.map((mcpTool) => { if (flag) return ['renamed', convert(mcpTool)]; return [mcpTool.name, convert(mcpTool)]; })); }",
      ),
    /one unconditional canonical return/,
  );
  assert.throws(
    () =>
      assertHyperAiCanonicalRegistry(
        typescript,
        "import { MCP_TOOLS as OTHER } from '@/lib/mcp-server/tools'; const MCP_TOOLS = []; function createHyperAiTools() { return Object.fromEntries(MCP_TOOLS.map((mcpTool) => { return [mcpTool.name, convert(mcpTool)]; })); }",
      ),
    /must resolve to the canonical named import/,
  );
});

test("five-surface parity catalog has no unreviewed drift", () => {
  const root = path.resolve(__dirname, "..");
  const result = spawnSync(
    process.execPath,
    ["scripts/parity-contract.mjs", "--check"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("trusted validation rejects removals and permits only bounded concrete transitions", () => {
  const root = path.resolve(__dirname, "..");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "parity-contract-"));
  const baseline = JSON.parse(
    fs.readFileSync(path.join(root, "config/parity/generated-inventory.json"), "utf8"),
  );
  baseline.surfaces.api.push("GET /api/mcp/removed-from-candidate");
  const removalBaseline = path.join(temporary, "removal-baseline.json");
  fs.writeFileSync(removalBaseline, JSON.stringify(baseline));
  const removed = spawnSync(
    process.execPath,
    [
      "scripts/parity-contract.mjs",
      "--validate-only",
      "--contract",
      "config/parity/contract.json",
      "--baseline",
      removalBaseline,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.notEqual(removed.status, 0);
  assert.match(removed.stderr, /Trusted parity entries were removed/);

  const contract = JSON.parse(
    fs.readFileSync(path.join(root, "config/parity/contract.json"), "utf8"),
  );
  const webhooks = contract.jobs.find((job) => job.id === "webhooks.manage");
  webhooks.matches.cli = [
    ...(webhooks.matches.cli ?? []),
    "^webhooks future$",
  ];
  if (webhooks.exclusions) delete webhooks.exclusions.cli;
  webhooks.planned = {
    ...(webhooks.planned ?? {}),
    cli: {
      issue: "https://app.hypertask.ai/detail/project-15/5361",
      expires: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      entries: ["webhooks future"],
    },
  };
  const transitionContract = path.join(temporary, "transition-contract.json");
  fs.writeFileSync(transitionContract, JSON.stringify(contract));
  const transition = spawnSync(
    process.execPath,
    [
      "scripts/parity-contract.mjs",
      "--validate-only",
      "--contract",
      transitionContract,
      "--baseline",
      "config/parity/generated-inventory.json",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(transition.status, 0, `${transition.stdout}\n${transition.stderr}`);

  const completedContract = JSON.parse(
    fs.readFileSync(path.join(root, "config/parity/contract.json"), "utf8"),
  );
  const completedEntry = Object.entries(baseline.assignments.api).find(
    ([, jobId]) => jobId === "webhooks.manage",
  )[0];
  const completedJob = completedContract.jobs.find(
    (job) => job.id === "webhooks.manage",
  );
  completedJob.planned = {
    ...(completedJob.planned ?? {}),
    api: {
      issue: "https://app.hypertask.ai/detail/project-15/5361",
      expires: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10),
      entries: [completedEntry],
    },
  };
  const cleanedCandidate = structuredClone(completedContract);
  const cleanedJob = cleanedCandidate.jobs.find(
    (job) => job.id === "webhooks.manage",
  );
  delete cleanedJob.planned.api;
  if (Object.keys(cleanedJob.planned).length === 0) delete cleanedJob.planned;
  const completedContractPath = path.join(temporary, "completed-contract.json");
  const cleanedCandidatePath = path.join(temporary, "cleaned-candidate.json");
  fs.writeFileSync(completedContractPath, JSON.stringify(completedContract));
  fs.writeFileSync(cleanedCandidatePath, JSON.stringify(cleanedCandidate));
  const cleaned = spawnSync(
    process.execPath,
    [
      "scripts/parity-contract.mjs",
      "--validate-only",
      "--contract",
      completedContractPath,
      "--baseline",
      "config/parity/generated-inventory.json",
      "--candidate-contract",
      cleanedCandidatePath,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(cleaned.status, 0, `${cleaned.stdout}\n${cleaned.stderr}`);
  const stale = spawnSync(
    process.execPath,
    [
      "scripts/parity-contract.mjs",
      "--validate-only",
      "--contract",
      completedContractPath,
      "--baseline",
      "config/parity/generated-inventory.json",
      "--candidate-contract",
      completedContractPath,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /transition is complete and must be removed/);
});

test("trusted validation recomputes candidate artifacts without executing candidate code", () => {
  const root = path.resolve(__dirname, "..");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "parity-artifacts-"));
  const staleInventory = path.join(temporary, "generated-inventory.json");
  const staleReport = path.join(temporary, "five-surface-parity.md");
  fs.copyFileSync(
    path.join(root, "config/parity/generated-inventory.json"),
    staleInventory,
  );
  fs.copyFileSync(
    path.join(root, "docs/parity.md"),
    staleReport,
  );
  fs.appendFileSync(staleInventory, " ");

  const result = spawnSync(
    process.execPath,
    [
      "scripts/parity-contract.mjs",
      "--validate-only",
      "--contract",
      "config/parity/contract.json",
      "--baseline",
      "config/parity/generated-inventory.json",
      "--candidate-contract",
      "config/parity/contract.json",
      "--candidate-inventory",
      staleInventory,
      "--candidate-report",
      staleReport,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /generated-inventory\.json is stale/);
});

test("trusted validation rejects candidate replacement of the canonical policy", () => {
  const root = path.resolve(__dirname, "..");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "parity-policy-"));
  const contract = JSON.parse(
    fs.readFileSync(path.join(root, "config/parity/contract.json"), "utf8"),
  );
  contract.jobs = [
    {
      id: "everything",
      title: "Everything",
      matches: {
        api: [".*"],
        mcp: [".*"],
        cli: [".*"],
        ai_chat: [".*"],
        hyperai: [".*"],
      },
    },
  ];
  const candidateContract = path.join(temporary, "contract.json");
  fs.writeFileSync(candidateContract, JSON.stringify(contract));
  const result = spawnSync(
    process.execPath,
    [
      "scripts/parity-contract.mjs",
      "--validate-only",
      "--contract",
      "config/parity/contract.json",
      "--baseline",
      "config/parity/generated-inventory.json",
      "--candidate-contract",
      candidateContract,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Trusted parity policy evolution failed/);
});

test("trusted validation permits only the CLI package selected by the trusted runner", () => {
  const root = path.resolve(__dirname, "..");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "parity-cli-version-"));
  const contract = JSON.parse(
    fs.readFileSync(path.join(root, "config/parity/contract.json"), "utf8"),
  );
  contract.cliPackage.version = "99.0.0";
  const candidateContract = path.join(temporary, "contract.json");
  fs.writeFileSync(candidateContract, JSON.stringify(contract));

  const allowed = spawnSync(
    process.execPath,
    [
      "scripts/parity-contract.mjs",
      "--validate-only",
      "--contract",
      "config/parity/contract.json",
      "--baseline",
      "config/parity/generated-inventory.json",
      "--candidate-contract",
      candidateContract,
      "--trusted-cli-package",
      contract.cliPackage.name,
      "--trusted-cli-version",
      contract.cliPackage.version,
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(allowed.status, 0, `${allowed.stdout}\n${allowed.stderr}`);

  const rejected = spawnSync(
    process.execPath,
    [
      "scripts/parity-contract.mjs",
      "--validate-only",
      "--contract",
      "config/parity/contract.json",
      "--baseline",
      "config/parity/generated-inventory.json",
      "--candidate-contract",
      candidateContract,
      "--trusted-cli-package",
      contract.cliPackage.name,
      "--trusted-cli-version",
      "98.0.0",
    ],
    { cwd: root, encoding: "utf8" },
  );
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /CLI package must match the trusted runner/);
});
