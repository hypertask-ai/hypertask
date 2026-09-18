export const GOOGLE_CALENDAR_API_BASE =
  "https://www.googleapis.com/calendar/v3";
export const GOOGLE_CALENDAR_AUTHORIZE_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_CALENDAR_CONNECTION_PATH =
  "/api/google-calendar/connection";
export const GOOGLE_CALENDAR_OAUTH_CALLBACK_PATH =
  "/api/google-calendar/oauth/callback";
export const GOOGLE_CALENDAR_OAUTH_START_PATH =
  "/api/google-calendar/oauth/start";
export const GOOGLE_CALENDAR_SETTINGS_PATH = "/settings/calendar";
export const GOOGLE_CALENDAR_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_CALENDAR_REVOKE_URL =
  "https://oauth2.googleapis.com/revoke";
export const GOOGLE_CALENDAR_JWKS_URL =
  "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_CALENDAR_SCOPE =
  "openid email https://www.googleapis.com/auth/calendar.app.created";

const GENERIC_ERROR = "Google Calendar could not be connected. Try again.";

const ERROR_MESSAGES = new Map<string, string>([
  [
    "not_configured",
    "Google Calendar is not set up on this server yet. Trying again will not help.",
  ],
  ["access_denied", "You cancelled Google approval, so nothing was connected."],
  [
    "invalid_state",
    "That Google sign-in attempt expired. Start again from Connect.",
  ],
  [
    "missing_code",
    "Google did not return a sign-in code. Start again from Connect.",
  ],
  [
    "user_mismatch",
    "You changed Hypertask accounts during sign-in. Start again from Connect.",
  ],
  [
    "google_account_mismatch",
    "Disconnect the current Google account before connecting a different one.",
  ],
  ["connection_failed", GENERIC_ERROR],
]);

export const googleCalendarErrorMessage = (code: string | null | undefined) =>
  (code ? ERROR_MESSAGES.get(code) : undefined) ?? GENERIC_ERROR;
