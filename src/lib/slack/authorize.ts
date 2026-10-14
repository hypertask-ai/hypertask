
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
