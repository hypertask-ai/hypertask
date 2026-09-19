# AI directory submissions

Operational runbook for [the Hypertask directory listing ticket](https://app.hypertask.ai/detail/project-15/4638).
A listing is complete only when the vendor portal shows it as approved and the
public directory can find Hypertask. A pull request or submitted draft is not
acceptance.

## Release gate

The vendor-specific MCP catalogs are behind
`htpr-4638-ai-directory-metadata`, which defaults to Owner and QA. The OpenAI
catalog adds a title plus explicit read-only, destructive, and open-world hints
to every existing tool. The Anthropic catalog exposes only single-purpose tools
with neutral descriptions and marks each as read-only or destructive. Turn the
flag on for Everyone before either portal scans production. Only the product
owner changes release mode at `https://app.hypertask.ai/admin/flags`.

The OpenAI domain challenge endpoint is disabled unless
`OPENAI_APPS_CHALLENGE_TOKEN` contains the exact token issued by the submission
portal. It returns 404 when unset. Set the production value, redeploy, complete
domain verification, then remove the value after verification succeeds.

## Live production prerequisites

These public endpoints were checked on 2026-09-19:

| What | URL | Expected result |
| --- | --- | --- |
| MCP server | `https://mcp.hypertask.ai/mcp` | 401 without a token |
| Protected-resource metadata | `https://mcp.hypertask.ai/.well-known/oauth-protected-resource` | 200 |
| Authorization-server metadata | `https://app.hypertask.ai/.well-known/oauth-authorization-server` | 200 |
| OAuth endpoints | `https://app.hypertask.ai/oauth/{authorize,token,register,revoke}` | Public machine endpoints |
| Connect page | `https://app.hypertask.ai/connect` | Login, then MCP settings |
| Logo | `https://app.hypertask.ai/logo.png` | 200 |
| Large icon | `https://app.hypertask.ai/icon-512x512.png` | 200 |
| MCP documentation | `https://docs.hypertask.ai/mcp/overview/` | 200 |
| Privacy policy | `https://hypertask.ai/privacy/` | 200 |
| Terms | `https://hypertask.ai/terms/` | 200 |
| Support | `help@hypertask.ai` | Monitored inbox |

OAuth 2.1 uses dynamic client registration, PKCE S256, and no client secret.
The production MCP endpoint supports Streamable HTTP.

## Shared listing content

- **Name:** Hypertask
- **Tagline:** Turn plans into shared boards for people and AI.
- **Description:** Hypertask gives people and AI agents one place to plan work,
  manage tasks, discuss decisions, and track delivery. Connect once with OAuth
  so Claude or ChatGPT can work on the boards the signed-in user can access.
- **Categories:** Productivity, Project management
- **Website:** `https://hypertask.ai/`
- **Anthropic MCP server:** `https://mcp.hypertask.ai/mcp?directory=anthropic`
- **OpenAI MCP server:** `https://mcp.hypertask.ai/mcp?directory=openai`
- **Documentation:** `https://docs.hypertask.ai/mcp/overview/`
- **Privacy policy:** `https://hypertask.ai/privacy/`
- **Terms:** `https://hypertask.ai/terms/`
- **Support:** `help@hypertask.ai`
- **Icon:** `https://app.hypertask.ai/icon-512x512.png`

## Anthropic submission

Official requirements:
`https://claude.com/docs/connectors/building/submission`.

Portal:
`https://claude.ai/admin-settings/directory/submissions/new`.

1. Use a Team or Enterprise organization with Directory management access.
2. Submit a remote MCP server with the universal URL
   `https://mcp.hypertask.ai/mcp?directory=anthropic` and Streamable HTTP
   transport.
3. Confirm OAuth with dynamic client registration and PKCE.
4. Run the portal tool sync. Resolve every missing-title or missing-annotation
   warning before continuing.
5. Enter the shared listing content, use cases, data handling answers, and a
   populated reviewer account with no MFA or email verification step.
6. Accept the Software Directory terms and all seven compliance statements,
   then submit.
7. Record the portal submission ID and status below. After approval, verify a
   consumer can search for Hypertask and install it from Claude's directory.

Anthropic requires every tool to have a title and the applicable
`readOnlyHint` or `destructiveHint`. The portal groups tools by those values and
blocks submission when metadata is missing.

## OpenAI submission

Official requirements:
`https://developers.openai.com/plugins/deploy/submission`.

Portal:
`https://platform.openai.com/plugins`.

1. Use an OpenAI organization with a verified Hypertask business identity and
   Apps Management write access.
2. Create a plugin with **With MCP**, choose a universal URL, and enter
   `https://mcp.hypertask.ai/mcp?directory=openai`.
3. If the portal requests domain verification, copy its token into
   `OPENAI_APPS_CHALLENGE_TOKEN`, deploy, and let the portal read
   `https://mcp.hypertask.ai/.well-known/openai-apps-challenge`.
4. Configure OAuth and provide a populated reviewer account with no MFA or
   email verification step.
5. Select **Scan Tools**. Confirm every tool has a title plus explicit
   `readOnlyHint`, `destructiveHint`, and `openWorldHint` values.
6. Add the listing content, starter prompts, five positive tests, three negative
   tests, supported countries, policy attestations, and release notes.
7. Submit for review and record the portal submission ID and status below.
   After approval, select **Publish**, then verify public discovery in ChatGPT.

## OpenAI reviewer tests

Positive tests:

1. Connect with OAuth and list the review account's boards.
2. List tasks on the populated sandbox board.
3. Search for a known sandbox task and open its details.
4. Create a task in the sandbox board and confirm it appears in Hypertask.
5. Add a comment to that task and confirm it appears in Hypertask.

Negative tests:

1. Request a board outside the review account. Expect access denied and no data.
2. Try to create a task without a board or title. Expect a validation error and
   no task.
3. Revoke the OAuth connection, then call a read and a write tool. Expect an
   authentication error and no write.

## Acceptance evidence

Do not mark a row approved from an email alone. Add the public listing URL and
confirm search and one-click installation from a fresh consumer account.

| Directory | Submission ID | Portal status | Public listing | Consumer install check |
| --- | --- | --- | --- | --- |
| Anthropic | Not submitted | Not submitted | None | Not run |
| OpenAI | Not submitted | Not submitted | None | Not run |
