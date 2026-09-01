---
name: prototype
description: Build a clickable HTML prototype of a Hypertask UI change, grounded in screenshots of the live product, using the app's real styles, published on hypertask.app and attached to the ticket. Invoke with /prototype <ticket or flow>. Iterate on every feedback message by republishing to the same URL.
---

# prototype

A prototype is a self-contained HTML page a person can tap through on their phone. It is built FROM the live product, never invented. This skill is the standard that produced the HTPR-5902 set (https://hypertask.app/explorations/a6gij32); match that bar.

## 0. Rules that never bend

- **Reality first.** Before drawing anything, screenshot the real screen the ticket touches and read the component markup. Every element in the prototype exists in the product or is the change under discussion. No invented dots, badges, labels, icons.
- **Real screenshots on the page**, numbered `#REAL-1`, `#REAL-2` …, shown next to the prototype so the reader can compare.
- **One state per click.** Every state the ticket discusses is reachable by tapping in the prototype, with a status line under the phone saying what just happened.
- **Verify before publishing.** Open the file headlessly, click through every state by script, screenshot each, compare to the real screenshots, fix. Never publish a page you have not clicked through.
- **Same URL on every iteration.** Feedback means edit, re-verify, republish to the same URL, one ledger line, one reply.
- **Never publish secrets.** The login recipe, tokens, cookie files stay local. Never paste them into a page, ticket or PR.

## 1. Capture reality

1. Log into production headlessly (the manager-side recipe lives in the app repo AGENTS.md under "Preview auto-login recipe"; agents use `HT_PRODUCTION_STORAGE_STATE_FILE`). Use `agent-browser`, never a visible tab: `agent-browser set viewport 390 844` for mobile (1280x800 desktop), cookie `theme=dark` for the dark theme.
2. Open exactly the screens the ticket touches (`/detail/project-15/<n>`, `/inbox`, `/connect` …). Scroll every scroller to top before the first shot (`document.documentElement.scrollTop=0`; the page scroller is the HTML element). Take one screenshot per screen and per relevant scroll position.
3. Read the real markup with `agent-browser eval` or the component source under `src/components` so structure, order and labels are exact.
4. Upload each screenshot: `PUT https://hypertask.app/explorations/<ticket>-real-<n>.png` with `Content-Type: image/png`, `Authorization: Bearer $HYPERTASK_APP_SHARE_TOKEN`, `CF-Access-Client-Id`, `CF-Access-Client-Secret` (all from `~/.config/hypertask-app/credentials.env`). A GET without the CF headers returns 302; that is normal.

## 2. Design language (the app as it is)

| Thing | Value |
|---|---|
| Page / card / well backgrounds (dark) | page `#141414`, card `#1a1a1a`, composer well `#1d1d1d`, control `#2f3136` |
| Text | `#ececec` primary, `#9a9ba1` muted |
| Purple `#c668ff` | ONLY for AI signals: pen-sparkle icon, AI FAB, an AI headline. Never on chips, borders, or plain controls |
| Primary action buttons (mic, check, send, Save, Done) | WHITE `#ececec` with `#141414` icon, always right-bound in the row |
| Radii | 4px chips and controls, 5px cards, 8px composer wells |
| Icons | lucide only (mic, check, send, plus, x, loader, gauge for the model selector, pen-sparkle for Write with AI) |
| Fonts | the app's system stack; 16px body in fields, 13px chips, 14px menu items |
| Composer row order | `+` (plus menu) · pen-sparkle · spacer · ghost mic · white send/check |
| Plus menu | popover above the row: Attach image, Attach file, @ Mention someone, / Commands, red Discard |
| Mobile task page (dark) | top bar [sidebar] "Hypertask Product" [Commands] [avatar]; title + share/check round buttons; one-line summary; properties table (Assignees, Agents, ID, Status, Due date, Project, Priority, Task size, Tags); description card; activity feed; purple AI FAB + plus FAB bottom-right; "Add a comment…" composer |

If the ticket touches a screen not in this table, derive the values from the screenshot and markup, and add a row here.

## 3. Build

- One HTML file per flow, no external libraries, inline CSS/JS. Phone frame 390 wide with a fake status bar and, when text entry is involved, a drawn keyboard.
- States are driven by small JS functions; every control the ticket discusses actually toggles state. Mock AI/transcription with 900 to 1500 ms delays and a loader in the far-right slot.
- Below the frame: a `#status` line that names the state and the design decision behind it.
- A gallery section with the `#REAL-n` screenshots and a one-line caption each.
- Text is realistic product text, never lorem ipsum. Ticket titles and comments come from the real screenshots.
- Keep an `index.html` for the ticket listing every page with one line per state, and a `LEDGER.md` with one line per change (date, page, what changed, who asked).

## 4. Verify

```
agent-browser open "file://$PWD/proto.html"
agent-browser eval "<click the control>; 'state='+<assert something>"
agent-browser screenshot /path/state-1.png
```

Walk every state this way. Look at each screenshot. Compare against the real screenshot: same order, same labels, same radii, same colours, same right-bound primaries. Fix and repeat until nothing deviates.

## 5. Publish and attach

1. `htmlshare proto.html` prints `https://hypertask.app/explorations/<id>`; running it again on the same file republishes to the same id. Add `?v=N` when telling someone to reload.
2. Attach to the ticket as a canvas page: `hypertask pages create --task <numeric task id> --title "<flow>" --markdown-file proto.html --html --canvas` (numeric id from `hypertask tasks get`).
3. Comment on the ticket (HTML block tags, answer first): the direct link per page, and for each page one line saying what to tap and what to look for. Mention @Valentin Yeo for review. Never make him search for the page.

## 6. Iterate

Every feedback message is one loop: edit, click-test, screenshot, republish to the same URL, ledger line, reply with the URL and one line of what changed. A superseded page becomes a stub that links to its replacement; never leave two live versions of the same flow.

## 7. Handoff

When the prototype is approved, the build ticket(s) list one acceptance criterion per state, link the prototype and the `#REAL-n` shots, and name the design-language rows that apply. Implementation is checked against the prototype with production screenshots at the same viewport; a deviation goes back to the implementer with the two images side by side.
