---
name: wireframe
description: Required before every new or changed visible Hypertask UI, except a [BUGFIX] restoring intended behaviour (Valentin, 2026-10-10). Wireframes start from the full-app base kit on hypertask.app, reuse only the live app, and publish a clickable link, key-screen PNGs and one yes/no Question for UX Sign-off.
---

# wireframe

**Runner browser policy.** A runner (any session not named INFRA MANAGER) never opens pages in Valentin's browser: no `zsb` navigate/open/activate. Links to tickets, pages, reports and wireframes go in ticket comments only. Browser QA and checks use headless Playwright with QA account 985, following `verify-qa`, never his browser. Only the session he talks to (INFRA MANAGER) opens a page for him, and only when it mentions that page to him in chat. (Valentin, 2026-10-12): "i never look a the runner sessoins they don't need to do that i reply to ticket in the inbox and via you thats it" and "but should the even try to open pages?"

## When

**Before visible UI code.** Required for every new or changed visible UI: publish a clickable wireframe on its ticket, move to **UX Sign-off** (board 15 column 22502), and wait for Valentin's yes before code. A `[BUGFIX]` restoring intended behaviour is exempt from wireframe sign-off, but every new component file still needs his yes naming it. The `ux-signoff` check enforces both rules (Valentin, 2026-10-10).

## Rules that never bend

- Valentin, 2026-10-03: "in the past wireframes 'made up ux' that didn't exist and didn't use our styleguide; we have to stick to how hypertask was built already. ctrl+k for menus and so on."
- Follow /ship's claim rules and record the ticket's requested UI change in a comment (quoted, dated) before wireframing (Valentin, 2026-10-10).
- **No new element without his yes naming it.** Nothing that is not already in the app may be built unless Valentin approved it by name on the ticket (Valentin, 2026-10-10).
- **Live app only, nothing invented.** Start from the real screen on app.hypertask.ai, as the QA account (user 985, `~/.config/hypertask-videos/storageState-qa.json`; never Valentin, never print the file). No invented menus, buttons, icons, badges, colours, fonts or spacing. Open every PNG, compare with Today and fix mismatches.
- **Reuse, then copy, naming the source screen.** Find the existing solution with `reuse-existing-ui`, `design-system/` and `.claude/skills/design-compliance`; copy its exact markup and classes ("back button copied from Settings"). Include source-screen screenshots in "Where the pieces come from". For live DOM edits with Playwright `page.evaluate`, clone real nodes; use existing classes and `element.style.setProperty(..., "important")` when necessary, not CSP-blocked injected style tags.
- **Menus in Commands (Ctrl+K).** Add rows to existing Commands, never a new menu, popover or toolbar.
- **Phone 390x844 and desktop 1440x900, in all four themes:** Porcelain, Graphite, AMOLED, Dia.
- **Two options at most**, one recommended, plus a Today picture; give each option a one-line plain description in one self-contained HTML page.
- Valentin, 2026-10-11: "can the agents copy the key screens in the comment replies instead of me having to go to the url to see the key change? url still should be provided."
- **Attach key-screen PNGs to every wireframe comment and reply**, never embedded images in the comment HTML. Capture each key screen with headless Playwright at 1440x900 and, if relevant, 390x844 into `~/.local/state/vcc-evidence/<TICKET>/wireframe/`. Each attachment stays under 3 MiB (crop to the changed area when useful); vcc rejects larger files. Changed-wireframe replies attach before and after PNGs. Keep the link and closing yes/no `Question:`; the wireframe comment is the ticket's last comment. Attach additional key-screen PNGs with `--attach` when needed.
- Keep it clickable on hypertask.app (ticket pages strip JavaScript; Valentin, 2026-10-10: "including a clickable wireframe"). Put the published link in the ticket comment only; INFRA MANAGER opens it only when mentioning it to him in chat. Move to UX Sign-off (Valentin, 2026-10-10).

## How

1. `wireframe new <TICKET>`: copies the full-app base kit (https://hypertask.app/wireframes/base) into a working folder and prints its path.
2. Change only what the ticket needs in that file, using only elements already in the kit or the live app.
3. Click through it in a headless browser at both sizes before publishing. Fix any broken link or dead click first.
4. `wireframe publish <TICKET> --question "<one yes/no question>?"`: uploads to `https://hypertask.app/wireframes/<ticket>` (lowercase), verifies the bytes, posts the link, screenshot and Question mentioning Valentin, and moves board 15 tickets to **UX Sign-off** (column 22502). Put `New elements: <ComponentName>, ...` (or `New elements: none`) inside the `--question` text, using the exact component names the build will add: `ux-signoff` matches those names. Never edit a wireframe comment after posting it (the check cannot see edits); post a new wireframe comment instead, which needs a fresh yes. Keep it the last comment, with the clickable wireframe link and one closing yes/no `Question:` @mentioning Valentin. In /ship, abandon remaining gates with "waiting for Valentin: wireframe sign-off" (Valentin, 2026-10-10).
5. When he answers: `wireframe status <TICKET> approved` or `wireframe status <TICKET> rejected`, then build exactly what he approved, behind the ticket's flag for new behaviour, and continue /ship. Do not build a rejected option.

List: https://hypertask.app/wireframes. A static image may still go on the ticket as a page.

Example: HTPR-6861, https://app.hypertask.ai/page/cmus7aedh000006qezwr17po4

For a clickable multi-state flow, `prototype` has the deeper method; publish its clickable result on hypertask.app and keep a ticket page for static images.
