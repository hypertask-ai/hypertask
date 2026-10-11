/* Opt-in API: server flag htpr-6924-rest-compat AND ?compat=htpr-6924.
 * List: { success, sessions: summaries, nextCursor }; limit 1..100 (default 30),
 * optional taskId, projectId (board-only unless taskId is supplied), emptyOnly=true.
 * Detail: sessionId alone returns { success, session } with its full transcript.
 * Ordering is snapshotted as updatedAt DESC, id DESC; opaque cursors expire after
 * 15 minutes (410: restart). New/updated sessions appear in order on a fresh list.
 * The snapshot stores IDs only; each page rechecks owner, visibility and scope.
 * Initial ordering costs one ID-only scan; transcript/summary reads stay bounded.
 * Without both opt-ins the legacy response and query remain unchanged.
 */
import { randomUUID } from "node:crypto";
import { getRedis } from "@/lib/redis";
import { HTPR_6924_REST_COMPAT_FLAG, isFeatureEnabled } from "@/lib/flags";
import { checkRestRateLimit } from "@/lib/api/rateLimit";
import prisma from "@/lib/prisma";
import { loadCurrentUser } from "@/lib/auth/currentUser";
import { unauthorized } from "@/lib/api/response";
import { NextRequest, NextResponse } from "next/server";

const summarySelect = {
  id: true, createdAt: true, updatedAt: true, userId: true,
  taskId: true, projectId: true, agentId: true, teamId: true, title: true,
  _count: { select: { messages: true } },
} as const;
const transcriptInclude = {
  messages: {
    orderBy: { createdAt: "asc" as const },
    include: { attachments: true, authorAgent: { select: { displayName: true } } },
  },
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function pagedSessions(request: NextRequest, userId: number) {
  const params = new URL(request.url).searchParams;
  const visible = {
    userId,
    OR: [{ agentId: null }, { agent: { runtimeType: { not: "EXTERNAL" as const } } }],
  };
  const invalid = () => NextResponse.json(
    { success: false, error: "Invalid session query" }, { status: 400 }
  );
  const sessionId = params.get("sessionId");
  if (params.has("sessionId")) {
    if (!sessionId || !uuidPattern.test(sessionId) ||
        ["cursor", "limit", "taskId", "projectId", "emptyOnly"].some((key) => params.has(key))) return invalid();
    const session = await prisma.chatSession.findFirst({
      relationLoadStrategy: "join",
      where: { ...visible, id: sessionId },
      include: transcriptInclude,
    });
    return session
      ? NextResponse.json({ success: true, session })
      : NextResponse.json({ success: false, error: "Session not found" }, { status: 404 });
  }

  const limitText = params.get("limit") ?? "30";
  if (!/^[1-9]\d*$/.test(limitText) || Number(limitText) > 100) return invalid();
  const limit = Number(limitText);
  const scope: { taskId?: number | null; projectId?: number } = {};
  for (const key of ["taskId", "projectId"] as const) {
    if (!params.has(key)) continue;
    const value = params.get(key)!;
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) return invalid();
    scope[key] = Number(value);
  }
  if (scope.projectId !== undefined && scope.taskId === undefined) scope.taskId = null;
  if (params.has("emptyOnly") && params.get("emptyOnly") !== "true") return invalid();
  const emptyOnly = params.get("emptyOnly") === "true";
  let cursor: { snapshot: string; offset: number } | undefined;
  if (params.has("cursor")) {
    const encoded = params.get("cursor")!;
    if (!encoded || encoded.length > 512 || !/^[A-Za-z0-9_-]+$/.test(encoded)) return invalid();
    try {
      const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
      if (!decoded || typeof decoded.snapshot !== "string" || !uuidPattern.test(decoded.snapshot) ||
          !Number.isSafeInteger(decoded.offset) || decoded.offset < 1 ||
          Object.keys(decoded).sort().join(",") !== "offset,snapshot") return invalid();
      cursor = decoded;
    } catch {
      return invalid();
    }
  }
  const where = { ...visible, ...scope, ...(emptyOnly ? { messages: { none: {} } } : {}) };
  const snapshot = cursor?.snapshot ?? randomUUID();
  const cacheKey = `ai-chat:session-page:${userId}:${scope.taskId ?? ""}:${scope.projectId ?? ""}:${emptyOnly}:${snapshot}`;
  let ids: string[];
  if (cursor) {
    const cached = await (await getRedis()).get(cacheKey);
    if (!cached) return NextResponse.json(
      { success: false, error: "Session cursor expired; restart pagination" }, { status: 410 }
    );
    ids = JSON.parse(cached);
    if (cursor.offset >= ids.length) return invalid();
  } else {
    // A mutable updatedAt keyset skips unseen sessions moved ahead of the cursor.
    // Freeze membership/order, not transcripts, so concurrent writes cannot move IDs.
    ids = (await prisma.chatSession.findMany({
      where, select: { id: true }, orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    })).map(({ id }) => id);
    if (ids.length > limit) {
      await (await getRedis()).set(cacheKey, JSON.stringify(ids), "EX", 15 * 60);
    }
  }
  const offset = cursor?.offset ?? 0;
  const pageIds = ids.slice(offset, offset + limit);
  const rows = pageIds.length ? await prisma.chatSession.findMany({
    relationLoadStrategy: "join",
    where: { ...where, id: { in: pageIds } },
    select: summarySelect,
    take: limit,
  }) : [];
  const byId = new Map(rows.map((row) => [row.id, row]));
  const page = pageIds.flatMap((id) => {
    const row = byId.get(id);
    return row ? [row] : [];
  });
  if (!ids.length && !cursor && !Object.keys(scope).length && !emptyOnly) {
    page.push(await prisma.chatSession.create({ data: { userId }, select: summarySelect }));
  }
  const sessions = page.map(({ _count, ...session }) => ({
    ...session, hasMessages: _count.messages > 0,
  }));
  const nextOffset = offset + pageIds.length;
  const nextCursor = nextOffset < ids.length ? Buffer.from(JSON.stringify({
    snapshot, offset: nextOffset,
  })).toString("base64url") : null;
  return NextResponse.json({ success: true, sessions, nextCursor });
}

export async function GET(request: NextRequest) {
  try {
    const currentUser = await loadCurrentUser(request.headers, true);
    if (!currentUser) return unauthorized();
    const { user } = currentUser;

    let restCompat = false;
    try {
      restCompat = await isFeatureEnabled(HTPR_6924_REST_COMPAT_FLAG, currentUser.userId);
    } catch {
      // Flag lookup failure preserves the legacy route.
    }
    if (restCompat) {
      const limited = await checkRestRateLimit(currentUser.userId, "read");
      if (limited) return limited;
    }

    if (restCompat && new URL(request.url).searchParams.get("compat") === "htpr-6924") {
      return await pagedSessions(request, currentUser.userId);
    }

    const sessions = await prisma.chatSession.findMany({
      relationLoadStrategy: "join",
      where: {
        userId: user.id,
        // External agents (self-hosted runtimes) are only chatted with from
        // Agent Chat, which sends through /api/agent-chat, not this general
        // AI chat surface. Listing their sessions here lets a user open one
        // and hit the /api/ai/chat/stream guard that rejects the send.
        OR: [{ agentId: null }, { agent: { runtimeType: { not: "EXTERNAL" } } }],
      },
      include: {
        messages: {
          orderBy: {
            createdAt: "asc",
          },
          include: {
            attachments: true,
            // HTPR-6284: agent-attributed replies keep their author on reload.
            authorAgent: { select: { displayName: true } },
          },
        },
      },
      orderBy: {
        updatedAt: "desc",
      },
    });

    if (sessions.length === 0) {
      console.warn("No sessions found, creating new session");
      const session = await prisma.chatSession.create({
        data: {
          userId: user.id,
        },
        include: {
          messages: {
            orderBy: {
              createdAt: "asc",
            },
            include: {
              attachments: true,
              authorAgent: { select: { displayName: true } },
            },
          },
        },
      });
      sessions.push(session);
    }

    return NextResponse.json({ success: true, sessions });
  } catch (error) {
    console.error("🚀 ~ GET ~ Error listing chat sessions:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal server error",
      },
      { status: 500 }
    );
  }
}
