const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(path.join(root, "tests/velocity-entry.cjs"), {
  interopDefault: true,
  alias: { "@": path.join(root, "src") },
});

const {
  normalizeReportSlug,
  REPORT_BODY_MAX,
  REPORT_SLUG_RE,
  ReportValidationError,
  validateReportBody,
  validateSlug,
  RESERVED_REPORT_SLUGS,
} = jiti(
  path.join(root, "src/utils/controllers/reports/reportService.ts")
);
const { buildHtmlBlockSrcDoc } = jiti(
  path.join(
    root,
    "src/components/RTE/Extensions/HtmlBlock/buildSrcDoc.ts"
  )
);

test("report slugs normalize to lowercase dash-separated ASCII", () => {
  const cases = [
    [" Quarterly Report ", "quarterly-report"],
    ["UPPER_CASE", "upper-case"],
    ["revenue!!!growth", "revenuegrowth"],
    ["résumé 東京", "rsum"],
    ["---many___spaces---", "many-spaces"],
    ["___", ""],
    [`${"a".repeat(63)}-${"b".repeat(10)}`, "a".repeat(63)],
    ["a".repeat(80), "a".repeat(64)],
  ];

  for (const [input, expected] of cases) {
    const result = normalizeReportSlug(input);
    assert.equal(result, expected);
    if (result) assert.match(result, REPORT_SLUG_RE);
  }
});

test("report body validation accepts the cap and rejects one character over", () => {
  assert.doesNotThrow(() => validateReportBody("x".repeat(REPORT_BODY_MAX)));
  assert.throws(
    () => validateReportBody("x".repeat(REPORT_BODY_MAX + 1)),
    (error) =>
      error instanceof ReportValidationError && error.field === "bodyHtml"
  );
});

test("HTML block source documents block network connections", () => {
  const output = buildHtmlBlockSrcDoc("<p>Report</p>");
  assert.match(output, /connect-src 'none'/);
});

if (typeof DOMParser !== "undefined") {
  test("our CSP appears before a full document's own CSP", () => {
    const agentCsp = "default-src https:";
    const output = buildHtmlBlockSrcDoc(
      `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${agentCsp}"></head><body>Report</body></html>`
    );
    const ourCspIndex = output.indexOf("connect-src 'none'");
    const agentCspIndex = output.indexOf(agentCsp);

    assert.ok(ourCspIndex >= 0);
    assert.ok(agentCspIndex > ourCspIndex);
  });
}

test("reserved built-in slugs are rejected", () => {
  for (const reserved of RESERVED_REPORT_SLUGS) {
    // The static /report/project-N/velocity route shadows [reportSlug], so a
    // report saved under that slug could never render at its own URL.
    assert.throws(
      () => validateSlug(reserved),
      (error) =>
        error instanceof ReportValidationError && error.field === "slug"
    );
    assert.throws(() => validateSlug(`  ${reserved.toUpperCase()}!  `));
  }
});
