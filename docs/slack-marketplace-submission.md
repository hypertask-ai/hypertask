# Slack Marketplace submission package (HTPR-4857)

Everything an agent can prepare for the Slack Marketplace review of the
Hypertask Slack app. Decisions made: the listing uses the **same dedicated
Hypertask-owned Slack app** that already runs the integration (owner decision,
2026-09-09). Final account authorization is a deployment step, not a design
blocker.

## Valentin's deployment checklist (only you can do these)

1. Legal pages Slack reviewers can reach **without a login**: privacy policy
   URL and support URL. hypertask.app paths currently sit behind Cloudflare
   Access for this VPS; confirm they are truly public or host them elsewhere.
2. App ownership: the Slack app must live in the Hypertask-owned workspace
   (see HTPR-4826 / the HTPR-4826-linked decision). Marketplace ownership can
   never be changed after creation.
3. In the Slack app config: turn on distribution, add the event subscriptions
   `app_uninstalled` and `tokens_revoked` (request URL stays
   `https://app.hypertask.ai/api/slack/events`), and keep the request URL /
   redirect URL exactly as configured today.
4. Fill the app-directory form: name, short + long description, icon,
   screenshots (Settings → Slack page and the bot in action).
5. Flip feature flag `htpr-4857-add-to-slack` to **Everyone** at
   https://app.hypertask.ai/admin/flags right before submitting. While it is
   Owner+QA, /add-to-slack 404s for anonymous visitors and the Marketplace
   callback resumes to `invalid_state`.
6. Submit, then answer reviewer questions from the sections below.

## What exists in the product (for the directory form)

- Install: https://app.hypertask.ai/add-to-slack (public, once the flag is
  Everyone). Slack's own "Add to Slack" button goes straight to the authorize
  screen and returns to `/api/slack/oauth_redirect` with a code and no state;
  the app then sends the visitor through Hypertask login and Settings finishes
  the link. No bot token is stored before a Hypertask team is linked.
- Connect: Settings → Slack (per Hypertask team; one Slack workspace per
  Hypertask team). Users can be linked to Slack identities per install.
- Features: `/hypertask` slash command, thread watching with summaries,
  assistant sidebar chat, mention-to-task creation.

## Scope justification (reviewers scrutinize every scope)

| Scope | Why it is needed |
| --- | --- |
| app_mentions:read | Receive @-mentions so users can create tasks and ask questions. |
| assistant:write | Post responses inside Slack's assistant sidebar. |
| channels:history | Read public-channel threads **only after a user asks the bot to watch that thread** (thread summaries). No bulk backfill, no untargeted reads. |
| commands | The `/hypertask` slash command (task creation, connect, help). |
| groups:history | Same thread-watching as channels:history, for private channels a user explicitly adds the bot to. |
| im:history | Read the user's direct messages with the bot to answer questions and create tasks. |
| chat:write | Post task confirmations, thread summaries, and assistant replies as the bot. |
| team:read | Show the Slack workspace name in Settings so users can verify the connected workspace. |
| users:read | Match Slack member IDs to Hypertask accounts for attribution and mentions. |
| users:read.email | Match by email address when Slack does not expose the Hypertask account otherwise; used once during user linking. |

Honest answer to "why channels:history": the bot cannot summarize a thread it
was invited into without reading the messages in it. Reads are bounded to
threads with a `SlackWatchedThread` checkpoint row, which a user must create.

## Data-handling answers

What we store per connected workspace (all rows cascade from `SlackInstall`):

- `encryptedBotToken` — the bot token, encrypted at rest.
- `slackTeamId`, `slackTeamName`, `botUserId`, `installedByUserId`.
- `SlackWatchedThread` — thread checkpoints (channel, thread timestamp, last
  message timestamp, referenced Hypertask task ids) for threads a user asked
  us to watch.
- `SlackUserLink` — Slack member id ↔ Hypertask user id, created only when the
  member runs `/ht connect`.

Retention: kept while the install exists; nothing else is derived from Slack
messages. Tasks a user creates from Slack live in their Hypertask team as
normal user content and are not deleted on uninstall (they are Hypertask data,
not Slack app data). Application logs may transiently contain error traces
that quote a message.

Deletion on uninstall: the Slack app config must subscribe to `app_uninstalled`
and `tokens_revoked`; both delete the `SlackInstall` row and, via cascade, the
watched-thread checkpoints and user links. `tokens_revoked` only ends the
install when the **bot** identity was revoked (a member's user-token
revocation does not). A delayed event never deletes an install that was
re-created after the event happened (`updatedAt` vs event timestamp). Retry
deliveries are no-ops.

Not stored: Slack message contents beyond the checkpoint timestamps above,
user OAuth tokens (we never exchange a user token), and anything from
workspaces that installed but never connected a Hypertask team.

## Verification

- `node --test tests/slack-uninstall.test.ts` covers the deletion matrix.
- With the flag on: `/add-to-slack` renders for anonymous visitors;
  `/api/slack/oauth_redirect?code=x` (no state) redirects to
  `/login?returnTo=%2Fsettings%2Fslack`, and with a Hypertask session straight
  to `/settings/slack`. With the flag off both keep the pre-launch behavior.
