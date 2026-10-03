import { waitUntil } from "@vercel/functions";
import { PostHog } from "posthog-node";

export type SignupMethod = "email" | "google" | "invite";

export type SignupAttribution = {
  signupMethod: SignupMethod;
  utmSource?: string;
};

type SignupRecord = SignupAttribution & {
  isNewUser: boolean;
  userId: number;
};

type PostHogCapture = {
  captureImmediate: (capture: {
    distinctId: string;
    event: string;
    properties: Record<string, string>;
  }) => Promise<unknown>;
};

type SignupAnalyticsDependencies = {
  client?: PostHogCapture;
  onError?: (error: unknown) => void;
  schedule?: (promise: Promise<unknown>) => void;
};

const CAPTURE_TIMEOUT_MS = 1500;
const MAX_UTM_SOURCE_LENGTH = 200;

let client: PostHog | undefined;

export function postHogClient(): PostHog | undefined {
  const token = process.env.POSTHOG_SERVER_PROJECT_TOKEN?.trim();
  if (!token) return undefined;

  if (!client) {
    client = new PostHog(token, {
      host: process.env.POSTHOG_SERVER_HOST || "https://eu.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
      requestTimeout: CAPTURE_TIMEOUT_MS,
      disableGeoip: true,
    });
  }

  return client;
}

function cleanUtmSource(value: string | undefined): string | undefined {
  const source = value?.trim();
  return source ? source.slice(0, MAX_UTM_SOURCE_LENGTH) : undefined;
}

export function buildUserSignedUpCapture(
  signup: Omit<SignupRecord, "isNewUser">,
) {
  const properties: Record<string, string> = {
    signup_method: signup.signupMethod,
  };
  const utmSource = cleanUtmSource(signup.utmSource);
  if (utmSource) properties.utm_source = utmSource;

  return {
    distinctId: String(signup.userId),
    event: "user_signed_up",
    properties,
  };
}

function cookieValue(cookieHeader: string | null, name: string) {
  const encodedValue = cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);

  if (!encodedValue) return undefined;
  try {
    return decodeURIComponent(encodedValue);
  } catch {
    return encodedValue;
  }
}

export function signupAttributionFromHeaders(
  headers: Headers | undefined,
  defaultMethod: Exclude<SignupMethod, "invite">,
  explicitUtmSource?: string,
): SignupAttribution {
  const referrer = headers?.get("referer");
  let referrerParams: URLSearchParams | undefined;
  try {
    referrerParams = referrer ? new URL(referrer).searchParams : undefined;
  } catch {
    referrerParams = undefined;
  }

  const cookieHeader = headers?.get("cookie") ?? null;
  const isInviteSignup =
    Boolean(referrerParams?.get("key") && referrerParams.get("projectId")) ||
    Boolean(
      cookieValue(cookieHeader, "inviteKey") &&
        cookieValue(cookieHeader, "projectInvite"),
    );

  return {
    signupMethod: isInviteSignup ? "invite" : defaultMethod,
    utmSource:
      cleanUtmSource(explicitUtmSource) ??
      cleanUtmSource(referrerParams?.get("utm_source") ?? undefined) ??
      cleanUtmSource(cookieValue(cookieHeader, "utm_source")),
  };
}

export function recordUserSignedUp(
  signup: SignupRecord,
  dependencies: SignupAnalyticsDependencies = {},
): void {
  if (!signup.isNewUser) return;

  const reportError =
    dependencies.onError ??
    ((error: unknown) => {
      console.warn("[signup-analytics] PostHog capture failed", error);
    });

  let captureClient: PostHogCapture | undefined;
  try {
    captureClient = dependencies.client ?? postHogClient();
  } catch (error) {
    reportError(error);
    return;
  }
  if (!captureClient) return;

  const capturePromise = (async () => {
    await captureClient.captureImmediate(buildUserSignedUpCapture(signup));
  })().catch(reportError);

  try {
    (dependencies.schedule ?? waitUntil)(capturePromise);
  } catch (error) {
    reportError(error);
    void capturePromise;
  }
}
