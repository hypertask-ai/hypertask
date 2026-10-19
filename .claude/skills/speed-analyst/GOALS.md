# Speed goals

**Goal: every page shows its content in 50 ms**, like Linear and Superhuman. Valentin set this goal (2026-10-19): "our orignal goal was to achieve 50ms load time per page ... like superhuman/linear i wanted instant loading as the whole app lives already on theusers diskr/ram/cache".

The 50 ms goal applies to **moving inside the app** once it is open, because the data is already on the device. The first open of a cold tab also needs the network, so it gets its own, looser milestone targets.

## Baseline (2026-10-18)

Median content-visible time from `node scripts/speed/measure.mjs`, QA 2343 on production, 5 samples per path.

| Path | Desktop | Phone |
|---|---|---|
| Board | 1817 ms | 10122 ms |
| Ticket, first open | 1937 ms | 13659 ms |
| Ticket, opened before | 433 ms | 2934 ms |
| Page navigation | 796 ms | 2503 ms |
| Search | 1062 ms | 2458 ms |
| Ctrl+J | 511 ms | 1217 ms |
| My Tasks | 275 ms | 888 ms |

Each path is 5x to 270x away from 50 ms. The phone board and the first ticket open are the furthest.

## Milestones

Work on the next open milestone first. A path counts as met once its median stays under the target on 3 daily runs in a row.

| Milestone | Desktop target | Phone target |
|---|---|---|
| 1 | Every path under 1000 ms | Board and first ticket under 4000 ms, the rest under 2000 ms |
| 2 | Opened-before ticket, My Tasks, Ctrl+J and page navigation under 200 ms; the rest under 500 ms | Every path under 1500 ms |
| 3 | In-app navigation under 100 ms | In-app navigation under 400 ms |
| Goal | **In-app navigation under 50 ms**, first open under 500 ms | **In-app navigation under 100 ms**, first open under 1500 ms |

## How fast apps get there

Research rounds compare these against our code and score them in [PLAYBOOK.md](PLAYBOOK.md):

- **Local data first.** Linear keeps the workspace in IndexedDB and memory and syncs changes in the background, so a click reads local data and draws without waiting for the network.
- **App shell cached on the device.** A service worker serves the app code from disk, so a new tab does not download it again.
- **Prefetch what comes next.** Load the ticket while the pointer is on the card, before the click.
- **Less work on the main thread.** Fewer and shorter long tasks; the board run above spends over 1 s in long tasks.

## Rules for the speed runner

- **Never idle.** The runner dispatcher sends SPEED RUNNER the top free `[SPEED]` ticket. With none free, it sends a research round every 6 hours, which ends with the best experiment filed as a `[SPEED]` ticket.
- **Nothing breaks.** A speed change keeps the output identical, ships with a regression test and same-condition before and after numbers, and passes live QA before Done. A change users can see goes behind a flag.
- **Report against the goals.** Each closed speed ticket names the path, the milestone and the before and after median in its done note.
