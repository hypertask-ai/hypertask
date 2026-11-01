export const isolatedCjsTests = new Set([
  "tests/action-archive-cache.test.cjs",
  "tests/agent-run-activities.test.cjs",
  "tests/failed-payment-plan-gate.test.cjs",
  "tests/feature-flags.test.cjs",
  "tests/htpr-6478-regressions.test.cjs",
  "tests/management-key-route.test.cjs",
  "tests/management-key-route-wiring.test.cjs",
  "tests/mcp-usage-auth.test.cjs",
  "tests/mcp-usage-route.test.cjs",
  "tests/oauth-authorize-session-identity.test.cjs",
]);

export function isSerialTestFile(file) {
  return file.endsWith(".test.ts") || isolatedCjsTests.has(file);
}
