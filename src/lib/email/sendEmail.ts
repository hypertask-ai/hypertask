const RESEND_REQUEST_TIMEOUT_MS = 5000;

interface SendEmailOptions {
  to: string | string[];
  from: string;
  replyTo?: string | string[];
  subject: string;
  html?: string;
  text?: string;
  /** Extra RFC headers, e.g. List-Unsubscribe (HTPR-4164). Resend passes these through. */
  headers?: Record<string, string>;
}

export async function sendEmail({
  to,
  from,
  replyTo,
  subject,
  html,
  text,
  headers,
}: SendEmailOptions) {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to,
        from,
        ...(replyTo !== undefined ? { reply_to: replyTo } : {}),
        subject,
        ...(html !== undefined ? { html } : {}),
        ...(text !== undefined ? { text } : {}),
        ...(headers !== undefined ? { headers } : {}),
      }),
      signal: AbortSignal.timeout(RESEND_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let message = errorText;

      try {
        message = JSON.parse(errorText).message || errorText;
      } catch {}

      throw new Error(`Resend API error: ${response.status} - ${message}`);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(
        `Resend API request timed out after ${RESEND_REQUEST_TIMEOUT_MS}ms`,
      );
    }
    throw error;
  }
}
