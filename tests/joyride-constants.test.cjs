const test = require("node:test")
const assert = require("node:assert")

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
