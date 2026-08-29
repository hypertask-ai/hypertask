import crypto from "node:crypto";
import { parse, type Node } from "node-html-parser";
import { escapeHtml } from "@/utils/helperFunctions/escapeHtml";
import { sanitizeRichHtml } from "@/utils/helperFunctions/sanitizeRichHtml";

const TOKEN_VERSION = "v1";
const SIGNATURE_BYTES = 16;
const MAX_REPLY_CHARACTERS = 10_000;
const MAX_SOURCE_CHARACTERS = 100_000;
const DEFAULT_INBOUND_DOMAIN = "reply.hypertask.ai";
const DAY_MS = 86_400_000;
// The signed address is a bearer credential: anyone holding it can comment as
// the notified user. Stamping the issue day and refusing an old stamp turns a
// leaked or forwarded notification into a bounded window instead of permanent
// impersonation. Long enough that a genuine late reply still lands.
const MAX_REPLY_ADDRESS_AGE_DAYS = 60;

const HTML_BLOCK_TAGS = new Set([
  "address",
  "article",
  "blockquote",
  "div",
  "footer",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "li",
  "p",
  "pre",
  "section",
  "table",
  "tr",
  "ul",
  "ol",
]);

function signingSecret(): string {
  const value = process.env.SESSION_SECRET || process.env.JWT_SECRET;
  if (!value) {
    throw new Error(
      "SESSION_SECRET or JWT_SECRET is required to sign inbound reply addresses",
    );
  }
  return value;
}

function inboundDomain(): string {
  const value =
    process.env.RESEND_INBOUND_DOMAIN?.trim().toLowerCase() ||
    DEFAULT_INBOUND_DOMAIN;
  if (
    value.length > 253 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      value,
    )
  ) {
    throw new Error("RESEND_INBOUND_DOMAIN must be a valid DNS name");
  }
  return value;
}

function signingPayload(
  taskId: number,
  userId: number,
  issuedDay: number,
): string {
  return `${TOKEN_VERSION}:${taskId.toString(36)}:${userId.toString(36)}:${issuedDay.toString(36)}`;
}

function signatureFor(
  taskId: number,
  userId: number,
  issuedDay: number,
): string {
  return crypto
    .createHmac("sha256", signingSecret())
    .update(signingPayload(taskId, userId, issuedDay))
    .digest()
    .subarray(0, SIGNATURE_BYTES)
    .toString("base64url");
}

function currentDay(): number {
  return Math.floor(Date.now() / DAY_MS);
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function createInboundReplyAddress(
  taskId: number,
  userId: number,
): string {
  if (!isPositiveSafeInteger(taskId) || !isPositiveSafeInteger(userId)) {
    throw new Error("A positive task id and user id are required");
  }

  const issuedDay = currentDay();
  const localPart = `reply+${taskId.toString(36)}.${userId.toString(36)}.${issuedDay.toString(36)}.${signatureFor(taskId, userId, issuedDay)}`;
  if (Buffer.byteLength(localPart, "utf8") > 64) {
    throw new Error("Inbound reply address exceeds the email local-part limit");
  }
  return `${localPart}@${inboundDomain()}`;
}

export function createNotificationReplyAddress(
  taskId: number,
  userId: number,
): string | undefined {
  if (
    !process.env.RESEND_WEBHOOK_SECRET ||
    !process.env.RESEND_INBOUND_DOMAIN ||
    !(process.env.SESSION_SECRET || process.env.JWT_SECRET)
  ) {
    return undefined;
  }
  return createInboundReplyAddress(taskId, userId);
}

function bareEmailAddress(value: string): string {
  const trimmed = value.trim();
  const bracketed = trimmed.match(/<([^<>]+)>\s*$/);
  return (bracketed?.[1] ?? trimmed).trim();
}

export function normalizeSenderEmail(value: string): string | null {
  const address = bareEmailAddress(value).toLowerCase();
  if (
    address.length > 320 ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)
  ) {
    return null;
  }
  return address;
}

export function verifyInboundReplyAddress(
  value: string,
): { taskId: number; userId: number } | null {
  const address = bareEmailAddress(value);
  const at = address.lastIndexOf("@");
  if (at <= 0 || address.slice(at + 1).toLowerCase() !== inboundDomain()) {
    return null;
  }

  const match = address
    .slice(0, at)
    .match(
      /^reply\+([0-9a-z]+)\.([0-9a-z]+)\.([0-9a-z]+)\.([A-Za-z0-9_-]{22})$/,
    );
  if (!match) return null;

  const taskId = Number.parseInt(match[1], 36);
  const userId = Number.parseInt(match[2], 36);
  const issuedDay = Number.parseInt(match[3], 36);
  if (
    !isPositiveSafeInteger(taskId) ||
    !isPositiveSafeInteger(userId) ||
    !isPositiveSafeInteger(issuedDay)
  ) {
    return null;
  }

  // Reject a stamp from the future as well as a stale one: a forged day cannot
  // buy an attacker a longer-lived credential than a real notification gets.
  const age = currentDay() - issuedDay;
  if (age < 0 || age > MAX_REPLY_ADDRESS_AGE_DAYS) return null;

  const supplied = Buffer.from(match[4]);
  const expected = Buffer.from(signatureFor(taskId, userId, issuedDay));
  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected)
  ) {
    return null;
  }

  return { taskId, userId };
}

function outlookHeaderStartsAt(lines: string[], index: number): boolean {
  if (!/^from:\s+\S/i.test(lines[index])) return false;
  const nearby = lines.slice(index + 1, index + 6).join("\n");
  return /^(sent|date):\s+/im.test(nearby) && /^to:\s+/im.test(nearby);
}

export function stripQuotedReply(value: string): string {
  const lines = value
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  let cutAt = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const nearbyEndsWithWrote = lines
      .slice(index, index + 3)
      .some((part) => /\bwrote:\s*$/i.test(part.trim()));
    if (
      /^-{2,}\s*original message\s*-{2,}$/i.test(line) ||
      /^_{5,}$/.test(line) ||
      (/^on\s.+/i.test(line) && nearbyEndsWithWrote) ||
      outlookHeaderStartsAt(lines, index)
    ) {
      cutAt = index;
      break;
    }
  }

  return lines
    .slice(0, cutAt)
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function htmlNodeText(node: Node): string {
  const chunks: string[] = [];
  const stack: Array<{ node: Node; appendBlockBreak: boolean }> = [
    { node, appendBlockBreak: false },
  ];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current.appendBlockBreak) {
      chunks.push("\n");
      continue;
    }
    if (current.node.nodeType === 3) {
      chunks.push(String(current.node.text ?? ""));
      continue;
    }
    if (current.node.nodeType !== 1) continue;

    const tag = String(current.node.rawTagName ?? "").toLowerCase();
    if (tag === "br") {
      chunks.push("\n");
      continue;
    }
    if (HTML_BLOCK_TAGS.has(tag)) {
      stack.push({ node: current.node, appendBlockBreak: true });
    }
    const children = current.node.childNodes ?? [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], appendBlockBreak: false });
    }
  }

  return chunks.join("");
}

export function emailHtmlToText(value: string): string {
  const root = parse(value.slice(0, MAX_SOURCE_CHARACTERS), {
    comment: false,
    lowerCaseTagName: true,
  });

  root
    .querySelectorAll(
      "blockquote, script, style, head, .gmail_quote, .yahoo_quoted, .protonmail_quote, .moz-cite-prefix, #divRplyFwdMsg",
    )
    .forEach((node) => node.remove());

  return htmlNodeText(root);
}

function plainTextToCommentHtml(value: string): string {
  return value
    .split(/\n{2,}/)
    .map(
      (paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

export function buildInboundCommentHtml(input: {
  text?: string | null;
  html?: string | null;
}): string | null {
  let candidate = "";
  if (input.text?.trim()) {
    candidate = input.text;
  } else if (input.html) {
    candidate = emailHtmlToText(input.html);
  }
  const reply = stripQuotedReply(candidate.slice(0, MAX_SOURCE_CHARACTERS))
    .slice(0, MAX_REPLY_CHARACTERS)
    .trim();
  if (!reply) return null;
  return sanitizeRichHtml(plainTextToCommentHtml(reply));
}

export interface ResendReceivedEmail {
  id: string;
  from: string;
  to: string[];
  text?: string | null;
  html?: string | null;
}

export async function retrieveResendReceivedEmail(
  emailId: string,
): Promise<ResendReceivedEmail> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");

  const response = await fetch(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "Hypertask/1.0",
      },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new Error(`Resend receiving API error: ${response.status}`);
  }
  return (await response.json()) as ResendReceivedEmail;
}
