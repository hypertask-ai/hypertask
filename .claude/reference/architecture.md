# App architecture reference

## Stack Orientation

Next.js uses App and Pages routers. Trace affected middleware, routes, shared controllers/services, auth/cookies, queues, realtime, and cache invalidation before editing. Business logic usually belongs in shared controllers, not only route files. Add a legitimate "still allowed" case alongside every access or security refusal test.

## AI models

One AI model per class: a new model version replaces the old one in the same change (old one leaves every picker, saved picks move to the new one). Enforced by tests/model-class-unique.test.cjs (Valentin, 2026-10-08).

## AI funding

Who pays for an AI call, which credential it uses, and which provider route executes it all live in one module: `src/app/api/ai/_lib/aiFunding.ts` (`AI_FUNDING_TABLE`, `resolveAiFundingTableDecision`, `resolveHypertaskAnthropicCredential`, `getAnthropicMonthlyCreditState`, `reportAiFundingIncident`).

- **Hypertask-paid calls** (Free, Pro, AI, comped/internal teams, and BYOK teams using included allowance with no matching own key): burn Valentin's monthly Anthropic credit first via direct Anthropic (`ANTHROPIC_API_KEY`, default `$200/month` via `ANTHROPIC_MONTHLY_CREDIT_USD`), tracking monthly spend from `AiUsage` (`provider = "platform:anthropic"`) + Redis.
- **Auto routing**: `src/app/api/ai/_lib/autoModel.ts` reads `isHypertaskPaidAutoContext` from `aiFunding.ts` and picks the cheapest Claude model fitting `tierForFeature` + `chatStepUp` (`claude-haiku-5-5` -> `claude-sonnet-5-5` -> `claude-opus-5-5`; Free stays off premium Opus).
- **BYOK & forced keys**: customer keys always run directly on the customer's key first, unchanged. User-picked specific models are respected.
- **Loud automatic fallback**: when Hypertask-paid traffic falls back from direct Anthropic to the Vercel AI Gateway (credit exhausted, Anthropic error, missing `ANTHROPIC_API_KEY`), or when a Hypertask-paid gateway call fails (credit exhausted, refusal, error), `reportAiFundingIncident` files an urgent error ticket via `src/lib/errors/reportError.ts`, deduped to one ticket per cause per UTC day, with the reason and month's Anthropic spend. The user's request succeeds on fallback.
- **Single client factory rule**: only `src/app/api/ai/_lib/aiFunding.ts` may import or call `createGateway`, `createAnthropic`, `createOpenAI`, or `createOpenRouter` in `src/`. Enforced by `eslint-local-rules/ai-funding-provider-clients.mjs` and `tests/ai-funding-provider-clients-rule.test.cjs`.

## pstack in hax and Codex sessions

Use the official shared pstack installation and its harness adapter. Read the matching skill when needed. Follow the house-rule model table and project model rules; use explicit models, subscription auth, and no fast mode. Claude Code model choices live in `.claude/rules/pstack-models.md`.
