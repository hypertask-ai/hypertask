"use strict";

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
  writeBoardFile,
  readBoardFile,
};
