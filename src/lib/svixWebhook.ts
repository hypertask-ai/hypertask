import { Webhook } from "svix";

export function verifySvixPayload(
  secret: string,
  rawBody: string,
  headers: Record<string, string>,
): unknown {
  new Webhook(secret).verify(rawBody, headers);
  return JSON.parse(rawBody);
}
