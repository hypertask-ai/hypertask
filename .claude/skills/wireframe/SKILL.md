---
name: wireframe
description: Wireframe a Hypertask UI change before building it, ONLY when Valentin asks for one (on the ticket or in chat). Built from the live app and its style guide by editing the real page in a browser, never invented. Published on the ticket as a page, then one yes/no Question and Valentin Review.
---

# wireframe

Valentin, 2026-10-03: "in the past wireframes 'made up ux' that didn't exist and didn't use our styleguide; we have to stick to how hypertask was built already. ctrl+k for menus and so on."

## When

**On request only.** Run this skill only when the ticket or Valentin's chat message says a wireframe is required. Without that request, do not wireframe: build behind a flag and let him judge the real thing (the normal /ship path).

## Rules that never bend

1. **The wireframe IS the live app.** Every picture starts from the real screen on app.hypertask.ai. Nothing new may appear that the app does not already have: no new menus, buttons, icons, badges, colours, fonts or spacing.
2. **Reuse, then copy.** Before drawing, find where the app already solves the same thing (`reuse-existing-ui`; `design-system/` and `.claude/skills/design-compliance` for the style guide). Copy that element's exact markup and classes. Name the source screen in the wireframe ("back button copied from Settings").
3. **Menus go in Commands (Ctrl+K).** Actions that do not fit go into the existing Commands menu as rows, not into a new "⋯" menu, popover or toolbar.
4. **Phone and desktop as they are today**, light and dark: phone 390x844, desktop 1440x900.
5. **Two options at most**, one marked recommended, plus a "Today" picture.

## How

1. Claim the ticket like any /ship ticket. Write the request into a comment (quoted, dated).
2. Open the real screen headlessly as the QA account (`~/.config/hypertask-videos/storageState-qa.json`, user 985; never Valentin's account, never print the file). Screenshot "Today".
3. Build each option by editing the live page in that browser with Playwright `page.evaluate`: replace or move real DOM nodes, and set only class names that already exist in the app. Set style changes the app's classes cannot express through `element.style.setProperty(..., "important")`; the app's CSP blocks injected style tags. For a Commands menu row, clone an existing row and change its text.
4. Screenshot each option, phone light and dark. Open every screenshot and compare it with "Today": same font, colours, spacing, icons. Fix anything that looks invented.
5. Build one self-contained HTML page: "Today", each option with a one-line plain description, and a "Where the pieces come from" section with screenshots of the source screens.
6. Put it on the ticket as a page, never on hypertask.app: `vcc pages create --task <TICKET> --title "Wireframe: <thing> (<date>)" --canvas --markdown-file wireframe.html`. Open `https://app.hypertask.ai/page/<publicId>` in his zsb pane.
7. One `Question:` comment via `vcc` that @mentions Valentin: which option to build, yes/no for the recommended one, the page link, key screenshots attached. Move the ticket to Valentin Review. In /ship, abandon the remaining gates with "waiting for Valentin: choose a wireframe option".
8. When he answers, build the chosen option exactly as wireframed, behind the ticket's flag if it is new behaviour, and continue /ship.

Example: the HTPR-6861 wireframe, https://app.hypertask.ai/page/cmus7aedh000006qezwr17po4

For a clickable multi-state flow, the `prototype` skill has the deeper method; publish its result on the ticket as a page too.
