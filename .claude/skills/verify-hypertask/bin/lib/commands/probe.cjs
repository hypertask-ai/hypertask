const { fail, parseArgs } = require("../context.cjs");
const { withPage } = require("../session.cjs");

const usage = `ht-verify probe <selector> - read what the page shows, without changing it

Usage:
  ht-verify probe <selector> [--text] [--count] [--attr <name>] [--style <property>]
                              [--html] [--timeout 15000]
  ht-verify probe --cookie <name>

  <selector>     Playwright selector. Reports how many elements match and what the
                 first one shows. Read-only: nothing is clicked, typed or scrolled.
  --text         the first match's innerText (default when no other flag is given)
  --count        how many elements match; 0 is a reportable miss, not an error
  --attr         an attribute value, such as data-theme or aria-selected
  --style        the computed CSS value of one property, such as color or border-bottom-width
  --html         the first match's innerHTML, clipped
  --cookie       a cookie's value. Refused for names that look like session material.
  --timeout      milliseconds to wait for the selector. Default 15000.

Reports the value as JSON so a checklist can assert on it. A missing selector with
--count 0 exits 0 with ok false, because "absent" is often the assertion.

Examples:
  ht-verify probe "html" --attr data-theme
  ht-verify probe "[data-testid=search-results] [role=option]" --count
  ht-verify probe "h1" --style color
  ht-verify probe --cookie theme`;

const SECRET = /session|token|auth|secret|key|jwt/i;

module.exports = {
  name: "probe",
  summary: "read text, count, attribute, computed style or a safe cookie from the page",
  usage,
  async run(argv) {
    const { values, positionals } = parseArgs(argv, {
      text: "bool", count: "bool", attr: "value", style: "value", html: "bool",
      cookie: "value", timeout: "value",
    });
    if (values.cookie) {
      if (SECRET.test(values.cookie)) {
        fail(`cookie ${values.cookie} looks like session material`, "Probe a preference cookie such as theme. Session values are never printed.", "refused", 2);
      }
      return withPage(async (page, session) => {
        const match = (await page.context().cookies()).find((cookie) => cookie.name === values.cookie);
        return {
          target: session.base.includes("127.0.0.1") ? "local" : "production",
          data: { cookie: values.cookie, present: Boolean(match), value: match?.value ?? null, url: page.url() },
        };
      });
    }
    const selector = positionals[0];
    if (!selector) fail("probe needs a selector", "For example: ht-verify probe \"html\" --attr data-theme", "usage", 2);
    const timeout = Number(values.timeout ?? 15_000);
    const wanted = values.text || (!values.count && !values.attr && !values.style && !values.html);
    return withPage(async (page, session) => {
      const locator = page.locator(selector);
      const first = locator.first();
      if (await first.count()) await first.waitFor({ state: "attached", timeout }).catch(() => {});
      const count = await locator.count();
      const data = { selector, count, url: page.url() };
      if (count > 0) {
        if (wanted) data.text = (await first.innerText().catch(() => "")).slice(0, 2_000);
        if (values.html) data.html = (await first.innerHTML().catch(() => "")).slice(0, 2_000);
        if (values.attr) data.attr = { name: values.attr, value: await first.getAttribute(values.attr).catch(() => null) };
        if (values.style) {
          data.style = { property: values.style, value: await first.evaluate((element, property) => getComputedStyle(element).getPropertyValue(property), values.style).catch(() => null) };
        }
      }
      return {
        target: session.base.includes("127.0.0.1") ? "local" : "production",
        data,
        ok: count > 0,
        error: count > 0 ? null : { code: "missing", message: `no element matched ${selector}`, next: "Open the page that holds it, or fix the selector, then probe again." },
      };
    });
  },
};
