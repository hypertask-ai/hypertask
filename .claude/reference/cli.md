# CLI and MCP reference

## CLI and MCP repositories

Fix native CLI tickets in `~/projects/hypertask-cli-zig`, remote [hypertask-ai/cli](https://github.com/hypertask-ai/cli), base `main`. Run its Zig tests and parity tests. Server-side MCP/API work stays here. Never extend the retired Node CLI or use its `htz` alias in new work.

Managed agents, agent chat, and product MCP tokens remain supported. Pass integration tokens per invocation or environment; never save an agent token through human login. These integrations do not change session board-write identity. Codex intensity recommendations do not change identity or provider rules.
