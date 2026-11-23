# Mobile

## Sub-features

- `phone-zoom` Phone zoom.
- `phone-chat-delete` With `htpr-7575-phone-chat-delete` on, each personal chat row in the phone history list has a trash button labeled Delete chat. It asks "Delete this chat?" before it deletes. Agent rows do not get the button. Off, the button is hidden.
- `phone-new-task-layout` With `htpr-8029-phone-new-task-layout` on, the phone new-task sheet starts below the status bar, and the attach and dictate bar stays at the bottom of the description card, above the keyboard. Desktop is unchanged. Off keeps the full-screen sheet.
- `phone-chat-fullscreen` With `htpr-8032-phone-chat-fullscreen` on, phone AI chat opens as a full-screen dialog, and the board picker is one small chip in the header. Desktop stays the sidebar. Off restores the sheet and the large board picker.
- `mobile-screens` 16 phone screens: Kanban board (`board-kanban`), task detail (`task-detail`), inbox (`inbox`), AI chat sheet (`ai-chat-sheet`), AI chat full (`ai-chat-full`), Commands/Ctrl+K sheet (`commands-search`), Ctrl+J task writer (`commands-new-task`), New task modal (`new-task-modal`), table (`board-table`), calendar (`calendar`), my tasks (`my-tasks`), search (`search`), board switcher (`board-switcher`), view switcher (`view-switcher`), settings menu (`settings-menu`), settings general (`settings-general`).

## How to get to it (user POV)

Any route at a phone viewport. Not a separate app; same routes, same code,
different layout below the responsive breakpoint.

## Driving it with agent-browser

Real 390x844 phone-viewport screenshot, never a resized desktop window:
```
.claude/skills/verify-on-phone/scripts/phone-shot.sh https://app.hypertask.ai/<path> <out.png>
```
**Set the phone user agent before the first navigation.** The server decides
"mobile" from the `user-agent` request header (`isMobileDevice` in
`src/utils/serverActions.ts`), so a Playwright context created at 1440x900 and
resized to 390x844 still gets `maximum-scale=1.2`, no
`data-phone-new-task-sheet`, and the desktop chat. Create the context at
390x844 with an iPhone user agent, or pass `--viewport 390x844` to `ht-verify
shot`, which sets both. Check `navigator.userAgent` in the page before trusting
any mobile-only attribute.

With the phone user agent the checks that held on 2026-11-20 were:
`<meta name="viewport">` = `maximum-scale=5, user-scalable=yes` (with
`htpr-8145-phone-zoom` on); `#createTaskModal[data-phone-new-task-sheet="on"]`
and `[data-phone-new-task-card="on"]` on `/new?id=<board>`; `#body`
`padding-top: 28px`; and on the board, **Ask AI** opening a dialog labelled
`AI Chat` with `data-ai-chat-phone-fullscreen`, no model label and no
"Context:" text.

`e2e/smoke/journeys.spec.ts` `@mobile` tests (`open-board`, `open-task`, `create-task`, `reply-inbox`, `ai-chat`, `switch-boards`, `switch-column`) drive all seven flows with real taps at 390x844 (`isMobile`, `hasTouch`, `pointer: coarse`) when `HT_QA_JOURNEYS=1`. `e2e/smoke/mobile-design.spec.ts` audits all 16 screens across Porcelain, Graphite, AMOLED, and Dia against `e2e/smoke/__snapshots__/mobile-design.baseline.json` (set `MOBILE_DESIGN_STRICT=1` for zero-debt check or `MOBILE_DESIGN_UPDATE=1` to refresh baseline). `.github/workflows/mobile-verify.yml` runs `--project=mobile-design` and `--project=mobile-journeys` after production pushes and on dispatch; `.github/scripts/feature-map-live-daily.mjs` runs `mobile-journeys` daily alongside desktop `journeys`.

### Per-screen mobile flows

| Screen | Entry point / tap flow | Observable end state |
|---|---|---|
| Kanban board | `/project?id=<id>&surface=board` | Columns (`.kanban-column-title`), cards, bottom nav, `Ask AI`, `Create task`; no reload loop |
| Task detail | Tap `#task-<id> a[href^="/detail/"]` or `/detail/project-<id>/<n>` | `#title-input`, description, `[data-task-properties-rail]`, comment composer visible |
| Inbox | `/inbox` -> tap row -> tap composer -> type -> tap `Send comment` | `POST /api/comments/create` 200; reply persists after reload |
| AI chat sheet | Board -> tap bottom nav `AI` or `Ask AI` | AI chat dialog/sheet opens with `#ai-chat-tiptap-editor` |
| AI chat full | `/chat` -> tap editor -> type -> tap `Send message` | Delivered assistant reply appears in `.submessage-container.delivered` |
| Commands / Ctrl+K | Board -> tap `Commands` | Command sheet opens on Search tab |
| Ctrl+J task writer | Board -> tap `Commands` -> tap tab `New Task` -> fill `Describe the task` -> tap `Create task` | `POST /api/tasks/create` 200; created task opens and persists after reload |
| New task modal | Board -> tap `Create task` or `/new?id=<id>` | `#createTaskModal` opens with title, description, properties, Save |
| Table view | `/project?id=<id>&surface=table` | Table rows and sortable headers render without page overflow |
| Calendar | `/calendar` | `.mobile-calendar` renders current schedule |
| My Tasks | `/my-tasks` | `[data-testid="my-tasks-list"]` and splits render |
| Search | `/search` | `#search-input` renders and accepts queries |
| Board switcher | Board -> tap `Switch board` -> tap `#mobile-board-option-<id>` | URL updates to `?id=<id>` with 0 full page reloads |
| View switcher | Board -> tap `Switch view` | View options sheet/dropdown opens |
| Switch column | Task detail -> tap status in `[data-task-properties-rail]` -> tap target column | Column updates via `/api/tasks/moveTask` and persists after reload |
| Settings | `/settings` and `/settings/general` | Settings search input and profile/theme controls render |

For the New Task title, open a sandbox board at 390x844, press `C`, expand
`Title: Add`, then tap the title field, type and save. Check the textarea itself
has height >=24px and `elementFromPoint` at its centre hits it; the
`htpr-6556-mobile-description-first` layout allowance must not mask a collapsed
input. Repeat on desktop to check
the unchanged desktop path (https://app.hypertask.ai/detail/project-15/6970).

For description-only New Task creation (`/new?id=<private QA board>`), leave the
title empty, enter a description, and save. Under `htpr-8031-auto-title`, the
`/api/ai/task-writer` request carries `requestKind: "auto-title"`; a title-only
reply is valid, but a full task draft still needs a description. Check the saved
title and original description after reload on iPhone-sized, Android-sized and
desktop viewports. Repeat with a manual title and confirm it stays unchanged.
Intercept only the title request with a 503 in a separate browser context to
prove saving uses the first 80 description characters and shows the fallback
notice. This injected failure proves recovery, not live provider health. Never
change shared provider settings. Delete only this run's QA fixtures.

### Delete a chat on the phone

At 390x844, with `htpr-7575-phone-chat-delete` on, open AI chat and open
the chat history list. A personal row has an icon button with
`aria-label="Delete chat"` (not visible row text).
Tap it. The browser asks "Delete this chat?". Confirm, and that chat
leaves the list. Cancel, and it stays. An agent chat row has no trash
button. Flag off, the trash button is absent on every row. Desktop
delete is the same confirm and the same delete action.

### New task sheet on the phone

Open `/new?id=<board id>` at 390x844 with an iPhone user agent and
`htpr-8029-phone-new-task-layout` on. `#createTaskModal` has
`data-phone-new-task-sheet="on"`. `#body` padding-top is the safe area, and at
least 28px, so the sheet starts below the status bar. The description card has
`data-phone-new-task-card="on"`. With `htpr-9440-phone-sheet-editor-card` on,
the description text stays inside that card on a tall screen and scrolls there.
The bar
inside `.attachment-upload-container` (Attach files, and dictate) sits
at the bottom of that card. Open the keyboard. The modal gets
`data-phone-new-task-keyboard="on"` and its bottom edge is the keyboard
inset, so the bar sits above the keyboard. `data-phone-new-task-short="on"`
also appears whenever the keyboard is open, at any height. At desktop width, or
with a desktop user agent, the sheet attributes are absent. Flag off, those
attributes are absent and the sheet is full screen.

### Full-screen phone chat

At 390x844 with an iPhone user agent, `htpr-8032-phone-chat-fullscreen` on, open AI chat
from a board with **Ask AI**. The chat is a dialog labeled AI Chat with
`data-ai-chat-phone-fullscreen`, and it has no sheet handle. The header
is one row. The board picker is one small chip in that header, with no
"Context:" label. The model line under the
title (`data-ai-chat-mobile-model-label`) is hidden. On `/chat` the
screen is still full screen, and that header chip is not added. Desktop
stays the sidebar. Flag off restores the sheet, the handle, the large
board picker, and the model line.

## Gotchas

Known failing on production, tracked in [HTPR-9582](https://app.hypertask.ai/detail/project-15/9582).

Mobile-only layout and interaction bugs desktop testing never catches, most
recently: mobile Task Writer direct save locking up and new-task layout
([HTPR-6564](https://app.hypertask.ai/detail/project-15/6564), two rounds), mobile Agent Chat chrome and composer showing on
the wrong path ([HTPR-6476](https://app.hypertask.ai/detail/project-15/6476), two rounds), mobile creator focus
initialization order ([HTPR-6556](https://app.hypertask.ai/detail/project-15/6556)), mobile Agent Chat layout/mic/reply style
([HTPR-6407](https://app.hypertask.ai/detail/project-15/6407)), and the shortcut nudge not showing on mobile task pages
([HTPR-5906](https://app.hypertask.ai/detail/project-15/5906)). This area has a long tail of past mobile-only fixes; grep
`git log --oneline | grep -i 'BUGFIX.*mobile'` for the full list if a ticket
needs older context.

### What proof to collect

The real phone-width screenshot itself is the proof; a desktop-width
screenshot is not evidence for a mobile ticket, full stop (this cost a real
regression once, see `verify-on-phone/SKILL.md`). Reload after any state
change and reshoot to confirm it held at that viewport.

### Cleanup

Same as whichever underlying area you were testing (task, comment, board);
mobile isn't a separate data surface.

### Phone zoom

With `htpr-8145-phone-zoom` enabled, inspect the server viewport on a phone:
`user-scalable=yes`, `maximum-scale=5`. Pinch to at least 200% on My Tasks,
Inbox rows and task comments. Swipe rows must keep vertical scrolling and
pinch zoom. Text inputs, textareas and editable composers must compute to at
least 16px; focusing them from 100% must not enlarge the visual viewport.
Capture phone screenshots before/after pinching and after focus. Check the
unchanged desktop viewport and the flag-off phone viewport separately. Browser
emulation proves Chromium behavior; record physical iPhone Safari as
unreachable unless a real device is available.
