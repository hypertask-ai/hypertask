const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/request-error-filter.test.cjs"),
  {
    interopDefault: true,
    alias: { "@": path.join(root, "src") },
  },
);
const { isExpectedClientAbortedRscPayload } = jiti(
  path.join(root, "src/lib/errors/requestErrorFilter.ts"),
);

const rscPayloadContext = {
  routerKind: "App Router",
  routeType: "render",
  renderSource: "react-server-components-payload",
};

test("ignores the Next.js client-aborted RSC payload error", () => {
  assert.equal(
    isExpectedClientAbortedRscPayload(
      new Error("The destination stream closed early."),
      rscPayloadContext,
    ),
    true,
  );
});

test("keeps reporting real errors with similar messages or contexts", () => {
  assert.equal(
    isExpectedClientAbortedRscPayload(
      new Error("The destination stream closed early while saving."),
      rscPayloadContext,
    ),
    false,
  );
  assert.equal(
    isExpectedClientAbortedRscPayload(
      new Error("The destination stream closed early."),
      {
        ...rscPayloadContext,
        routeType: "action",
      },
    ),
    false,
  );
  assert.equal(
    isExpectedClientAbortedRscPayload(
      new Error("The destination stream closed early."),
      {
        ...rscPayloadContext,
        renderSource: "server-rendering",
      },
    ),
    false,
  );
  assert.equal(
    isExpectedClientAbortedRscPayload(
      "The destination stream closed early.",
      rscPayloadContext,
    ),
    false,
  );
  assert.equal(
    isExpectedClientAbortedRscPayload(
      new Error("The destination stream closed early."),
      {
        ...rscPayloadContext,
        routerKind: "Pages Router",
      },
    ),
    false,
  );
  assert.equal(
    isExpectedClientAbortedRscPayload(
      new Error("The destination stream closed early."),
      undefined,
    ),
    false,
  );
});
