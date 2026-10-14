import type { Instrumentation } from "next";

type RequestErrorContext = Parameters<Instrumentation.onRequestError>[2];

const CLIENT_ABORTED_RSC_MESSAGE = "The destination stream closed early.";

export function isExpectedClientAbortedRscPayload(
  error: unknown,
  context: RequestErrorContext | null | undefined,
) {
  if (!context) return false;

  return (
    error instanceof Error &&
    error.message === CLIENT_ABORTED_RSC_MESSAGE &&
    context.routerKind === "App Router" &&
    context.routeType === "render" &&
    context.renderSource === "react-server-components-payload"
  );
}
