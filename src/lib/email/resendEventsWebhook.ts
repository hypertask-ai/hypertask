export interface ResendEventsDependencies {
  verify(secret: string, rawBody: string, headers: Headers): unknown;
  log(message: string): void;
}

interface ResendEvent {
  type?: string;
  data?: {
    bounce?: { type?: unknown; subType?: unknown };
    failed?: { reason?: unknown };
  };
}

function safeEventText(value: unknown): string {
  if (typeof value !== "string") return "unknown";
  return (
    value
      .replace(/(?:"[^"\r\n]+"|[^\s<>(),;:"@]+)@[^\s<>(),;:"@]+/g, "<email>")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "unknown"
  );
}

export function createResendEventsHandler(dependencies: ResendEventsDependencies) {
  return async function POST(request: Request): Promise<Response> {
    const secret = process.env.RESEND_EVENTS_WEBHOOK_SECRET;
    if (!secret) {
      dependencies.log("[email-event] webhook signing key is not configured");
      return Response.json({ received: false }, { status: 503 });
    }

    const rawBody = await request.text();
    let verified: unknown;
    try {
      verified = dependencies.verify(secret, rawBody, request.headers);
    } catch {
      return Response.json({ received: false }, { status: 400 });
    }

    if (verified && typeof verified === "object") {
      const event = verified as ResendEvent;
      if (event.type === "email.bounced") {
        dependencies.log(
          `[email-event] email.bounced (${safeEventText(event.data?.bounce?.type)}, ${safeEventText(event.data?.bounce?.subType)})`,
        );
      } else if (event.type === "email.failed") {
        dependencies.log(
          `[email-event] email.failed: ${safeEventText(event.data?.failed?.reason)}`,
        );
      }
    }

    return Response.json({ received: true });
  };
}
