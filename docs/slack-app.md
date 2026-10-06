# Official Hypertask Slack app

The app reuses the production Slack installation, encrypted bot token, user links, shared task controllers and ambient summaries. Archived PR #2155 already exists in production; this port completes its missing conversational creation, assistant context and identity edge cases instead of duplicating it. Worker source was compared read-only for parity.

## Rollout

`htpr-6817-slack-app` is server-side and defaults to Owner + QA. For linked Slack users it is evaluated against their Hypertask user, not the installer. Before linking, the installer's flag setting lets users reach the connection flow. Authorization always requires the actual person's accepted membership of the installing Hypertask team and current project access.

When off, production's existing slash commands, private mention replies, DMs, default-project thread creation, account linking and ambient summaries are unchanged. When on:

- Natural-language creation with a named project uses the same tools as DMs, instead of being intercepted by default-project thread creation. Explicit requests to create from this thread still draft the thread into the default project.
- Assistant started/context-changed events retain workspace-bound channel metadata. Subsequent chat turns retain recent messages and results, bounded to 8,000 characters, isolated by install, Slack user, channel, thread and real Hypertask user, with a 24-hour Redis TTL. Context is untrusted reference data, not authority; it never grants access to the originating channel or a Hypertask project.
- `/ht disconnect` suppresses automatic email relinking until `/ht connect`. This marker has no expiry and relies on persistent Redis, like the existing action limiter. Redis loss removes the opt-out, so retain Redis persistence. Flag off ignores the marker to preserve legacy behavior.
- Bot/deleted Slack accounts cannot auto-link, and membership is rechecked after concurrent link creation.

All user actions run as the linked person. Ambient summaries continue to post as the HyperAI integration identity. There is no workspace-wide Hypertask token fallback. Channel task results remain ephemeral to avoid exposing private boards to other channel members.

## Slack application configuration

Apply `docs/slack-app-manifest.json` to the official Hypertask app, not the Worker app. Reauthorize existing installs after adding scopes; editing the manifest alone does not update granted OAuth scopes. Slack's assistant/agent messaging experience must be enabled in app settings. Keep its existing experience; converting legacy `assistant_view` to `agent_view` is irreversible and is not part of this code change. The Messages tab must be enabled and writable for DMs.

### Bot scopes

| Scope | Purpose |
| --- | --- |
| `app_mentions:read` | Receive direct mentions of the app. |
| `commands` | Receive `/ht` slash commands. |
| `chat:write` | Post Block Kit responses, ephemeral channel replies and assistant welcomes. |
| `assistant:write` | Enable Slack assistant conversations. |
| `im:history` | Receive DM messages, including assistant-thread replies. |
| `channels:history` | Read public-channel thread source for ticket creation and ambient summaries. |
| `groups:history` | Read private-channel thread source where the app has been invited. |
| `users:read` | Resolve Slack user names and profiles. |
| `users:read.email` | Auto-match a confirmed Slack email to exactly one verified Hypertask member within the installing team. Missing permission or no verified match prompts `/ht connect`. |
| `team:read` | Resolve workspace information for installation. |

### Endpoints

| Surface | URL | Authentication |
| --- | --- | --- |
| `/ht` command request | `https://app.hypertask.ai/api/slack/commands` | Slack v0 signature over the raw form body, with a five-minute timestamp window. |
| Events request | `https://app.hypertask.ai/api/slack/events` | Same Slack signature check, including URL-verification challenges. |
| OAuth redirect | `https://app.hypertask.ai/api/slack/oauth_redirect` | Slack OAuth code exchange and signed, short-lived install state. |
| Start install | `https://app.hypertask.ai/api/slack/install` | Authenticated Hypertask session and installing-team access. |
| Connect confirmation page | `https://app.hypertask.ai/settings/slack/link` | Authenticated Hypertask session and signed user-bound state. |
| Browser connection confirmation | `https://app.hypertask.ai/api/slack/link` | Authenticated Hypertask session, team membership and single-use signed state. Not a Slack webhook. |

No new ingress endpoint is needed. Keep interactivity disabled: task-card buttons are URL links. Do not configure the Worker's unsigned no-op interactions endpoint.

Subscribe to `app_mention`, `message.im`, `message.channels`, `message.groups`, `assistant_thread_started`, `assistant_thread_context_changed`, `app_uninstalled` and `tokens_revoked`. Existing signed uninstall/token-revocation handling remains active. Event IDs and command trigger IDs prevent retries from repeating writes. Vercel background work performs the model/tool actions after acknowledgement. The existing shared Redis rate limit fails closed.

Runtime configuration uses `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`, the app's existing encrypted-secret configuration, `REDIS_URL` and the team's AI gateway configuration. Never expose any of their values in documentation, test output or logs.

## Commands and tools

The thirteen slash commands are `create`, `search`, `list`, `view`, `comment`, `assign`, `move`, `update`, `inbox`, `projects`, `help`, `connect`, `disconnect`. Run `/ht help` for arguments. Creation requires a title and `--project`; quoted project names are supported.

Mentions and DMs support the same fourteen actions as the Worker: `create_task`, `get_task`, `list_tasks`, `search_tasks`, `move_task`, `add_comment`, `assign_user`, `add_follower`, `remove_follower`, `update_task`, `list_projects`, `list_sections`, `list_inbox`, `archive_inbox`. Task cards, task lists, project lists and inbox lists use Block Kit and app links.

Auto-match requires Slack's confirmed email and a verified Hypertask email, without ambiguous matches. If it fails, `/ht connect` produces a ten-minute signed link. The browser verifies the Hypertask session and team membership, then the same Slack person completes `/ht connect <confirmation>`. Both tokens are single-use. Forwarding the browser link cannot impersonate its recipient without that second Slack confirmation.

## Local proof and deferred operations

Run `node --test tests/slack-app-*.test.cjs tests/slack-integration.test.cjs` for signature, command, identity, conversation, flag-off, controller and manifest coverage. Run `node tests/slack-app-checks.cjs` for project typecheck and changed-file lint.

Live Slack verification and updating the official app's configuration require a later deployment. Marketplace legal/public pages, org-wide installation and distribution approval are separate follow-up work for Valentin. Do not uninstall or decommission the Worker or `slack.hypertask.ai` until parity has passed live verification. This branch does not perform those operations.
