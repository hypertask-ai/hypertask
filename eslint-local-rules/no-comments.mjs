import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const checkJsTags = /^\/\*\*[\s\S]*?@(param|returns|property|callback)\b/;

export const allowedCommentPatterns = [
  /^\/[/\*]\s*eslint-(?:disable-next-line|disable-line|disable|enable)\b/,
  /^\/[/\*]\s*@ts-expect-error(?:[ \t]+:?[ \t]*|:[ \t]*)(?=[^\s*:])[^\r\n]+/,
  /^\/[/\*]\s*@ts-(?:nocheck|check)\b/,
  /^\/\/\/\s*<reference\b[^>]*>/,
  /^\/[/\*]\s*(?:webpackChunkName|webpackIgnore|webpackPrefetch|webpackPreload|webpackMode|turbopackIgnore)\b/,
  /^\/[/\*]\s*(?:@vite-ignore|[\#@]__PURE__|\#__NO_SIDE_EFFECTS__)\b/,
  /^\/[/\*]\*?\s*(?:\*\s*)?@(?:jsxImportSource|jsx)\b/,
  /^\/[/\*]\s*(?:prettier-ignore|istanbul ignore|c8 ignore|v8 ignore|biome-ignore|trufflehog:ignore)\b/,
  /^\/[/\*]\*?\s*(?:\*\s*)?@(?:vitest-environment|jest-environment|refresh reset)\b/,
  /^\/[/\*]\s*#\s*sourceMappingURL\s*=/,
  /^\/\*\*[\s\S]*?@(?:deprecated|type|typedef|template|satisfies|overload)\b/,
  checkJsTags,
  /(?:@generated\b|DO NOT EDIT)/,
  /^#!/,
];

export function isGeneratedFile(filename, comments) {
  return filename.endsWith(".generated.ts") || /(?:@generated\b|DO NOT EDIT)/.test(comments[0]?.value ?? "");
}

export function isAllowedComment(comment, filename, source) {
  const text = source.slice(...comment.range);
  if (/^\/[/\*]\s*@ts-ignore\b/.test(text)) return false;
  return allowedCommentPatterns.some((pattern) =>
    (pattern !== checkJsTags || /\.(?:js|mjs|cjs)$/.test(filename)) && pattern.test(text),
  );
}

const noComments = {
  meta: {
    type: "problem",
    docs: { description: "Allow only tool-read comments in source files" },
    schema: [],
    messages: {
      comment: "Code comments are not allowed (YPER4-379). Say it in code instead: a clearer name, a smaller function, or an assertion or log message. Allowed: eslint-disable, @ts-expect-error <reason>, tool pragmas, JSDoc @deprecated/@type.",
      tsIgnore: "Use @ts-expect-error with a reason, or fix the type (YPER4-379).",
    },
  },
  create(context) {
    const source = context.sourceCode;
    return {
      Program() {
        const comments = source.getAllComments();
        if (isGeneratedFile(context.filename, comments)) return;
        for (const comment of comments) {
          if (isAllowedComment(comment, context.filename, source.text)) continue;
          context.report({
            loc: comment.loc,
            messageId: /^\/[/\*]\s*@ts-ignore\b/.test(source.getText(comment)) ? "tsIgnore" : "comment",
          });
        }
      },
    };
  },
};

export const noCommentsPlugin = {
  meta: {
    name: "hypertask-no-comments",
    version: createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex"),
  },
  rules: { "no-comments": noComments },
};

export const noCommentsLintConfig = {
  files: ["src/**/*.{ts,tsx,js,jsx,mjs,cjs}"],
  ignores: ["**/*.generated.ts"],
  plugins: { local: noCommentsPlugin },
  rules: { "local/no-comments": "error" },
  linterOptions: { reportUnusedDisableDirectives: "error" },
};

export default noCommentsLintConfig;
