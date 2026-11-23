VERDICT: PASS

Reviewed PR #3818 (`boss-9625/agents-join-boards`) full diff against `production` (14 files, +388 / −18). Scope: agent self-join to boards behind `htpr-9625-agents-join-boards`.

| Area | Status | file:line | reason |
|------|--------|-----------|--------|
| Join board in another team | PASS | src/lib/mcp/agents/selfJoin.ts:46-47 | Each target board must share the agent’s derived `homeTeamId`; cross-team IDs refuse before write. |
| Join board owner cannot open | PASS | src/lib/mcp/agents/selfJoin.ts:49-54 | Owner must be board owner or a human member, then `isProjectAdmin`; invisible boards never reach `ok: true`. |
| Join private / non-member board agent should not reach | PASS | src/lib/mcp/agents/lifecycleRequests.ts:229, src/lib/mcp/agents/updateBoards.ts:238-265 | Self-join uses `getAccessibleAgentBoard` without acting-agent scope; transaction re-checks owner/admin admin-bit. |
| Change another agent’s access without admin | PASS | src/lib/mcp/agents/delegatedAccess.ts:41-42 | Non-self `targetAgentId` still requires `requireRole(ctx, 'admin')`; unchanged delegation path. |
| Self-add via MCP `invite_member` bypass | PASS | src/lib/ai/tools/projectAdmin.ts:167-170, src/lib/mcp/agents/delegatedAccess.ts:81-90 | Even when delegation clears, `assertAgentBoardInviteScope` requires the acting agent to already be on the board. |
| Refusal leaks board title or team across teams | PASS | src/lib/mcp/agents/delegatedAccess.ts:11-12, tests/htpr-9625-agents-join-boards.test.cjs:137-139 | Safe messages are numeric `project_id` + CLI hint only; tests assert refusal text omits team slugs. |
| Refusal oracle for foreign-board existence | PASS | src/lib/mcp/agents/selfJoin.ts:13-17,46-54 | Cross-team, invisible, non-admin, missing project, and flag-off paths share the same `selfBoardAccessRefusal` shape for the client-supplied id. |
| Flag off access control | PASS | src/lib/mcp/agents/selfJoin.ts:15-16, tests/htpr-9625-agents-join-boards.test.cjs:141-147 | Flag off denies before agent/board reads; membership unchanged. |
| Flag off behavior exactly (copy + contract) | FAIL | src/lib/mcp/agents/delegatedAccess.ts:11-12, tests/htpr-9625-agents-join-boards.test.cjs:141-147 | Deny outcome matches production; refusal text is the new `hypertask project invite` hint, not the legacy “cannot change its own board access” string (intentional per tests; not an auth bug). |
| Self-remove or mixed add/remove | PASS | src/lib/mcp/agents/delegatedAccess.ts:30-38 | Only add-only empty-remove batch can self-join; remove and mixed mutations stay forbidden. |
| TOCTOU after pre-check | PASS | src/lib/mcp/agents/updateBoards.ts:238-265, tests/htpr-9625-agents-join-boards.test.cjs:194-205 | Serializable transaction re-validates owner/admin before `createMany`; demotion mid-flight refuses with no write. |
| Still-allowed tests | PASS | tests/htpr-9625-agents-join-boards.test.cjs:172-191, tests/htpr-7576-invite-agent-rules.test.cjs:224-233 | Legitimate owner/admin self-join via PATCH; sibling/human invite paths still allowed where unchanged. |
| Refusal tests | PASS | tests/htpr-9625-agents-join-boards.test.cjs:141-171,207-219, tests/agent-access-delegation.test.ts:53-56 | Cross-team, invisible board, non-admin visible board, flag off, mixed ids, self-remove covered. |
| Flag metadata / harm scenario | PASS | src/lib/flags/definitions/htpr-9625-agents-join-boards.ts:5-18, tests/htpr-9625-flag.test.cjs:5-14 | `OWNER_AND_QA` default; release risk documents cross-team harm. |
| MCP safe error allowlist | PASS | src/lib/mcp-server/tool-response.ts:39-42 | New refusal patterns registered so clients get sanitized tool errors. |

Notes for consumers of #3818: flag-off is not wire-identical to pre-9625 refusal copy; security posture (no self-add when off) is preserved. Self-join is only through `PATCH` board membership when flag on; `invite_member` self-target remains blocked by existing invite scope.