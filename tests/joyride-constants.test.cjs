const test = require("node:test")
const assert = require("node:assert")

// src/lib/tours/hooks/useTour.tsx inlines these string constants instead of
// importing STATUS/ACTIONS/EVENTS from react-joyride, because a value import
// would pull the library's 102 KB runtime back into the board's initial chunk
// and undo the dynamic import (HTPR-4508).
//
// The cost of inlining is that a react-joyride upgrade could change a string and
// silently break the tour callback: `status === 'finished'` would just stop
// matching and tours would never mark themselves complete. This test is the
// tripwire. If it fails, update BOTH this file and the constants in useTour.tsx.
const INLINED = {
  STATUS: { FINISHED: "finished", SKIPPED: "skipped" },
  ACTIONS: { PREV: "prev" },
  EVENTS: { STEP_AFTER: "step:after", TARGET_NOT_FOUND: "error:target_not_found" },
}

test("inlined react-joyride constants still match the library", () => {
  const joyride = require("react-joyride")

  for (const [group, pairs] of Object.entries(INLINED)) {
    assert.ok(joyride[group], `react-joyride no longer exports ${group}`)
    for (const [key, value] of Object.entries(pairs)) {
      assert.strictEqual(
        joyride[group][key],
        value,
        `react-joyride ${group}.${key} is now "${joyride[group][key]}", but useTour.tsx inlines "${value}"`
      )
    }
  }
})
