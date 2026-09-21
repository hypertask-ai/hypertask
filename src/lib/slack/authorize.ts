// Shared Slack OAuth authorize-URL builder. The Settings flow (/api/slack/install,
// signed state) and the public /add-to-slack page (Marketplace entry, no state)
// must agree on client id, scopes, and redirect URI so the Marketplace listing
// documents exactly what the app asks for (HTPR-4857).

// users:read is required by the cron worker's users.info calls.
export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "assistant:write",
  "channels:history",
  "commands",
  "groups:history",
  "im:history",
  "chat:write",
  "team:read",
  "users:read",
  "users:read.email",
];

export const SLACK_REDIRECT_PATH = "/api/slack/oauth_redirect";

// Returns null when SLACK_CLIENT_ID is not configured; callers decide how to degrade.
export function buildSlackAuthorizeUrl(origin: string): URL | null {
  const clientId = process.env.SLACK_CLIENT_ID?.trim();
  if (!clientId) return null;
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", SLACK_BOT_SCOPES.join(","));
  url.searchParams.set(
    "redirect_uri",
    new URL(SLACK_REDIRECT_PATH, origin).toString(),
  );
  return url;
}
