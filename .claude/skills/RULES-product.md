# Product rules

Rules for a Valentin's Claude Code session working the Hypertask product
(board 15, repo `hypertask-ai/hypertask`). Board writes go through `vcc`.
Reads go through the plain `hypertask` CLI. Never assign userId 6.


## Done means verified on production

A ticket is done when the production deployment for the merge sha is
`success` and `verify-qa` passed with evidence. A merge or a local commit
is not done.

## Flags

New behaviour ships behind a ticket flag with explicit `defaultMode: "EVERYONE"`, unless `releaseRisk.highRisk` is set (`money`, `access`, `data-deletion`, `customer-email`) or kind is `internal`. Existing flags keep their current mode (HTPR-7389).
Bug fixes ship behind a ticket-named flag with `kind: "bugfix"`, on for Everyone by default (Valentin, 2026-10-06). Fixes to saved data, security and crashes keep shipping with no flag. Bugfix flags get cleanup after 7 days on Everyone; money, access and data-deletion flags stay at 14 days. The daily cron at `/api/cron/feature-flag-removals` files the removal ticket and does not switch the flag. New feature and improvement flags set `defaultMode: "EVERYONE"` in their definition file unless `releaseRisk.highRisk` is set (`money`, `access`, `data-deletion`, `customer-email`) or kind is `internal`; existing flags keep their current mode (Valentin, 2026-10-20, HTPR-7389). A `[BUGFIX]` title is only a hint.

Check the declared and stored mode before judging a flagged feature. New eligible flags explicitly use `EVERYONE`; existing flags keep their current mode. High-risk flags explicitly use `OWNER_AND_QA`; bugfix flags otherwise inherit `EVERYONE`.
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
