export type GithubAppConfig = {
  appId: string;
  clientId: string;
  clientSecret: string;
  slug: string;
  stateSecret: string;
};

const REQUIRED_ENV = {
  appId: "GITHUB_APP_ID",
  clientId: "GITHUB_APP_CLIENT_ID",
  clientSecret: "GITHUB_APP_CLIENT_SECRET",
  slug: "GITHUB_APP_SLUG",
  stateSecret: "GITHUB_APP_STATE_SECRET",
} as const satisfies Record<keyof GithubAppConfig, string>;

const MIN_STATE_SECRET_LENGTH = 32;

export function getGithubAppConfig(): GithubAppConfig | null {
  const entries = Object.entries(REQUIRED_ENV).map(
    ([field, name]) => [field, name, process.env[name]?.trim() ?? ""] as const,
  );
  const missing = entries.filter(([, , value]) => !value).map(([, name]) => name);
  if (missing.length > 0) {
    console.error("GitHub App is not configured", `missing ${missing.join(", ")}`);
    return null;
  }
  const config = Object.fromEntries(
    entries.map(([field, , value]) => [field, value]),
  ) as GithubAppConfig;
  if (
    !/^[1-9][0-9]*$/.test(config.appId) ||
    !/^[a-z0-9][a-z0-9-]*$/.test(config.slug) ||
    config.stateSecret.length < MIN_STATE_SECRET_LENGTH
  ) {
    console.error(
      "GitHub App is misconfigured",
      "GITHUB_APP_ID, GITHUB_APP_SLUG or GITHUB_APP_STATE_SECRET has an invalid shape",
    );
    return null;
  }
  return config;
}
