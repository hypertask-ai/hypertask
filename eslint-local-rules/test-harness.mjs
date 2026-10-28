import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselineText = readFileSync(new URL("./test-harness-baseline.json", import.meta.url), "utf8");
const baseline = JSON.parse(baselineText);
const property = node => node.computed ? node.property.value : node.property.name;
const member = (node, name) => node?.type === "MemberExpression" && property(node) === name;
const rule = {
  meta: {
    type: "problem", schema: [],
    messages: { duplicate: "Use loadModule/stubModule/findElement from tests/helpers/loadModule.cjs instead of defining a test harness. Existing allowance must shrink after migration." },
  },
  create(context) {
    const nodes = [];
    return {
      MemberExpression(node) {
        if (member(node, "_load") || member(node, "transpileModule")) nodes.push(node);
        if (node.object?.type === "MemberExpression" && member(node.object, "cache") && node.object.object.name === "require"
          && ((node.parent.type === "AssignmentExpression" && node.parent.left === node) || node.parent.type === "UpdateExpression" || node.parent.operator === "delete")) nodes.push(node);
      },
      VariableDeclarator(node) {
        if (node.id.type === "ObjectPattern") {
          for (const field of node.id.properties) if (["transpileModule", "_load"].includes(field.key?.name)) nodes.push(field);
        }
        if (node.id.name === "findElement" && ["ArrowFunctionExpression", "FunctionExpression"].includes(node.init?.type)) nodes.push(node);
      },
      FunctionDeclaration(node) {
        if (node.id?.name === "findElement") nodes.push(node);
      },
      "Program:exit"() {
        const filename = path.relative(root, context.filename).split(path.sep).join("/");
        const allowance = baseline[filename] ?? 0;
        for (const node of nodes.sort((a, b) => a.range[0] - b.range[0]).slice(allowance)) context.report({ node, messageId: "duplicate" });
      },
    };
  },
};

export const testHarnessLintConfig = {
  files: ["tests/**/*.{js,cjs,mjs,ts,tsx}"],
  ignores: ["tests/helpers/loadModule.cjs"],
  plugins: { "hypertask-tests": {
    meta: { name: "hypertask-tests", version: createHash("sha256").update(readFileSync(new URL(import.meta.url))).update(baselineText).digest("hex") },
    rules: { "no-new-harness": rule },
  } },
  rules: { "hypertask-tests/no-new-harness": "error" },
};
