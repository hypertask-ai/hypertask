# Search suggestions

The existing search screen can show an aligned, full-width list under its input when `htpr-6865-search-layout`, `htpr-6688-search-autocomplete`, `htpr-6370-search-chips`, and `htpr-6369-search-operators` are enabled. The new flag defaults to Owner + QA; the owner controls rollout at `/admin/flags`.

- Empty search shows recent queries once, with readable filter chips, then operator examples and meanings. Tips use two columns on desktop and one on phones.
- Typing shows Ask AI first, matching operators next, then matching people, labels and boards. People include their email and the existing avatar; matching letters are bold.
- At the end of an entity value (`from:`, `assignee:`, `in:`, `board:`, `label:`), a prefix match completes in grey. Tab accepts the selected suggestion into a chip.
- Arrows select suggestions; j/k also work on empty tips. Tab/Enter accepts; Escape dismisses without clearing the query. Enter on ordinary text searches; selecting Ask AI sends the text to the existing general AI chat.
- Draft text does not request document results or display previous results. Accepting a value or recent query, pressing Enter, or loading a search URL runs search. Choosing an operator alone opens its values rather than searching an incomplete filter. Removing a chip or changing archive scope while drafting also waits for submission.
- Search results and the empty-result message share the input's inset.

With the layout flag off (or any prerequisite off), the existing popover, history, and search behavior remain unchanged. `/api/search/values` returns people emails only to sessions with all four flags enabled, within the existing accessible-board scope.

Sources: `src/app/search/SearchChipsInput.tsx`, `src/app/search/SearchComp.tsx`, `src/hooks/Search/useSearch.ts`, `src/pages/api/search/values.ts`. Tests: `tests/search-layout.test.cjs` and the existing `tests/search-*` suites.
