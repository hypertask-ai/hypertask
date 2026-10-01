# Search autocomplete

Ticket: https://app.hypertask.ai/detail/project-15/6688
Flag: `htpr-6688-search-autocomplete` (default Owner + QA). Existing search operators and chips must also be enabled. No new endpoint or permission is added: entity values use the existing access-scoped `/api/search/values` route; statuses, dates and `has:` values are local suggestions for already supported server filters.

## Reach it

Open `https://app.hypertask.ai/search` (or use the existing `/` search shortcut). A shared query uses **searchTerm**, e.g. `https://app.hypertask.ai/search?searchTerm=login%20is%3Aopen`. Sign in as Owner or QA; do not change the flag to Everyone. Use existing tasks only, without creating or modifying data.

## Drive and prove it

1. Focus an empty bar: Search tips lists all ten operators (`from`, `assignee`, `in`, `board`, `label`, `is`, `has`, `after`, `before`, `on`), each with an example and meaning. Click a tip, or use arrows then Tab/Enter: only its operator is inserted, ready for a value.
2. Type `fr`, `la`, `is`, `as`, `in`, `ha`, `af`, `be`, `bo`, `on`. Matching operators appear with grey inline completion. Refocusing an unfinished status, `has:` or date filter reopens its values; accepting a value keeps writing focus even after results return. Keyboard selection scrolls hidden tips into view. For `a`, arrows switch between `assignee:` and `after:` and update the ghost; Tab or Enter accepts. Escape dismisses only the list without clearing text or leaving search; a second Escape retains existing page navigation.
3. Accept `from:`/`assignee:`/`in:`/`board:`/`label:` and choose an existing, accessible value. These retain the existing permission-scoped people/board/label lookup and `@`/`#` shortcuts. Selecting a row uses its ID, not its display name, and preserves any free text and `-` exclusion.
4. `is:` offers only `open`, `done`, `archived`. `has:` offers `attachment`, `comment`, `due`, `due-date` (the last two mean the same thing). Every operator works with arrows and Tab/Enter, without a mouse.
5. `after:`/`before:`/`on:` offer Today, Yesterday, Last 7 days, This week and a valid typed `YYYY-MM-DD`. Shortcuts insert real ISO dates, not unsupported words. Dates are UTC; This week is Monday. `after:` excludes the chosen day and `before:` excludes it too: the shortcut selects a boundary, not an implicit range. `on:` matches that day. `2024-02-29` is accepted; `2026-02-30` is not suggested. Advanced typed `created:YYYY-MM-DD` and `updated:YYYY-MM-DD` remain supported.
6. While entering an operator value (including a fully typed value before acceptance), a coloured border frames just that filter, not the free text before it. Accepted chips use six distinct palettes: violet people, blue boards, rose labels, emerald status, amber dates, cyan `has`. Verify Porcelain and Graphite/AMOLED: chip text remains primary theme text; colours never replace readable labels.
7. Search for an existing text term such as `login is:open`: literal, case-insensitive matches in result titles are marked. Filter values are not highlighted as text. Title text is rendered by React, not injected as HTML.
8. Turn the ticket flag off for the test account using the approved admin UI (restore its previous mode afterwards): no new tips, operator dropdown, ghost, frame, colours or title treatment; existing chip/value-picker behavior is unchanged. Non-Owner/QA accounts follow that same off path by default.

## Automated evidence

`node --test tests/search-autocomplete*.test.cjs` exercises the real search input and reused `MentionListRows`, including keyboard acceptance, Escape propagation, typed dates, exclusions, entity lookup scope and the disabled path. Unit tests check parser-aligned operators and values, UTC dates, six colour mappings, full tips coverage, flag registration/default and safe literal title highlighting. `npm test` also covers existing chip/parser/API regressions.
