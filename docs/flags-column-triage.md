# Flags-column triage

Owner: **Mini Boss CEO**. Deterministic agent infrastructure: board 15 **Flag:** columns except **No Flag**, live `ht-flag get`, no database access.

```sh
node scripts/flags/triage-flags-column.mjs          # read-only, exit 0 clean / 2 drift
node scripts/flags/triage-flags-column.mjs --apply  # owning session only
```

Fixed labels: `flag:everyone`, `flag:owner-only`, `flag:qa-only`, `flag:off`, `flag:internal`. Live metadata wins over prose. One declared flag per ticket; missing declarations get one question, never a guessed label or mode change.

Repair creates missing labels, fixes only resolved tickets, preserves unrelated labels, appends a clickable `/admin/flags/<key>` link. Tickets with `ask: true` stay in the JSON report; only an authorized lead posts the people-visible Question (vcc gates question comments). Install `scripts/flags/triage-flags-column.{service,timer}` under systemd user for four daily read-only reports (exit 2 is expected drift). Implementation sessions do not run `--apply` or install the timer.

Regression: `tests/flags-column-triage.test.cjs`.
