# CI decisions and CLI/MCP bugs

Read AGENTS.md CI contract and CLI and MCP repositories, docs/ci.md and docs/ci-policy.yml first.

**Runner compute rule** (Valentin, 2026-10-21, https://app.hypertask.ai/detail/project-4060/535): no local `next build`, premerge build, full test suites or full lint on the VPS. Push and let free GitHub-hosted `ubuntu-latest` run them; only single targeted test files and syntax checks run locally. Use `scripts/premerge-remote.sh <pr> <click-script-path>` for the recorded premerge click. Do not fall back to a VPS build when GitHub is red.

No VPN runner, new host or default preview gate without a recorded decision.

16. **CLI and MCP tickets:** File a CLI, MCP or `/api/mcp/*` bug unassigned on board 15 with the exact command, error and expected result.
