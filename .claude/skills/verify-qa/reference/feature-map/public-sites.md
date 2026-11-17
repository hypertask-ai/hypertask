# Public sites

## Sub-features

- `public-sites-marketing` Marketing site at https://hypertask.ai/.
- `public-sites-docs` Documentation at https://docs.hypertask.ai/.
- `public-sites-help` Help site at https://help.hypertask.ai/.
- `developers-redirect` Open `/developers` with no session. The page redirects to https://docs.hypertask.ai/api/rest-api/.
- `whole-help-articles` With `htpr-7825-whole-help-articles` on, help search returns each matching article in full after the HTML is stripped. Off, each article stops at the first 1500 characters. The in-app AI tool `search_help_docs` and the MCP help search both use this. A failed flag read still returns the full text.

## How to get to it (user POV)

Open the affected public URL without signing in. Follow the path in the ticket from a public entry point to the changed page or action.

`/developers` is an app URL. It does not render a page. It redirects to the REST API page on the docs site. Help search runs inside the app AI and the MCP help tool. It fetches articles from https://help.hypertask.ai . The flag `htpr-7825-whole-help-articles` ships with default Everyone.

## Driving it with agent-browser

1. Confirm the ticket's merged commit has a successful production deployment for the affected site. Record its commit and deployment link.
2. Open the affected production URL in a headless browser without saved login state. Exercise the ticket's exact path and check the result after reload.
3. Check affected links and navigation from the public entry point. Capture a screenshot and record the URL and observed result. For a visible layout change, follow the desktop and phone capture requirements in verify-qa.
4. Check unaffected public paths named in the ticket. Do not submit real customer messages or create permanent data to test a form.
5. Open `/developers` with no saved login and record the final URL. Ask the in-app AI a product how-to that calls `search_help_docs`, then compare an answer with `htpr-7825-whole-help-articles` on against the same question with the flag off. On includes text past the first 1500 characters of the article. Off stops there.

## Gotchas

- The marketing, docs and help sites deploy separately from the app. Verify the affected site's deployment, not the app deployment.
- A successful HTTP response alone does not prove the changed content or interaction works.
- Public pages should work without an app login. Do not use Valentin's browser or account.
- `/developers` is a redirect. A 200 on the docs site is the result. The app URL itself does not stay on screen.
- Help search waits at most 8 seconds for the help site. A failed article fetch keeps the search excerpt.

### What proof to collect

Use `Feature map: .claude/skills/verify-qa/reference/feature-map/public-sites.md` in the proof file. Record the deployed merge SHA, deployment success, run folder, observed cases and non-empty screenshot evidence as required by verify-qa. For `/developers`, record the final docs URL. For `htpr-7825-whole-help-articles`, record one article's returned length with the flag on and with the flag off.

### Cleanup

Remove any temporary local files or disposable test data created for the check. Do not delete customer data.
