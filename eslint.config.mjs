import { defineConfig } from "eslint/config";
import { fixupConfigRules } from "@eslint/compat";
import tsParser from "@typescript-eslint/parser";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import { styleGuideRuleRegistrationConfig } from "./eslint-local-rules/style-guide.mjs";
import { apiConventionsLintConfig } from "./eslint-local-rules/api-conventions.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// eslint-config-next still ships ESLint 9-era plugins (react, jsx-a11y, import)
// whose rules call context.getFilename(). ESLint 10 removed those methods.
const nextConfigs = fixupConfigRules(nextCoreWebVitals);

export default defineConfig([
  {
    // Generated build artifacts (service worker, etc.) — never hand-authored, not lint targets.
    ignores: [".next/**", "public/workbox-*.js", "public/sw.js", "public/service-worker.js"],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "off",
    },
  },
  ...nextConfigs,
  {
    // Next's bundled Babel parser has no ScopeManager#addGlobals, which
    // ESLint 10 calls during SourceCode.finalize. typescript-eslint 8.56+
    // implements that method, so use it for JS as well as TS.
    languageOptions: {
      parser: tsParser,
    },
  },
  // YPER4-5 enables the exported rule set after it adds suppressions for existing violations.
  styleGuideRuleRegistrationConfig,
  apiConventionsLintConfig,
  {
    files: ["src/**/*.{js,jsx,ts,tsx,mjs,cjs}"],
    ignores: ["src/lib/env.ts", "src/lib/logger.ts"],
    rules: {
      "no-console": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message: 'Read environment variables through "@/lib/env".',
        },
      ],
    },
  },
  {
    // HTPR-6160: "@/lib/flags" reaches ioredis through getSessionUser, so a browser
    // component importing it breaks the production build with `Can't resolve 'tls'`.
    files: ["src/components/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}", "src/app/**/*.tsx"],
    // The one server-rendered page that reads a flag directly. Exempt this file,
    // not every page.tsx: a page carrying "use client" is a browser bundle too.
    ignores: [
      "src/app/admin/flags/page.tsx",
      // HTPR-4857: server component; gates the public /add-to-slack page.
      "src/app/add-to-slack/page.tsx",
      // HTPR-6536: server component; gates the public /qa/login page.
      "src/app/qa/login/page.tsx",
    ],
    rules: {
      // Types are erased, so a type-only import never reaches the bundle.
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/lib/flags",
              message:
                'Import flag keys from "@/lib/flags/keys". "@/lib/flags" is server-only.',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  {
    plugins: { "react-hooks": nextConfigs[0].plugins["react-hooks"] },
    rules: {
      // eslint-config-next 16 pulls in eslint-plugin-react-hooks' new React
      // Compiler readiness rules, which flag hundreds of pre-existing patterns across
      // the codebase unrelated to the Next 16 / React 19 upgrade (HTPR-3958).
      // Disabled so `eslint .` stays green on this migration; keep the
      // cleanup tracked separately rather than folding it into this upgrade.
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/globals": "off",
      "react-hooks/static-components": "off",
      "react-hooks/error-boundaries": "off",
      "@next/next/no-img-element": "off",
      "jsx-a11y/role-supports-aria-props": "off",
    },
  },
]);
