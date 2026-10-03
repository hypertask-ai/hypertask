# AI golden baseline

No golden LLM tasks file for https://app.hypertask.ai/detail/project-15/6804 exists in this worktree. This is the requested minimal five-task fallback. The existing `evals/mcp-client/tasks.json` catalog tests connector parity separately.

`recorded-turns.json` contains deterministic mocked model turns, not production transcripts. The harness runs bounded agent loops against current chat and MCP input schemas, supplies isolated tool results, checks arguments and tool order, and reports retries and token counts. It never executes production tools. Offline replay tests contracts, not model quality; the recorded contract rejects stale chat prompts or tool schemas.

Run offline with `node scripts/ai-eval.cjs`. CI pins `AI_EVAL_LIVE=0` and a zero wrong-tool threshold. To evaluate live tool selection explicitly, set `AI_EVAL_LIVE=1` and provide `ANTHROPIC_API_KEY` in the environment. Live mode uses only synthetic tasks and tool results, and does not persist prompt, reply or tool argument bodies.

When changing a prompt, bump its registry version and review the prompt baseline. When tool schemas or the chat prompt change, review live eval results before refreshing `recorded-contract.json` using the exported `recordedContract({ chat: chatTools(), mcp: mcpTools() })` helper. Do not silently refresh hashes to bypass a failing eval.

Generation tracing stores ids, attribution, tokens, outcome, latency and estimated USD cost. Cost is `null` when catalog pricing is unavailable or a custom endpoint has no known rate, not a fabricated zero. Historical rows remain unchanged. `reportError` uses the existing PostHog tracker, durable deduplicated error tickets and alert workflow; deployment must already configure those existing services.
