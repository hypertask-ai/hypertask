import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const FUNDING_MODULE_PATH = "src/app/api/ai/_lib/aiFunding.ts";
const PROVIDER_CLIENT_FACTORIES = new Set([
  "createGateway",
  "createAnthropic",
  "createOpenAI",
  "createOpenRouter",
]);

function normalizePath(filename) {
  return String(filename ?? "").replace(/\\/g, "/");
}

function isFundingModule(filename) {
  const normalized = normalizePath(filename);
  return (
    normalized === FUNDING_MODULE_PATH ||
    normalized.endsWith(`/${FUNDING_MODULE_PATH}`)
  );
}

const noDirectProviderClients = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Create AI SDK provider clients only inside src/app/api/ai/_lib/aiFunding.ts",
    },
    schema: [],
    messages: {
      forbiddenClient:
        "Do not import or call {{name}} outside src/app/api/ai/_lib/aiFunding.ts. Use the funding module (src/app/api/ai/_lib/aiFunding.ts) so every AI call follows the single funding table.",
    },
  },
  create(context) {
    if (isFundingModule(context.filename)) return {};
    return {
      ImportSpecifier(node) {
        const imported =
          node.imported?.type === "Identifier" ? node.imported.name : "";
        if (!PROVIDER_CLIENT_FACTORIES.has(imported)) return;
        context.report({
          node,
          messageId: "forbiddenClient",
          data: { name: imported },
        });
      },
      CallExpression(node) {
        let name = "";
        if (node.callee.type === "Identifier") {
          name = node.callee.name;
        } else if (
          node.callee.type === "MemberExpression" &&
          !node.callee.computed &&
          node.callee.property.type === "Identifier"
        ) {
          name = node.callee.property.name;
        }
        if (!PROVIDER_CLIENT_FACTORIES.has(name)) return;
        context.report({
          node,
          messageId: "forbiddenClient",
          data: { name },
        });
      },
    };
  },
};

export const aiFundingProviderClientsPlugin = {
  meta: {
    name: "hypertask-ai-funding",
    version: createHash("sha256")
      .update(readFileSync(new URL(import.meta.url)))
      .digest("hex"),
  },
  rules: {
    "no-direct-provider-clients": noDirectProviderClients,
  },
};

export const aiFundingProviderClientsLintConfig = {
  files: ["src/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
  ignores: ["**/*.generated.ts"],
  plugins: { "ai-funding": aiFundingProviderClientsPlugin },
  rules: {
    "ai-funding/no-direct-provider-clients": "error",
  },
};

export default aiFundingProviderClientsLintConfig;
