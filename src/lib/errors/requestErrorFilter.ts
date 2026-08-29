import type { Instrumentation } from "next";

type RequestErrorContext = Parameters<Instrumentation.onRequestError>[2];

const CLIENT_ABORTED_RSC_MESSAGE = "The destination stream closed early.";

export function isExpectedClientAbortedRscPayload(
  error: unknown,
  context: RequestErrorContext | null | undefined,
) {
  // These are the exact fields emitted by the reproducible Next 16.3 bug.
  // Broader matching could hide an application error with the same message.
  if (!context) return false;

  return (
    error instanceof Error &&
    error.message === CLIENT_ABORTED_RSC_MESSAGE &&
    context.routerKind === "App Router" &&
    context.routeType === "render" &&
    context.renderSource === "react-server-components-payload"
  );
}
