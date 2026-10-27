# HTPR-7038: one-time saved model reset

Decision: https://app.hypertask.ai/detail/project-15/7038. Reset saved personal LLM picker choices to `claude-haiku-5-5` once; users can choose another model afterwards. This is saved-data repair, not a persistent override or a change to plan defaults.

## Storage audit

| Storage | Classification and action | Source |
| --- | --- | --- |
| `UserSetting.aiModelPreferences.{aiChat,taskWriter,writeWithAi,improveWriting,askAi}` | In scope: saved global personal LLM choices. | `src/prisma/schema.prisma:573`, `src/lib/aiModelPreferences.ts:1` |
| `UserSetting.aiModelPreferences.teams.<teamId>.{aiChat,taskWriter,writeWithAi,improveWriting,askAi}` | In scope: the same user's personal choices for each team, not admin team defaults. | `src/lib/aiModelPreferences.ts:52`, `src/hooks/General/useAiModelPreference.ts:123` |
| Board and boardless AI chat picker | Uses the personal `aiChat` keys above; no separate board-chat user column or chat-session model preference. | `src/hooks/MultiPages/AIChat/useAiChatModelPreference.ts:12`, `src/lib/ai/chatStream/turnModel.ts:99` |
| Settings, editor/task-detail pickers and preference APIs | Settings exposes all five LLM surfaces, including `taskWriter`. UI and APIs share the JSON column; no second saved model store. | `src/components/Modals/Settings/AiDefaultModelsSection.tsx:28`, `src/lib/contexts/TaskDetail/AITaskWriterContext.tsx:252`, `src/app/api/users/preferences/route.ts:261`, `src/utils/controllers/users/fetch_preferences.ts:40` |
| Ctrl+J create-task writer | No picker to modify; leave its plan-default resolution and request code unchanged. The separate settings/task-detail `taskWriter` saved picker choice remains in scope. | `src/hooks/MultiPages/Tasks/useCreateTaskModalStates.ts:395`, `src/lib/ai/composeTask.ts:73` |
| `UserSetting.aiModelPreferences.imageGeneration` and team-scoped equivalent | Compatibility exception: preserve image picker choices. Haiku is a text model and is rejected for this surface; recommend a separate image-model decision if an image reset is wanted. | `src/components/Modals/Settings/AiDefaultModelsSection.tsx:102`, `src/app/api/users/preferences/route.ts:278`, `src/lib/systemModelLadder.ts:54` |
| `Team.aiProviderSettings.featureModels` (all features, including system/fast models) | Out of scope: admin defaults; recommend retaining them unless separately authorized. | `src/prisma/schema.prisma:669`, `src/pages/api/teams/aiFeatureModels.ts:182`, `src/lib/systemModelLadder.ts:114` |
| `AI_Custom_Instructions.model_selected`, `source_selected` | Out of scope: shared board defaults; recommend retaining board-owner choices. | `src/prisma/schema.prisma:906`, `src/pages/api/ai/project/customInstruction.ts:148` |
| `Agent.modelOptionId` and runtime/prompt configurations | Out of scope: agent pins and configs; recommend retaining deliberate agent cost/capability choices. | `src/prisma/schema.prisma:2498`, `src/lib/ai/chatStream/turnModel.ts:150` |
| Team/agent BYOK records and `Team.aiProviderSettings` provider/custom-endpoint configuration | Out of scope: credentials, availability and endpoint settings; recommend leaving all untouched. A personal LLM picker choice pointing at a custom endpoint is still backed up and reset. | `src/prisma/schema.prisma:678`, `src/prisma/schema.prisma:2595`, `src/app/api/ai/_lib/byokKeys.ts` |
| `AiUsage.model`, message/request model mentions | Out of scope: usage history and explicit per-request overrides, not saved picker defaults; recommend preserving history and overrides. | `src/prisma/schema.prisma:2660`, `src/lib/ai/chatStream/turnModel.ts:154` |

The stored picker ID is `claude-haiku-5-5` (`src/lib/aiModelOptions.ts:428`), not the provider routing ID `anthropic/claude-haiku-5.5`. Unknown/legacy string choices are also reset. Missing keys, SQL/JSON nulls, malformed non-string values, image choices and unrelated JSON are preserved. No settings rows or preferences are created for users without a saved choice.

## Schema and server-side reset

Migration: `src/prisma/migrations/20261008120000_htpr_7038_reset_saved_model_choices/migration.sql`. It creates tables only and makes no saved-choice changes. Both tables are mapped Prisma models:

- `htpr_7038_model_choice_backup`: `user_id`, `location` (a JSON-encoded array path), `previous_value`, `backed_up_at`; primary key `(user_id, location)`.
- `htpr_7038_model_choice_reset_done`: `user_id` primary key and `reset_at`.

Neither table has a user foreign key, so recovery records survive user deletion. Completion is per user, not the existence of the backup table.

`ensureHtpr7038ModelReset(userId)` in `src/lib/ai/htpr7038ModelReset.ts` checks `htpr-7038-reset-saved-model-choices` through `src/lib/flags.ts`. This is a feature defaulting to **Owner + QA**. Off performs no marker lookup, backup or reset. Only Valentin releases the flag to Everyone; this change does not change any stored flag mode.

Enabled users with a marker take one indexed marker lookup and no transaction. A first eligible read takes a single transaction with a per-user advisory lock, inserts the marker with conflict protection, then locks the settings row before reading its JSON. It backs up every non-Haiku in-scope string with `ON CONFLICT DO NOTHING` and folds precise `jsonb_set` updates into one settings-row update. Empty, absent or malformed preferences still get a completion marker without creating settings or choices. Any failure rolls back marker, backups and choices together. Failures log fixed text only and continue the read with existing preferences. No saved values, credentials or raw exceptions are logged.

Changed preferences invalidate the existing Redis preferences cache before transaction commit. Cache invalidation failure rolls the reset back so later reads cannot serve stale pre-reset picks behind a completion marker. The initiating controller read also bypasses any pre-reset cache hit. React `cache` deduplicates reset checks within a server-render request. API call graphs have one saved-preference read point per request; audio transcription reads only its dictation language before optional model selection, avoiding a duplicate reset check.

The reset returns `disabled`, `done`, `reset` (preferences changed), or `failed`. Reads keep using existing preferences on failure. A POST with any model-choice update returns HTTP 503 and a short retryable message on `failed`, without saving any preferences. Non-model saves remain available. After recovery, reset completes before the retried choice is saved, so later reads preserve that choice.

Read points:

- `src/utils/controllers/users/fetch_preferences.ts`: reset before Redis or database reads. Covers `/api/users/preferences` GET, server-rendered preferences and the image route without changing image choices.
- `src/lib/ai/chatStream/turnModel.ts`: reset before loading personal chat choices.
- `src/app/api/ai/_lib/editorAi.ts`: reset in the shared personal-model selector, covering task writer, Write with AI, Improve Writing, Ask AI and their editor/MCP callers.
- `src/app/api/users/preferences/route.ts`: POST resets before merge/save, so an explicit new user choice wins and its response never exposes pre-reset picks.

Later picker saves are never reset again, even if the flag is disabled and re-enabled. Explicit request overrides, team/board defaults, agent pins, provider/BYOK settings and image choices retain existing behavior. Haiku availability still follows existing model, plan and provider gates.

## Manual undo and re-run

`scripts/htpr-7038-undo-model-reset.sql` is not auto-run. Only an authorized operator may review and execute it. It visits existing users in ascending user ID order, takes the same `pg_advisory_xact_lock(7038, user_id)` as reset before locking that user's settings row, and restores each backup only where the current value is still exactly `claude-haiku-5-5`, and preserves later non-Haiku picks, removed/null paths, unrelated JSON and deleted settings. There is no table lock. Scanning existing users before checking backups also includes an in-flight first reset whose backup has not committed yet. Undo waits for that reset and reads its committed backup after obtaining the advisory lock; concurrent resets and preference writes cannot invert the row/advisory lock order. Repeated undo is a no-op. A deliberate later re-selection of Haiku is indistinguishable from an unchanged reset and will be restored.

Undo retains **both backups and per-user completion markers**. To deliberately re-run for selected users, an authorized operator must first disable the flag, review the affected backup paths, then explicitly delete only those users' rows from `htpr_7038_model_choice_reset_done` and re-enable the flag. Existing backup paths remain the original pre-reset values because conflicts do not replace them. Never drop either table as an undo step. Undo does not invalidate Redis; allow the existing five-minute cache TTL or use the normal preferences-cache invalidation before checking the UI.

## Deployment safety

The migration runner remains production-only. Production uses the `production` branch; previews share its database and must not apply migrations or be used for reset testing. Schema must exist before the reset can succeed; reads fail open if deployment briefly reaches the function before schema installation. No production/shared database, account or preview is accessed during verification. Existing CI applies migrations to disposable test databases before builds. No workflow, deployment command or production execution is changed.

## Verification

Run:

- `node tests/htpr-7038-model-reset.test.cjs`
- `node tests/htpr-7038-model-reset-read-points.test.cjs`
- `node tests/feature-flags.test.cjs`
- `npx tsc --noEmit`
- ESLint on touched TypeScript and CommonJS files with `--suppressions-location eslint-local-rules/style-guide-suppressions.json --pass-on-unpruned-suppressions`
- The local CI feature flag gate with title `HTPR-7038 [COST] One-time reset of saved model choices to Haiku 5.5`, plus redacted gitleaks when installed.

The Postgres suite requires Docker and fails rather than skips if unavailable. It creates a network-disabled disposable Postgres 16 container using a Unix socket, trust auth and temporary in-container storage, with only migration SQL mounted read-only. It applies earlier migration history and checks both table shapes against offline Prisma-generated SQL. It executes the actual server function with a transaction adapter over persistent psql sessions, plus mocked flags and Redis. No database URL, password, credentials or environment file is used.

Coverage includes schema-only deployment, flag off/on, exact global/team paths (including unusual team IDs), null/missing/non-string/image preservation, exact original backups, per-user timestamps, cache-failure atomic rollback, retryable 503 on model-choice saves during reset failure, successful recovery followed by preserved user choices, concurrent reset/undo lock ordering, untouched row versions, simultaneous first reads, repeated reads, later user choices, later users, empty completion, conditional undo and retained markers/backups after settings deletion. Unit tests execute the shared read paths and API entry points with isolated dependencies and check reset ordering, cache bypass, failure continuation and server-reader inventory. Negative controls reject altered unrelated keys, missed choices and data-changing migration SQL. Containers are removed on success or failure.
