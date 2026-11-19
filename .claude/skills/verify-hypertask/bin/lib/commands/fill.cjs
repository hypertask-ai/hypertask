const { fail, parseArgs } = require("../context.cjs");
const { withPage } = require("../session.cjs");

const usage = `ht-verify fill <selector> <text> - type into one field in the persistent session

Usage:
  ht-verify fill <selector> <text...> [--submit] [--timeout 15000]

  <selector>  Playwright selector for an input, textarea or contenteditable editor.
  <text>      everything after the selector, joined with spaces.
  --submit    press Enter after filling.
  --timeout   Milliseconds to wait for the field. Default 15000.

Reports the landed URL and the field's value length, never the value itself.

Examples:
  ht-verify fill "#comment-input .ProseMirror" "checked on mobile" --submit
  ht-verify fill "input[name=query]" "billing"`;

module.exports = {
  name: "fill",
  summary: "type into one field in the persistent browser session",
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs(argv, { submit: "bool", timeout: "value" });
    const [selector, ...words] = positionals;
    if (!selector || !words.length) fail("fill needs a selector and text", "For example: ht-verify fill \"input[name=query]\" billing", "usage", 2);
    const text = words.join(" ");
    const timeout = Number(values.timeout ?? 15_000);
    return withPage(async (page, session) => {
      const locator = page.locator(selector).first();
      try {
        await locator.fill(text, { timeout: 5_000 });
      } catch {
        await locator.click({ timeout });
        await page.waitForTimeout(500);
        await locator.fill(text, { timeout });
      }
      if (values.submit) await locator.press("Enter");
      return { target: session.base.includes("127.0.0.1") ? "local" : "production", data: { selector, length: text.length, url: page.url() } };
    });
  },
};
