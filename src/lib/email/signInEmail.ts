import { escapeHtml } from "@/utils/htmlEscape";

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
  const safeHeading = escapeHtml(heading);
  const safeLink = escapeHtml(link);
  const codeBox = `<div class="onboarding-code" style="margin:0 0 16px;padding:16px;background-color:#EFEFF1;border:1px solid #E2E2E6;border-radius:4px;color:#18181B;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:20px;letter-spacing:0.2em;text-align:center;">${escapeHtml(code)}</div>`;
  const listHtml = `<div class="content-list" style="margin:0 0 24px;color:#18181B;font-size:15px;line-height:1.6;">${[
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${escapeHtml(introduction)}</p>`,
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">Or enter this code on the sign-in page.</p>`,
    codeBox,
    `<p style="margin:0;font-size:13px;line-height:1.5;color:#71717A;">This link expires in ${linkMinutes} minutes. This code expires in ${codeMinutes} minutes.</p>`,
  ].join("")}</div>`;
  const footerNote = "You got this email because someone asked to sign in with this address. If it was not you, ignore it.";

  return {
    subject: heading,
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      @media (prefers-color-scheme: dark) {
        .email-body { background-color: #17181B !important; color: #FAFAFA !important; }
        .email-card { background-color: #1F2125 !important; border-color: #2A2C31 !important; color: #FAFAFA !important; }
        .wordmark, .content-list, h1 { color: #FAFAFA !important; }
        .onboarding-code { background-color: #262a30 !important; color: #ffffff !important; }
        .cta { background-color: #5D6577 !important; color: #000000 !important; }
        .secondary-cta { color: #9A9CA1 !important; }
        .footer { color: #9A9CA1 !important; }
      }
      @media only screen and (max-width: 600px) {
        .email-shell { padding: 16px 12px !important; }
        .email-card { padding: 24px 20px !important; }
      }
    </style>
  </head>
  <body class="email-body" style="margin:0;padding:0;background-color:#EFEFF1;color:#18181B;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td class="email-shell" align="center" style="padding:32px 16px;">
          <div class="email-card" style="box-sizing:border-box;width:100%;max-width:560px;padding:32px;background-color:#FFFFFF;border:1px solid #E2E2E6;color:#18181B;text-align:left;">
            <div class="wordmark" style="margin:0 0 28px;color:#18181B;font-size:13px;font-weight:700;letter-spacing:0.04em;">Hypertask</div>
            <h1 style="margin:0 0 20px;color:#18181B;font-size:20px;line-height:1.4;font-weight:600;">${safeHeading}</h1>
            ${listHtml}
            <a class="secondary-cta" href="${safeLink}" style="display:inline-block;margin:0 16px 12px 0;color:#71717A;font-size:14px;text-decoration:underline;">Copy link</a>
            <a class="cta" href="${safeLink}" style="display:inline-block;padding:10px 16px;background-color:#5C6070;color:#FAFAFA;border-radius:4px;font-size:15px;font-weight:600;text-decoration:none;">Sign in</a>
            <p class="footer" style="margin:32px 0 0;color:#71717A;font-size:12px;line-height:1.5;">${escapeHtml(footerNote)}</p>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`,
  };
}
