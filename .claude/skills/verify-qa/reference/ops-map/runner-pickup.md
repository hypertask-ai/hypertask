# Runner pickup

Pickup reads assigned board tasks and writes runner inboxes. The domain
admission code is in `.claude/skills/ship/scripts/runner-domain-pickup.py`;
the entry point is `.claude/skills/ship/scripts/runner-pickup`.

## Read-only live check

1. After installation, run
   `~/.local/lib/hypertask/runner-pickup/runner-pickup preview N` for the runner.
2. Compare the printed labels, sections and ownership with assigned board tasks.
   Missing or multiple domain labels mean Shared. Shared conflicts with all scopes.
3. Preview is a snapshot, not a reservation or dispatch proof. Do not use
   `run` as a read-only check; it updates the inbox and ownership state.
4. In hosted CI, the pickup domain fixture exercises real ticks, simultaneous
   admissions, relabels, legacy inboxes and failed reads:
   `python3 .claude/skills/ship/scripts/runner-pickup.domain.test.py`.

Delivered and active leases keep acquired domains until a successful read confirms
completion or unassignment. A conflicting relabel stays pending; it does not displace the
existing holder. Pending scopes block new work. Pending owners retain acquired scopes regardless of runner ordering.
Reciprocal relabels may release reservations only for proven undelivered Todo work;
runner-ID order resolves that cycle. Active reciprocal relabels cannot be preempted.
Legacy pending leases use runner-ID order. Incomplete reads retain leases.
Manual claims bypass pickup. Existing manual work is invisible until its runner's
successful tick; imported active work may already conflict. Preview and fixture
results do not prove fleet-wide exclusivity.
