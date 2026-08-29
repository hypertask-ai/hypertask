type SlackApiResponse = {
  error?: string;
  ok: boolean;
};

export async function callSlackApi<T extends SlackApiResponse>(
  method: string,
  botToken: string,
  params: Record<string, string>,
): Promise<T> {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${botToken}` },
  });
  if (!response.ok) {
    throw new Error(`Slack ${method} request failed (${response.status})`);
  }

  const payload = (await response.json()) as T;
  if (!payload.ok) {
    throw new Error(`Slack ${method} failed: ${payload.error ?? "unknown_error"}`);
  }
  return payload;
}

export async function postSlackThreadReply(
  botToken: string,
  channelId: string,
  threadTs: string,
  text: string,
): Promise<void> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      channel: channelId,
      thread_ts: threadTs,
      text,
      unfurl_links: "false",
      unfurl_media: "false",
    }),
  });
  if (!response.ok) {
    throw new Error(`Slack chat.postMessage request failed (${response.status})`);
  }
  const payload = (await response.json()) as SlackApiResponse;
  if (!payload.ok) {
    throw new Error(
      `Slack chat.postMessage failed: ${payload.error ?? "unknown_error"}`,
    );
  }
}

export async function postSlackMessage(
  botToken: string,
  channelId: string,
  blocks: Record<string, unknown>[],
  threadTs?: string,
): Promise<void> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: channelId,
      blocks,
      text: "Hypertask response",
      unfurl_links: false,
      unfurl_media: false,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`Slack chat.postMessage request failed (${response.status})`);
  }
  const payload = (await response.json()) as SlackApiResponse;
  if (!payload.ok) {
    throw new Error(
      `Slack chat.postMessage failed: ${payload.error ?? "unknown_error"}`,
    );
  }
}

export async function postSlackEphemeralMessage(
  botToken: string,
  channelId: string,
  slackUserId: string,
  blocks: Record<string, unknown>[],
  threadTs?: string,
): Promise<void> {
  const response = await fetch("https://slack.com/api/chat.postEphemeral", {
    method: "POST",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: channelId,
      user: slackUserId,
      blocks,
      text: "Hypertask response",
      ...(threadTs ? { thread_ts: threadTs } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Slack chat.postEphemeral request failed (${response.status})`,
    );
  }
  const payload = (await response.json()) as SlackApiResponse;
  if (!payload.ok) {
    throw new Error(
      `Slack chat.postEphemeral failed: ${payload.error ?? "unknown_error"}`,
    );
  }
}

export async function postSlackResponseUrl(
  responseUrl: string,
  blocks: Record<string, unknown>[],
  ephemeral = false,
): Promise<void> {
  const url = new URL(responseUrl);
  if (url.protocol !== "https:" || url.hostname !== "hooks.slack.com") {
    throw new Error("Invalid Slack response URL");
  }
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      response_type: ephemeral ? "ephemeral" : "in_channel",
      blocks,
      text: "Hypertask response",
    }),
  });
  if (!response.ok) {
    throw new Error(`Slack response_url request failed (${response.status})`);
  }
}
