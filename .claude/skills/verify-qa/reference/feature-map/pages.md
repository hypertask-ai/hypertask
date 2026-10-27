# Pages

## How a customer reaches it

Open a ticket, then "Add page" next to "Add sub-tasks", or "New page" in the
ticket's "Pages (n)" list. The page opens at `https://app.hypertask.ai/page/<publicId>`
with "Back to task", "Saved" and the version. Typing `@` in a description can
mention a page. With `htpr-7298-standalone-pages` and `htpr-7309-pages-screens` enabled,
the left rail's Pages row and Commands → Go to Pages open `/pages`.
This board / All boards, search and Archived pages narrow the list.
New page creates a standalone document on the selected board (or asks for a
board). The editor shows Linked tickets, Link ticket and Unlink; a page
with no visible ticket returns to Pages. A ticket offers Link page next to
New page, using the existing Commands-style picker. Commands also offers
New page, Link page on tickets and Link ticket in the page editor.
The original standalone-pages flag retains its current audience; the new
screen flag defaults to Everyone but cannot widen standalone-page access.

## How to drive it

Headless Playwright or `phone-shot.sh` against production. Use the QA flag
identity (`storageState-qa.json`, user 985) for the flagged API and the plain
account (`storageState-qa-normal.json`, user 2343) for the flag-off path: the
three flagged calls answer 404 for it, and its ticket pages behave as before.
Call the API from the page context (`page.evaluate(fetch)`) so the session
cookie is used. Work on a board the QA account owns.

## What usually breaks

- A page with no visible ticket crashing the editor or "Back to task"
  pointing nowhere (it should read "Back to board" when the flag is on).
- A page or its title showing on a ticket to someone who cannot open the
  page's board, or counts that include hidden pages.
- Moving a ticket to another board: a page moves only when that ticket is its
  only link and it sat on the ticket's old board.
- Images in a page not loading after a ticket move or unlink.

## What proof to collect

Ticket with "Pages (1)", the page editor with "Saved", reload keeping the
title, and "Back to task" returning to the ticket, desktop and 390x844.
Flagged: a standalone page opening with "Back to board", a link making it
appear on the ticket, unlink removing it, and the Pages list including it. Search, board scope, Archived pages,
Commands entries and Link page from the ticket must also work. On a fresh ticket load, search for Link page immediately; late flag or route updates must refresh the open search without retyping or reloading. Repeat at desktop and phone width. Flag-off: 404 from each flagged call. Shoot the changed page screen in
all four themes.

## Cleanup

Archive every page you created (the page's Delete) and delete the test
tickets you created.
