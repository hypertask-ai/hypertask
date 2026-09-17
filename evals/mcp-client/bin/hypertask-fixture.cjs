#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { handleCli, readBoardFile, writeBoardFile } = require("../lib/fixture.cjs");

const boardPath = process.env.EVAL_FIXTURE_BOARD;
if (!boardPath) {
  process.stderr.write("EVAL_FIXTURE_BOARD is required\n");
  process.exit(2);
}

const board = readBoardFile(boardPath);
const stdout = handleCli(board, process.argv.slice(2));
writeBoardFile(board, boardPath);
process.stdout.write(stdout);
process.exit(0);
