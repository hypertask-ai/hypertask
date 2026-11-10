## Daily AI model watch

[AI model watch](../.github/workflows/ai-model-watch.yml) runs at 05:43 UTC daily,
with production-only manual dispatch, on public-repo `ubuntu-latest` (free hosted
compute). It is non-required, uses Node 24 built-ins with no app install, and
runs `tests/model-diff.test.cjs` and `tests/model-watch-allowlist.test.cjs`
before discovery. `scripts/model-diff --json` compares the app catalog with the
Vercel AI Gateway and authenticated OpenAI / Anthropic lists. Gateway failures
warn and fall back; unknown pricing never authorizes unconditional automatic
shipping. No usable sources fails the watch.

A new class files a ticket only when its family is in
[model-watch.allowlist.json](https://github.com/hypertask-ai/hypertask/blob/production/.github/scripts/model-watch.allowlist.json)
at or above the version recorded there. Another provider, a size, modality or
coding side-line, or an older version stays in the run log. Watching a family is
one line in that file. A newer version of a class we already ship, or a stale
entry, is always filed. A day where everything watched is premium files nothing,
so models held for
[HTPR-7746](https://app.hypertask.ai/detail/project-15/7746) ride along with a
cheaper finding instead of filing their own ticket.

The existing CI `HYPERTASK_MCP_TOKEN` files board-15 tickets through the MCP
search/create endpoints; optional `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` enable
provider fallback. Stable exact-title searches, serialized runs, a stable
idempotency key and fail-closed search validation prevent duplicate filings. A
rollup is keyed by the sorted set of watched models it lists, not by the date, so
the same pending set files once and only a changed set files again. The Action
changes no app models and grants only `contents: read`; runners follow the
indexed [update-ai-models skill](../.claude/skills/update-ai-models/SKILL.md) to
ship an existing-class OpenAI/Anthropic bump or ask Valentin about a new
class/provider. The saved discovery fixture is synthetic, not current
upstream/pricing proof.
