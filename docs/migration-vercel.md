# Migration plan: AWS EC2 → Vercel

> Persistent record of the "move off AWS to Vercel" exploration so it is not re-traced
> every time. Companion to [infrastructure.md](./infrastructure.md). Last updated 2026-07-04.

## Goal & motivation

Move production off the single EC2 box (`Hypertasks-london`) to **Vercel**, for:
- **Convenience** (the real win): push-to-deploy, preview environments, no SSH build script.
- **Cost**: uncertain, see the honest take below.
- **Speed**: mixed, see below.

## What actually blocks the switch

Only **one thing**: the EC2 box runs the Next.js app **plus its Quirrel job queue and Redis**.
Everything else stateful is already external and works from Vercel unchanged:

- Postgres → **Neon** (already managed)
- Search → **Typesense on Railway** (already off AWS)
- Files → **S3** (just an API, fine from Vercel)
- AI backend → **Lambda `fastapi-ai-lambda`** (serverless already)

So the migration is really: **relocate Quirrel + on-box Redis onto managed serverless**, then
the app move to Vercel is a non-event (it already runs there as staging).

## Target stack

| Piece | Today | Target |
|---|---|---|
| App | Next.js on EC2 | **Vercel** |
| Job queue | Quirrel (on-box) | **Upstash QStash** |
| Redis | on-box / `ioredis` | **Upstash Redis** |
| DB | Neon | Neon (keep) |
| Search | Typesense/Railway | keep (or Typesense Cloud later) |
| Files | S3 | keep |
| AI | Lambda | keep |

### Why QStash for the queue

All 17 queues are **delayed one-shot jobs** (`enqueue(payload, { runAt })`, no cron). That maps
1:1 to `qstash.publishJSON({ url, notBefore, body })`, QStash calls your endpoint at time T.
It is essentially **hosted Quirrel**. The handlers are already POST routes, so migration is
near-mechanical: swap the `Queue(...).enqueue({ runAt })` call for `qstash.publishJSON`, add
QStash's signature-verify wrapper, keep the business logic (`invokeDueDate`, etc.) unchanged.
Bonus: Quirrel is abandoned (Netlify shut it down ~2023), so leaving it is worth doing anyway,
and Upstash Redis removes the last reason to keep Redis on the box.

Rejected alternatives: **Vercel Cron** (recurring-only, can't do arbitrary delayed jobs);
**Inngest** (more powerful but a bigger rewrite, overkill for "call a URL later");
**keep Quirrel on a box** (then you never left the server).

## Honest take on the three goals

- **Convenience → clear win.** Push-to-deploy + preview envs + no SSH.
- **Money → wash or worse.** A busy API-heavy app on Vercel bills function-hours + bandwidth
  that can beat a fixed EC2 bill, and you add managed-service costs (QStash, Upstash). Only a
  real saving if it lets you retire the box entirely *and* usage stays modest.
- **Speed → mixed.** CDN/static faster globally, but serverless + Prisma + Neon needs connection
  pooling (Neon serverless driver / PgBouncer / Prisma Data Proxy) or DB latency gets *worse*
  than today's long-lived warm Node process.

## Step-by-step

1. **Stripe webhook** → replace the `stripe listen` dev CLI in `npm start` with a real webhook
   endpoint configured in the Stripe dashboard. Trivial, do anytime.
2. **Quirrel + Redis → QStash + Upstash Redis.** The main work.
   - Migrate **one queue at a time** (start with the lowest-stakes, e.g. chat-session expiry).
   - Test on the **Vercel shadow/staging** env first, watch a real job fire end-to-end.
   - **Drain in-flight jobs:** keep Quirrel running during cutover so already-scheduled
     reminders fire out; retire it only once its backlog is empty.
3. **Typesense** → already on Railway, no move needed (optionally Typesense Cloud later).
4. **Flip the app to Vercel production** (env vars + DNS). Trivial once 1–2 are done.
5. **Decommission** `Hypertasks-london`; check/kill the stopped `hypertasks-stats` box.

## Risk

Medium and controllable. Worst case is degraded background jobs (reminders/notifications stop
firing) — **not** site-down; the app, DB, auth, task CRUD keep working. Controls: per-queue
migration, staging-first, drain in-flight jobs.

## Open items / unknowns

- Confirm Quirrel/Redis are on-box vs external (`docker ps` on the box).
- Prisma + serverless connection pooling strategy for Neon (needed before the app flip).
- The FastAPI Lambda stays; no action, just noted.

## Account status

- **Upstash** account opened 2026-07-04. Need `QSTASH_TOKEN` + `QSTASH_CURRENT_SIGNING_KEY` +
  `QSTASH_NEXT_SIGNING_KEY` from the console (QStash tab) to start the spike. (The first UUID
  pasted was the account **Management API key**, not the QStash token.)
- Next concrete step: a QStash spike, one queue, end-to-end, on staging, to size the real effort.
