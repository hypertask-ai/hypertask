# Calendar

## Sub-features

- `calendar-route` Calendar surface.
- `calendar-loading-shell` Calendar surface.

## How to get to it (user POV)

`https://app.hypertask.ai/calendar`, or the rail **Go to calendar**, or `g` then `c` (`src/components/PageComponents/Kanban/HeaderComponents/AppShellRail.tsx`). Signed-out visits redirect to sign-in.

## Driving it with agent-browser

`agent-browser` or `ht-verify`, headless, `https://app.hypertask.ai/...?realtime=on`, QA state `~/.config/hypertask-videos/storageState-qa.json`.

Open `/calendar` with QA 985. Wait for the calendar grid or the muted **Loading calendar…** shell when `htpr-7397-calendar-loading-shell` is on (`src/app/calendar/page.tsx:15-28`). Confirm the app rail stays visible during hydration. Do not drag events unless the ticket requires a write check.

There is no `Calendar` heading to read. The rail is icons with accessible names only, and on a phone the bottom tab carries the word. The week view draws weekday headers (`Monday` to `Friday`) plus `Today` and a date range such as `Nov 23 – 29`; expect one of those, so the check waits for the grid instead of passing on the **Loading calendar…** shell. The `‹` and `›` arrows move one period and have no accessible name, so do not plan a click by name on them.

## Gotchas

Calendar is its own route, not a board view switch (`boards-and-views.md`). Hydration mismatches show React errors #418/#423/#425. Timezone bugs remount the whole page.

### What proof to collect

Screenshot the primary heading and one representative control at 1440x900 and 390x844 when the layout differs. Save the URL, account, and flag mode when a flag gates the control.

### Cleanup

Archive or delete only fixtures this check created. Leave production boards unchanged on read-only passes.
