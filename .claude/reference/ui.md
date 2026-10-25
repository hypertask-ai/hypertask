# Shared UI reference

## Reuse existing UI (enforced)

Before UI work, follow [reuse-existing-ui](../../.claude/skills/reuse-existing-ui/SKILL.md). Use the Ctrl+K command system and existing shared pickers, view-save controls, and selection components. Do not copy markup or invent a parallel control.

| Rule | Enforcement |
|---|---|
| No new selects, dropdowns, or floating choice panels | `hypertask-ui/no-new-choice-menus` |
| No parallel Save, Reset, or Save as view controls | `hypertask-ui/no-new-view-save-actions` |
| No new checkbox, radio, or checkmark styles | `hypertask-ui/no-new-selection-styles` |
| Keep unrelated layouts and sizes unchanged | `e2e/smoke/layout-lock.spec.ts`, live flags and every flag on |
| One AI model per class; replace old picks together | `tests/model-class-unique.test.cjs` |
| No explanatory code comments | `local/no-comments`; use clearer code instead |

Never increase UI baseline allowances. Lower counts when removing debt. New files have zero allowance. Only shared implementation files own raw controls. An exceptional paradigm requires a human-approved reason and expiry on the offending line, never a blanket lint disable. Syntax checks do not replace semantic review. Requested layout changes update the baseline or flagged-change record with the ticket and Valentin's quote. Run UI lint and `tests/ui-patterns.test.cjs` when touching these rules or UI.

