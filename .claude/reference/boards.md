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

The moment you actually start working a ticket (writing code / doing the fix, not just reading or triaging), make it visible on the board so no one else picks up the same work:

1. Claim via `vcc`: `vcc comment add <PREFIX-NNN> --text "<p><strong>Claimed.</strong> Session working it now.</p>"`. **No session ever writes in Valentin's name: no ticket, comment, assignment or move goes through his user token. All board writes use `vcc`, identity "Valentins Claude Code". Never assign userId 6. Only Valentin assigns himself. A ticket he assigned himself or moved by hand stays exactly as he left it.**
2. Move it to In Progress: `vcc task move <PREFIX-NNN> --section "In Progress"`.

Signal: **Claimed. comment + In Progress = in flight, do not touch.** Abdul self-assigns tickets he picks up; **never work a ticket assigned to Abdul** - leave it and pick another.
