## No comments in the GitHub scripts and workflows (HTPR-8937)

The rule "no explanatory code comments" was enforced by ESLint's
`local/no-comments` over `src`, `e2e`, `scripts`, `tests` and `.claude` only, so
`.github/scripts` and `.github/workflows` drifted: 645 narrative comments in 31 of
the 60 GitHub scripts and 976 comment lines in 30 of the 47 workflows, after a
reviewer had already caught the same thing by hand in seven pull requests.

The required `ci-tests` job now runs `scripts/check-no-comments.mjs` as its own
static lane, launched beside the board boundary gate so it also runs on a
workflow-only PR, where `ci-change-scope.cjs` deliberately keeps the build
skipped. It reuses the same rule and the same allowed tool markers as ESLint
(`eslint-local-rules/no-comments.mjs` via `scripts/strip-comments.mjs`), so a
shebang, an `eslint-disable` directive, `@ts-expect-error <reason>` and the
webpack/vite pragmas still pass. Every other file in scope is shell, Python,
workflow YAML or an extensionless executable with a shebang, which ESLint cannot
parse, so a line whose first non-space character is `#` is a comment there, with
the tool markers those languages need allowed: `yaml-language-server`,
`actionlint`, `yamllint`, `shellcheck`, `renovate:`, `zizmor:`, `gitleaks:`,
`prettier-ignore`, `nosemgrep`, `noqa`, `type:`, `pylint:`, `fmt:`, `isort:`,
`mypy:`, `pragma:` and `pyright:`.

Existing debt is grandfathered by exact per-file counts in
`.github/no-comments-baseline.json`, the same ratchet shape as the style-guide
baseline; the file is generated and never hand-edited. A file may keep the comments it already has; one more fails with
`Comment in <file>:<line>. Remove it and name the intent in code.` A new script or
workflow gets no allowance and fails on its first comment. Unused allowances do not
fail, so cleaning a file is safe, and `node scripts/check-no-comments.mjs
--write-baseline` shrinks the baseline to the current counts when that cleanup
lands. No new required check is added.
