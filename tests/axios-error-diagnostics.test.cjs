const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const jiti = require("jiti")(
  path.join(root, "tests/axios-error-diagnostics.test.cjs"),
  { interopDefault: true, alias: { "@": path.join(root, "src") } },
);
const { axiosErrorDiagnostics } = jiti(
  path.join(root, "src/lib/telemetry/axiosErrorDiagnostics.ts"),
);

test("Axios diagnostics preserve the endpoint without query values or request data", () => {
  const diagnostics = axiosErrorDiagnostics({
    name: "AxiosError",
    isAxiosError: true,
    code: "ERR_BAD_REQUEST",
    config: {
      method: "post",
      url: "/api/tasks/update?id=5019&token=secret",
      headers: { Authorization: "Bearer secret" },
      data: { private: "content" },
    },
    response: {
      status: 400,
      statusText: "Bad Request",
      data: { message: "Task id is required", private: "content" },
    },
  });

  assert.deepEqual(diagnostics, {
    axiosCode: "ERR_BAD_REQUEST",
    requestMethod: "POST",
    requestPath: "/api/tasks/update",
    responseStatus: 400,
    responseStatusText: "Bad Request",
    responseMessage: "Task id is required",
  });
  assert.doesNotMatch(JSON.stringify(diagnostics), /secret|private|5019/);
});

test("Axios diagnostics normalize absolute URLs to their path", () => {
  assert.deepEqual(
    axiosErrorDiagnostics({
      isAxiosError: true,
      config: { method: "get", url: "https://api.example.com/v1/tasks?key=x" },
      response: { status: 500 },
    }),
    {
      requestMethod: "GET",
      requestPath: "/v1/tasks",
      responseStatus: 500,
    },
  );
});

test("non-Axios rejections add no diagnostics", () => {
  assert.deepEqual(axiosErrorDiagnostics(new Error("boom")), {});
  assert.deepEqual(axiosErrorDiagnostics({ code: "ERR_BAD_REQUEST" }), {});
});
