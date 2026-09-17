"use strict";

const http = require("node:http");
const { URL } = require("node:url");
const { snapshotState, writeBoardFile } = require("./fixture.cjs");

const SECTION_IDS = { Bugs: 1, QA: 2, Done: 3 };

function json(data) {
  return `${JSON.stringify(data)}\n`;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function taskDetail(board, extra = {}) {
  return {
    id: extra.id || 1,
    ticketNumber: extra.ticketNumber || board.ticket,
    title: extra.title || board.title,
    description: extra.description || "",
    section: extra.section || board.section,
    sectionId: extra.sectionId || SECTION_IDS[extra.section || board.section] || 1,
    boardId: board.projectId,
    boardTitle: "Eval Board",
    sub_tasks: [],
    projectId: board.projectId,
    status: "Normal",
    overdue: board.overdue,
    assignees: (board.assignees || []).map((name, index) => ({
      id: index + 1,
      email: `${name}@example.com`,
      displayName: name,
    })),
    ...extra,
  };
}

function commentDetail(comment) {
  return {
    id: comment.id,
    text: comment.text,
    commentText: comment.text,
    createdAt: comment.createdAt || "2026-09-17T00:00:00.000Z",
  };
}

function pathnameOf(req) {
  const url = new URL(req.url, "http://127.0.0.1");
  return url.pathname.replace(/^\/api/, "") || "/";
}

function queryOf(req) {
  return new URL(req.url, "http://127.0.0.1").searchParams;
}

function handleIsolatedRequest(board, req, body) {
  const path = pathnameOf(req);
  const query = queryOf(req);
  const method = req.method || "GET";

  if (path === "/health") {
    return { status: 200, data: { ok: true } };
  }

  if (path === "/mcp/hello") {
    return {
      status: 200,
      data: {
        success: true,
        user: { id: 1, displayName: "Eval User", email: "eval@example.com" },
        boards: [
          {
            id: board.projectId,
            name: "Eval Board",
            title: "Eval Board",
            taskUrlTemplate: "https://app.hypertask.ai/detail/project-{projectId}/{uniqueIndex}",
          },
        ],
        boardsTotal: 1,
        boardsTruncated: false,
        capabilities: { task: "yes", comment: "yes", mcp: "yes" },
        conventions: [],
        conventionsTruncated: false,
      },
    };
  }

  if (path === "/mcp/tasks" && method === "GET") {
    const ticket = query.get("ticket_number");
    const task = taskDetail(board);
    const tasks = !ticket || ticket === board.ticket ? [task] : [];
    return {
      status: 200,
      data: {
        success: true,
        tasks,
        total: tasks.length,
        limit: 50,
        offset: 0,
        overdue: board.overdue,
      },
    };
  }

  if (path === "/mcp/tasks/search") {
    return {
      status: 200,
      data: {
        success: true,
        tasks: [{ ...taskDetail(board), title: "MCP eval harness" }],
        total: 1,
        limit: 10,
        offset: 0,
      },
    };
  }

  if (path === "/mcp/tasks/update" && method === "POST") {
    if (body.status && !["Normal", "Archive", "Deleted"].includes(body.status)) {
      board.section = String(body.status);
    }
    if (body.sectionId) {
      const match = Object.entries(SECTION_IDS).find(([, id]) => id === Number(body.sectionId));
      if (match) board.section = match[0];
    }
    if (body.title) board.title = String(body.title);
    return { status: 200, data: { success: true, task: taskDetail(board) } };
  }

  if (path === "/mcp/tasks/create" && method === "POST") {
    const created = {
      id: board.created.length + 2,
      ticketNumber: `EVAL-${board.created.length + 2}`,
      title: String(body.title || "Eval fixture note"),
    };
    board.created.push(created);
    return {
      status: 200,
      data: {
        success: true,
        task: taskDetail(board, created),
      },
    };
  }

  if (path === "/mcp/tasks/move" && method === "POST") {
    if (body.section || body.status) board.section = String(body.section || body.status);
    return { status: 200, data: { success: true, task: taskDetail(board) } };
  }

  if (path === "/mcp/tasks/next") {
    return {
      status: 200,
      data: { success: true, tasks: [taskDetail(board)], total: 1, limit: 10 },
    };
  }

  if (path === "/mcp/tasks/context") {
    return {
      status: 200,
      data: {
        success: true,
        context: {
          ticketNumber: board.ticket,
          title: board.title,
          section: board.section,
        },
        task: taskDetail(board),
      },
    };
  }

  if (path === "/mcp/comments" && method === "POST") {
    const comment = {
      id: board.comments.length + 1,
      text: String(body.text || "eval status"),
      createdAt: new Date().toISOString(),
    };
    board.comments.push(comment);
    return {
      status: 200,
      data: { success: true, comment: commentDetail(comment) },
    };
  }

  if (path === "/mcp/comments" && method === "GET") {
    return {
      status: 200,
      data: {
        success: true,
        comments: board.comments.map(commentDetail),
        total: board.comments.length,
        limit: 50,
        offset: 0,
      },
    };
  }

  if (path === "/mcp/assignees/assign" && method === "POST") {
    if (!board.assignees.includes("me")) board.assignees.push("me");
    return {
      status: 200,
      data: {
        success: true,
        assignees: [{ userId: 1 }],
        assignStatus: "Assigned",
        assignmentOutcome: "created",
        task: taskDetail(board),
      },
    };
  }

  if (path === "/mcp/projects" && method === "GET") {
    return {
      status: 200,
      data: {
        success: true,
        projects: [
          {
            id: board.projectId,
            title: "Eval Board",
            name: "Eval Board",
            ownerId: 1,
            memberCount: 1,
            taskCount: 1,
            defaultSections: board.sections,
            status: "Normal",
            createdAt: "2026-09-17T00:00:00.000Z",
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
        has_more: false,
      },
    };
  }

  const projectMatch = path.match(/^\/mcp\/projects\/(\d+)\/(sections|labels|members)$/);
  if (projectMatch) {
    const kind = projectMatch[2];
    if (kind === "sections") {
      return {
        status: 200,
        data: {
          success: true,
          projectId: board.projectId,
          sections: board.sections.map((title) => ({
            id: SECTION_IDS[title] || 1,
            title,
            section_title: title,
            projectId: board.projectId,
            visibility: true,
            deleted: false,
            ranking: String(SECTION_IDS[title] || 1),
            isDone: title === "Done",
            autoAssign: null,
            taskCount: title === board.section ? 1 : 0,
            position: String(SECTION_IDS[title] || 1),
            role: title === "Done" ? "done" : "work",
          })),
        },
      };
    }
    if (kind === "labels") {
      return {
        status: 200,
        data: {
          success: true,
          projectId: board.projectId,
          labels: (board.labels || []).map((name, index) => ({
            id: String(index + 1),
            name,
          })),
        },
      };
    }
    return {
      status: 200,
      data: {
        success: true,
        projectId: board.projectId,
        members: (board.members || []).map((member) => ({
          id: member.id,
          displayName: member.name,
          email: "eval@example.com",
        })),
      },
    };
  }

  if (path === "/mcp/inbox/list") {
    return {
      status: 200,
      data: {
        success: true,
        items: board.inbox,
        user_notifications: (board.inbox || []).map((item, index) => ({
          id: item.id || index + 1,
          title: item.title,
          text: item.title,
        })),
      },
    };
  }

  if (path === "/mcp/time/log" && method === "POST") {
    const minutes = Number(body.minutes) || 15;
    board.timeLogs.push({ minutes });
    return {
      status: 200,
      data: {
        success: true,
        minutes,
        entry: {
          id: board.timeLogs.length,
          taskId: 1,
          userId: 1,
          startedAt: "2026-09-17T00:00:00.000Z",
          endedAt: "2026-09-17T00:15:00.000Z",
          pausedAt: null,
          seconds: minutes * 60,
        },
      },
    };
  }

  if (path === "/mcp/user/profile" || path === "/mcp/user/context") {
    return {
      status: 200,
      data: {
        success: true,
        user: { id: 1, displayName: "Eval User", email: "eval@example.com" },
      },
    };
  }

  return {
    status: 404,
    data: { success: false, error: `isolated API has no ${method} ${path}` },
  };
}

function startIsolatedApi(board, { boardFile } = {}) {
  const server = http.createServer(async (req, res) => {
    req.on("error", () => {});
    res.on("error", () => {});
    try {
      const body = req.method === "GET" || req.method === "HEAD" ? {} : await readJsonBody(req);
      const result = handleIsolatedRequest(board, req, body);
      if (boardFile) writeBoardFile(board, boardFile);
      res.writeHead(result.status, {
        "content-type": "application/json",
        connection: "close",
      });
      res.end(json(result.data));
    } catch (error) {
      res.writeHead(500, {
        "content-type": "application/json",
        connection: "close",
      });
      res.end(json({ success: false, error: error.message }));
    }
  });
  server.on("clientError", (_error, socket) => {
    socket.destroy();
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        board,
        port,
        apiUrl: `http://127.0.0.1:${port}/api`,
        snapshot: () => snapshotState(board),
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

module.exports = {
  SECTION_IDS,
  handleIsolatedRequest,
  startIsolatedApi,
  taskDetail,
};
