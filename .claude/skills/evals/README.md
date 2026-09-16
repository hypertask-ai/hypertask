# Skill pack evals

Four checks, no dependencies beyond bash/grep/sed:

- **A. INDEX rows resolve.** Every Path in `INDEX.md`'s table exists on disk.
- **B. Every SKILL.md is indexed.** Every `.claude/skills/*/SKILL.md` has a row in `INDEX.md`.
- **C. Scripts a skill names exist.** Every repo-relative `.claude/skills/...` path a skill names exists.
- **D. Board columns a skill names exist.** Every `--section` a skill names is a real column in `.claude/board.yml`, if that file exists (SKIP otherwise).

Run locally: `bash .claude/skills/evals/run-evals.sh`
