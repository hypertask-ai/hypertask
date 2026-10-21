# Agent board scope guard

Run from an installed checkout with Semgrep 1.140.0 on PATH:

```sh
python3.12 -m venv "$RUNNER_TEMP/agent-scope-venv"
export PATH="$RUNNER_TEMP/agent-scope-venv/bin:$PATH"
python -m pip install --require-hashes -r .github/scripts/agent-scope/requirements.txt
python .github/scripts/agent-scope/run.py --self-test
python .github/scripts/agent-scope/run.py
```

`run.py` regenerates the AST authentication inventory, scans every agent-capable
entry file that names a `prisma.project`, `prisma.task` or `prisma.comment`
delegate (the only files the rule can match), then checks exceptions and debt. Output goes to a fresh temporary
directory, or `--output <directory>`. No generated inventory is committed.
Semgrep metrics and version checks are off; up to four scanner workers are used.
The lock is for Python 3.12. CI takes 3.12 from the runner tool cache, so the
`ubuntu-latest` move to Ubuntu 26.04 does not change it, and asserts the version.
Regenerate the lock explicitly with
`uv pip compile --generate-hashes --python-version 3.12 .github/scripts/agent-scope/requirements.in -o .github/scripts/agent-scope/requirements.txt`.
Review scanner/parser changes before upgrading.

## Coverage and limitations

**Direct `prisma.project/task/comment` calls in agent-capable entry files only**:
findMany, findFirst, findUnique, update, delete and count. Entries are Pages API
files, App Router route files and MCP operation files. The inventory follows
static references to authentication, conservatively including cookie sessions.
Reviewed incoming cron/signature/purpose-token boundaries are in `inventory.py`.
Malformed entries are conservatively agent-capable and TypeScript inventory
parse errors fail before scanning, even when Semgrep's parser recovers silently.
Semgrep parse errors, engine errors and missing scanned targets also fail closed.
Inline nosemgrep is disabled; no directory suppressions or file-wide query
exceptions are used.

This is a structural ratchet, not proof that all board access is scoped.
Transitive controllers, Prisma aliases/transactions, raw SQL, other delegates,
bulk/create/upsert methods and arbitrary nested relations are not checked.
Dynamic imports/references and novel authentication mechanisms need inventory
review. Syntactic inline helper calls are accepted without proving their binding,
agent argument or conjunctive placement. The scoped helpers are exactly
getProjectWhere, getProjectListingWhere, projectContentAccessWhere,
taskWriteAccessWhere and savedViewBoardAccessWhere. getTaskWhere is not scoped.
An unrelated helper elsewhere in a file never exempts another call.

## Reviewed exceptions versus debt

`agent-scope-exceptions.json` binds each reviewed call to its path, complete file
SHA-256, whitespace-normalized call and occurrence index. Every reason names the
dominating gate and authenticated actor provenance. Any edit to an excepted file
requires re-review, not automatic hash refresh. Reviewed patterns:

- Comments list (2 calls): authenticated ctx.agentId reaches findTaskByIdentifier;
  commentWhere is limited to the returned authorized task.
- Decisions by ID (2 calls): loadAccessibleDecisionRequest resolves its task with
  ctx.agentId before owner-field hydration. Answer rejects agents as well.
- Projects list (2 calls): where retains AND getProjectListingWhere(user.id, ctx.agentId).
- Tasks list (3 calls): identifier where retains the agent-aware project predicate;
  listing IDs come from the same predicate and requested boards must be included.
- Task search (4 calls): agent-scoped project IDs and project relation survive
  subsequent search restrictions and spread hydration.

These are rebound from reviewed handoff patterns, not approvals for other queries
in the same files. The rejected cancelInvite proposal is debt, not an exception.
All uncertain findings remain in `agent-scope-baseline.json`, not exceptions.
Debt binds path, normalized call and occurrence, so unrelated edits stay green.
Each entry records follow-up ticket, owner, expiry and approval. Expired debt,
stale debt/exceptions, overlaps and any unlisted finding fail. Counts of findings,
excepted, debt and new calls are printed on every completed scan.

`baseline-approval.mjs` compares against the fetched PR BASE_SHA. Every added or
changed debt entry requires a full ticket URL in approvedIn and the PR body line
`Agent scope debt approved: <URL>`. Exceptions use
`Agent scope exception approved: <URL>`. Initial creation and removals are free.

Fixtures use `.ts.fixture`, not `.ts` or `.tsx`, because tsconfig includes those
extensions repository-wide and ESLint does not ignore .github by default. They
are outside the src inventory and run only through `run.py --self-test`, using
the same inventory, scanner and ratchet checker as the real scan.
