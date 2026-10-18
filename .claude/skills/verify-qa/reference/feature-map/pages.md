# Pages

## How a customer reaches it

Open a ticket, then "Add page" next to "Add sub-tasks", or "New page" in the
ticket's "Pages (n)" list. The page opens at `https://app.hypertask.ai/page/<publicId>`
with "Back to task", "Saved" and the version. Typing `@` in a description can
mention a page. Behind `htpr-7298-standalone-pages` (Owner + QA), a page can
also exist with no ticket and link to many tickets; until the screens in
[HTPR-7309](https://app.hypertask.ai/detail/project-15/7309) ship, that part is
reachable only through the browser-session API:
`POST /api/pages/create` with `project_id` and no `task_id`,
`POST`/`DELETE /api/pages/<publicId>/links` with `task_id`, and
`GET /api/pages/list?scope=all|board`.

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
appear on the ticket, unlink removing it, and the `scope=all` list including
it. Flag-off: 404 from each flagged call. Shoot the changed page screen in
all four themes.

## Cleanup

Archive every page you created (the page's Delete) and delete the test
tickets you created.
