import type { NextApiHandler } from "next";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import type { PersonHovercardSubject } from "@/models/personHovercard";
import { resolvePersonHovercard } from "@/utils/controllers/members/personHovercard";

const firstQueryValue = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

const positiveInteger = (value: string | undefined) => {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

export const parsePersonHovercardQuery = (query: {
  projectId?: string | string[];
  kind?: string | string[];
  id?: string | string[];
}): { projectId: number; subject: PersonHovercardSubject } | null => {
  const projectId = positiveInteger(firstQueryValue(query.projectId));
  const kind = firstQueryValue(query.kind);
  const id = firstQueryValue(query.id);
  if (!projectId || !id) return null;

  if (kind === "user") {
    const userId = positiveInteger(id);
    return userId ? { projectId, subject: { kind, id: userId } } : null;
  }

  if (kind === "agent" && id.length <= 128 && id.trim() === id) {
    return { projectId, subject: { kind, id } };
  }

  return null;
};

const handler: NextApiHandler = async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.setHeader("Vary", "Cookie");
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = verifySession(req.cookies[SESSION_COOKIE]);
  if (!session) {
    return res
      .status(401)
      .json({ error: "Unauthorized", code: "SESSION_REQUIRED" });
  }

  const parsed = parsePersonHovercardQuery(req.query);
  if (!parsed) {
    return res.status(400).json({ error: "Invalid person hovercard query" });
  }

  const result = await resolvePersonHovercard(
    parsed.projectId,
    session.id,
    parsed.subject,
  );
  if (!result.ok) {
    return res.status(result.status).json({ error: result.message });
  }

  return res.status(200).json(result.profile);
};

export default handler;
