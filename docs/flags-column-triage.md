# Flags-column triage

Owner: **Mini Boss CEO**. Review the report every six hours, resolve exact drift, and ask for missing declarations rather than guessing. This is deterministic agent infrastructure, not a product feature; no product flag or migration is needed.

```sh
node scripts/flags/triage-flags-column.mjs
```

The default is read-only: board 15's Flags column, ticket comments and the live `/api/mcp/flags` metadata through `ht-flag get`. No database access or AI judgement. Exit 0 means clean, 2 means exact ticket drift is listed in JSON, and 1 means a read or command failed. A partial read must not produce a clean report. Every report includes the owner reminder.

The fixed state-label vocabulary is:

| Live metadata | Label |
| --- | --- |
| Everyone | `flag:everyone` |
| Owner only | `flag:owner-only` |
| Owner + QA | `flag:qa-only` |
| Off | `flag:off` |
| Internal kind, regardless of audience | `flag:internal` |

`flag:qa-only` is the ticket's proposed name for the existing Owner + QA mode, not a new QA-exclusive audience. Live flag metadata wins over prose about an old audience. A shared key must still exist in live metadata; a retired shared signup key is drift even when the registry lists a newer ticket-specific key.

An exact declared key takes precedence over the registry's originating ticket; an unambiguous comment is a fallback when neither identifies a flag. Multiple candidates and unknown/removed keys are reported, never guessed or assigned an arbitrary state. The missing-declaration question remains actionable until a live flag is declared. A link must be a clickable anchor to the resolved flag card; a bare URL is not sufficient.

## Repair and backfill

Only the owning session, under its own `vcc` identity, may opt into board writes:

```sh
node scripts/flags/triage-flags-column.mjs --apply
```

This creates the fixed label vocabulary, adds a missing-declaration question once, and repairs only unambiguously resolved tickets. It rereads each affected ticket before writing, skips tickets that left Flags, uses additive/removal label operations to preserve unrelated labels, appends the flag link without replacing existing content, and rereads the result. It never changes flag modes. Unresolved tickets remain drift (exit 2), with their exact links in the report. The Mini Boss CEO must obtain their declarations, then rerun repair; it must not declare those tickets clean while they are unresolved.

## Several-times-daily schedule

After this code is merged into the production checkout, the owning operator can install the checked-in user units (adjust the service's working directory if that checkout is elsewhere):

```sh
mkdir -p ~/.config/systemd/user
cp scripts/flags/triage-flags-column.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now triage-flags-column.timer
systemctl --user list-timers triage-flags-column.timer
journalctl --user -u triage-flags-column.service --since today
```

The timer schedules four read-only reports per day. Exit 2 is an expected drift report, not an infrastructure failure; the JSON remains in the journal for Mini Boss CEO to review. Authentication uses the existing session-aware `hypertask` and `ht-flag` readers; credentials are never embedded in the units or report.

The implementation session is prohibited from board writes and installations: **live backfill, missing-declaration comments, and timer activation must be performed by the owning session after handoff**. Merely committing these units does not activate a timer or repair live tickets.

## Regression coverage

`tests/flags-column-triage.test.cjs` imports the production triage module and substitutes its CLI boundary. CI runs it through the existing test inventory. No local build, install, test, typecheck or dev server is required or permitted for this ticket.
