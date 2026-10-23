import { createHmac, timingSafeEqual } from "node:crypto";
import type { RiskLevelValue } from "@/lib/mcp/tasks/contractFields";

export function verifyGithubSignature(
  rawBody: string,
  signatureHeader: string | null | undefined,
  secret: string | undefined,
): boolean {
  if (!secret || !signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expectedSignature =
    "sha256=" +
    createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");

  if (
    Buffer.byteLength(signatureHeader) !== Buffer.byteLength(expectedSignature)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(signatureHeader, "utf8"),
    Buffer.from(expectedSignature, "utf8"),
  );
}

export function extractTicketId(input: {
  boardPrefix: string;
  title?: string | null;
  headRef?: string | null;
  body?: string | null;
}): string | null {
  const ticketPattern = /\b([A-Za-z][A-Za-z0-9]{1,9})-(\d+)\b/g;
  const boardPrefix = input.boardPrefix.trim().toUpperCase();

  for (const value of [input.headRef, input.title]) {
    for (const match of value?.matchAll(ticketPattern) ?? []) {
      if (match[1].toUpperCase() === boardPrefix) {
        return `${boardPrefix}-${match[2]}`;
      }
    }
  }

  const titleTicket = input.title?.match(/^\s*([A-Za-z][A-Za-z0-9]{1,9})-\d+\s+\[/);
  if (titleTicket && titleTicket[1].toUpperCase() !== boardPrefix) return null;

  const bodyPattern = /\b([A-Z][A-Z0-9]{1,9})-(\d+)(?![-\w])/g;
  for (const match of input.body?.matchAll(bodyPattern) ?? []) {
    if (match[1] === boardPrefix) {
      return `${boardPrefix}-${match[2]}`;
    }
  }

  return null;
}

export function chooseReviewSectionName(
  riskLevel: RiskLevelValue | null | undefined,
): "AI Review" | "Valentin Review" {
  return riskLevel === "High" ? "Valentin Review" : "AI Review";
}
