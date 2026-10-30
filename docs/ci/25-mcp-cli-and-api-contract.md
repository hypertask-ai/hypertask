## MCP, CLI and API contract

`mcp-cli-api-contract` is a separately reported, fail-closed summary of a contract executed inside
`browser-smoke`. It is not in the ruleset itself: it blocks merges because the contract step runs
inside the required `browser-smoke` job, so a failing contract fails that job. It uses the disposable server before any layout flag reseed. The owner,
team member, accepted external board guest, owner-created write agent and ordinary
OAuth client exercise catalog discovery, keyword search, task/comment/column writes
and readbacks, labels and pages. A read-role agent remains readable but cannot write;
an unaccepted board invitation grants no access. Search uses local fixture rows, not
production ranking or embeddings.

The existing pinned native CLI release is checksum verified, runs with isolated HOME
and a child-only bearer, and checks boards, task reads, creation, comments and column
moves against REST readbacks. Its TCP destinations are traced and must remain on the
local app. Missing output, failed, skipped or cancelled browser smoke fails the summary.
The sole no-contract exception is a successful docs-only browser job with an explicit
`docs_only=true` scope output; it does not claim the contract executed.
Activate the new production ruleset context in coordination with this policy update:
The hourly `Required Check Settings` monitor compares the live ruleset's exact
context set against the workflow expectation. This change does not modify that ruleset.
