# Repo board exceptions

The decision-location sentence applies to asking for a decision. A chat decision already made must still be recorded before acting, per global boards.md. Database exceptions below never authorize direct board-content access.

logs and session notes go to run activity.

Never ask him in chat or in a pull request.

Direct database writes are only for migrations, schema work, requested data repair or local seed data. Why: https://app.hypertask.ai/detail/project-15/3891 and https://app.hypertask.ai/detail/project-15/3892.

## Hypertask Ticket Access

Treat app detail URLs as tickets. Read through the CLI or product interface first. If access fails, obtain the ticket text or authorization context; never inspect the database.

Use full clickable ticket URLs in human communication. Runners never navigate Valentin's browser. Use headless QA accounts, never his login or cookies.

## Ticket comments

Use the shared `tickets` skill. Human comments use `question`, `qa`, or `done`, plain words, and short sentences. Plans, retries, logs, and handoffs belong in agent activity. Keep people comments to an answer, then Gap / Fix / Status.

Use either plain text or complete HTML, not mixed formatting. Links need HTML anchors. Edit an owned comment in place instead of reposting it. Before Done, explain the user-visible problem and changed result; links and file lists alone are insufficient.

## Claim a ticket before working it (collision avoidance)

Before investigating or coding, check `ship-identity`, then run `ship-claim <PREFIX-NNN> "<resume command>"`. Use the session's identity for board writes through `vcc`; never write as Valentin. Proceed only when the claim succeeds. Respect competing claims and step back if another runner claimed first.

Preserve human assignees and moves. Only Valentin assigns himself; a ticket he assigned himself or moved by hand stays exactly as he left it. Never work a ticket assigned to Abdul; leave it and pick another.
