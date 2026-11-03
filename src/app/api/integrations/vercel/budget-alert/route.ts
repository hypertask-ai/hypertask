import { NextResponse } from "next/server";
import { fileVercelBudgetTicket } from "@/lib/ops/fileVercelBudgetTicket";
import { parseVercelBudgetAlert, verifyVercelSignature } from "@/lib/ops/vercelBudgetAlert";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY_BYTES = 8 * 1024;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  const signingSecret = process.env.VERCEL_BUDGET_WEBHOOK_SECRET?.trim();
  if (!signingSecret) {
    console.error("[vercel-budget-alert] VERCEL_BUDGET_WEBHOOK_SECRET is not configured");
    return NextResponse.json({ error: "Webhook is not configured" }, { status: 503 });
  }

  const signature = request.headers.get("x-vercel-signature");
  if (!verifyVercelSignature(rawBody, signature, signingSecret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const alert = parseVercelBudgetAlert(payload);
  if (!alert) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const filed = await fileVercelBudgetTicket(alert);
  return NextResponse.json({
    taskId: filed.taskId,
    created: filed.created,
    emailed: filed.emailed,
  });
}
