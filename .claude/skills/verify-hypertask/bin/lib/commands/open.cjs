const { fail, parseArgs } = require("../context.cjs");
const { withPage } = require("../session.cjs");

const usage = `ht-verify open <path-or-url> - navigate the persistent session

Usage:
  ht-verify open <path-or-url> [--wait <selector>] [--full]

  <path>            a path on the session's base URL, or a full URL.
  --wait            wait for this selector before reporting (up to 30s).
  --full            wait for the load event and network idle, not just DOM ready.

Starts nothing. Needs ht-verify session start first, and reports the landed URL,
HTTP status and title, so a login landing is visible without a screenshot.

Examples:
  ht-verify open /my-tasks
  ht-verify open /project?id=7049&surface=board --wait ".kanban-column-title"`;

module.exports = {
  name: "open",
  summary: "navigate the persistent browser session",
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs(argv, { wait: "value", full: "bool" });
    const target = positionals[0];
    if (!target) fail("open needs a path or URL", "For example: ht-verify open /my-tasks", "usage", 2);
    return withPage(async (page, session) => {
      const url = target.startsWith("/") ? new URL(target, session.base).toString() : target;
      const response = await page.goto(url, { waitUntil: values.full ? "networkidle" : "domcontentloaded", timeout: 60_000 });
      if (values.wait) await page.locator(values.wait).first().waitFor({ state: "visible", timeout: 30_000 });
      return { target: session.base.includes("127.0.0.1") ? "local" : "production", data: { requested: target, url: page.url(), status: response?.status() ?? null, title: await page.title() } };
    });
  },
};
