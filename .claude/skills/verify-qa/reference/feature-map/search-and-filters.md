# Search and filters

## How a customer reaches it

The search bar (any board, or global) and board filter controls.

## How to drive it

`agent-browser`, headless, `?realtime=on`. Search a term that matches a title
word and a scrambled/partial word, and check both archived and active tasks
show up when they should. For filters, apply one and reload to confirm it
holds.

## What usually breaks

- Weak matches ranking above strong ones, or title phrases not outranking
  scrambled title words ([HTPR-6372](https://app.hypertask.ai/detail/project-15/6372), three rounds: `#549`, `#552`, `#553`).
- Archived tasks and title matches dropping out of ranked search
  ([HTPR-6372](https://app.hypertask.ai/detail/project-15/6372) again, `#552`).
- Board filters not applying immediately, requiring a reload to take effect
  ([HTPR-6595](https://app.hypertask.ai/detail/project-15/6595)).

## Phone search operators

With `htpr-6371-mobile-search` enabled (Owner + QA), use the same `/search`
input as desktop. At widths below 768px, check `@` and `#` using input events,
including composition and keyboard prediction replacements. Pick from-person,
commenter, assignee, in/board, label, is, before/after/on and has suggestions.
The existing list follows `visualViewport` above the keyboard and clears the
bottom navigation. Its preselected row is visible, rows and chip-wide remove
buttons are at least 44px tall, and long names truncate without hiding icons.
The existing Show results row is available above the keyboard; the keyboard
Search key runs the query rather than choosing an autocomplete suggestion.
Check wrapping, tap the existing x to remove a filter, and compare the URL and
results with desktop. Verify 390x844, 375x667 and landscape, all four themes,
then confirm flag-off and desktop retain the current layout. Simulated viewport
checks do not replace a physical iOS Safari and Android Chrome check after deploy.

## What proof to collect

Screenshot the search results for the exact query from the ticket, in the
exact order returned. Ranking bugs are about order, not presence, so a
screenshot that only shows "the task appeared somewhere" doesn't verify a
ranking fix.

## Cleanup

None; search and filters don't write data.

## Gap

No `e2e/smoke` write journey covers search yet (the old Midscene
`search-works` flow retired with the rest of that suite). Verify by hand.
