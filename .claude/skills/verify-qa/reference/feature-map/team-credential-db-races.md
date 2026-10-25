# Team credential database races

## How a customer reaches it

The CI Tests check runs `tests/htpr-7660-team-races-postgres.test.cjs`. These are infrastructure checks, not a new screen. They load the real report/view/page services, lease routes, attachment persistence and webhook delivery/retry functions against disposable PostgreSQL.

## How to drive it

1. Open the ticket PR's CI Tests run. Require the current head SHA, successful `ci-tests`, and all 62 `real PG` cases passing without skips. Local runs intentionally skip database provisioning; they are not concurrency proof.
2. Read the shard log, not only the aggregate check. Move-first cases commit a task/page/board move before the final transaction guard. Write-first cases attempt the actual `teamId`/`projectId` update from another connection while the protected row remains locked; PostgreSQL must return SQLSTATE 55P03. The move must succeed after commit.
3. Require bound same-team and unbound controls, lease heartbeat/expiry advancement, no denied report/view/page/lease/upload side effects, and upload reconciliation after a lost commit acknowledgement.
4. Require delayed board and agent sends to cancel after a team move. Retries must also refuse a formerly delivered source after movement, not only an already cancelled source.
5. After merge, require successful Production deployment. Use QA 985 for signed-in My Tasks screenshots and the core inbox cycle. Use the runner's own agent for read-only MCP task lookup. Never reproduce destructive team moves against production or preview databases.

## What usually breaks

- Faked lock traces or skipped database cases mistaken for PostgreSQL proof.
- Updating a primary key in the lock probe instead of the actual ownership column.
- Existing lease values mistaken for a successful heartbeat.
- A cancelled delivery mistaken for retry scope revalidation.
- The attachment batch's outer HTTP 500 hiding its transaction guard's 404. Assert the real guard rejection and persisted rows separately.

## What proof to collect

Record exact-head CI metadata and the shard's 62 results, then deployment SHA/state, signed-in QA 985 desktop/phone shots, video, read-only MCP results, and core inbox evidence. Race tests run only in the disposable CI database; live evidence checks unchanged app paths, not destructive races. These cases do not claim hierarchy-wide serializability after a child's final read: parent-board moves are covered before that guard, and lock contention is proven on the locked row itself.

### Automated evidence

CI: `HT_REQUIRE_PG_TESTS=1 npm run test:file -- tests/htpr-7660-team-races-postgres.test.cjs`. Uses the existing pinned PostgreSQL image and shared TypeScript loader; no production database URL, live storage or webhook receiver is used.

## Cleanup

The suite disconnects Prisma and removes only its uniquely named PostgreSQL container. Live read-only MCP checks create nothing. The core inbox recipe owns its own QA Sandbox fixtures; follow its cleanup. Keep reports outside the worktree.
