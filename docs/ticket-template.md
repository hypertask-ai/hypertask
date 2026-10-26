# Ticket template

Every ticket writer uses this. One shape, plain language, a recommendation in every ticket.

## The shape

1. **What the person sees.** The screen, the action, the words on it. A screenshot or the exact copy if you have it.
2. **What is wrong, or what is wanted.** One or two sentences. If it is a bug, the steps and what happens instead.
3. **The recommendation.** One option, named, with one line of why. Not a menu of options with no pick.
4. **The acceptance line.** "Done when" in things a person could check on the live app.
5. **The proof.** What will show it worked: a screenshot pair, a number before and after, a live check.

Optional, only when they carry weight: related tickets, what was tried and rejected, and anything that must not change.

## What never goes in the body

- File paths, function names, line numbers, class names. Those belong in the PR.
- Internal ids, commit hashes, workspace names.
- A question the writer has not answered themselves. If two options are genuinely undecided, say who decides and what you recommend.

## Rules

- Keep every number, name and quote the person gave, word for word. Do not round 15.4 to 15.
- A duplicate is not a new ticket. Search first, then link the existing ticket and say what the new ask adds.
- The recommendation is compulsory. A ticket without one is not finished.
- Under 400 words unless the change is genuinely large.

## Example

> **What the person sees.** In the Inbox, pressing E on a ticket marked blocked by me does nothing.
> **What is wrong.** Every other Inbox ticket leaves on E. This one stays, and it comes back after a reload.
> **Recommendation.** Treat blocked-by-me tickets like any other: archive on E, keep the blocker marker, move focus to the next ticket. Why: the marker already explains why the ticket waited, the archive key should not be a special case.
> **Done when.** On desktop and phone, E removes the ticket, it stays gone after two reloads, and the next ticket takes focus.
> **Proof.** Screenshot before and after, plus the reload, on both sizes.
