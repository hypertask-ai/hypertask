## Resuming runners after a freeze

After verifying recovery, clear `MERGE_FREEZE` and record the lift together:

```bash
gh variable delete MERGE_FREEZE --repo hypertask-ai/hypertask && ~/.local/lib/hypertask/runner-pickup/runner-pickup record-lift
```

`record-lift` records the current epoch in `~/.local/state/runner-inbox/freeze-lift`.
Do not run it for an old release or merely green checks.
Without that record, blocked tickets remain blocked.
Pickup queues an older same-runner freeze or GitHub-limit block.
Before starting hax, the keeper drains one eligible ticket: moves it to
In Progress, reads it back, records an agent activity, and names it in the brief.
The move uses `vcc raw POST /mcp/tasks/update` with `expected_section_id` and
`expected_updated_at`. Both are checked under the existing mutation fence and
in the final database update: a newer section or revision returns 409 without
changing the ticket. Conditional updates accept only one section mutation.
A per-runner recovery intent is saved before the write; failed confirmation
is retried without repeating a completed move. Definitively changed holds retire
the intent without a move. A ready handoff stays durable until the keeper sees
the launched session complete and acknowledges that exact ticket; failed startup
and timeout do not acknowledge it. Recovery accepts only an
unambiguous freeze-only or GitHub-limit-only block, never mixed failures.
The blocked-section entry must also predate the lift; unknown entry age
refuses recovery. Fresh blocks, explicit blocker comments, questions, human
blocks and unrelated failures remain untouched. Incomplete reads cannot authorize a clear.
Install the merged pickup version before the keeper version; existing runner
processes are not restarted. Targeted offline recovery fixtures run as
`runner-pickup.recovery.test.py` in `ship-scripts-tests`.
