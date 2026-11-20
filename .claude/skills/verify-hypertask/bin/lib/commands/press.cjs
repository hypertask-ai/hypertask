const { fail, parseArgs } = require("../context.cjs");
const { withPage } = require("../session.cjs");

const usage = `ht-verify press <keys> - send a key chord to the persistent session

Usage:
  ht-verify press <keys> [--selector <selector>] [--count 1] [--wait 250]

  <keys>      Playwright key chord: a single key, or modifiers joined with "+".
              Examples: Escape, Tab, j, Shift+3, Control+Shift+S, Control+k.
  --selector  focus this element first, so a shortcut reaches the editor or list
              that owns it. Omit to send the chord to whatever has focus.
  --count     repeat the chord this many times, for j/k row movement.
  --wait      milliseconds to wait after the last chord before reporting.

Reports the landed URL and the text of the focused element after the key.

Examples:
  ht-verify press Escape
  ht-verify press "Control+Shift+S" --selector "[data-testid=comment-row]"
  ht-verify press j --count 3`;

module.exports = {
  name: "press",
  summary: "send a key chord to the persistent browser session",
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs(argv, { selector: "value", count: "value", wait: "value" });
    const keys = positionals.join(" ");
    if (!keys) fail("press needs a key or chord", "For example: ht-verify press Escape", "usage", 2);
    const count = Number(values.count ?? 1);
    if (!Number.isInteger(count) || count < 1 || count > 50) fail(`invalid --count ${values.count}`, "Pass a repeat count between 1 and 50.", "usage", 2);
    const wait = Number(values.wait ?? 250);
    return withPage(async (page, session) => {
      if (values.selector) await page.locator(values.selector).first().focus({ timeout: 15_000 });
      for (let index = 0; index < count; index += 1) await page.keyboard.press(keys);
      if (wait > 0) await page.waitForTimeout(wait);
      const focused = await page.evaluate(() => {
        const element = document.activeElement;
        if (!element) return null;
        return {
          tag: element.tagName.toLowerCase(),
          text: (element.textContent || element.getAttribute("placeholder") || "").trim().slice(0, 120),
        };
      });
      return {
        target: session.base.includes("127.0.0.1") ? "local" : "production",
        data: { keys, count, focused, url: page.url() },
      };
    });
  },
};
