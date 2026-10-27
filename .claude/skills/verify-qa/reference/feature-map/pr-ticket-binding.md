# PR ticket binding

## How a customer reaches it

A same-repository production PR uses a ticket-prefixed title. The trusted
`pr-title` step in `.github/workflows/pr-guards-trusted.yml` saves the link in
the ticket's existing pull request property. No runner-local file is needed.

## How to drive it

After merging, dispatch PR Guards Trusted on production with input `pr_number`
set to this ticket's PR. The manual job and automatic title guard execute
`.github/scripts/pr-title.cjs` from trusted production. A non-production manual
ref must not execute. Old runs retain their original workflow definition;
do not use a pre-merge rerun as evidence. The title step must log the ticket
key and canonical PR URL. Ticketed runner bots must bind; unticketed dependency
bots stay exempt. Delayed runs may bind merged PRs. Read the ticket through the Hypertask CLI;
its `pullRequests` must contain that URL. Do not manually create the link.
Repeat the run and confirm the link remains unique.

Automated evidence: `node --test tests/pr-ticket-binding.test.cjs` executes
the actual workflow title step with fake GitHub and HTTP boundaries. It checks
all ticket prefixes, current metadata, fork refusal, API failure and delayed
merged-PR binding. These fixtures are not live proof.

## What usually breaks

- Missing board credentials or ticket write permission.
- Trusting the event title instead of current GitHub metadata.
- Accepting an API success without its saved link.
- Sending credentials to forks or following redirects.

## What proof to collect

Save the merged SHA, successful deployment, trusted workflow log, and CLI
readback showing the unique persisted link. Capture a QA 985 signed-in doctor
screenshot. Include a checklist and self-contained ticket report. No UI change
or feature flag is involved.

## Cleanup

Leave the real ticket link intact. Remove only this session's merged branch
and worktree. Save evidence outside the worktree.
