# Product rules

Rules for a Valentin's Claude Code session working the Hypertask product
(board 15, repo `hypertask-ai/hypertask`). Board writes go through `vcc`.
Reads go through the plain `hypertask` CLI. Never assign userId 6.


## Done means verified on production

A ticket is done when the production deployment for the merge sha is
`success` and `verify-qa` passed with evidence. A merge or a local commit
is not done.

## Flags

New behaviour ships behind a flag named after the ticket, default Owner + QA.
Bug fixes ship behind a ticket-named flag with `kind: "bugfix"`, on for Everyone by default (Valentin, 2026-10-06). Fixes to saved data, security and crashes keep shipping with no flag. Bugfix flags get the same cleanup after 14 days on Everyone. Feature and new-behaviour flags still default Owner + QA; developers never switch a feature flag to Everyone. A `[BUGFIX]` title is only a hint.

Check the mode before judging a flagged feature. `OWNER_AND_QA` is the
expected feature/improvement mode. Bugfix flags default to `EVERYONE`. `OWNER_ONLY` and an unapproved feature `EVERYONE` are failures.
User 985 (`~/.config/hypertask-videos/storageState-qa.json`) sees Owner + QA
flags. User 2343 (`storageState-qa-normal.json`) is the flag-off account.
Pass the file with `--state`. Never print it. Never use Valentin's account.

## Phone width

A UI change needs a real 390x844 screenshot on production before a pass.
A desktop window or a code reading is not that check (Valentin, 2026-09-11).

## Fixtures and data

Clean up only fixtures you created, through the product UI, never SQL.
Never read or write ticket content through Prisma, SQL, or a database client.

## Board

Comments are HTML (`<p>`, `<strong>`, `<a>`). Use the full ticket URL.
The final comment says what the user will notice, in plain language.
After every move, read the ticket back. If Valentin assigned himself or
moved the ticket by hand, leave it as he left it.
