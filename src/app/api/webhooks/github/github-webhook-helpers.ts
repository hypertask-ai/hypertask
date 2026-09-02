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

  // Branch name first: this repo generates branches directly from the ticket
  // (e.g. htpr-4437-github-pr-link), so it's the most reliable signal. Title
  // is free-form human text that often references OTHER tickets ("Revert
  // HTPR-1234", "follow-up to INNE-99") — trusting it first would resolve to
  // the wrong ticket, and possibly move a task on an unrelated board.
  for (const value of [input.headRef, input.title, input.body]) {
    for (const match of value?.matchAll(ticketPattern) ?? []) {
      if (match[1].toUpperCase() === boardPrefix) {
        return `${boardPrefix}-${match[2]}`;
      }
    }
  }

  return null;
}

export function chooseReviewSectionName(
  riskLevel: RiskLevelValue | null | undefined,
): "AI Review" | "Valentin Review" {
  return riskLevel === "High" ? "Valentin Review" : "AI Review";
}
