# Pages

## Sub-features

- `pages` Pages.
- `snippets` `/snippets` is the Snippets screen. Saved snippets lists each title and a text preview, or No snippets yet. New snippet clears the editor. A title and content, then Create or Save. Delete removes the open snippet.
- `page-image-gallery` With `htpr-6872-page-image-gallery` on, a plain click on a page image that is not a Figma embed preview opens the full-size gallery of that page's images, including images inside an HTML block, and the gallery download control. A modifier-click does not open it. Off, the click only places the cursor.
- `smart-page-search` With `htpr-9017-smart-page-search` on, Search pages on the Pages list can return a page whose words differ, from the page index of its text and meaning. Results stay on boards you can open. Archived pages and boards that are not Normal stay out. Off, only a title or body that contains the words matches.

## How to get to it (user POV)

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
Snippets: Commands, Go to snippets, or press `g` then `;`.
The address is `https://app.hypertask.ai/snippets`. A signed-out visit is sent to sign in.

## Driving it with agent-browser

Headless Playwright or `phone-shot.sh` against production. Use the QA flag
identity (`storageState-qa.json`, user 985) for the flagged API and the plain
account (`storageState-qa-normal.json`, user 2343) for the flag-off path: the
three flagged calls answer 404 for it, and its ticket pages behave as before.
Call the API from the page context (`page.evaluate(fetch)`) so the session
cookie is used. Work on a board the QA account owns.

Snippets: open `/snippets`, create one with a title and some content, reload,
and confirm it is in Saved snippets. Delete it and confirm it is gone.

```text
/snippets: "New snippet" opens Title (placeholder "e.g. Weekly update") and a
content editor. Create -> the row appears with its text preview. Reload -> still
listed. Open it -> Delete -> it leaves the list.
```

Gallery: open a page that has an image, with `htpr-6872-page-image-gallery`
on. Click the image. The gallery opens on that image, can move through the
page's other images, and can download. Close it and confirm you are still on
the page. With the flag off, the same click does not open a gallery.

Page search: on the Pages list, search for words that are not a literal title
or body match for a page you can open. With `htpr-9017-smart-page-search` on,
that page can appear. With it off, only a literal title or body match appears.
A page on a board you cannot open stays hidden either way. `/pages` loads with
`Pages <count>`, `Archived pages`, `New page`, `This board`, `All boards` and a
`Search pages…` field. A standalone page (created with `project_id` and no
`task_id`) reads **Back to Pages** at the top left; only a page whose flags are
off, or that has a linked ticket, reads **Back to board** / **Back to task**.

## Gotchas

- A page with no visible ticket crashing the editor or "Back to task"
  pointing nowhere (it should read "Back to Pages" while `htpr-7298-standalone-pages`
  and `htpr-7309-pages-screens` are both on, and "Back to board" only when one is off).
- A page or its title showing on a ticket to someone who cannot open the
  page's board, or counts that include hidden pages.
- Moving a ticket to another board: a page moves only when that ticket is its
  only link and it sat on the ticket's old board.
- Images in a page not loading after a ticket move or unlink.
- A page image click doing nothing while `htpr-6872-page-image-gallery` is on, or the gallery opening while it is off.
- Search pages returning a page from a board you cannot open while `htpr-9017-smart-page-search` is on.

### What proof to collect

Ticket with "Pages (1)", the page editor with "Saved", reload keeping the
title, and "Back to task" returning to the ticket, desktop and 390x844.
Flagged: a standalone page opening with "Back to Pages", a link making it
appear on the ticket, unlink removing it, and the Pages list including it. Search, board scope, Archived pages,
Commands entries and Link page from the ticket must also work. On a fresh ticket load, search for Link page immediately; late flag or route updates must refresh the open search without retyping or reloading. Repeat at desktop and phone width. Flag-off: 404 from
`POST /api/pages/create` with `project_id`, `GET /api/pages/list` and the
`/api/pages/<publicId>/links` routes. `GET /api/pages/search` is not gated and
still answers 200 with plain matches. Shoot the changed page screen in
all four themes. Also shoot `/snippets` after creating and after deleting a
snippet, a page image gallery open and closed for `htpr-6872-page-image-gallery`,
and a Pages search that finds a non-literal page only while
`htpr-9017-smart-page-search` is on.

### Cleanup

Archive every page you created (the page's Delete) and delete the test
tickets you created. A standalone page is archived with
`POST /api/pages/<publicId>/archive`; there is no DELETE on that path.
