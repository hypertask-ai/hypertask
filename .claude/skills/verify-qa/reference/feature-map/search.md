# Search autocomplete

Ticket: https://app.hypertask.ai/detail/project-15/6688
Autocomplete is always available; its rollout switch has been removed. No new endpoint or permission is added: entity values use the existing access-scoped `/api/search/values` route; statuses, dates and `has:` values are local suggestions for already supported server filters.

Flag `htpr-6880-search-commenter` (Owner + QA): with search layout on, pick `commenter:@Hicham` for an exact person or type a name/email using the fuzzy-person flag; results show that person’s newest matching comment and open at it, text matches only their comments, and `-commenter:` excludes their tickets without exposing inaccessible boards.
Flag `htpr-6881-search-fuzzy-person` (Owner + QA): typed `from:`/`assignee:` names or emails match every case/accent-insensitive substring in accessible requested boards; numeric chips stay exact and negation excludes all matches.

## Reach it

Open `https://app.hypertask.ai/search` (or use the existing `/` search shortcut). A shared query uses **searchTerm**, e.g. `https://app.hypertask.ai/search?searchTerm=login%20is%3Aopen`. Sign in as Owner or QA; do not change the remaining flags. Use existing tasks only, without creating or modifying data.

## Drive and prove it


Layout flag `htpr-6865-search-layout` (default Owner + QA): suggestions are one in-flow list aligned with the input instead of the floating 18rem box. Empty bar shows Recent searches once, then Tips below them. Typing shows Ask AI, matching operators, then people (name plus email), labels or boards with matched letters bold. Entity values get grey inline completion (`from:Val` shows `entin Yeo`); Tab accepts into a chip. No live results while typing: results load only after accepting a suggestion or recent, pressing Enter, or loading a `searchTerm` URL. Verify the off path with user 2343 (old floating box) and the on path with user 985.

Label flag `htpr-6878-search-label-scope` (Owner + QA; requires layout): positive board chips scope labels, muted ticket counts put unused labels last, unscoped same-name labels combine and filter by name, and Ask AI shows readable chip names.
Match highlights apply when search layout is enabled: verify from/assignee amber inbox name pills, matching label/board pills, safely marked title/snippet words and comment author before the snippet; desktop stays one truncated line, phone stacks, light/dark inherit inbox colours, and disabling layout preserves legacy rows.

Flag `htpr-6879-search-esc-back` (Owner + QA, requires `htpr-6865-search-layout` and `htpr-6994-search-esc-leaves` off): Esc with suggestions closed restores the previous search in this tab, or empty recents + tips; empty searches always show that list, and board chips omit the extra text `#` while the icon and typed `#` picker remain.

1. Focus an empty bar: Search tips lists all ten operators (`from`, `assignee`, `in`, `board`, `label`, `is`, `has`, `after`, `before`, `on`), each with an example and meaning. Click a tip, or use arrows then Tab/Enter: only its operator is inserted, ready for a value.
2. Type `fr`, `la`, `is`, `as`, `in`, `ha`, `af`, `be`, `bo`, `on`. Matching operators appear with grey inline completion. Refocusing an unfinished status, `has:` or date filter reopens its values; accepting a value keeps writing focus even after results return. Keyboard selection scrolls hidden tips into view. For `a`, arrows switch between `assignee:` and `after:` and update the ghost; Tab or Enter accepts. With `htpr-6994-search-esc-leaves` on, Escape returns to the page search was opened from, even with suggestions or tips open; with `htpr-7563-search-esc-footer` also on, the footer says "Esc to go back". With either flag off, the footer keeps "Esc to close". Only with `htpr-6994-search-esc-leaves` off does Escape dismiss the list without clearing text or leaving search; a second Escape follows the existing navigation behavior, including search-history restoration when `htpr-6879-search-esc-back` is enabled.
3. Accept `from:`/`assignee:`/`in:`/`board:`/`label:` and choose an existing, accessible value. These retain the existing permission-scoped people/board/label lookup and `@`/`#` shortcuts. Selecting a row uses its ID, not its display name, and preserves any free text and `-` exclusion.
4. `is:` offers only `open`, `done`, `archived`. `has:` offers `attachment`, `comment`, `due`, `due-date` (the last two mean the same thing). Every operator works with arrows and Tab/Enter, without a mouse.
5. `after:`/`before:`/`on:` offer Today, Yesterday, Last 7 days, This week and a valid typed `YYYY-MM-DD`. Shortcuts insert real ISO dates, not unsupported words. Dates are UTC; This week is Monday. `after:` excludes the chosen day and `before:` excludes it too: the shortcut selects a boundary, not an implicit range. `on:` matches that day. `2024-02-29` is accepted; `2026-02-30` is not suggested. Advanced typed `created:YYYY-MM-DD` and `updated:YYYY-MM-DD` remain supported.
6. While entering an operator value (including a fully typed value before acceptance), a coloured border frames just that filter, not the free text before it. Accepted chips use six distinct palettes: violet people, blue boards, rose labels, emerald status, amber dates, cyan `has`. Verify Porcelain and Graphite/AMOLED: chip text remains primary theme text; colours never replace readable labels.
7. Search for an existing text term such as `login is:open`: literal, case-insensitive matches in result titles are marked. Filter values are not highlighted as text. Title text is rendered by React, not injected as HTML.

## Automated evidence

`node --test tests/search-autocomplete*.test.cjs` exercises the real search input and reused `MentionListRows`, including keyboard acceptance, Escape propagation, typed dates, exclusions and entity lookup scope. Unit tests check parser-aligned operators and values, UTC dates, six colour mappings, full tips coverage and safe literal title highlighting. `npm test` also covers existing chip/parser/API regressions.
