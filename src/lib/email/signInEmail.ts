import { escapeHtml } from "@/utils/htmlEscape";
import { renderLayout } from "@/utils/controllers/notifications/emailTemplates";

export function renderSignInEmail({
  heading,
  introduction,
  link,
  code,
  linkMinutes,
  codeMinutes,
}: {
  heading: string;
  introduction: string;
  link: string;
  code: string;
  linkMinutes: number;
  codeMinutes: number;
}): { subject: string; html: string } {
  const codeBox = `<div class="onboarding-code" style="margin:0 0 16px;padding:16px;background-color:#EFEFF1;border:1px solid #E2E2E6;border-radius:4px;color:#18181B;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:20px;letter-spacing:0.2em;text-align:center;">${escapeHtml(code)}</div>`;
  const blocks = [
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(introduction)}</p>`,
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Or enter this code on the sign-in page.</p>`,
    codeBox,
    `<p style="margin:0;font-size:13px;line-height:1.5;color:#71717A;">This link expires in ${linkMinutes} minutes. This code expires in ${codeMinutes} minutes.</p>`,
  ];

  return {
    subject: heading,
    html: renderLayout(
      {
        heading: escapeHtml(heading),
        listHtml: `<div class="content-list" style="margin:0 0 24px;color:#18181B;font-size:15px;line-height:1.6;">${blocks.join("")}</div>`,
        ctaLabel: "Sign in",
        secondaryCta: { label: "Copy link", link },
        footerNote:
          "You got this email because someone asked to sign in with this address. If it was not you, ignore it.",
      },
      link,
    ),
  };
}
