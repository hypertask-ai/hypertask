# Five-surface parity

**This generated contract enforces catalog coverage only.** It detects added, removed, or unmapped routes, tools, and CLI commands; it does not prove runtime authorization, mutation behavior, or confirmation policy. Those guarantees remain in implementation tests and review.

The first landing is bootstrapped by the pre-existing, exact-head `claude-review` required check plus manual sensitive-path merge. After landing, `parity-contract-trusted` evaluates candidate source with the verifier and policy from the protected base branch; PR code cannot replace or relax the rules judging that PR.

Regenerate it with `node scripts/parity-contract.mjs --write --cli-capabilities <production-capabilities.json>`. Inventory: api: 152, mcp: 73, cli: 132, ai_chat: 83, hyperai: 73. A number is the count of concrete routes, tools, or leaf commands implementing the canonical job. ↪ records an intentional exclusion; 🛠 is a reviewed, temporary two-step transition and must be removed by its implementation PR. The CLI inventory is pinned to `@hypertask/hypertask_cli@1.13.29`; HyperAI keys are independently validated as the identity projection of the canonical MCP registry.

| Job | api | mcp | cli | ai_chat | hyperai |
|---|---|---|---|---|---|
| **Discover identity and accessible workspace context** | ✅ 3 | ✅ 2 | ✅ 2 | ✅ 1 | ✅ 2 |
| **Update the human profile** | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 |
| **List, inspect, and contact board agents** | ✅ 4 | ✅ 2 | ✅ 2 | ✅ 3 | ✅ 2 |
| **Agent Chat: an agent runtime reads and answers its owner's chat** | ✅ 2 | ↪ Only the chatted agent's runtime token may read or answer its session; MCP clients act as the human, not as the agent. | ↪ The agent worker runtime posts replies with its own bearer token; the CLI has no agent-side chat command. | ↪ Agent Chat is the surface itself; native agents answer in-process without this route. | ↪ HyperAI inherits the human session and never speaks as an external agent. |
| **Create, revoke, and rotate managed agents or keys** | ✅ 18 | ✅ 7 | ✅ 15 (transition) | ✅ 5 | ✅ 7 |
| **Create, refresh, inspect, or clear a CLI/API session** | ✅ 4 | ↪ MCP clients receive credentials out of band and do not manage interactive login. | ✅ 4 | ↪ The signed-in web session is managed by the app shell. | ↪ The embedded agent inherits the invoking human session. |
| **List, inspect, and filter tasks** | ✅ 2 | ✅ 2 | ✅ 2 | ✅ 3 | ✅ 2 |
| **Read task context, hierarchy, and description history** | ✅ 6 | ✅ 3 | ✅ 4 | ✅ 3 | ✅ 3 |
| **Search, retrieve, and find related tasks** | ✅ 3 | ✅ 3 | ✅ 3 | ✅ 3 | ✅ 3 |
| **Pull, lease, and coordinate the next task** | ✅ 6 | ✅ 1 | ✅ 1 | ✅ 1 | ✅ 1 |
| **Create, update, move, batch, or escalate tasks** | ✅ 6 | ✅ 3 | ✅ 4 | ✅ 3 | ✅ 3 |
| **Assign people and attach files** | ✅ 3 | ✅ 2 | ✅ 2 | ✅ 3 | ✅ 2 |
| **Link, unlink, and inspect task relations** | ✅ 3 | ✅ 1 | ✅ 3 | ✅ 1 | ✅ 1 |
| **List boards, teams, members, manifests, and playbooks** | ✅ 4 | ✅ 4 | ✅ 8 | ✅ 4 | ✅ 4 |
| **Create, archive, invite to, and configure boards** | ✅ 6 | ✅ 3 | ✅ 4 | ✅ 3 | ✅ 3 |
| **Manage labels, columns, and custom fields** | ✅ 10 | ✅ 5 (transition) | ✅ 15 (transition) | ✅ 5 (transition) | ✅ 5 (transition) |
| **Read, add, edit, and delete task comments** | ✅ 5 | ✅ 4 | ✅ 4 | ✅ 4 | ✅ 4 |
| **Read and triage inbox notifications** | ✅ 6 | ✅ 4 | ✅ 5 (transition) | ✅ 4 | ✅ 4 |
| **Create, read, search, update, archive, and restore pages** | ✅ 8 | ✅ 6 | ✅ 9 | ✅ 6 | ✅ 6 |
| **Create, read, update, and delete saved reports** | ✅ 5 | ✅ 1 | ✅ 5 | ✅ 5 | ✅ 1 |
| **Create, read, update, delete, and switch saved views** | ✅ 6 | ✅ 6 | ✅ 6 | ✅ 6 | ✅ 6 |
| **Create, read, update, delete, and import skills** | ✅ 6 | ✅ 6 | ✅ 6 | ✅ 6 | ✅ 6 |
| **Create, read, answer, and cancel decision requests** | ✅ 4 | ✅ 1 | ✅ 5 | ✅ 1 | ✅ 1 |
| **Create, read, update, publish, and delete drafts** | ✅ 5 | ✅ 1 | ✅ 5 | ✅ 1 | ✅ 1 |
| **Start, stop, pause, resume, log, and report time** | ✅ 10 | ✅ 3 | ✅ 8 (transition) | ✅ 8 | ✅ 3 |
| **Draft, improve, and inspect AI usage** | ✅ 7 | ↪ AI clients already provide their own model; recursive writing tools are intentionally API/CLI-only. | ✅ 2 | ↪ AI Chat itself is the writing surface rather than a nested tool. | ↪ HyperAI itself is the writing surface rather than a nested tool. |
| **Search Hypertask product help** | ↪ Help search uses the public documentation service, not a user-data API route. | ✅ 1 | ↪ The CLI exposes command help locally instead of remote help-center search. | ✅ 1 | ✅ 1 |
| **Search the public web for current information** | ↪ Public web search is an AI-runtime capability, not a board data endpoint. | ↪ MCP clients can provide their own web-search capability. | ↪ The board CLI does not proxy public web search. | ✅ 1 | ↪ HyperAI does not receive the AI Chat web-search provider. |
| **Create, inspect, test, and delete webhooks** | ✅ 4 | ✅ 1 | ✅ 6 | ✅ 1 | ✅ 1 |
| **Inspect client capabilities and reject unknown routes** | ✅ 5 | ↪ MCP protocol discovery already returns the live tool catalog. | ✅ 1 | ↪ AI Chat tool discovery is internal to the model runtime. | ↪ HyperAI inherits the canonical MCP registry at runtime. |
