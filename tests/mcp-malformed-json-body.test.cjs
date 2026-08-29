// HTPR-5568: a client that interpolated an undefined variable into a JSON
// template sent `{"task_id":,"title":""}` to /api/mcp/tasks/update. The route
// called request.json() unguarded, so the SyntaxError escaped as a server
// error instead of telling the caller its payload was malformed. Every MCP
// write route now reads its body through readJsonBody, which answers 400.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const jiti = require('jiti')(__filename, {
  interopDefault: true,
  alias: { '@': path.join(root, 'src') },
});

const { readJsonBody } = jiti(path.join(root, 'src/lib/mcp/readJsonBody.ts'));

function request(rawBody) {
  return new Request('https://app.hypertask.ai/api/mcp/tasks/update', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: rawBody,
  });
}

test('the exact malformed payload from production answers 400, not a crash', async () => {
  const result = await readJsonBody(request('{"task_id":,"title":""}'));
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 400);
  const payload = await result.response.json();
  assert.equal(payload.success, false);
  assert.equal(payload.field, 'body');
  // The caller has to be able to tell a malformed payload from a rejected one.
  assert.match(payload.error, /not valid JSON/i);
});

test('an empty body is a caller error, not a server error', async () => {
  const result = await readJsonBody(request(''));
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 400);
});

test('a JSON scalar or array is rejected: write routes read named fields', async () => {
  for (const raw of ['[]', '"task"', '7', 'null']) {
    const result = await readJsonBody(request(raw));
    assert.equal(result.ok, false, `expected ${raw} to be rejected`);
    assert.equal(result.response.status, 400);
  }
});

test('a well-formed object still reaches the route unchanged', async () => {
  const result = await readJsonBody(request('{"task_id":42,"title":"hi"}'));
  assert.equal(result.ok, true);
  assert.deepEqual(result.body, { task_id: 42, title: 'hi' });
});

test('every MCP route body parse is guarded, and every guard is returned', () => {
  // A regex sweep misses a multiline or aliased parse, so the source is walked
  // with the TypeScript AST the build already depends on. Invoking the real
  // route handlers is not viable here: importing any /api/mcp route pulls in
  // the Firebase admin client, which refuses to load without a real
  // service-account key.
  const ts = require('typescript');
  const unguardedParses = [];
  const unreturnedGuards = [];

  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) files.push(full);
    }
  };
  walk(path.join(root, 'src/app/api/mcp'));

  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true
    );
    const where = (node) =>
      `${path.relative(root, file)}:${
        source.getLineAndCharacterOfPosition(node.getStart()).line + 1
      }`;

    const isRequestJsonCall = (node) =>
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'json' &&
      ts.isIdentifier(node.expression.expression) &&
      /^(request|req)$/.test(node.expression.expression.text);

    // `request.json().catch(...)` never throws, so it is already guarded.
    const isCaught = (node) => {
      let current = node.parent;
      while (current) {
        if (ts.isTryStatement(current)) return true;
        if (
          ts.isCallExpression(current) &&
          ts.isPropertyAccessExpression(current.expression) &&
          current.expression.name.text === 'catch'
        )
          return true;
        current = current.parent;
      }
      return false;
    };

    // A guard nobody returns is not a guard: the malformed body would fall
    // through into the handler with an undefined payload.
    const guardIsReturned = (call) => {
      const declaration = ts.isAwaitExpression(call.parent)
        ? call.parent.parent
        : call.parent;
      if (!ts.isVariableDeclaration(declaration) || !ts.isIdentifier(declaration.name))
        return false;
      const name = declaration.name.text;
      const statement = declaration.parent.parent;
      const block = statement.parent;
      if (!block || !Array.isArray(block.statements)) return false;
      const next = block.statements[block.statements.indexOf(statement) + 1];
      return Boolean(next && new RegExp(`!${name}\\.ok`).test(next.getText()));
    };

    const visit = (node) => {
      if (isRequestJsonCall(node) && !isCaught(node)) unguardedParses.push(where(node));
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'readJsonBody' &&
        !guardIsReturned(node)
      )
        unreturnedGuards.push(where(node));
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  assert.deepEqual(unguardedParses, []);
  assert.deepEqual(unreturnedGuards, []);
});
