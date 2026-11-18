---
name: verify-design
description: Design QA for Hypertask (app.hypertask.ai). Puts the live screen next to the ticket's approved design frame in Light, AMOLED and Graphite 2, scores each pair, and flags purple, sparkle icons and corners other than 0, 2 or 4px. Use for every design-pass, Figma or visible UI ticket, before QA verdicts and before any flag goes to Everyone.
---

pstack: 0.15.43

# verify-design moved

This skill is now [verify-hypertask](../verify-hypertask/SKILL.md). Its Drive and Evidence
sections hold the design-pass recipe, the FAIL column rule and the reviewer checklist.

The tooling stays in `scripts/` and the screen recipes stay in `features/` because
`.github/workflows/ship-scripts-tests.yml` runs `scripts/design-check.test.mjs`, and that
workflow file has another owner. Both paths move with the skill once that list moves with
them.
