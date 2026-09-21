const publicApiPrefixes = [
  "/api/auth/",
  "/api/cron/",
  "/api/demo/",
  "/api/mcp/",
  "/api/queues/",
  "/api/slack/",
  "/api/v1/",
  "/api/webhooks/",
] as const;

const publicApiPaths = new Set([
  "/api/auth",
  "/api/calendar/feed",
  "/api/client-error",
  "/api/errors",
  "/api/figma/oauth/callback",
  "/api/google-calendar/oauth/callback",
  "/api/integrations/posthog/error-alert",
  "/api/integrations/posthog/error-test",
  "/api/mcp",
  "/api/notifications/unsubscribe",
  "/api/oauth/authorization-code/agent",
  "/api/share/getSharedTask",
  "/api/stripe/event",
  "/api/stripe/webhook",
  "/api/users/onboarded-webhook",
  "/api/v1",
  "/api/version",
]);

export function isPublicApiPath(pathname: string): boolean {
  return (
    publicApiPaths.has(pathname) ||
    publicApiPrefixes.some((prefix) => pathname.startsWith(prefix))
  );
}
