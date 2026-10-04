import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

// Fixture-only search boundary. This is not a Turbopuffer ranking/embedding test.
export function queryFixtureRows(rows, query) {
  function matches(row, filter) {
    if (!filter) return true;
    const [field, operator, value] = filter;
    if (field === "And") return operator.every(part => matches(row, part));
    if (field === "Or") return operator.some(part => matches(row, part));
    if (operator === "Eq") return row[field] === value;
    if (operator === "In") return value.includes(row[field]);
    throw new Error("Unsupported fixture filter");
  }
  function terms(rank) {
    if (!Array.isArray(rank)) return [];
    if (rank[1] === "BM25") return String(rank[2]).toLowerCase().split(/\s+/).filter(Boolean);
    if (rank[0] === "Sum" || rank[0] === "Product") return terms(rank[1]);
    if (rank.every(part => Array.isArray(part) || typeof part === "number")) return rank.flatMap(terms);
    throw new Error("Unsupported fixture ranking");
  }
  const words = terms(query.rank_by);
  return rows.filter(row => matches(row, query.filters) &&
    (!words.length || words.some(word => row.searchText.toLowerCase().includes(word))))
    .slice(0, query.top_k ?? 50).map(row => ({ ...row, $dist: 1 }));
}

export function fixtureSearchServer(rows) {
  return createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET" && request.url === "/health") {
      response.end('{"ok":true}');
      return;
    }
    const match = /^\/v2\/namespaces\/(tasks|comments)\/query(?:\?.*)?$/.exec(request.url);
    if (request.method !== "POST" || !match) {
      response.writeHead(404).end('{"error":"Fixture search supports task/comment queries only"}');
      return;
    }
    try {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 65536) throw new Error("Query too large");
      }
      const query = JSON.parse(body);
      const fixtures = match[1] === "tasks" ? rows : [];
      if (query.queries) throw new Error("Fixture search supports keyword queries only");
      response.end(JSON.stringify({ rows: queryFixtureRows(fixtures, query) }));
    } catch {
      response.writeHead(400).end('{"error":"Unsupported fixture query"}');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { searchRows } = JSON.parse(await readFile(process.argv[2], "utf8"));
  if (!Array.isArray(searchRows) || !searchRows.length) throw new Error("Missing search fixtures");
  fixtureSearchServer(searchRows).listen(Number(process.argv[3]), "127.0.0.1");
}
