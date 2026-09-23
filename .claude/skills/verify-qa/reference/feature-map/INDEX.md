# Feature map for QA verification

One file per customer-facing area. Each file says how a customer reaches the
area, how to drive it, what usually breaks there, what proof to collect, and
the cleanup. Read the file for the area a ticket touches before verifying it;
don't read all ten for a one-line fix.

Pattern borrowed from
[poteto/verification-skill-example](https://github.com/poteto/verification-skill-example):
a short reference file per feature area beats one long QA checklist, because
each ticket only needs the one or two areas it touches.

## Areas

| Area | File | e2e/smoke id |
|---|---|---|
| Login | [login.md](login.md) | `login` (write journey) |
| Boards and views | [boards-and-views.md](boards-and-views.md) | `open-board`, `switch-boards` (write); `view-board-list`, `view-kanban-board` (load-only, `prod.spec.ts`) |
| Task detail and description | [task-detail-and-description.md](task-detail-and-description.md) | `open-task`, `edit-description` (write); `view-task-detail` (load-only) |
| Comments and mentions | [comments-and-mentions.md](comments-and-mentions.md) | `add-comment` (write journey) |
| Drag and drop | [drag-and-drop.md](drag-and-drop.md) | `drag-card` (write journey) |
| AI chat | [ai-chat.md](ai-chat.md) | `ai-chat` (write journey) |
| Inbox | [inbox.md](inbox.md) | `view-inbox` (load-only); no write journey for archive/undo |
| Search and filters | [search-and-filters.md](search-and-filters.md) | `view-AI-search` (load-only, capital AI); no write journey for filters |
| Demo board | [demo-board.md](demo-board.md) | `demo` (tag `@demo`, `demo.spec.ts`) |
| Mobile | [mobile.md](mobile.md) | any id above tagged `@mobile` (`open-board`, `open-task`, `create-task`) |

Load-only ids come from `prod.spec.ts`'s per-view smoke check (page loads,
no error, right selector present). Real, but shallower than a write journey.
Write-journey ids are tagged `@id:<name>`, tier-prefixed when `HT_QA_TIER` is
set (`lib/tier.ts`'s `tieredId`); load-only ids follow the same
`@id:view-<name>` shape from `prod.spec.ts`, case preserved from the view's
own `name` field. "No write journey" means don't invent a test id that
doesn't exist; verify that action by hand.

## Driving the app for verification

Prefer `agent-browser`, headless, straight against production:
`https://app.hypertask.ai/...?realtime=on`, the same param
`e2e/smoke/lib/realtime.ts` appends. **It does not turn on live push under
automation**: `src/lib/realtime/client.ts` checks `navigator.webdriver`
before it even reads the param, and `agent-browser` reports
`navigator.webdriver === true` like any automated Chromium. So proof is
always reload-and-re-read-from-the-server, never "watch it update live" (see
each area file's "what proof to collect"). Sign in with your own runtime's
`$HT_PRODUCTION_STORAGE_STATE_FILE`. `zsb` is Valentin's visible browser, not
yours; use it only when he needs to watch.

## QA runner accounts

Three tiered accounts, state files at `~/.config/ht-qa/state-{free,byok,pro}.json`.
Names may still change: `e2e/smoke/lib/tier.ts` currently uses
`free`/`light`/`premium` as free-form tier labels and the free/light/premium
to Free/BYOK/Pro plan mapping is unconfirmed. Keep the account names in this
one file so renaming them is a one-line edit, not a grep-and-replace:

- `free` → `~/.config/ht-qa/state-free.json`
- `byok` → `~/.config/ht-qa/state-byok.json`
- `pro` → `~/.config/ht-qa/state-pro.json`

Each account writes only to its own private **"QA runner board"**
(`e2e/smoke/lib/boardSetup.ts` enforces solo ownership, no other members).
Never write to a board you don't own, and never use another account's state
file.

The real plan ids in `src/lib/subscriptionPlans.ts` are `Free`, `AI`, `Pro`,
and `BYOK`; none of those exactly match `free`/`light`/`premium` either, so
`HT_QA_EXPECTED_PLAN` needs a confirmed mapping before it can gate a
pass/fail. Open question, not yet resolved.

**These tiered accounts are plain customer accounts, not `OWNER_AND_QA`
flagged accounts.** A flag-gated ticket still needs the existing flagged
pair from `RULES-product.md`: `storageState-qa.json` (userId 985) and
`storageState-qa-normal.json` (userId 2343). Use the tiered accounts for
plan-specific behavior, the flagged pair for anything behind a feature flag.

## Before/after for a fixed ticket

1. Read the ticket. Pick the area file(s) it touches from the table above.
2. **When the PR opens**, capture a "before" screenshot on production
   (`app.hypertask.ai`, the bug as it exists today) per that area's proof
   section.
3. **Once the fix is live**, capture the matching "after" screenshot the same
   way.
4. Attach both to the ticket with `--attach` (never embed as markdown
   images). Say in the comment what changed between the two.
5. Run the area's cleanup step so the QA account boards stay clean for the
   next run.
