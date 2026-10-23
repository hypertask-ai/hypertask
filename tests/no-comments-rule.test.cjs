const assert = require("node:assert/strict");
const test = require("node:test");
const { resolve } = require("node:path");
const { Linter, ESLint } = require("eslint");
const parser = require("@typescript-eslint/parser");
const root = resolve(__dirname, "..");
const rulePromise = import("../eslint-local-rules/no-comments.mjs");

async function lint(code, filename = "src/Test.tsx") {
  const { noCommentsLintConfig } = await rulePromise;
  return new Linter({ cwd: root }).verify(code, [{
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: { parser, parserOptions: { ecmaFeatures: { jsx: true } } },
  }, {
    ...noCommentsLintConfig,
    linterOptions: { reportUnusedDisableDirectives: "off" },
  }], { filename: resolve(root, filename), allowInlineConfig: false });
}

test("reports line, block, trailing, JSX and plain JSDoc comments with the actionable message", async () => {
  for (const code of [
    "// Explain the implementation\nconst value = 1;",
    "/* Explain the implementation */\nconst value = 1;",
    "const value = 1; // Explain the implementation",
    "const value = <div>{/* Explain the implementation */}</div>;",
    "/** Explain the implementation. @see otherCode */\nconst value = 1;",
    "/** @param value Explanatory TS documentation */\nfunction run(value: string) {}",
  ]) {
    const messages = await lint(code);
    assert.equal(messages.length, 1, code);
    assert.equal(messages[0].ruleId, "local/no-comments");
    assert.equal(messages[0].message, "Code comments are not allowed (YPER4-379). Say it in code instead: a clearer name, a smaller function, or an assertion or log message. Allowed: eslint-disable, @ts-expect-error <reason>, tool pragmas, JSDoc @deprecated/@type.");
  }
});

test("allows every tool directive and pragma, including directive reasons", async () => {
  for (const comment of [
    "// eslint-disable", "// eslint-disable-next-line no-console", "// eslint-disable-line -- needed by test",
    "/* eslint-enable no-console */", "/* eslint-disable -- external API */",
    "// @ts-expect-error third-party declaration omits the property", "// @ts-expect-error: bad upstream types",
    "/* @ts-expect-error reason */", "// @ts-nocheck", "// @ts-check",
    '/// <reference types="node" />',
    '/* webpackChunkName: "chunk" */', "/* webpackIgnore: true */", "/* webpackPrefetch: true */",
    "/* webpackPreload: true */", '/* webpackMode: "lazy" */', "/* turbopackIgnore: true */",
    "/* @vite-ignore */", "/*#__PURE__*/", "/* @__PURE__ */", "/*#__NO_SIDE_EFFECTS__*/",
    "/* @jsxImportSource react */", "/* @jsx h */", "// prettier-ignore",
    "/* istanbul ignore next */", "/* c8 ignore next */", "/* v8 ignore next */",
    "// @vitest-environment jsdom", "// @jest-environment jsdom", "// @refresh reset",
    "/** @jest-environment jsdom */", "/**\n * @vitest-environment happy-dom\n */", "/** @jsxImportSource react */",
    "//# sourceMappingURL=file.js.map", "// biome-ignore lint: reason", "// trufflehog:ignore",
    "// @generated", "/* DO NOT EDIT */",
  ]) assert.deepEqual(await lint(`${comment}\nconst value = 1;`), [], comment);
  assert.deepEqual(await lint("#!/usr/bin/env node\nconst value = 1;", "src/cli.js"), []);
});

test("allows whole JSDoc blocks only when a tool reads their tags", async () => {
  for (const tag of ["deprecated", "type", "typedef", "template", "satisfies", "overload"]) {
    assert.deepEqual(await lint(`/** Prose remains.\n * @${tag} {string} value\n */\nconst value = 1;`), [], tag);
    assert.equal((await lint(`/* @${tag} {string} value */\nconst value = 1;`)).length, 1, tag);
  }
  for (const extension of ["js", "mjs", "cjs"]) {
    for (const tag of ["param", "returns", "property", "callback"]) {
      assert.deepEqual(await lint(`/** Description. @${tag} {string} value */\nconst value = 1;`, `src/Test.${extension}`), [], `${extension}:${tag}`);
    }
  }
  for (const extension of ["ts", "tsx", "jsx"]) {
    assert.equal((await lint("/** @returns {string} value */\nconst value = 1;", `src/Test.${extension}`)).length, 1);
  }
});

test("rejects ts-ignore and expect-error without a reason", async () => {
  for (const comment of ["// @ts-expect-error", "/* @ts-expect-error */", "// @ts-expect-error:   ", "// @ts-expect-error\n", "// @ts-ignore", "// @ts-ignore legacy reason"]) {
    const messages = await lint(`${comment}\nconst value = 1;`);
    assert.equal(messages.length, 1, comment);
    if (comment.includes("@ts-ignore")) assert.match(messages[0].message, /Use @ts-expect-error with a reason, or fix the type/);
  }
  for (const comment of ["// eslint-disabled", "// @ts-expect-errors reason", "/* @jsxFake h */", "// explanation mentioning prettier-ignore"]) {
    assert.equal((await lint(`${comment}\nconst value = 1;`)).length, 1, comment);
  }
});

test("ignores generated filenames and first-comment markers, not a later marker", async () => {
  assert.deepEqual(await lint("// Explanation\nconst value = 1;", "src/Test.generated.ts"), []);
  for (const marker of ["@generated", "DO NOT EDIT"]) {
    assert.deepEqual(await lint(`/* ${marker} */\n// Explanation\nconst value = 1;`), []);
    assert.equal((await lint(`// Explanation\n/* ${marker} */\nconst value = 1;`)).length, 1);
  }
});

test("real config enables enforcement and unused directives only in source files", async () => {
  const eslint = new ESLint({ cwd: root });
  for (const extension of ["ts", "tsx", "js", "jsx", "mjs", "cjs"]) {
    const config = await eslint.calculateConfigForFile(`src/Test.${extension}`);
    assert.equal(config.rules["local/no-comments"][0], 2);
    assert.equal(config.linterOptions.reportUnusedDisableDirectives, 2);
  }
  for (const filename of ["tests/Test.test.cjs", "scripts/Test.mjs", "src/Test.generated.ts"]) {
    const config = await eslint.calculateConfigForFile(filename);
    assert.equal(config.rules["local/no-comments"], undefined);
    assert.equal(config.linterOptions.reportUnusedDisableDirectives, 0);
  }
});
