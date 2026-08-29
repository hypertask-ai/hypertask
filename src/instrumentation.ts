import type { Instrumentation } from "next";
import { isExpectedClientAbortedRscPayload } from "./lib/errors/requestErrorFilter";

export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  if (!shouldAutoEnsureSweepSchedule()) return;

  const { ensureSweepSchedule } = await import("./lib/qstashSweepSchedule");
  await ensureSweepSchedule();
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  if (
    process.env.NEXT_RUNTIME === "edge" ||
    request.path.startsWith("/api/errors") ||
    request.path.startsWith("/api/tasks/createGlobally")
  ) {
    return;
  }

  // Next 16.3 reports an RSC response cancelled by navigation as a render
  // failure. The exact context keeps real stream and route errors visible.
  if (isExpectedClientAbortedRscPayload(error, context)) return;

  try {
    const { reportError } = await import("./lib/errors/reportError");
    const { prismaErrorDiagnostics } =
      await import("./lib/errors/prismaErrorDiagnostics");
    const normalized =
      error instanceof Error
        ? error
        : new Error(String(error ?? "Unknown error"));
    await reportError({
      message: normalized.message,
      stack: normalized.stack,
      url: request.path || context.routePath,
      source: "server",
      extra: {
        route: context.routePath,
        method: request.method,
        router: context.routerKind,
        ...prismaErrorDiagnostics(error),
      },
    });
  } catch (reportingError) {
    console.error("[instrumentation] error reporting failed", reportingError);
  }
};

function shouldAutoEnsureSweepSchedule() {
  if (process.env.QSTASH_AUTO_REGISTER_SWEEP === "false") return false;
  if (process.env.QSTASH_AUTO_REGISTER_SWEEP === "true") return true;
  if (process.env.VERCEL_ENV === "preview") return false;
  return process.env.NODE_ENV === "production";
}
