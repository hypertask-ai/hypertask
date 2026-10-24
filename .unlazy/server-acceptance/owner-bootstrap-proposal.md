# Owner-approved template binding

The reusable path is a project template plus an explicit semantic requirement receipt for each eligible task. A frozen current-ticket manifest may assist bootstrap, but it is not the long-term policy.

The owner approves immutable template versions through a cookie-authenticated product route. The route verifies the actual session and project ownership, requires a same-origin request, and ignores body-supplied identities. No owner credential is copied to the worker host. Template criteria retain mandatory implementation, tests and independent QA. Existing criterion IDs, kinds, phases and descriptions cannot be removed or weakened by a new version.

The same owner route records versioned explicit semantic criteria against the exact task revision. It does not infer approval from existing mutable acceptance text. Owner UI integration can record this receipt when the owner saves acceptance criteria through the normal task workflow. That UI integration is a separate slice. Future eligible tasks use the same binding path as existing ones. Missing semantics remain unmet and require a decision; no generic template substitutes for the product outcome.

An enrolled worker can request binding by project/task identity only. Server code chooses the latest approved template and semantic receipt. It copies their exact criteria into an append-only contract, retaining approval provenance. The caller cannot submit criteria, choose an older version, or approve its own evidence. Template/source updates invalidate outstanding grants and requests. Guard checks reject stale bindings even if a prior grant exists. Consumed receipts remain historical proof.

This slice adds template/semantic receipt persistence, the owner-session API, binding through the existing dynamic factory MCP route, and behavioral/authorization regressions. It does not activate enrollment, run a product migration, implement owner UI, or create an evidence authority.

The host account has unrestricted passwordless sudo. Local users and root-owned files cannot isolate a grant credential. Activation requires deterministic server-side evidence verification with trusted producers, or a verified provider sandbox that also protects privileged host credentials. Current host QA statements do not become independent evidence merely by signing them.

## Implemented request contract

Owner GET `/api/factory/policy?project_id=N&task_id=T` returns current template, semantic receipt and task identity/revision/scopeDigest. POST on that route requires the real owner cookie session and matching Origin. Authorization bearer headers are rejected. The UI itself remains unimplemented.

- `operation: template`: project_id, expected_version and explicit policy.* criteria. Implementation and tests must be pre_qa; independent_qa must be final.
- `operation: requirements`: project_id, task_id, expected_version, expected_task_revision, expected_scope_digest and explicit scope.* criteria. A never-edited task may have a null task revision. Process-only criteria cannot replace semantic product outcomes.
- MCP `POST /api/mcp/factory/bind`: project_id and task_id only. No caller-selected versions or criteria. The latest owner-approved template and receipt are selected on the server. Missing approval remains unmet.

Receipts bind the canonical description relation, title, acceptanceCriteria and verifyCommand. Owner approval must match both the task timestamp and scope digest. That catches description changes which do not update the task timestamp. Approved workers cannot rewrite the title or description; they can put implementation updates in comments. Owner changes to scope invalidate the binding until the owner records a new receipt.

Status adds template, semanticReceipt and binding with ready/unmet plus a structured reason. Template or semantic version changes invalidate unconsumed grants and supersede pending requests. Consumed receipts remain available as historical proof. Old per-ticket criteria survive template binding; the binder cannot remove or replace them.

The server still needs trusted evidence authority outside provider control. Before activation, verify that providers cannot obtain owner-session signing keys, authority credentials, trusted evidence producer keys or equivalent deployment privileges. The new cookie route establishes the application identity boundary; it does not remove the host's sudo privileges.
