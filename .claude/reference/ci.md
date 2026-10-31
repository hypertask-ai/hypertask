# CI decisions and CLI/MCP bugs

Read the [CI contract](#ci-contract), [CLI and MCP repositories](cli.md#cli-and-mcp-repositories), [docs/ci.md](../../docs/ci.md), and [docs/ci-policy.yml](../../docs/ci-policy.yml) first.

No VPN runner, new host or default preview gate without a recorded decision.

16. **CLI and MCP tickets:** File a CLI, MCP or `/api/mcp/*` bug unassigned on board 15 with the exact command, error and expected result.

## CI contract

Read [docs/ci.md](../../docs/ci.md) and [docs/ci-policy.yml](../../docs/ci-policy.yml) before changing workflows, runners, rulesets, required checks, previews, or deploy behavior. App CI uses GitHub-hosted Ubuntu. Never add a VPN runner or another host implicitly. Full CI belongs on hosted runners; run only the targeted checks permitted by the current task and host policy.
