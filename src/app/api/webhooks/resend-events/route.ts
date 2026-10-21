import { verifySvixPayload } from "@/lib/svixWebhook";
import { createResendEventsHandler } from "@/lib/email/resendEventsWebhook";

export const POST = createResendEventsHandler({
  verify: (secret, rawBody, headers) =>
    verifySvixPayload(secret, rawBody, {
      "svix-id": headers.get("svix-id") ?? "",
      "svix-timestamp": headers.get("svix-timestamp") ?? "",
      "svix-signature": headers.get("svix-signature") ?? "",
    }),
  log: (message) => console.error(message),
});
