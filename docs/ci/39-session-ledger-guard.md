## Session ledger guard (HYCI-16)

`ci-prepare` runs `node scripts/check-session-ledgers.mjs` as its second step, with no
`if:` and no new job. It reads the checkout and stops the run when a session ledger is in
the tree: `GATES.md`, `.unlazy-hook-state.json`, or any file under a `.unlazy` directory.
The offending paths are printed with the fix, and the step costs 0.12 s (`--rev HEAD`,
7,457 files). The PR budget stays at 17 jobs and no required context is added.

The step is unconditional because a ledger-only pull request is a documentation-shaped
diff, and every later step in that job is skipped for documentation-shaped diffs.

A ledger is private working state. Keep it outside the worktree, at
`~/.unlazy/ledgers/<ticket>/GATES.md`, and pass that path to the gate tools. Locally the
same check runs from `npm run check:session-ledgers`, and `npm run lint` and
`npm run lint:changed` run it through their existing `prelint` hooks. Files that only
resemble a ledger (`docs/feature-flag-and-ux-gates.md`, a `gates/` directory) stay
allowed, and `tests/session-ledger-guard.test.cjs` proves both directions plus a real
earlier commit that carried a ledger. The name match ignores case and depth, so a
lowercased `gates.md` in a package counts too: it is the same private file, and the error
says where to put it.
