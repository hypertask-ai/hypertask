# Changelog

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
