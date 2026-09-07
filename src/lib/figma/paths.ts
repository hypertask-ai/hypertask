export const FIGMA_API_BASE_URL = "https://api.figma.com/v1";
export const FIGMA_AUTHORIZE_URL = "https://www.figma.com/oauth";
export const FIGMA_CONNECTION_PATH = "/api/figma/connection";
export const FIGMA_CONNECTION_VERSION_COOKIE = "ht_figma_connection";
export const FIGMA_DISCONNECT_PATH = "/api/figma/disconnect";
export const FIGMA_OAUTH_CALLBACK_PATH = "/api/figma/oauth/callback";
export const FIGMA_OAUTH_SCOPE = "file_content:read current_user:read";
export const FIGMA_OAUTH_START_PATH = "/api/figma/oauth/start";
export const FIGMA_OEMBED_PATH = "/api/figma/oembed";
export const FIGMA_SETTINGS_PATH = "/settings/accounts";

// The OAuth routes can only hand the browser a short code on the redirect back
// to settings. Each code gets its own sentence because "try again" is wrong
// advice for half of them: a server with no Figma keys will never succeed.
const FIGMA_CONNECT_ERROR_MESSAGES: Record<string, string> = {
  not_configured:
    "Figma is not set up on this server yet, so there is nothing to connect to. Trying again will not help.",
  access_denied: "You cancelled the Figma approval, so nothing was connected.",
  invalid_state:
    "That Figma sign-in attempt expired. Start again from Connect Figma.",
  missing_code:
    "Figma did not send back a sign-in code. Start again from Connect Figma.",
  user_mismatch:
    "You signed in as a different Hypertask user part way through. Start again from Connect Figma.",
  connection_failed: "Figma could not be connected. Try again.",
};

export const FIGMA_CONNECT_GENERIC_ERROR =
  "Figma could not be connected. Try again.";

export const figmaConnectErrorMessage = (code: string | null | undefined) =>
  (code ? FIGMA_CONNECT_ERROR_MESSAGES[code] : undefined) ??
  FIGMA_CONNECT_GENERIC_ERROR;
