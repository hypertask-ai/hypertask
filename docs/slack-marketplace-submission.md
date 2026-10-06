# Slack Marketplace submission package (HTPR-4857, HTPR-6921)

Code preparation for the Slack Marketplace review of the Hypertask Slack app.
The listing uses the same dedicated Hypertask-owned Slack app that already
runs the integration (owner decision, 2026-09-09). Real-workspace parity QA
and retiring the Worker bot are separate deployment steps, not completed by
this code change. Do not retire the Worker before live parity is verified.

## Owner's deployment checklist

1. Confirm reviewers can reach these pages without login:
   - Privacy policy: https://hypertask.ai/privacy/
   - Terms: https://hypertask.ai/terms/
   - Support: https://app.hypertask.ai/slack/support
   - Install: https://app.hypertask.ai/add-to-slack
2. Confirm the Slack app is owned by Hypertask. Marketplace ownership cannot
   be changed after creation.
3. Turn on app distribution and apply `docs/slack-app-manifest.json` to the
   existing app configuration.
   It includes `app_uninstalled` and `tokens_revoked` at
   `https://app.hypertask.ai/api/slack/events`. Keep the request and redirect
   URLs unchanged. Keep **organization-wide deployment off**:
   `org_deploy_enabled` stays `false` because OAuth requires a workspace
   `team.id`; enterprise-only installs are not supported yet.
4. Fill the directory form: name, short and long description, icon, and
   screenshots of Settings, Slack, and the bot in action.
5. After Owner + QA verification, the owner must set both
   `htpr-4857-add-to-slack` and `htpr-6921-slack-marketplace` to **Everyone** at
   https://app.hypertask.ai/admin/flags before submission. The new flag defaults
   to **Owner + QA**, not Everyone. While restricted, the install and support
   pages return 404 for anonymous visitors under their respective flags;
   the new legal/support links on Add to Slack also stay hidden. The no-state
   Marketplace callback requires the install flag to resume via login.
6. Verify parity in a real workspace, submit, and answer reviewer questions.
   Neither this document nor the local tests prove a live install or review.

## What exists in the product

- Install: https://app.hypertask.ai/add-to-slack once its flag is Everyone.
  Slack's own Add to Slack button can return to `/api/slack/oauth_redirect`
  with a code and no state. Hypertask then sends the visitor through login
  and Settings finishes the link. No bot token is stored before a Hypertask
  team is linked.
- Connect: Settings, then Slack; one Slack workspace per Hypertask team.
  Set a default project for thread-to-task creation.
- Personal identity: `/ht connect` links an account through confirmation.
  The app can also automatically link a confirmed Slack email to exactly
  one verified member of the connected Hypertask team. `/ht disconnect`
  removes the link; with `htpr-6817-slack-app` enabled it persistently blocks
  automatic relinking until `/ht connect`. With that rollout off, legacy
  automatic email linking can occur again.
- Features: `/ht` commands, task creation from thread mentions, watched-thread
  summaries on Hypertask tickets, direct messages, and assistant sidebar chat.
  Actions enforce the linked user's existing Hypertask permissions.
- Support: https://app.hypertask.ai/slack/support and help@hypertask.ai.
- Team disconnect: Disconnect in Hypertask's Slack settings deletes the
  installation locally but does not uninstall the Slack app. Remove the app
  through Slack's app management to uninstall from the workspace.

## Scope justification

| Scope | Why it is needed |
| --- | --- |
| app_mentions:read | Receive mentions for task creation and questions. |
| assistant:write | Post replies inside Slack's assistant sidebar. |
| channels:history | Read public-channel threads for requested task creation and watched-thread summaries. No bulk backfill or untargeted reads. |
| commands | Support `/ht` commands, including task actions, connect, disconnect, and help. |
| groups:history | Read the same requested threads in private channels where the bot has been added. |
| im:history | Read direct messages with the bot to answer requests. |
| chat:write | Post task confirmations, summaries, and assistant replies. |
| team:read | Show the connected Slack workspace name in Settings. |
| users:read | Resolve member identities and participant names for attribution. |
| users:read.email | Check confirmed email against verified Hypertask team members during automatic linking. |

Thread summaries use `SlackWatchedThread` checkpoints; requested thread-to-task
creation also reads the source thread. Relevant Slack text is sent to the team's
configured AI service to interpret requests and generate tasks or summaries.

## Data-handling answers

Database data associated with `SlackInstall`:

- Encrypted bot token; Slack workspace ID and name; bot and installer IDs;
  connected Hypertask team ID; optional default project; creation/update dates.
- `SlackWatchedThread`: channel ID, thread and checkpoint timestamps, and
  referenced Hypertask task IDs.
- `SlackUserLink`: Slack member ID and Hypertask user ID, created through
  explicit connection or confirmed unique email matching.

Other retained data:

- With `htpr-6817-slack-app` enabled, Redis stores recent conversation text and
  bot results, bounded to **8,000 bytes per history**, plus assistant channel,
  workspace, and enterprise metadata. It is isolated by install, Slack user,
  channel, thread, and Hypertask user. A **24-hour TTL**, refreshed on history
  or context writes, bounds retention after the last write.
- Redis rate-limit counters expire after 60 seconds. Personal disconnect
  markers store a Hypertask user ID under the install and Slack user IDs,
  have no expiry, and are cleared on reconnect. Redis persistence is required
  to preserve the automatic-linking opt-out.
- `SlackEventReceipt` stores deduplication IDs and creation dates for events,
  commands, and single-use linking confirmations. These do not cascade from
  an installation and are not deleted on uninstall.
- Tasks and comments created from Slack, including generated summaries,
  participant attribution, and Slack links, remain normal Hypertask content.
  Error logs may contain error traces from processing requests.

Uninstall and revocation delete the `SlackInstall` row and cascade to its
watched-thread checkpoints and user links. `tokens_revoked` deletes an install
only when its bot identity was revoked, not a member's user token. Delayed
events do not delete a newer reinstall; retries are safe no-ops.

Redis conversation data is not purged immediately on uninstall; it expires
under the 24-hour TTL. Disconnect markers remain namespaced to the old install
ID and do not affect a new install. Hypertask content and deduplication receipts
remain. Team disconnect in Settings performs the same local database deletion
without revoking the Slack installation.

We do not store user OAuth tokens or bot tokens for workspaces that never
connect to a Hypertask team. We do store the bounded message history described
above; a claim that no message contents are stored would be inaccurate.

## Verification

- `node --test tests/slack-app-docs.test.cjs tests/feature-flags.test.cjs tests/slack-marketplace.test.cjs`
  checks manifest events, defaults, server gating, public-route exemptions,
  legal/support links, and `/ht` copy.
- With the install flag Everyone, `/add-to-slack` renders anonymously and the
  no-state callback resumes through login and Settings. With the Marketplace
  flag Everyone, `/slack/support` renders anonymously. With it Off, the support
  page calls `notFound()` and new links are absent from Add to Slack.
- Live workspace verification, Slack configuration changes, Marketplace
  submission, and Worker retirement still need deployment evidence.
