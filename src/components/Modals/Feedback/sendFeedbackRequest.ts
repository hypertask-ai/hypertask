export type FeedbackKind = "Bug" | "Idea" | "Question" | "Praise";

type FeedbackOptions = {
  kind?: FeedbackKind;
  notify?: boolean;
  pathname?: string;
  pageTitle?: string;
  userAgent?: string;
  appVersion?: string;
  screenshotUrl?: string;
};

export async function sendFeedbackRequest(
  text: string,
  options: FeedbackOptions = {}
): Promise<void> {
  const response = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, ...options }),
  });

  if (!response.ok) throw new Error("Feedback request failed");
}
