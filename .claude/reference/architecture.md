# App architecture reference

## Stack Orientation

Next.js uses App and Pages routers. Trace affected middleware, routes, shared controllers/services, auth/cookies, queues, realtime, and cache invalidation before editing. Business logic usually belongs in shared controllers, not only route files. Add a legitimate "still allowed" case alongside every access or security refusal test.

## AI models

One AI model per class: a new model version replaces the old one in the same change (old one leaves every picker, saved picks move to the new one). Enforced by tests/model-class-unique.test.cjs (Valentin, 2026-10-08).

## pstack in hax and Codex sessions

Use the official shared pstack installation and its harness adapter. Read the matching skill when needed. Follow the house-rule model table and project model rules; use explicit models, subscription auth, and no fast mode. Claude Code model choices live in `.claude/rules/pstack-models.md`.
