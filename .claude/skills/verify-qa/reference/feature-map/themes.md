# Themes

## How a customer reaches it

- Settings → Appearance: use the existing theme picker.
- Ctrl+K: search for the theme name, then press Enter.
- QA 985 uses `~/.config/hypertask-videos/storageState-qa.json`.
- QA Sandbox: `/project-7049`; open one existing task from a card. Also check `/inbox`.

## How to drive it

1. Pick Graphite 2 in Appearance, then reload. Confirm the `theme` cookie and `html[data-theme]` both retain `graphite-2`.
2. Switch to Graphite using Ctrl+K, then back to Graphite 2. Check both routes select the same saved preference.
3. Inspect Inbox, Kanban and Task at 1440×900 and 390×844. Graphite 2 has page/sidebar/panels `#17181b`, cards/property rail `#1f2125`, hover `#26282d`, borders `#2a2c31`, text `#ececed`, secondary `#9a9ca1`, quiet labels `#6c6f74`.
4. Task title is 24px/600; description headings are 15px. Property labels are weight 400 and rows have 16px gaps. IBM Plex Sans stays the font. Tags are unfilled and grey.
5. Expand and collapse the desktop rail. Every visible rail glyph is Iconoir; other themes retain their original icons.
6. Repeat the four existing themes, desktop and phone. Compare palette and typography against before-change captures. Nothing is removed, hidden or moved by the new theme.
7. With `htpr-8054-graphite-2` off, both pickers hide Graphite 2. A saved Graphite 2 cookie resolves to the system theme without being overwritten. Do not switch production flags for this test; cover the off path in the focused theme tests and record the live mode.

## What usually breaks

- Client hydration replaces the server-selected theme before flags load.
- A removed theme class lingers after switching.
- A saved theme reverts on reload or flashes the system palette.
- New CSS leaks into Graphite or Porcelain.
- Mobile first-screen preferences reject a newly supported theme.

## What proof to collect

Capture all five themes at both sizes, the three affected surfaces, selection/reload video, exact computed colours and type, old-theme before/after comparisons, and the core inbox cycle. Use actual picker clicks, not only injected cookies.

## Cleanup

Use existing sandbox tasks read-only. Restore the QA browser's original theme cookie; do not change global flags or other people's saved data.

## Icon source

New shared glyphs use the official Iconoir 7.11.0 regular SVG paths (MIT, Luca Burgio). See `licenses/Iconoir.txt`.
