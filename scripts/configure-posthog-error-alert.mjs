const NAME = "Hypertask server exceptions to rollback relay";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function request(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`PostHog returned HTTP ${response.status}`);
  }
  return body;
}

export async function findDestination(endpoint, headers, requestImpl = request) {
  const endpointUrl = new URL(endpoint);
  let next = `${endpoint}?type=destination&limit=100`;
  const seen = new Set();
  while (next) {
    const pageUrl = new URL(next, endpointUrl);
    if (
      pageUrl.origin !== endpointUrl.origin ||
      pageUrl.pathname !== endpointUrl.pathname ||
      seen.has(pageUrl.href) ||
      seen.size >= 100
    ) {
      throw new Error("PostHog destination pagination is invalid");
    }
    seen.add(pageUrl.href);
    const page = await requestImpl(pageUrl.href, { headers });
    const match = (page.results || []).find((item) => item.name === NAME);
    if (match) return match;
    if (page.next !== null && page.next !== undefined && typeof page.next !== "string") {
      throw new Error("PostHog destination pagination is invalid");
    }
    next = page.next || "";
  }
  return undefined;
}

export async function configurePostHogErrorAlert() {
  const hostUrl = new URL(process.env.POSTHOG_UI_HOST || "https://us.posthog.com");
  if (
    hostUrl.protocol !== "https:" ||
    !["eu.posthog.com", "us.posthog.com"].includes(hostUrl.hostname) ||
    hostUrl.username ||
    hostUrl.password
  ) {
    throw new Error("POSTHOG_UI_HOST must be an approved PostHog HTTPS host");
  }
  const host = hostUrl.origin;
  const projectId = required("POSTHOG_SERVER_PROJECT_ID");
  const apiKey = required("POSTHOG_PERSONAL_API_KEY");
  const webhookUrlObject = new URL(required("POSTHOG_ERROR_WEBHOOK_URL"));
  if (
    webhookUrlObject.protocol !== "https:" ||
    webhookUrlObject.username ||
    webhookUrlObject.password
  ) {
    throw new Error("POSTHOG_ERROR_WEBHOOK_URL must be an HTTPS URL");
  }
  const endpoint = `${host}/api/projects/${encodeURIComponent(projectId)}/hog_functions`;
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const config = {
    name: NAME,
    description: "Relays trusted server exceptions for new-error alerts and a rolling five-minute rollback threshold.",
    type: "destination",
    template_id: "template-webhook",
    enabled: true,
    filters: {
      events: [{ id: "$exception", type: "events" }],
      properties: [
        { key: "ht_source", value: "server", operator: "exact", type: "event" },
      ],
    },
    inputs: {
      url: { value: webhookUrlObject.toString() },
      method: { value: "POST" },
      body: { value: { event: "{event}" }, templating: "hog" },
      headers: { value: { "Content-Type": "application/json" } },
      signing_secret: { value: required("POSTHOG_ERROR_WEBHOOK_SECRET") },
    },
  };

  const match = await findDestination(endpoint, headers);
  if (match) {
    await request(`${endpoint}/${match.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(config),
    });
    console.log(`Updated PostHog destination ${match.id}`);
  } else {
    const created = await request(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(config),
    });
    console.log(`Created PostHog destination ${created.id}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await configurePostHogErrorAlert();
}
