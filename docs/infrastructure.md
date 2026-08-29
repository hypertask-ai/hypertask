# Infrastructure & Deployment Topology

> What runs where in production. Rewritten 2026-07-10, the day AWS was decommissioned.
> Keep this current when infra changes, it exists so nobody re-discovers it from scratch.

## TL;DR

**There is no AWS.** The account (`249963845567`) was emptied on 2026-07-10: both EC2 boxes
terminated, the AI Lambda deleted, the S3 buckets and the CloudFront distribution deleted.
Production is **Next.js on Vercel**, with Neon (Postgres), Upstash (Redis + QStash),
Cloudflare R2 (files) and Turbopuffer (search) around it.

Rollback is "promote the previous Vercel deployment", not a warm box.

## Web surfaces (two sites, two stacks)

| Domain | What | Stack | Host | Repo |
|---|---|---|---|---|
| **`hypertask.ai`** | Marketing / sales homepage | **Astro** | **Cloudflare** | separate repo (not this one) |
| **`app.hypertask.ai`** | The product app | **Next.js 14** | **Vercel** (`hypertasks-prod`) | **this repo** |

This repo is only the app. The public homepage is a standalone Astro site on Cloudflare.
A `/` route exists here (`src/app/page.tsx`) but is not the marketing homepage.

## Compute

Vercel project **`hypertasks-prod`**, deploying the **`staging`** branch. Pushing or merging
to `staging` deploys `app.hypertask.ai` in ~3 minutes. There is no other production gate.

`main` is frozen legacy. Do not base work on it, do not open PRs against it.

Every pushed branch gets its own Vercel preview deployment. **Previews share the live
database**, so click around freely but do not test destructively.

## Data & services

| Concern | Provider | Detail |
|---|---|---|
| **Database** | **Neon** (managed Postgres) | Project `hypertask-production`, via `DATABASE_URL`. Pooled connection. |
| **Job queue** | **Upstash QStash** | Replaced Quirrel 2026-07-06. Short-delay jobs publish to QStash; long/variable timers run off a minute-ly DB sweep (`hypertask-sweep-v1`). |
| **Cache / KV** | **Upstash Redis** | `REDIS_URL`. Powers CLI login, MCP idempotency, user preferences. |
| **Search** | **Turbopuffer** | Hybrid BM25 + vector, weighted BM25 ranking. Replaced Typesense-on-Railway. |
| **File storage** | **Cloudflare R2** | Bucket `hypertasks-uploads`, served from `files.hypertask.app`. Replaced S3 + CloudFront. |
| **AI** | **Vercel AI Gateway** | Native routes under `src/app/api/ai/`. Replaced the Python FastAPI Lambda. |
| **Auth** | Firebase (Google) + JWT | |
| **Email** | Resend | |
| **Payments** | Stripe | |

### R2 URL gotcha

R2's public domain **percent-decodes `%xx` in the path but does not decode `+`**. An object
key must therefore be the percent-decoded path with `+` left literal. Cloudflare also caches
404s, so re-test a fresh upload with a `?cb=<random>` query before concluding a file is missing.

## Deploy pipeline

1. Branch off `origin/staging`.
2. Push. A Vercel preview builds automatically and the bot comments the URL on the PR.
3. Open a PR with base `staging`. CI runs `ci-build`, the provider-portable `claude-review`
   compatibility check, `next-public-secrets`, and `revert-guard`. Preview smoke runs only
   when an opt-in preview exists.
4. Merge to `staging` -> production deploys in ~3 min.

Rollback: promote the previous production deployment in Vercel, or `git revert` on `staging`.

### CI runners (HTPR-5105, 2026-08-06)

CI runs on five **self-hosted runner services**
(`contabo-1` … `contabo-5`) on the Contabo-UK VPS (80.190.82.74). General-purpose
jobs use the low-privilege `ghrunner` account. Subscription review uses the separate
`htreviewrunner` account and private `valentinyeo/hypertask-reviewer` repository, so application PR-controlled jobs cannot schedule its runners or invoke its wrappers. Free minutes;
GitHub-hosted billing had trended ~$175/mo.

The services use three lanes:

- `ai-review`: AI review only. `contabo-1` and `contabo-2` are registered only to `valentinyeo/hypertask-reviewer` and run as `htreviewrunner`.
- `ci-fast`: secret guard, revert guard, and auto-merge. `contabo-4` is exclusive to this lane.
- `contabo`: CI Build, production health, and other heavy work on `contabo-3` and `contabo-5`.

All six local Actions runner services share the root-owned, read-only action archive cache at `/opt/github-actions/action-archive-cache`. Populate it from a trusted `staging` checkout with `.github/scripts/install-action-archive-cache.sh`; use `--install-services` only while lanes are idle because it restarts the services. Exact action commits and recovery behavior are canonical in `openwiki/deployment.md` and `docs/ci.md`.

This reserves two secure review slots without another host or VPN. All services still share the same physical VPS, so a host outage stops every lane.

Five is a capacity choice, not a limit: the box has 18 cores but also runs every
agent session. Two runners left checks queueing for
hours (2026-08-07). If the queue backs up again, add runners the same way (copy the
runner dir, `config.sh --name contabo-N --labels contabo`, `svc.sh install ghrunner`)
and watch `uptime`. **Live queue and runner health: https://hypertask.app/ci**

prod-health's page curls can hit Vercel's bot challenge on the VPS IP, so its health
check treats an `x-vercel-mitigated: challenge` response as INCONCLUSIVE (Telegram
warning, no rollback) — never weaken that guard, a challenged curl proves nothing
about the app.

AI review and `claude-mention` are also self-hosted. A validated local broker dispatches AI review to the private reviewer repository, which tries GPT-5.6 Luna through the
ChatGPT/Codex subscription, then Claude Sonnet through the Claude Code subscription, then GPT-5.6 Luna through Vercel AI Gateway. Its
job checks out only the trusted `staging` reviewer implementation and never executes PR code.
`claude-mention` still uses `CLAUDE_CODE_OAUTH_TOKEN`. External/fork PRs are excluded from review.

Deliberately still GitHub-hosted: **preview-smoke** (bot-challenge risk on preview URLs,
and it is tiny). If the Contabo box is down, PR checks queue until it returns; revert the
`runs-on` lines to `ubuntu-latest` to fall back to paid hosted runners.

### Database migrations are NOT applied by the deploy

**Nothing applies migrations for you.** The Vercel build is
`npx prisma generate && next build --webpack`, with no `prisma migrate deploy` in the
build, in CI, or in any release step. Merging a PR that adds a migration ships the
*code* and leaves the *schema untouched*.

Consequence: a feature backed by a new table deploys green, then 500s at runtime
because the table does not exist. This bit HTPR-4433 on 2026-07-20. Tracked as
https://app.hypertask.ai/detail/project-15/4466.

**The ledger itself is now clean.** It used to carry two rows with `finished_at IS NULL`
(a 2023 rollback and a stale `db push`-era row), which is why `migrate deploy` could not
run — it refuses against a history containing failed migrations. Verified on 2026-08-07:
zero rows have `finished_at IS NULL` or `rolled_back_at` set, so that particular blocker
is gone. Wiring `migrate deploy` into the deploy is now a matter of doing it, not of
reconciling history first.

Until someone does, apply an additive migration manually in one transaction against the
live branch, then insert the matching `_prisma_migrations` row (id, sha256 checksum of the
migration file, `finished_at = now()`, `applied_steps_count = 1`) so later tooling
sees it as applied. Do the existence checks inside the same transaction and abort if the
column or the ledger row is already there, so a re-run cannot half-apply.

### Which Neon branch is production (the names lie)

| Branch | id | Reality |
|---|---|---|
| **`import`** | `br-curly-glade-ab476077` | **THIS IS LIVE PRODUCTION.** Default/primary branch, what app.hypertask.ai reads and writes. |
| `production` | `br-square-meadow-abalo5fh` | **Empty — no `Task` table at all.** Misleading name, unused. |
| `staging-mirror` | `br-wild-credit-ab1av3ly` | Staging. |
| `dev-valentin` | `br-fragrant-sunset-abog6ih1` | Dev/test. **This is what `.env.local`'s `DATABASE_URL` points at**, not production. |

Never pick a branch by name or by row count — they are all ~22-24k tasks and look alike.
Identify the live one by probing for a row you know exists in production: resolve a known
ticket through the API to get its internal `Task.id`, then check which branch contains that
id. Vercel stores `DATABASE_URL` as a sealed secret and `?decrypt=true` returns ciphertext,
so the Neon API is the practical route to a connection string (`NEON_TOKEN` /
`NEON_PROJECT_ID` in `~/.config/val-staging/credentials.env`).

## Decommissioned (do not go looking for these)

Removed 2026-07-10 (see https://app.hypertask.ai/detail/project-15/4079):

- **AWS** in full: EC2 `Hypertasks-london` + `hypertasks-stats` + a stale `hypertask-new`
  box in us-east-2, the `fastapi-ai-lambda` Lambda, S3 buckets `hypertasks` and
  `fastapi-workflows`, the CloudFront distribution, all EBS volumes, snapshots, AMIs and
  elastic IPs. The EC2-era `docker-compose.prod.yml`, `Dockerfile.prod`, `nginx/` and the
  `deploy.yml` workflow went with them.
- **Pinecone** (vector DB) — superseded by Turbopuffer.
- **Railway** (Typesense + the Quirrel server) — superseded by Turbopuffer and QStash.
- **Quirrel** — abandoned upstream; replaced by QStash + the DB sweep.

## How to re-verify this map

```sh
# AWS should return zero of everything (claude-cli is read-only)
aws s3api list-buckets --query 'length(Buckets)'
aws ec2 describe-instances --region eu-west-2 \
  --query 'length(Reservations[].Instances[?State.Name!=`terminated`][])'

# what production actually is: Vercel project hypertasks-prod, production branch = staging
```
