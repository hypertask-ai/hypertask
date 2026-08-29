import { reportClientError } from "@/lib/telemetry/reportClientError";
import {
  isShareHydrationError,
  summarizeHydrationMutation,
} from "@/lib/telemetry/hydrationDiagnosticsCore";

const MAX_MUTATIONS = 20;
const OBSERVER_LIFETIME_MS = 10_000;
const reportedErrors = new WeakSet<object>();

function errorCause(error: unknown) {
  if (!(error instanceof Error) || !("cause" in error) || !error.cause) {
    return undefined;
  }
  const cause = error.cause;
  return cause instanceof Error
    ? `${cause.message}\n${cause.stack || ""}`.slice(0, 2000)
    : String(cause).slice(0, 2000);
}

function domFingerprint() {
  return JSON.stringify({
    readyState: document.readyState,
    fontTags: document.querySelectorAll("font").length,
    translateNoRoots: document.querySelectorAll('[translate="no"]').length,
    googleNotranslate: Boolean(
      document.querySelector('meta[name="google"][content="notranslate"]'),
    ),
    extensionMarkers: document.querySelectorAll(
      "grammarly-extension,[data-gramm],[data-new-gr-c-s-check-loaded],[data-lt-installed]",
    ).length,
    htmlChildren: Array.from(document.documentElement.childNodes)
      .map((node) => node.nodeName.toLowerCase())
      .join(",")
      .slice(0, 300),
  });
}

export function wasShareHydrationErrorReported(error: unknown) {
  return typeof error === "object" && error !== null && reportedErrors.has(error);
}

export function installShareHydrationDiagnostics() {
  if (!/^\/share(?:\/|$)/.test(window.location.pathname)) return;

  const mutations: string[] = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (mutations.length >= MAX_MUTATIONS) break;
      mutations.push(summarizeHydrationMutation(record));
    }
  });

  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "lang", "translate"],
    childList: true,
    subtree: true,
  });

  window.addEventListener(
    "error",
    (event) => {
      if (!isShareHydrationError(event.message, window.location.pathname)) return;

      for (const record of observer.takeRecords()) {
        if (mutations.length >= MAX_MUTATIONS) break;
        mutations.push(summarizeHydrationMutation(record));
      }

      if (typeof event.error === "object" && event.error !== null) {
        reportedErrors.add(event.error);
      }

      const error = event.error as
        | (Error & { componentStack?: string; digest?: string })
        | undefined;
      const cause = errorCause(error);
      reportClientError({
        source: "hydration-recoverable",
        message: event.message,
        stack:
          error?.stack ||
          (event.filename
            ? `${event.filename}:${event.lineno}:${event.colno}`
            : undefined),
        componentStack: error?.componentStack,
        digest: error?.digest,
        extra: {
          hydrationDom: domFingerprint(),
          hydrationMutations: JSON.stringify(mutations),
          ...(cause ? { hydrationCause: cause } : {}),
        },
      });
    },
    true,
  );

  window.setTimeout(() => observer.disconnect(), OBSERVER_LIFETIME_MS);
}
