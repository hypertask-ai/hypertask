# PR ticket binding

## Sub-features

- `pr-ticket-binding` PR ticket binding.

## How to get to it (user POV)

A same-repository production PR uses a ticket-prefixed title. The trusted
workflow `.github/workflows/pr-guards-trusted.yml` binds on PR open: the
anonymous step carrying `id: title` runs `.github/scripts/pr-title.cjs` and
saves the link in the ticket's existing pull request property. `pr-title` is
the commit-status context name, not a step name. No runner-local file is needed.

## Driving it with agent-browser

The binding happens when the PR opens, not after the merge. A run whose log
line reads `Title OK: <TICKET> ... linked <TICKET> to <pr url>` is the proof;
the step has no `name:`, so read the log, not the job steps list. To rebind by
hand, dispatch PR Guards Trusted on production with input `pr_number` set to
this ticket's PR; the manual `bind-ticket` job runs
`.github/scripts/pr-title.cjs` from trusted production and skips on any ref
other than `production`, so a no-link result there proves nothing. Old runs
retain their original workflow definition; do not use a pre-merge rerun as
evidence. Ticketed runner bots must bind; unticketed dependency bots stay exempt.
Delayed runs may bind merged PRs. Read the ticket through the Hypertask CLI or
MCP; its `pullRequests` must contain that URL exactly once. Do not manually
create the link. Repeat the run and confirm the link remains unique.

Automated evidence: `node --test tests/pr-ticket-binding.test.cjs` executes
the actual workflow title step with fake GitHub and HTTP boundaries. It checks
all ticket prefixes, current metadata, fork refusal, API failure and delayed
merged-PR binding. These fixtures are not live proof.

## Gotchas

- Missing board credentials or ticket write permission.
- Trusting the event title instead of current GitHub metadata.
- Accepting an API success without its saved link. A 409 or 5xx reply is accepted when the ticket already documents the URL, so a green run is not proof of a fresh write; read `pullRequests` back.
- Sending credentials to forks or following redirects.
- A manual dispatch on a non-production ref looks successful because the `bind-ticket` job is skipped, not run.

### What proof to collect

Save the merged SHA, successful deployment, trusted workflow log, and CLI
readback showing the unique persisted link. Capture a QA 985 signed-in doctor
screenshot. Include a checklist and self-contained ticket report. No UI change
or feature flag is involved.

### Cleanup

Leave the real ticket link intact. Remove only this session's merged branch
and worktree. Save evidence outside the worktree.
