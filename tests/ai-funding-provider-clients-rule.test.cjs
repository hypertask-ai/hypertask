const assert = require("node:assert/strict");
const test = require("node:test");
const { resolve } = require("node:path");
const { Linter, ESLint } = require("eslint");
const parser = require("@typescript-eslint/parser");

const root = resolve(__dirname, "..");
const rulePromise = import("../eslint-local-rules/ai-funding-provider-clients.mjs");

async function lint(code, filename = "src/app/api/ai/_lib/someCaller.ts") {
  const { aiFundingProviderClientsLintConfig } = await rulePromise;
  return new Linter({ cwd: root }).verify(
    code,
    [
      {
        files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
        languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
      },
      aiFundingProviderClientsLintConfig,
    ],
    { filename: resolve(root, filename), allowInlineConfig: false },
  );
}

test("rejects importing or calling provider client factories outside aiFunding.ts and names aiFunding.ts", async () => {
  const cases = [
    ['import { createGateway } from "ai";\nconst g = createGateway({ apiKey: "vck_x" });', "createGateway"],
    ['import { createAnthropic } from "@ai-sdk/anthropic";\nconst a = createAnthropic({ apiKey: "sk-x" });', "createAnthropic"],
    ['import { createOpenAI } from "@ai-sdk/openai";\nconst o = createOpenAI({ apiKey: "sk-x" });', "createOpenAI"],
    ['import { createOpenRouter } from "@openrouter/ai-sdk-provider";\nconst r = createOpenRouter({ apiKey: "sk-x" });', "createOpenRouter"],
    ['const g = ai.createGateway({ apiKey: "vck_x" });', "createGateway"],
  ];

  for (const [code, factory] of cases) {
    const messages = await lint(code, "src/lib/ai/rogueCaller.ts");
    assert.ok(messages.length >= 1, `expected violation for ${factory}`);
    for (const message of messages) {
      assert.equal(message.ruleId, "ai-funding/no-direct-provider-clients");
      assert.match(message.message, /src\/app\/api\/ai\/_lib\/aiFunding\.ts/);
      assert.ok(message.message.includes(factory), message.message);
    }
  }
});

test("allows all four provider client factories inside src/app/api/ai/_lib/aiFunding.ts", async () => {
  const code = [
    'import { createGateway } from "ai";',
    'import { createAnthropic } from "@ai-sdk/anthropic";',
    'import { createOpenAI } from "@ai-sdk/openai";',
    'import { createOpenRouter } from "@openrouter/ai-sdk-provider";',
    'export const a = createGateway({ apiKey: "vck_x" });',
    'export const b = createAnthropic({ apiKey: "sk-x" });',
    'export const c = createOpenAI({ apiKey: "sk-x" });',
    'export const d = createOpenRouter({ apiKey: "sk-x" });',
  ].join("\n");
  const messages = await lint(code, "src/app/api/ai/_lib/aiFunding.ts");
  assert.deepEqual(messages, []);
});

test("real ESLint config enforces the rule on src/ files and passes on the real codebase files", async () => {
  const eslint = new ESLint({ cwd: root });
  const callerConfig = await eslint.calculateConfigForFile("src/app/api/ai/_lib/modelProvider.ts");
  assert.equal(callerConfig.rules["ai-funding/no-direct-provider-clients"][0], 2);

  const results = await eslint.lintFiles([
    "src/app/api/ai/_lib/aiFunding.ts",
    "src/app/api/ai/_lib/modelProvider.ts",
    "src/app/api/ai/_lib/editorAi.ts",
    "src/lib/ai/batch/gatewayBatch.ts",
    "src/lib/demo/generateDemoBoard.ts",
    "src/app/api/demo/chat/stream/route.ts",
  ]);
  for (const result of results) {
    const directClientErrors = result.messages.filter(
      (message) => message.ruleId === "ai-funding/no-direct-provider-clients",
    );
    assert.deepEqual(directClientErrors, [], result.filePath);
  }
});
