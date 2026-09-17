"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const FIXTURE_PROJECT_ID = 99;
const FIXTURE_TICKET = "EVAL-1";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createBoard() {
  return {
    projectId: FIXTURE_PROJECT_ID,
    ticket: FIXTURE_TICKET,
    title: "Eval fixture ticket",
    section: "Bugs",
    overdue: true,
    assignees: ["me"],
    comments: [{ id: 1, text: "existing comment" }],
    labels: ["mcp", "eval"],
    members: [{ id: 1, name: "Eval User" }],
    inbox: [{ id: 1, title: "Inbox note" }],
    projects: [{ id: FIXTURE_PROJECT_ID, title: "Eval Board" }],
    sections: ["Bugs", "QA", "Done"],
    created: [],
    timeLogs: [],
    help: "Connect Claude to the Hypertask MCP server",
  };
}

function snapshotState(board) {
  return {
    ticket: board.ticket,
    title: board.title,
    section: board.section,
    commentCount: board.comments.length,
    createdCount: board.created.length,
    timeLogCount: board.timeLogs.length,
    assignees: [...board.assignees],
  };
}

function json(data) {
  return `${JSON.stringify(data)}\n`;
}

function handleMcpTool(board, name, args = {}) {
  switch (name) {
    case "hypertask_list_tasks": {
      const tasks = [
        {
          ticketNumber: board.ticket,
          title: board.title,
          overdue: board.overdue,
          projectId: board.projectId,
          assignee: "me",
        },
      ];
      return json({ success: true, tasks, overdue: true });
    }
    case "hypertask_add_comment_to_task": {
      board.comments.push({
        id: board.comments.length + 1,
        text: String(args.text || "eval status"),
      });
      return json({ success: true, comment: { id: board.comments.at(-1).id } });
    }
    case "hypertask_update_task": {
      if (args.status) board.section = String(args.status);
      if (args.title) board.title = String(args.title);
      return json({
        success: true,
        task: { ticketNumber: board.ticket, section: board.section, title: board.title },
      });
    }
    case "hypertask_get_tasks":
      return json({
        success: true,
        tasks: [
          {
            ticketNumber: board.ticket,
            section: board.section,
            assignees: board.assignees,
            title: board.title,
          },
        ],
      });
    case "hypertask_search_tasks":
      return json({
        success: true,
        tasks: [{ ticketNumber: board.ticket, title: "MCP eval harness" }],
      });
    case "hypertask_get_comments_for_task":
      return json({ success: true, comments: board.comments });
    case "hypertask_section":
      return json({ success: true, sections: board.sections });
    case "hypertask_list_projects":
      return json({ success: true, projects: board.projects });
    case "hypertask_hello":
      return json({
        success: true,
        user: "Eval User",
        capabilities: ["task", "comment", "mcp"],
      });
    case "hypertask_assign_user":
      if (!board.assignees.includes("me")) board.assignees.push("me");
      return json({ success: true, assignStatus: "Assigned" });
    case "hypertask_create_task": {
      const created = {
        ticketNumber: `EVAL-${board.created.length + 2}`,
        title: String(args.title || "Eval fixture note"),
      };
      board.created.push(created);
      return json({ success: true, task: created });
    }
    case "hypertask_list_labels":
      return json({ success: true, labels: board.labels });
    case "hypertask_inbox_list":
      return json({ success: true, inbox: board.inbox });
    case "hypertask_time":
      board.timeLogs.push({ minutes: Number(args.minutes) || 15 });
      return json({ success: true, minutes: board.timeLogs.at(-1).minutes });
    case "hypertask_next_tasks":
      return json({
        success: true,
        tasks: [{ ticketNumber: board.ticket, title: board.title }],
      });
    case "hypertask_task_context":
      return json({
        success: true,
        context: { ticketNumber: board.ticket, title: board.title, section: board.section },
      });
    case "hypertask_list_project_members":
      return json({ success: true, members: board.members });
    case "hypertask_search_help_docs":
      return json({ success: true, results: [{ title: board.help }] });
    default:
      return json({ success: false, error: `unknown tool ${name}` });
  }
}

function handleCli(board, argv) {
  const [cmd, sub, ...rest] = argv;
  if (cmd === "task" && sub === "list") {
    return handleMcpTool(board, "hypertask_list_tasks");
  }
  if (cmd === "comment" && sub === "add") {
    const textIndex = rest.indexOf("--text");
    return handleMcpTool(board, "hypertask_add_comment_to_task", {
      text: textIndex === -1 ? "eval status" : rest[textIndex + 1],
    });
  }
  if (cmd === "task" && sub === "move") {
    const sectionIndex = rest.indexOf("--section");
    return handleMcpTool(board, "hypertask_update_task", {
      status: sectionIndex === -1 ? "QA" : rest[sectionIndex + 1],
    });
  }
  if (cmd === "task" && sub === "get") {
    return handleMcpTool(board, "hypertask_get_tasks");
  }
  if (cmd === "search") {
    return handleMcpTool(board, "hypertask_search_tasks");
  }
  if (cmd === "comment" && sub === "list") {
    return handleMcpTool(board, "hypertask_get_comments_for_task");
  }
  if (cmd === "section" && sub === "list") {
    return handleMcpTool(board, "hypertask_section");
  }
  if (cmd === "project" && sub === "list") {
    return handleMcpTool(board, "hypertask_list_projects");
  }
  if (cmd === "status") {
    return handleMcpTool(board, "hypertask_hello");
  }
  if (cmd === "task" && sub === "assign") {
    return handleMcpTool(board, "hypertask_assign_user");
  }
  if (cmd === "task" && sub === "create") {
    const titleIndex = rest.indexOf("--title");
    return handleMcpTool(board, "hypertask_create_task", {
      title: titleIndex === -1 ? "Eval fixture note" : rest[titleIndex + 1],
    });
  }
  if (cmd === "task" && sub === "update") {
    const titleIndex = rest.indexOf("--title");
    return handleMcpTool(board, "hypertask_update_task", {
      title: titleIndex === -1 ? "Eval fixture ticket updated" : rest[titleIndex + 1],
    });
  }
  if (cmd === "labels" && sub === "list") {
    return handleMcpTool(board, "hypertask_list_labels");
  }
  if (cmd === "inbox" && sub === "list") {
    return handleMcpTool(board, "hypertask_inbox_list");
  }
  if (cmd === "time" && sub === "log") {
    return handleMcpTool(board, "hypertask_time", { minutes: Number(rest[1]) || 15 });
  }
  if (cmd === "task" && sub === "next") {
    return handleMcpTool(board, "hypertask_next_tasks");
  }
  if (cmd === "task" && sub === "context") {
    return handleMcpTool(board, "hypertask_task_context");
  }
  if (cmd === "project" && sub === "members") {
    return handleMcpTool(board, "hypertask_list_project_members");
  }
  if (cmd === "capabilities") {
    return handleMcpTool(board, "hypertask_search_help_docs");
  }
  return json({ success: false, error: `unknown command ${argv.join(" ")}` });
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

function startFixtureServer(board = createBoard()) {
  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(json({ ok: true }));
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405, { "content-type": "application/json" });
        res.end(json({ error: "method not allowed" }));
        return;
      }
      const body = await readJsonBody(req);
      if (body.method === "tools/call") {
        const name = body.params?.name;
        const args = body.params?.arguments || {};
        const text = handleMcpTool(board, name, args);
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          json({
            jsonrpc: "2.0",
            id: body.id ?? 1,
            result: { content: [{ type: "text", text }] },
          }),
        );
        return;
      }
      res.writeHead(400, { "content-type": "application/json" });
      res.end(json({ jsonrpc: "2.0", id: body.id ?? null, error: { message: "unsupported method" } }));
    } catch (error) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(json({ error: error.message }));
    }
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        board,
        url: `http://127.0.0.1:${port}/mcp`,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

function fixtureBinPath() {
  return path.join(__dirname, "..", "bin", "hypertask-fixture.cjs");
}

function writeBoardFile(board, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(board, null, 2)}\n`);
}

function readBoardFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

module.exports = {
  FIXTURE_PROJECT_ID,
  FIXTURE_TICKET,
  clone,
  createBoard,
  snapshotState,
  handleMcpTool,
  handleCli,
  startFixtureServer,
  fixtureBinPath,
  writeBoardFile,
  readBoardFile,
};
