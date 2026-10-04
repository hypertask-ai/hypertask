# MCP refactor slices [REFACTOR]

Ticket: https://app.hypertask.ai/detail/project-15/6478

## Section 1: shared execution done; validation consolidation remaining

- Removed the axios self-API client from the MCP tool execution path. Both the legacy and consolidated catalogs call the in-process operations under `src/lib/mcp/operations/`.
- The REST entry points retain their URLs, methods and route configuration, and export the same shared functions. Operation bodies, permission checks, JSON/status/error responses, idempotency and adopted mutation-lease cleanup are preserved without rewriting them.
- A request-local authenticated context carries the human principal, optional agent, runtime generation and management/team scope into each operation. It is not a token cache. Internal request identity, not an HTTP header, permits reuse; external REST requests still authenticate and rate-limit normally.
- Compound tools consume one rate-limit check, rather than authenticating and rate-limiting each self-HTTP subrequest. Management/data permissions and the management JWT audience/agent restrictions remain enforced by the existing helpers.
- Removed redundant full-schema validation from 35 thin tool entry points. Protocol schemas, CRUD action validation, service input adapters and shared operation/domain validators retain their existing contracts and error messages. Operation validation runs identically for REST and MCP callers.
- Frozen pre-refactor executor/tool fixtures prove byte-identical text, transformed inputs, idempotency headers and error messages for task get/list/create/update/comment, including attachment fan-out. Both catalogs and concurrent-principal isolation are covered with mocks.

The shared execution slice is complete, but absolute single-layer validation is not: service adapters and operation validators still overlap, and compound CRUD tools retain action-specific validation. Consolidating those schemas while preserving each caller's errors remains follow-up work; this slice does not claim that every input is parsed only once.

The mechanical extraction moves 77 operation modules and two helpers. Section 1 by itself exceeds the approximate 40-file budget; section 4 is deliberately not bundled. Source-based tests point at the extracted functions, with their behavioral assertions retained. The SDK, transport protocol, dependencies and `htpr-6804-mcp-tools` flag/catalog selection are unchanged.

## Section 2: remaining

Replace repeated REST scaffolding with one wrapper for rate limit, authentication, JSON parsing, error mapping and adopted mutation-lease cleanup. This slice preserves that scaffolding inside the extracted functions rather than changing REST contracts at the same time.

## Section 3: remaining

Review the current auth path before adding token-hash caching, bounded logging/throttling and scope derivation. Production already splits authentication into `src/lib/mcp/auth/{session,verifyJwt,rateLimit,mcpAuthErrors,types}.ts`; do not repeat the historical monolith split. Request-local context reuse in section 1 is not cross-request Redis caching or a revocation grace window.

## Section 4: remaining

Add destructive/read-only/idempotent annotations, cover both catalogs with scope-aware registration, wire the standards name check, and inspect OAuth discovery/CIMD support. Consolidated tools already have output schemas and structured content from https://app.hypertask.ai/detail/project-15/6804; retain those and address high-traffic legacy tools separately. Do not bump the SDK or transport packages in that slice. Re-test the bounded-body transport rebuild if a later dependency update changes them.

## Section 5: remaining

Simplify the large task-update pipeline, tool definition/import boilerplate, response serialization and shared priority typing. Evaluate independent-read concurrency, search over-fetch and batched board creation. Re-check current production before removing legacy permission shapes or comments.

## Section 6: remaining

Deleting the dead legacy MCP server is still needed, but this worktree cannot prove its current state and no other repository was touched. Inspect the legacy `hypertask-mcp` repository's actual CLI imports and deployment status first, then remove unused server entry points/tools/prompts/metadata, fix the README link and add its CI guard. The supported native CLI is in the separate `hypertask-ai/cli` repository; do not remove or extend it here.

## Local validation and limits

The parity, permissions, catalog and REST regression checks use mocks and do not write to a board or contact production. The unchanged eval suite also exercises 20 MCP and 20 native CLI operations against its disposable local fixture; its fixture adapter now replaces the in-process operation boundary instead of the deleted HTTP client. Full-project TypeScript currently has unrelated baseline diagnostics; the scoped check rejects new diagnostics and verifies every accepted dependency diagnostic comes from an unchanged baseline file. No live CLI smoke, deployment, push, PR or board mutation is performed in this slice.
