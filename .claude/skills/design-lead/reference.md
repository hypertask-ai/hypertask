# Design lead reference

## Repo map (hypertask-ai/hypertask; local `~/projects/hypertask`)

- Stack: Next 16, React 19, Tailwind 4.3. Leftover bootstrap, reactstrap, sass. Two icon sets (lucide, iconoir). No component library.
- Shared parts: `src/components/Common/`.
- Tokens: 7 theme files in `src/styles/tailwindThemes/`. Brand colours in `tailwind.config.ts`.
- Docs: `design-system/README.md`, `design-system/AUDIT.md` (6 ranked debts), `docs/DESIGN.md`, `.claude/skills/reuse-existing-ui/reference/style-guide.md`.
- CI: `eslint-local-rules/ui-patterns.mjs` with `ui-patterns-baseline.json`, `e2e/smoke/layout-lock*.spec.ts`, `visual-regression.yml`, `ux-signoff-gate.yml`.
- Repo skill `verify-visual`: Visual Regression diff PNGs. Use it next to layout-lock.
- Known broken: `.claude/skills/design-compliance/SKILL.md` points at `docs/design/STYLE-GUIDE.md`, `scripts/design-lint.mjs` and a design-gate check that do not exist.
- Live branch for audits: `production`.

## System goals (phase 2)

- One set of named colour roles. Merge near-duplicate greys.
- Real radius and shadow scales in Tailwind 4 `@theme`.
- Lint flags raw hex and stray radii. Debt goes in the baseline, never raised to pass.
- Token rules in one file, so the guide and AUDIT.md stop drifting.
- Fix the broken design-compliance pointers first.

## Board

- Board 15 "Hypertask Product". Design columns: UX needed (section 6106), UX Sign-off (22502).
- Old Grok Bot identity: Hypertask managed agent "Design Lead" (agent id 35080a32-dde2-4339-b190-022dd442608a). Its token sat on the Grok Bot box, not the VPS.

## Tools on hypertask-vps (checked 2026-10-26)

- Browser: headless Playwright (Chromium installed) and the `verify` skill. QA account 985. Never Valentin's browser.
- Wireframes: `wireframe` and `artifact-wireframe` skills.
- Figma: a `figma` item exists in `stack-key --list`; Claude Code lists a claude.ai Figma connector. Not tested.
- Refero (real product UI references, for example Superhuman and Linear): not installed.
- Rules sources: read online each time, or cache a digest per the vstack method.
