import { escapeHtml } from "@/utils/htmlEscape";
import { commentPreview } from "./commentPreview";
import { mentionQuoteHtml } from "./mentionText";

function computeInitials(name: string): string {
  const parts = String(name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const second =
    parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + second).toUpperCase() || "?";
}

export type TNotification =
  | "Comment"
  | "Mention"
  | "Assigned"
  | "Unassigned"
  | "Follower"
  | "Invite"
  | "TaskMove";

export interface INotificationBody {
  sender: string;
  title: string;
  link: string;
  recipient: any;
  recipientName?: string;
  commentText?: string;
  section?: string;
  /**
   * Recipient user id and task id. When both are set the email is bundled into
   * a digest instead of sent immediately; when either is missing (invites) it
   * goes out at once.
   */
  userId?: number;
  taskId?: number;
  /** Task used for Reply-To when this email must stay outside the digest. */
  replyTaskId?: number;
}

interface NotificationContent {
  heading: string;
  preview?: string;
  /** Pre-rendered, already-escaped quote content used instead of `preview`. */
  previewHtml?: string;
  /** Pre-rendered, already-escaped block used instead of `preview` by digests. */
  listHtml?: string;
  identity?: { name: string; initials: string; subline: string };
  badge?: string;
  eyebrow?: string;
  contextTitle?: string;
  ctaLabel: string;
  ctaColor?: string;
  quoteBorder?: string;
}

const settingsUrl = "https://app.hypertask.ai/settings";

function renderLayout(content: NotificationContent, link: string): string {
  const previewHtml =
    content.previewHtml ??
    (content.preview ? escapeHtml(content.preview) : "");
  const preview =
    content.listHtml ??
    (previewHtml
      ? `<blockquote class="preview" style="margin:0 0 24px;padding:16px 18px;background-color:#f9f9f9;border-left:3px solid ${content.quoteBorder ?? "#4455BB"};color:#262525;font-size:15px;line-height:1.6;">${previewHtml}</blockquote>`
      : "");
  const badge = content.badge
    ? `<td style="vertical-align:middle;white-space:nowrap;"><span class="badge" style="display:inline-block;background-color:#f9efcb;color:#262525;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap;">${content.badge}</span></td>`
    : "";
  const identity = content.identity
    ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin:0 0 20px;">
              <tr>
                <td style="width:40px;vertical-align:middle;"><div class="avatar" style="width:40px;height:40px;border-radius:20px;background-color:#262525;color:#ffffff;text-align:center;line-height:40px;font-size:14px;font-weight:700;">${content.identity.initials}</div></td>
                <td style="width:100%;padding-left:12px;vertical-align:middle;"><div class="identity-name" style="color:#262525;font-size:15px;font-weight:700;">${content.identity.name}</div><div class="identity-sub" style="color:#858585;font-size:13px;">${content.identity.subline}</div></td>
                ${badge}
              </tr>
            </table>
            `
    : "";
  const eyebrow = content.eyebrow
    ? `<p class="eyebrow" style="margin:0 0 6px;color:#858585;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${content.eyebrow}</p>
            `
    : "";
  const contextTitle = content.contextTitle
    ? `<div style="margin:0 0 18px;font-size:16px;font-weight:600;">${content.contextTitle}</div>
            `
    : "";
  const identityDarkModeStyles = content.identity
    ? `        .identity-name { color:#ffffff !important; }
        .avatar { background-color:#ffffff !important; color:#262525 !important; }
        .badge { background-color:#403a28 !important; color:#d29f02 !important; }
`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
      @media (prefers-color-scheme: dark) {
        .email-body { background-color: #0e0e0e !important; color: #ffffff !important; }
        .email-card { background-color: #27292D !important; border-color: rgb(35,37,42) !important; color: #ffffff !important; }
        .wordmark, .content-list { color: #ffffff !important; }
        .preview { background-color: #2F343C !important; color: #ffffff !important; border-left-color: #4455BB !important; }
        .mention-hl { background-color: #403a28 !important; color: #d29f02 !important; }
        .cta { background-color: #4455BB !important; color: #ffffff !important; }
        .footer { color: #858585 !important; }
        .footer-link { color: #4455BB !important; }
${identityDarkModeStyles}      }
      @media only screen and (max-width: 600px) {
        .email-shell { padding: 16px 12px !important; }
        .email-card { padding: 24px 20px !important; }
      }
    </style>
  </head>
  <body class="email-body" style="margin:0;padding:0;background-color:#f3f3f3;color:#262525;font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td class="email-shell" align="center" style="padding:32px 16px;">
          <div class="email-card" style="box-sizing:border-box;width:100%;max-width:560px;padding:32px;background-color:#ffffff;border:1px solid rgb(224,224,224);color:#262525;text-align:left;">
            <div class="wordmark" style="margin:0 0 28px;color:#262525;font-size:13px;font-weight:700;letter-spacing:0.04em;">Hypertask</div>
            <h1 style="margin:0 0 20px;font-size:20px;line-height:1.4;font-weight:600;">${content.heading}</h1>
            ${identity}${eyebrow}${contextTitle}${preview}
            <a class="cta" href="${escapeHtml(link)}" style="display:inline-block;padding:10px 16px;background-color:${content.ctaColor ?? "#4455BB"};color:#ffffff;border-radius:4px;font-size:15px;font-weight:600;text-decoration:none;">${content.ctaLabel}</a>
            <p class="footer" style="margin:32px 0 0;color:#858585;font-size:12px;line-height:1.5;">Hypertask · <a class="footer-link" href="${settingsUrl}" style="color:#4455BB;text-decoration:underline;">Notification settings</a></p>
          </div>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

export interface IDigestEvent {
  /** Already-phrased actor + action, e.g. "Alice commented". */
  line: string;
  /** Raw comment HTML, if this event carried one. */
  commentText?: string;
  isMention?: boolean;
  actor?: string;
}

/**
 * One email for everything that happened on a task while the recipient was
 * away. Reuses the single-notification layout so both stay in step.
 */
export function renderDigestEmail(
  taskTitle: string,
  link: string,
  events: IDigestEvent[],
  recipientName?: string
): { subject: string; html: string } {
  const title = escapeHtml(taskTitle);
  const count = events.length;
  const orderedEvents = [...events].sort(
    (a, b) => Number(Boolean(b.isMention)) - Number(Boolean(a.isMention))
  );
  const mentionEvent = orderedEvents.find((event) => event.isMention);
  const additionalUpdates = count - 1;
  const recip = recipientName?.trim();
  const mentionActor = mentionEvent?.actor ?? "Someone";
  const mentionSubject = mentionEvent
    ? additionalUpdates > 0
      ? `${mentionActor} mentioned you in "${taskTitle}" + ${additionalUpdates} more update${additionalUpdates === 1 ? "" : "s"}`
      : recip
        ? `${recip}, directly mentioned by ${mentionActor} in "${taskTitle}"`
        : `You were directly mentioned by ${mentionActor} in "${taskTitle}"`
    : undefined;

  const items = orderedEvents
    .map((event) => {
      const previewHtml = event.isMention
        ? mentionQuoteHtml(event.commentText ?? "")
        : escapeHtml(commentPreview(event.commentText ?? ""));
      const quote = previewHtml
        ? `<div class="preview" style="margin:6px 0 0;padding:10px 12px;background-color:#f9f9f9;border-left:3px solid #4455BB;color:#262525;font-size:14px;line-height:1.55;">${previewHtml}</div>`
        : "";
      return `<li style="margin:0 0 14px;">${escapeHtml(event.line)}${quote}</li>`;
    })
    .join("");

  return {
    subject:
      mentionSubject ??
      (count === 1
        ? `1 update on "${taskTitle}"`
        : `${count} updates on "${taskTitle}"`),
    html: renderLayout(
      {
        heading: mentionEvent
          ? `${escapeHtml(mentionEvent.actor ?? "Someone")} mentioned you in &ldquo;${title}&rdquo;${
              additionalUpdates > 0
                ? ` + ${additionalUpdates} more update${additionalUpdates === 1 ? "" : "s"}`
                : ""
            }`
          : count === 1
            ? `1 update on &ldquo;${title}&rdquo;`
            : `${count} updates on &ldquo;${title}&rdquo;`,
        listHtml: `<ul class="content-list" style="margin:0 0 24px;padding-left:20px;color:#262525;font-size:15px;line-height:1.6;">${items}</ul>`,
        ctaLabel: "View task",
      },
      link
    ),
  };
}

export function renderNotificationEmail(
  type: TNotification,
  body: INotificationBody
): { subject: string; html: string } {
  const sender = escapeHtml(body.sender);
  const title = escapeHtml(body.title);
  const section = escapeHtml(body.section);
  const preview = commentPreview(body.commentText ?? "");

  switch (type) {
    case "Comment":
      return {
        subject: `${body.sender} commented on "${body.title}"`,
        html: renderLayout(
          {
            heading: `New comment on &ldquo;${title}&rdquo;`,
            preview,
            ctaLabel: "Read full comment",
          },
          body.link
        ),
      };
    case "Mention": {
      const recip = body.recipientName?.trim();
      const recipEsc = recip ? escapeHtml(recip) : "";
      return {
        subject: recip
          ? `${recip}, directly mentioned by ${body.sender} in "${body.title}"`
          : `You were directly mentioned by ${body.sender} in "${body.title}"`,
        html: renderLayout(
          {
            heading: recipEsc
              ? `${recipEsc}, directly mentioned by ${sender}`
              : `You were directly mentioned by ${sender}`,
            identity: {
              name: sender,
              initials: escapeHtml(computeInitials(body.sender)),
              subline: "mentioned you here",
            },
            badge: "@ Direct mention",
            eyebrow: "In task",
            contextTitle: `&ldquo;${title}&rdquo;`,
            previewHtml: mentionQuoteHtml(body.commentText ?? ""),
            ctaLabel: `Reply to ${sender}`,
            ctaColor: "#262525",
            quoteBorder: "#858585",
          },
          body.link
        ),
      };
    }
    case "Assigned":
      return {
        subject: `You have been assigned to the task "${body.title}"`,
        html: renderLayout(
          {
            heading: `${sender} assigned &ldquo;${title}&rdquo; to you`,
            ctaLabel: "View task",
          },
          body.link
        ),
      };
    case "Unassigned":
      return {
        subject: `You have been unassigned from the task "${body.title}"`,
        html: renderLayout(
          {
            heading: `${sender} removed you from &ldquo;${title}&rdquo;`,
            ctaLabel: "View task",
          },
          body.link
        ),
      };
    case "Follower":
      return {
        subject: `${body.sender} added you to "${body.title}"`,
        html: renderLayout(
          {
            heading: `${sender} added you to &ldquo;${title}&rdquo;`,
            ctaLabel: "View task",
          },
          body.link
        ),
      };
    case "Invite":
      return {
        subject: `${body.sender} has invited you to the Kanban Board "${body.title}"`,
        html: renderLayout(
          {
            heading: `${sender} invited you to join &ldquo;${title}&rdquo;`,
            ctaLabel: "Accept invite",
          },
          body.link
        ),
      };
    case "TaskMove":
      return {
        subject: `Task: "${body.title}" has been moved to "${body.section}"`,
        html: renderLayout(
          {
            heading: `${sender} moved &ldquo;${title}&rdquo; to &ldquo;${section}&rdquo;`,
            ctaLabel: "View task",
          },
          body.link
        ),
      };
  }
}
