---
name: update-ai-models
description: Keep the AI catalog current from deterministic model discovery; ship approved OpenAI/Anthropic version bumps, ask Valentin for new classes/providers, and hold premium models.
---

# Update AI models

Use for model-watch tickets or a request to refresh the catalog. Follow `/ship` and [AI models](../../reference/architecture.md#ai-models): one model per class. This skill does not grant permission to bypass required review, CI, owner merge, deployment or live QA.

Valentin approved this automation in https://app.hypertask.ai/detail/project-15/7747: “for the providers we have we generally want the newest models as soon as they come out. openai/anthropic we always update.”

## Discover without AI

```bash
node scripts/model-diff
node scripts/model-diff --json
```

The script reads `src/lib/aiModelOptions.ts`, the Vercel AI Gateway `https://ai-gateway.vercel.sh/v1/models`, OpenAI `https://api.openai.com/v1/models`, and Anthropic `https://api.anthropic.com/v1/models`. Set `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in the environment for the provider lists; never print or commit keys. It uses built-in Node APIs, not an LLM or app dependencies. Anthropic pages are followed to completion.

The gateway can return a bot check on the VPS. Its failure is a warning, not a crash: provider lists still report discoveries and the output names every source used or unavailable. Without the gateway, missing provider models are not treated as proof of removal and prices are unknown. No usable sources is not a clean bill of health; the Action fails before filing tickets.

Classes are matched by provider and version-independent model name against the catalog's explicit `modelClass`; the highest numeric version per family is reported, not date snapshots or effort variants. Unknown naming schemes are proposals, never automatic shipments. Image, audio, embedding and coding-only models are outside this chat-model watch. Stale entries include older catalog versions of the same class (including hidden Haiku 4.5) and picker models missing from a successfully fetched gateway list.

The saved fixture is **synthetic**, based on the ticket's examples, not a captured live response or verified pricing:

```bash
node scripts/model-diff --fixture tests/fixtures/model-diff.json --json
```

It demonstrates Fable 5.1, GPT 6 Astra, Kimi K3.1 Pro and Qwen 3.8 Plus. Never use fixture prices to ship. The offline CI test rejects a picker model missing from the gateway fixture, with a positive control and deliberate missing-model negative control, and proves stale detection on a catalogue that keeps two versions of one class, because the real catalogue keeps one model per class (HTPR-7940).

## Decide

| Finding | Action |
|---|---|
| OpenAI or Anthropic version bump in an existing class, verified gateway input price at most $5/M tokens | **Ship automatically** through `/ship`; no new model-approval question. Replace, do not add a second version. |
| New class, new provider, or another provider's version bump | **Ask Valentin before shipping**; one Question on the finding's ticket, following `/ship`'s decision process. |
| Input price **over $5 per million input tokens** | **waits for HTPR-7746**: https://app.hypertask.ai/detail/project-15/7746. Never auto-ship or silently change premium gating. |
| Missing or invalid gateway price | Hold shipment until gateway pricing is verified. A provider model list does not establish cost. |
| Stale entry | Verify the replacement and remove it from pickers in the replacement change; migrate saved picks within the same class. Missing from one source alone is not proof that a direct provider retired it. |

The ticket says “input words”; this implementation uses **input tokens**, matching gateway pricing and the runner's explicit specification. Gateway `pricing.input` is USD per token, multiplied by 1,000,000 for the premium decision; exactly $5 is not over $5. Confirm both input and output prices from the gateway before changing app pricing.

## Replace and prove

1. Read the finding's upstream entries and release notes. Confirm class identity, API model IDs, routing, capabilities, context limits, effort options and current gateway prices; do not guess IDs from display names.
2. Trace every caller: `src/lib/aiModelOptions.ts`, provider routes/controllers, gateway IDs, plan/price gating, billing cost tables, web and Android composer/config pickers, defaults, mentions, background jobs and persisted model choices. Search for the old model IDs before editing.
3. Replace the old class version everywhere in the same PR. Preserve effort variants, plan access and automatic fallback to the previous working version for a provider failure, but do not expose the old version in any picker. Migrate/alias saved picks to the new class version. Do not bundle unrelated model classes into the finding's PR.
4. Follow AGENTS.md's flag rules: a same-provider version swap with unchanged slots/plan gating and automatic fallback is a dependency update, not a new feature; new classes and deliberate access/price changes still follow their approval and flag rules. Premium work remains blocked on the premium-model policy above.
5. Run verification on GitHub, not the VPS: `node --test tests/model-diff.test.cjs`, `tests/model-class-unique.test.cjs`, and the affected routing/pricing/saved-pick tests via the existing CI suite. Prove one visible model per class and that a saved old pick resolves to the replacement.
6. After the required checks, owning-session merge and production deploy, follow `verify-qa`: each new model must return a real live chat answer on an authorized QA account. Check saved picks, routing and unchanged plan gating. Record evidence on its ticket before Done; a listing or a fixture is not live chat proof.

## Daily Action

`.github/workflows/ai-model-watch.yml` runs daily at **05:43 UTC** on public-repo `ubuntu-latest` (free hosted compute), and supports `workflow_dispatch` on `production`. It runs the offline fixtures, emits the JSON discovery report, then uses the existing CI MCP ticket path (`/api/mcp/tasks/search`, `/api/mcp/tasks/create`) and `HYPERTASK_MCP_TOKEN` to file one board-15 Bugs ticket per finding. This CI identity is not a session's board-write identity; interactive sessions still use `vcc` only.

Stable titles contain a hash of finding kind/provider/normalized model, independent of prices and catalog versions; dated provider snapshots and dotted gateway versions share a title. The Action serializes runs, searches open (`status=open`) tickets for that marker, compares exact titles, and fails closed on failed, partial, malformed or truncated searches. Existing Normal tickets, including a Done-column ticket, suppress repeat filings. A stable `Idempotency-Key` also protects a retry after creation succeeds but its response is lost. No ticket, assignment, model update or deployment is performed by model-diff itself.

Required secret: `HYPERTASK_MCP_TOKEN`. Optional discovery secrets: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`; configure both for gateway-blocked fallback. No AI review credentials, write-capable GitHub token, app build, preview or additional runner host is needed. New workflows become dispatchable only after reaching the default branch; inspect the first production run rather than claiming a local fixture proved network access or secret configuration.
