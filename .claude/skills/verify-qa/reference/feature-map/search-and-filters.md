# Search and filters

## Sub-features

- `phone-search-operators` Phone search operators.
- `hide-tags` With `htpr-8171-hide-tags` on (Owner + QA), the tags filter on a board or on My Tasks can be set to Hide tags. Left and right, or the match label, cycle Match ANY, Match ALL, then Hide tags. Tickets that carry any picked tag drop out of that saved view, and the active tags row shows Hide. Asking AI for everything except those tags can save the view that way. Off, Hide is not offered, and a saved Hide does not remove tickets.

## How to get to it (user POV)

The search bar (any board, or global) and board filter controls.
Tags hide: open a board or My Tasks, open filters, pick one or more tags,
and set the tags match to Hide tags while `htpr-8171-hide-tags` is on.
Read the live mode first with `ht-verify flags show htpr-8171-hide-tags`; it is
EVERYONE on production, so there is no live off path.

## Driving it with agent-browser

Search: `?realtime=on`, search a term that matches a title word and a
scrambled/partial word, and check both archived and active tasks show up when
they should. For filters, apply one and reload to confirm it holds. For hide
tags, use the QA flag account. Pick tags on a board and on
My Tasks, set Hide tags, and confirm tickets with any of those tags leave
the list. The active tags row shows Hide. Reload and confirm the saved view
still hides them. With `htpr-8171-hide-tags` off, Hide is absent and a view
saved as Hide shows those tickets again.

Worked on production, 2026-11-20, QA 985 on QA Sandbox 7049:

```bash
ht-verify open /search --wait "#search-input"
ht-verify fill "#search-input" "login is:open"     # URL becomes /search?searchTerm=login+is%3Aopen after Enter
ht-verify press Enter --wait 2500
ht-verify probe "#tasks-list" --count              # 1 list with result rows
ht-verify probe mark --count                       # >0: title and snippet matches are marked

ht-verify open "/project?id=7049&surface=board" --wait "[aria-label='Filter board']"
ht-verify click "[aria-label='Filter board']"      # dialog: Filters / Match ANY Filters / Tags row
ht-verify click "text=Tags"                        # tag values, "Match ANY tags" once a tag is picked
ht-verify click 'text="bugs"'                      # applies the tag filter immediately
ht-verify click 'text="Match ANY tags"'            # becomes "Match ALL tags"
ht-verify click 'text="Match ALL tags"'            # becomes "Hide tags"; the tags row shows "\u00b7 Hide"
ht-verify shot --session --out hide-tags.png
```

The tag filter row is labelled Tags on a board, and the three match states
cycle in that order. Reload loses an unsaved filter; only Save view keeps it,
so shoot the saved view when the ticket is about persistence.

## Gotchas

- The tips list is longer than the eleven operators in `search.md`: live it
  also offers `type:`, `priority:`, `phrase:` and `exclude:`. Read the list
  rather than counting to eleven.
- Weak matches ranking above strong ones, or title phrases not outranking
  scrambled title words ([HTPR-6372](https://app.hypertask.ai/detail/project-15/6372), three rounds: `#549`, `#552`, `#553`).
- Archived tasks and title matches dropping out of ranked search
  ([HTPR-6372](https://app.hypertask.ai/detail/project-15/6372) again, `#552`).
- Board filters not applying immediately, requiring a reload to take effect
  ([HTPR-6595](https://app.hypertask.ai/detail/project-15/6595)).
- Hide tags removing a ticket that does not carry the picked tags, or leaving a tagged ticket visible while `htpr-8171-hide-tags` is on.
- Hide still removing tickets while `htpr-8171-hide-tags` is off.

### Phone search operators

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

### What proof to collect

Screenshot the search results for the exact query from the ticket, in the
exact order returned. Ranking bugs are about order, not presence, so a
screenshot that only shows "the task appeared somewhere" doesn't verify a
ranking fix. For `htpr-8171-hide-tags`, shoot the tags filter on Hide tags
and the list with those tickets gone. Live off is unreachable while the flag
is EVERYONE, so the off proof is the flag-off test named in the ticket.

### Cleanup

None; search and filters don't write data.

### Gap

No `e2e/smoke` write journey covers search yet (the old Midscene
`search-works` flow retired with the rest of that suite). Verify by hand.
