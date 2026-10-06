# Changelog

## 1.1.2 - 2026-10-06

- Queue heavy local lint, tests, typecheck and disposable webpack builds across
  worktrees. CI is unchanged. Prefer safe changed-file lint before a PR.
- Keep disposable QA servers tied to their owning run, with cleanup on exit
  and interruption. Add a 12-hour stale-resource sweep and an opt-in hourly
  systemd user timer, installed by the manager only after merge.
  https://app.hypertask.ai/detail/project-4060/202

## 1.1.1 - 2026-10-06

- Bug fixes now use ticket-named flags defaulting to Everyone with the same
  14-day cleanup. Saved-data, security and crash fixes remain flag-free.
  Feature and improvement flags still default Owner + QA; developers never
  widen feature flags. Synchronize skills, registry defaults and CI validation.
  https://app.hypertask.ai/detail/project-4060/201

## 1.1.0 - 2026-10-04

Adopt selected pstack rules for the Agent Kit:
https://app.hypertask.ai/detail/project-4060/195.

- Confirm bug causes at runtime. Undo a failed fix before testing a new cause.
  Helpers get three short, attributed principle files.
- Add blast-radius before wide changes ship and three-model design review
  only for the valentin-review lane. Ordinary work keeps ai-review.
- Check benchmark conditions, repeated runs and variance before reporting.
  Keep code comments only for non-obvious reasons.
- Add report-only weekly feature-map upkeep with a systemd user timer,
  dry-run and isolated tests. Leave map fixes for a separate ticket.

## 2026-10-01

These skills are for Valentin's own `/ship` sessions. Board writes go
through `vcc`. The session that ships a change verifies it on production.
History below is the 1.0.0 move and is left as it was.

## 1.0.0 - 2026-09-15

The product skill pack moved here from `hypertask-ai/agent-skills`, into the
repo it serves. Skills are now read from the checkout each run works in,
instead of a separate skills repo. Company-pack references go through
`$COMPANY_SKILLS_DIR` (the installed company-skills plugin, falling back to
`~/projects/company-skills`). Growth, Support and Finance stay in
`hypertask-ai/agent-skills`.
