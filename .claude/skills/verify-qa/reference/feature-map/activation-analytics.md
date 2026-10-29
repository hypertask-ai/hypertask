# Activation analytics

## How a customer reaches it

Server-side board creation, agent connection, agent task completion and invitations record activation milestones. Lifecycle email senders record successful delivery. Customers have no analytics controls.

## How to drive it

- Doctor: production deployment success, QA 985 signed in on `/my-tasks`, and the core inbox cycle.
- Read `/api/flags` with QA 985 and ordinary QA 2343. Retired activation switches must be absent; other switches remain available.
- Never create customer-looking analytics using synthetic QA identities. QA 985, guest users and configured QA emails remain excluded. Local activation/controller tests prove exclusions alongside an eligible positive control.
- Read the existing `https://hypertask.app/signup-check` aggregate report when its Access service identity is available. Follow [signup-check.md](../ops-map/signup-check.md); do not query ticket data through a database.
- Provider-side event delivery is UNREACHABLE when the runner lacks read access. Record that limit rather than claiming a mock proves live delivery.

## What usually breaks

- Retiring a gate accidentally bypasses synthetic-account exclusions.
- A shared eligibility change disables payment delivery or durable signup identity delivery.
- Retries emit duplicate events or consume an occurrence before delivery succeeds.

## What proof to collect

Live flags responses, signed-in doctor screenshot and core inbox evidence. Keep baseline and final targeted activation, wiring, payment, outbox, intent and account-category test results. Include provider aggregate evidence when reachable, with its snapshot time; a pre-deployment snapshot cannot prove post-deployment delivery.

## Cleanup

The core inbox recipe removes its own fixtures. Read-only flags and aggregate checks need no cleanup.
