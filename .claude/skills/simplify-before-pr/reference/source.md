# Source

Ported from Anthropic's official `code-simplifier` plugin.

- Plugin: `code-simplifier`, version `1.0.0`
- Installed at: `~/.claude/plugins/cache/claude-plugins-official/code-simplifier/1.0.0/`
- Author: Anthropic (`support@anthropic.com`)
- Licence: Apache License 2.0 (ships as `LICENSE` in the plugin directory; not reproduced here — see the plugin path above for the full text)
- Ported: 2026-09-15, at Valentin's request

The plugin is a single agent (`agents/code-simplifier.md`, `model: opus`) that runs autonomously after code is written or modified, simplifying it for clarity and consistency without changing behaviour.

## What carried over

- Clause 1 (preserve functionality) — kept, step 3.
- Clause 3 (enhance clarity) — kept close to verbatim, step 4.
- Clause 4 (maintain balance / what not to touch) — kept close to verbatim, step 5.

## What was dropped or changed for the fleet

- **Clause 2** (project-specific coding standards: ES modules, `function` over arrow functions, explicit return types, React prop patterns) is the plugin's own repo's house style, not a universal rule. Dropped rather than imported wholesale — a fleet skill applies across repos with different conventions, and `ticket-lifecycle`'s "match the codebase's conventions" already covers this ground.
- **Clause 5** (scope = "recently modified in the current session") doesn't translate to a fleet agent, whose session boundary isn't the ticket boundary. Replaced with `git diff --name-only pub/production...HEAD` — the ticket's own diff.
- **Autonomous trigger** ("runs immediately after code is written, without being asked") replaced with an explicit step wired into `fix-bug` and `ship-feature-behind-flag`, right before the PR step, and a separate commit so a reviewer can see the simplify pass apart from the fix. The plugin runs as a background agent with no commit boundary; a fleet ticket needs one so review and rollback stay clean.
- **Model pin** (`model: opus`) dropped — model choice is a fleet routing decision (see `~/.claude/CLAUDE.md` rule 5b), not something this skill should hardcode.
