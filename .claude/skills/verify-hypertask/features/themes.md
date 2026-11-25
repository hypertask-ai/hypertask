# Themes

## Sub-features

- `icon-source` Icon source.
- `settings-screen` `/settings` is the Settings screen. With no section it opens General. Appearance is the Profile item on this screen.
- `rounded-theme` With `htpr-7328-rounded-theme` on, desktop Appearance and Ctrl+K include Material (follows device). It follows the device light or dark setting. The phone list hides it even when the flag is on. Off removes the choice, and a saved Material preference resolves to the system theme.
- `appearance-heading-once` With `htpr-7870-appearance-heading-once` on, desktop Appearance shows the word Appearance once, at the top of the page, and not again on the card above the theme list. Phone still shows it on the card. Off restores the card label.
- `amoled-toggle` With `htpr-9027-amoled-toggle` on, a settings switch that is on uses the AMOLED primary, hsl(222 9% 46%), instead of green. The off position and every other theme stay unchanged. Off restores the green on-state in AMOLED.

## How to get to it (user POV)

- Open `/settings`. The screen title is Settings and the first section is General. Choose Appearance under Profile. The theme list is on that page.
- Settings → Appearance: use the existing theme picker.
- Ctrl+K: search for the theme name, then press Enter.
- QA 985 uses `~/.config/hypertask-videos/storageState-qa.json`.
- QA Sandbox: `/project-7049`; open one existing task from a card. Also check `/inbox`.

## Driving it with agent-browser

1. Pick Graphite 2 in Appearance, then reload. Confirm the `theme` cookie and `html[data-theme]` both retain `graphite-2`.
2. Switch to Graphite using Ctrl+K, then back to Graphite 2. Check both routes select the same saved preference.
3. Inspect Inbox, Kanban and Task at 1440×900 and 390×844. Graphite 2 has page/sidebar/panels `#17181b`, cards/property rail `#1f2125`, hover `#26282d`, borders `#2a2c31`, text `#ececed`, secondary `#9a9ca1`, quiet labels `#6c6f74`.
4. Task title is 24px/600; description headings are the standard 16px. Property labels are weight 400 and rows have 16px gaps. IBM Plex Sans stays the font. Tags are unfilled and grey.
5. Expand and collapse the desktop rail. Every visible rail glyph is Iconoir; other themes retain their original icons.
6. Repeat the four existing themes, desktop and phone. Compare palette and typography against before-change captures. Nothing is removed, hidden or moved by the new theme.
7. With `htpr-8054-graphite-2` off, both pickers hide Graphite 2. A saved Graphite 2 cookie resolves to the system theme without being overwritten. Do not switch production flags for this test; cover the off path in the focused theme tests and record the live mode.
8. On `/settings`, confirm the page title is Settings and the open section is General. Choose Appearance. On desktop, with `htpr-7328-rounded-theme` on, Material (follows device) is in the list and in Ctrl+K. At 390x844 it is absent. Do not need a new theme to prove the row exists; selecting it is the behavior check and must be restored afterward.
9. With `htpr-7870-appearance-heading-once` on, desktop Appearance shows that word once. At 390x844 the card above the list still says Appearance.
10. In AMOLED, with `htpr-9027-amoled-toggle` on, turn on an existing settings switch only if one is already on, or read a switch that is already on. The on track is the inner span of the switch: `[role=switch][aria-checked=true] > span`. The on track uses hsl(222 9% 46%), which computes to `rgb(107, 113, 128)`. Porcelain, Graphite, and Dia keep the green on track. Restore the theme cookie when finished.

Worked on production, 2026-11-20, QA 985. Live modes then:
`htpr-8054-graphite-2` OWNER_AND_QA, `htpr-9027-amoled-toggle` OWNER_AND_QA,
`htpr-7870-appearance-heading-once` EVERYONE, `htpr-7328-rounded-theme` OFF.

```bash
ht-verify open /settings/appearance --wait body
# title Settings; sidebar Profile > Appearance; list: Follow system, Light · Porcelain,
# Dark · Graphite, Graphite 2, OLED black · AMOLED, Paper · Dia. Material is absent while 7328 is OFF.
ht-verify click 'text="Graphite 2"'
ht-verify probe html --attr data-theme          # graphite-2
ht-verify probe --cookie theme                   # graphite-2 (read after a reload; see gotcha)
ht-verify open /settings/appearance --wait body  # reload
ht-verify probe html --attr data-theme          # still graphite-2
ht-verify press Control+k --wait 900
ht-verify probe "input:focus" --attr placeholder # "Type a command or search"
ht-verify fill "input:focus" Graphite            # RESULTS: Graphite 2, Dark · Graphite
ht-verify press Enter --wait 1500                # data-theme graphite-2
ht-verify open /settings/notifications --wait "[role=switch][aria-checked=true]"
ht-verify probe "[role=switch][aria-checked=true] > span" --style background-color   # amoled: rgb(107, 113, 128)
ht-verify shot https://app.hypertask.ai/settings/appearance --out appearance-390x844.png --viewport 390x844
```

Clicking through Appearance changes `html[data-theme]` and writes the `theme`
cookie in the same context; the value survives a reload. A fresh context
(the QA state without the cookie) resolves to Porcelain. The session's cookies
are never written back to the state file, so there is nothing to restore there.
Palette focus matters: press Escape and click a neutral label before Ctrl+K,
or the settings page's own Search settings input keeps focus.

### Hands-free drive on production

```bash
node .claude/skills/verify-hypertask/scripts/feature-map-drive.mjs {slug} --dir /tmp/feature-map-drive
```

Prints `PASS` or `FAIL` per step, writes `result.json` and screenshots into `--dir`, and ends with
`{slug} ok`. It refuses any base except `https://app.hypertask.ai`, uses the `qa-login` identities,
creates only fixtures its own cleanup removes, and never prints a cookie, token or email address.

## Gotchas

- Client hydration replaces the server-selected theme before flags load.
- A removed theme class lingers after switching.
- A saved theme reverts on reload or flashes the system palette.
- New CSS leaks into Graphite or Porcelain.
- Mobile first-screen preferences reject a newly supported theme.
- Material is expected on the phone, or a saved Material choice is left in place after the check.
- Reading the on-track colour from the switch button returns `rgba(0, 0, 0, 0)`: the visible track is the button's inner span.
- `ht-verify probe --cookie theme` straight after a pick has reported the cookie absent while `html[data-theme]` already changed; reload the page and probe again before calling the cookie wrong.
- Desktop Appearance still shows Appearance on the card above the theme list while `htpr-7870-appearance-heading-once` is on.
- An AMOLED settings switch that is on stays green while `htpr-9027-amoled-toggle` is on.

### What proof to collect

Capture all five themes at both sizes, the three affected surfaces, selection/reload video, exact computed colours and type, old-theme before/after comparisons, and the core inbox cycle. Use actual picker clicks, not only injected cookies.

### Cleanup

Use existing sandbox tasks read-only. Restore the QA browser's original theme cookie; do not change global flags or other people's saved data.

### Icon source

New shared glyphs use the official Iconoir 7.11.0 regular SVG paths (MIT, Luca Burgio). See `licenses/Iconoir.txt`.
