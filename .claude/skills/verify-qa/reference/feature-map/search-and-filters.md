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
  scrambled title words (`HTPR-6372`, three rounds: `#549`, `#552`, `#553`).
- Archived tasks and title matches dropping out of ranked search
  (`HTPR-6372` again, `#552`).
- Board filters not applying immediately, requiring a reload to take effect
  (`HTPR-6595`).

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
