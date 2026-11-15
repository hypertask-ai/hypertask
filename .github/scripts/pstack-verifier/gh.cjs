'use strict';

const { execFileSync } = require('node:child_process');

function gh(args, input) {
  return execFileSync('gh', args, {
    encoding: 'utf8',
    input,
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function ghJson(args) {
  return JSON.parse(gh(args));
}

function flattenPages(value) {
  if (!Array.isArray(value)) return [];
  if (value.every(Array.isArray)) return value.flat();
  return value;
}

module.exports = { gh, ghJson, flattenPages };
