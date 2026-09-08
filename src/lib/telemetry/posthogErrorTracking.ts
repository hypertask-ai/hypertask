import type { ErrorReport } from "@/lib/errors/reportError";

export async function capturePostHogException(report: ErrorReport) {
  if (typeof window !== "undefined") return false;
  try {
    const { capturePostHogExceptionOnServer } = await import(
      "./posthogErrorTracking.server"
    );
    return await capturePostHogExceptionOnServer(report);
  } catch (captureError) {
    console.error("[posthog-error-tracking] capture failed", captureError);
    return false;
  }
}
