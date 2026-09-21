const routeMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);
const wrappers = new Set(["withAuth", "withoutAuth"]);

function calleeName(node) {
  return node?.type === "CallExpression" && node.callee.type === "Identifier"
    ? node.callee.name
    : undefined;
}

function isWrapped(node) {
  return wrappers.has(calleeName(node));
}

const requireRouteWrapper = {
  meta: {
    type: "problem",
    docs: { description: "Require every API route export to declare its auth policy" },
    schema: [],
    messages: {
      unwrapped: "Wrap exported API handlers with withAuth() or withoutAuth().",
    },
  },
  create(context) {
    const filename = context.filename.replaceAll("\\", "/");
    const isAppRoute = /\/src\/app\/.+\/route\.[jt]sx?$/.test(filename);
    const isPagesRoute = /\/src\/pages\/api\/.+\.[jt]sx?$/.test(filename);
    if (!isAppRoute && !isPagesRoute) return {};

    return {
      ExportNamedDeclaration(node) {
        if (!isAppRoute) return;
        if (!node.declaration) {
          for (const specifier of node.specifiers) {
            if (specifier.exported.type === "Identifier" && routeMethods.has(specifier.exported.name)) {
              context.report({ node: specifier, messageId: "unwrapped" });
            }
          }
          return;
        }
        if (
          node.declaration.type === "FunctionDeclaration" &&
          routeMethods.has(node.declaration.id?.name)
        ) {
          context.report({ node: node.declaration, messageId: "unwrapped" });
          return;
        }
        if (node.declaration.type !== "VariableDeclaration") return;
        for (const declaration of node.declaration.declarations) {
          if (
            declaration.id.type === "Identifier" &&
            routeMethods.has(declaration.id.name) &&
            !isWrapped(declaration.init)
          ) {
            context.report({ node: declaration, messageId: "unwrapped" });
          }
        }
      },
      ExportDefaultDeclaration(node) {
        if (isPagesRoute && !isWrapped(node.declaration)) {
          context.report({ node, messageId: "unwrapped" });
        }
      },
    };
  },
};

export const apiConventionsPlugin = {
  meta: { name: "hypertask-api-conventions", version: "1.0.0" },
  rules: { "require-route-wrapper": requireRouteWrapper },
};

export const apiConventionsLintConfig = {
  files: ["src/app/**/route.{ts,tsx}", "src/pages/api/**/*.{ts,tsx}"],
  plugins: { "hypertask-api": apiConventionsPlugin },
  rules: { "hypertask-api/require-route-wrapper": "error" },
};
