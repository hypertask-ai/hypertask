import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselineText = readFileSync(new URL("./flag-stubs-baseline.json", import.meta.url), "utf8");
const baseline = JSON.parse(baselineText);
const HELPER = "tests/helpers/flags.ts (stubFlags)";
const keyName = (node) => node.computed ? node.key.value : node.key.name ?? node.key.value;
const mockCall = (node) =>
  node?.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  ["vi", "jest"].includes(node.callee.object?.name) &&
  (node.callee.computed ? node.callee.property.value : node.callee.property.name) === "mock" &&
  ["@/lib/flags", "@/lib/flags/definitions"].includes(node.arguments[0]?.value);

const handMadeList = {
  meta: {
    type: "problem",
    schema: [],
    messages: { handMade: `Use ${HELPER} instead of a hand-made flag list. A new flag then needs no test edit, and a renamed key fails loudly.` },
  },
  create(context) {
    const nodes = [];
    return {
      Property(node) {
        if (keyName(node) !== "FEATURE_FLAG_DEFINITIONS" || node.value.type !== "ArrayExpression") return;
        if (node.value.elements.some((element) => element?.type === "ObjectExpression")) nodes.push(node);
      },
      "Program:exit"() {
        const filename = path.relative(root, context.filename).split(path.sep).join("/");
        const allowance = baseline[filename] ?? 0;
        for (const node of nodes.slice(allowance)) context.report({ node, messageId: "handMade" });
      },
    };
  },
};

const flagModuleMock = {
  meta: {
    type: "problem",
    schema: [],
    messages: { mock: `Use ${HELPER} instead of mocking src/lib/flags by hand.` },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (mockCall(node)) context.report({ node, messageId: "mock" });
      },
    };
  },
};

export const flagStubsLintConfig = {
  files: ["tests/**/*.{js,cjs,mjs,ts,tsx}"],
  ignores: ["tests/helpers/flags.ts"],
  plugins: { "hypertask-flags": {
    meta: { name: "hypertask-flags", version: createHash("sha256").update(readFileSync(new URL(import.meta.url))).update(baselineText).digest("hex") },
    rules: { "no-hand-made-flag-list": handMadeList, "no-flag-module-mock": flagModuleMock },
  } },
  rules: { "hypertask-flags/no-hand-made-flag-list": "error", "hypertask-flags/no-flag-module-mock": "error" },
};
