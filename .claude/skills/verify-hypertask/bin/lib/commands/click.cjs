const { fail, parseArgs } = require("../context.cjs");
const { withPage } = require("../session.cjs");

const usage = `ht-verify click <selector> - click one element in the persistent session

Usage:
  ht-verify click <selector> [--double] [--timeout 15000]

  <selector>  Playwright selector. Prefer role, aria-label, data-testid or a stable id.
  --double    double-click, for editors that open on a second click.
  --timeout   Milliseconds to wait for the element. Default 15000.

Reports the landed URL and the element's text after the click.

Examples:
  ht-verify click "[data-rfd-drag-handle-draggable-id=\\"task-123\\"]"
  ht-verify click "text=My Tasks"`;

module.exports = {
  name: "click",
  summary: "click one element in the persistent browser session",
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs(argv, { timeout: "value", double: "bool" });
    const selector = positionals[0];
    if (!selector) fail("click needs a selector", "For example: ht-verify click \"text=My Tasks\"", "usage", 2);
    const timeout = Number(values.timeout ?? 15_000);
    return withPage(async (page, session) => {
      const locator = page.locator(selector).first();
      const text = await locator.innerText({ timeout }).catch(() => "");
      if (values.double) await locator.dblclick({ timeout });
      else await locator.click({ timeout });
      return { target: session.base.includes("127.0.0.1") ? "local" : "production", data: { selector, text: text.slice(0, 120), url: page.url() } };
    });
  },
};
