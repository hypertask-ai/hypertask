import { renderLayout } from "@/utils/controllers/notifications/emailTemplates";
import { escapeHtml } from "@/utils/htmlEscape";

export function renderOnboardingEmail({
  subject,
  heading,
  paragraphs,
  code,
  cta,
  unsubscribeUrl,
}: {
  subject: string;
  heading: string;
  paragraphs: string[];
  code?: string;
  cta: { label: string; url: string };
  unsubscribeUrl?: string;
}): { subject: string; html: string; text: string } {
  const blocks = paragraphs.map((paragraph) =>
    `<p style="margin:0 0 16px;">${escapeHtml(paragraph)}</p>`
  );
  if (code !== undefined) {
    // Porcelain: --bg-comment-description #f9f9fa; --color-white-black #18181b.
    blocks.splice(1, 0, `<pre class="onboarding-code" style="margin:0 0 16px;padding:12px;background-color:#f9f9fa;color:#18181b;white-space:pre-wrap;overflow-wrap:anywhere;font-family:monospace;"><code>${escapeHtml(code)}</code></pre>`);
  }
  const textBlocks = [...paragraphs];
  if (code !== undefined) textBlocks.splice(1, 0, code);

  return {
    subject,
    html: renderLayout({
      heading: escapeHtml(heading),
      listHtml: `<div class="content-list" style="margin:0 0 24px;font-size:14px;line-height:1.6;">${blocks.join("")}</div>`,
      ctaLabel: escapeHtml(cta.label),
    }, cta.url, unsubscribeUrl),
    text: [heading, ...textBlocks, `${cta.label}: ${cta.url}`, ...(unsubscribeUrl ? [`Unsubscribe: ${unsubscribeUrl}`] : [])].join("\n\n"),
  };
}
