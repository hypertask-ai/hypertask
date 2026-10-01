# Skills for Valentin's Claude Code sessions

These skills are for an interactive session started with `/ship`. One session takes one ticket from the fix through the production check. Board writes go through `vcc` (identity "Valentins Claude Code CLI"). Reads go through the plain `hypertask` CLI.

Read the "when to load" column, open that SKILL.md, and follow it, including its scripts. Paths are repo-relative from the repo root.

## Skills

| Skill | When to load (/ship step) | Path |
|---|---|---|
| ship | Start of every session (`/ship <ticket>`): the map of steps, the proof checklist, the merge and Done block | .claude/skills/ship/SKILL.md |
| vcc | Claim, board writes, merge, deploy watch, report | .claude/skills/vcc/SKILL.md |
| reuse-existing-ui | Before UI code | .claude/skills/reuse-existing-ui/SKILL.md |
| fix-bug | The fix, when it restores behaviour that used to work | .claude/skills/fix-bug/SKILL.md |
| ship-feature-behind-flag | The fix, when it adds behaviour the user has not seen | .claude/skills/ship-feature-behind-flag/SKILL.md |
| simplify-before-pr | Before the PR | .claude/skills/simplify-before-pr/SKILL.md |
| design-compliance | Before the PR (UI) | .claude/skills/design-compliance/SKILL.md |
| update-docs | Before the PR (user-visible change) | .claude/skills/update-docs/SKILL.md |
| verify-on-phone | Before the PR (UI) | .claude/skills/verify-on-phone/SKILL.md |
| verify-qa | After deploy | .claude/skills/verify-qa/SKILL.md |

`prototype` is the `/prototype` slash command, not a `/ship` step. When a change touches auth, billing, or user data, `fix-bug` also reads `.claude/skills/fix-bug/reference/security-findings.md`.

## The flag rule

A real bug fix restores behaviour that used to work or was clearly intended;
it never gets a flag and ships to everyone, even when visible (Valentin,
2026-09-22). A `[BUGFIX]` title is only a hint to the mechanical gate: the
reviewer decides from the diff whether this is truly a fix. New visible
behaviour dressed as a fix still needs a flag. (Matches `fix-bug/SKILL.md`.)
