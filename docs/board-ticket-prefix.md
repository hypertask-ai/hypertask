# Board ticket prefixes

Feature: https://app.hypertask.ai/detail/project-15/6868

Flag: `htpr-6868-ticket-prefix`, default Owner + QA. Both controls and custom-prefix writes are gated. Existing board renames and automatic-prefix creation remain available with the flag off.

In Settings > Board > General, Ticket prefix appears above Board notifications. Board owners and existing board editors can change it. Enter or leaving the field saves it. The helper previews the typed prefix and explains that historical IDs still resolve. Errors use the existing toast.

The create-board dialog uses the existing name-field input for Ticket prefix. Its suggestion follows the automatic identifier generator until the user edits the prefix. A supplied prefix is uppercased and validated on the server. It must contain 2 to 5 letters or numbers, start with a letter, and be unique among non-deleted boards in that team. A conflict returns an error rather than silently changing the user's choice.

Prefix changes write an uppercase ProjectPrefixAlias, change the board prefix and rewrite all task ticket numbers with one SQL UPDATE in one transaction. Legacy lowercase board prefixes retain historical lookup, and prefix uniqueness checks are case-insensitive. Team locks serialize prefix claims; board locks coordinate ticket creation and moves. Normal task edits do not write a stale ticket-number snapshot back over a prefix change.

MCP, CLI task lookup and ticket-number detail lookup try live tickets before historical prefixes. Alias lookup retains the caller's existing board access filters, rejects deleted boards and tasks, and requires a board scope when the identifier is ambiguous. Numeric detail URLs are unchanged. Moved tasks use the existing highest-index-plus-one allocator, not a task count.

The additive migration is `20261003150000_add_project_prefix_aliases`. It must be deployed through the normal migration workflow before enabling this feature. Development verification uses mocked Prisma clients and does not run the migration against a real database.

Public documentation belongs in the separate docs repository and is not changed by this worktree-only implementation.
