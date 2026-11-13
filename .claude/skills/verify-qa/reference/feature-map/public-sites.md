# Public sites

## Sub-features

- `public-sites-marketing` Marketing site at https://hypertask.ai/.
- `public-sites-docs` Documentation at https://docs.hypertask.ai/.
- `public-sites-help` Help site at https://help.hypertask.ai/.

## How to get to it (user POV)

Open the affected public URL without signing in. Follow the path in the ticket from a public entry point to the changed page or action.

## Driving it with agent-browser

1. Confirm the ticket's merged commit has a successful production deployment for the affected site. Record its commit and deployment link.
2. Open the affected production URL in a headless browser without saved login state. Exercise the ticket's exact path and check the result after reload.
3. Check affected links and navigation from the public entry point. Capture a screenshot and record the URL and observed result. For a visible layout change, follow the desktop and phone capture requirements in verify-qa.
4. Check unaffected public paths named in the ticket. Do not submit real customer messages or create permanent data to test a form.

## Gotchas

- The marketing, docs and help sites deploy separately from the app. Verify the affected site's deployment, not the app deployment.
- A successful HTTP response alone does not prove the changed content or interaction works.
- Public pages should work without an app login. Do not use Valentin's browser or account.

### What proof to collect

Use `Feature map: .claude/skills/verify-qa/reference/feature-map/public-sites.md` in the proof file. Record the deployed merge SHA, deployment success, run folder, observed cases and non-empty screenshot evidence as required by verify-qa.

### Cleanup

Remove any temporary local files or disposable test data created for the check. Do not delete customer data.
