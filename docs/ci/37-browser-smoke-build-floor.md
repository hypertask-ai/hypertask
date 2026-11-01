## Browser smoke build floor (HYCI-49)

Measured 2026-11-01 from the sixteen successful halves in eight `ci-tests` runs
(41265224791, 41265369916, 41265519169, 41265549905, 41266013374, 41266082372,
41266355640, 41267336155), read from the Actions API step timings:

- `browser-smoke-desktop`: 438 to 622 s per half, median 528 s.
- `browser-smoke-mobile`: 449 to 568 s per half, median 522 s.
- The `next build` step, on webpack at the time: 123 to 233 s, median 183 s.
- The served test step: 185 to 264 s, median 227 s.
- The remainder (containers, checkout, caches, Chromium, fixtures): the other
  106 to 162 s.

The decision, for the two alternatives HYCI-49 offers:

- The halves stay at this floor. CI cannot build this app under 90 seconds while
  it builds what production ships: at the time of this measurement `package.json`
  built with `next build --webpack`, and HYCI-32 has both halves build the
  candidate themselves so neither waits behind the other. The build is therefore
  on the critical path of both halves at once, and it is the largest part of a
  half that is not a test.
- The lever belongs to the app, not to this check. A webpack-free build
  (Turbopack) or a smaller build graph has to land in the app first, where the
  shipped build and this smoke build change together. Moving only this check
  would make it build something production does not ship, which HYCI-49's own
  risk section rules out. That work needed an app ticket on board 15.
- That app change landed in HTPR-8245 on 2026-11-01. `package.json`, both halves
  and every other build entry point run `next build` on Turbopack in one commit.
  The build step measured 105 s on its first run (41275339631, desktop half),
  down from the 183 s webpack median and under the previous 123 s floor. The 90
  second target in HYCI-50 stays open.
- The 30 second settle window in `e2e/smoke/prod.spec.ts` stays. It is the only
  lever left inside the check, it is worth about 30 to 40 seconds of each half,
  and no run shows a shorter window catching the same reload regressions. A 6 to
  8 percent saving against a lost reload signal is not a trade to take blind;
  revisit only with a run proving a shorter window still fails the same way.

Required contexts do not change: `browser-smoke` stays the required summary,
`browser-smoke-desktop` and `browser-smoke-mobile` keep their names and their
work, and `app-smoke` is untouched. Nothing here edits a workflow, a spec or a
config line, so the undo is that there is nothing to undo.
