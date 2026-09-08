# AI directory submissions (HTPR-4638)

Prepared submission package for listing Hypertask in the **Anthropic connector
directory** (Claude) and the **ChatGPT apps/connectors directory** (OpenAI).
The repository work for this ticket is preparation only: both submissions are
submitted by an organisation owner through the vendor portals, because only the
owner can accept the vendor policy terms.

## Verified production prerequisites

Every endpoint a directory reviewer will probe was verified live on
2026-09-08 (`curl` status in parentheses):

| What | URL | Status |
| --- | --- | --- |
| MCP server (Streamable HTTP) | `https://mcp.hypertask.ai/mcp` | live (401 without token, correct) |
| MCP server (SSE fallback) | `https://mcp.hypertask.ai/sse` | live |
| Protected-resource metadata | `https://mcp.hypertask.ai/.well-known/oauth-protected-resource` | live (200) |
| Same metadata, app host | `https://app.hypertask.ai/.well-known/oauth-protected-resource` | live (200) |
| Authorization-server metadata | `https://app.hypertask.ai/.well-known/oauth-authorization-server` | live (200) |
| OAuth endpoints | `https://app.hypertask.ai/oauth/{authorize,token,register,revoke}` | live (register = 400 on empty body, endpoint up) |
| Consumer connect page | `https://app.hypertask.ai/connect` → `https://app.hypertask.ai/settings/mcp` | live (307) |
| Logo (stable, square) | `https://app.hypertask.ai/logo.png` | live (200) |
| Large icon | `https://app.hypertask.ai/icon-512x512.png` | live (200) |
| Docs | `https://docs.hypertask.ai/mcp/overview/` | live (200) |
| Privacy policy | `https://hypertask.ai/privacy/` | live (200) |
| Terms | `https://hypertask.ai/terms/` | live (200) |
| Support | `help@hypertask.ai` | — |

OAuth 2.1 with dynamic client registration (PKCE, S256, no client secret) is
already verified end to end from real consumer Claude and ChatGPT accounts
(HTPR-4636). No code change is required for the listings.

## Shared listing content

- **Name:** Hypertask
- **One-line description:** AI-powered project boards where humans and AI agents work side by side.
- **Long description:** Connect Hypertask and Claude or ChatGPT can read and
  write your boards, tasks, comments, and task pages on your behalf. Sign in
  once with your Hypertask account — no API keys.
- **Category:** Productivity / Project management
- **MCP server URL:** `https://mcp.hypertask.ai/mcp`
- **Privacy policy:** `https://hypertask.ai/privacy/`
- **Terms:** `https://hypertask.ai/terms/`
- **Support:** `help@hypertask.ai`, `https://docs.hypertask.ai/`
- **Icon:** `https://app.hypertask.ai/icon-512x512.png` (512×512 PNG)

## Anthropic connector directory

Submission is a portal form on Anthropic's side and requires an organisation
owner to accept Anthropic's policy terms. Field mapping:

1. **Server URL** — `https://mcp.hypertask.ai/mcp` (Anthropic's client performs
   RFC 9728 discovery against this host; the metadata above answers it).
2. **Auth** — OAuth 2.1, dynamic client registration, PKCE S256.
3. **Name / description / icon / category** — see shared listing content.
4. **Privacy policy URL** — `https://hypertask.ai/privacy/`.
5. **Support contact** — `help@hypertask.ai`.

## ChatGPT apps / connectors directory

OpenAI's flow is: build MCP server → authenticate users (OAuth) → connect and
test your plugin → submit and publish, reviewed against their MCP server review
requirements. Field mapping:

1. **MCP server URL** — `https://mcp.hypertask.ai/mcp`.
2. **Authentication** — OAuth, authorization server `https://app.hypertask.ai`.
3. **Publisher identity + domain verification** — verify `app.hypertask.ai`
   (and `mcp.hypertask.ai`) in the OpenAI portal; this is owner-click only.
4. **Listing content** — see shared listing content.
5. **Review/test credentials** — provide a free Hypertask test account with a
   small sandbox board (create one at submission time; do not ship a production
   account).
6. **Test cases** — the reviewer test plan below.

## Reviewer test plan (both directories)

1. Connect with OAuth from a fresh consumer account; sign in lands on the
   Hypertask consent screen and returns to the assistant connected.
2. `list_tasks` on the sandbox board returns its tasks.
3. `create_task` adds a task; the board shows it in the Hypertask UI.
4. `add_comment` posts a comment; the comment is visible on the ticket.
5. Disconnect/revoke in Hypertask settings (`/settings/mcp`) invalidates the
   session; subsequent tool calls fail.

## Owner submission checklist (~2 minutes each)

1. Open the Anthropic directory submission portal, paste the values from
   "Anthropic connector directory" above, accept the policy terms, submit.
2. Open the OpenAI app submission portal, verify both `app.hypertask.ai` and
   `mcp.hypertask.ai` domains when prompted, paste the values from
   "ChatGPT apps" above, attach the sandbox test account, submit.
3. Note both submission confirmation emails in this ticket so review status can
   be tracked.
