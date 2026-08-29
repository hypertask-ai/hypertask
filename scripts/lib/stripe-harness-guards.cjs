const TEST_CONFIRMATION = "I_UNDERSTAND_TEST_ONLY";

function assertSafeHarnessConfig({ stripeSecretKey, confirmation }) {
  if (!stripeSecretKey?.startsWith("sk_test_")) {
    throw new Error(
      "Refusing to run: STRIPE_SECRET_KEY must be a test-mode key.",
    );
  }
  if (confirmation !== TEST_CONFIRMATION) {
    throw new Error(
      `Refusing to run: set STRIPE_HARNESS_CONFIRM=${TEST_CONFIRMATION}.`,
    );
  }
}

module.exports = { assertSafeHarnessConfig, TEST_CONFIRMATION };
