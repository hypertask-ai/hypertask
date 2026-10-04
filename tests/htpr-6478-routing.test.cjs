const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { NextRequest } = require('next/server')
const root = path.resolve(__dirname, '..')
const source = fs.readFileSync(path.join(root, 'src/lib/mcp/operations/index.ts'), 'utf8')
const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const jiti = require('jiti')(__filename, { alias: { '@': path.join(root, 'src') } })
const { ApiError } = jiti(path.join(root, 'src/lib/mcp-server/utils/errors.ts'))
let call
const loadedModule = { exports: {} }
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
function exportedMethods(file) {
  const sf = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true)
  const names = []
  for (const statement of sf.statements) {
    if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue
    if (ts.isFunctionDeclaration(statement)) names.push(statement.name.text)
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isObjectBindingPattern(declaration.name)) names.push(...declaration.name.elements.map((element) => element.name.text))
        else names.push(declaration.name.text)
      }
    }
  }
  return names.filter((name) => methods.has(name))
}
new Function('module', 'exports', 'require', code)(loadedModule, loadedModule.exports, (name) => {
  if (name === '@/lib/mcp-server/utils/errors') return { ApiError }
  assert.ok(name.startsWith('./') && name.endsWith('/operation'), `Unexpected operation import ${name}`)
  const file = 'src/lib/mcp/operations/' + name.slice(2) + '.ts'
  return Object.fromEntries(exportedMethods(file).map((method) => [method, async (request, context) => {
    call = { file, method, params: await context.params, request }
    return Response.json({ success: true })
  }]))
})
const { executeMcpOperation } = loadedModule.exports
const operationModules = [...source.matchAll(/load: \(\) => import\('\.\/([^']+)\/operation'\)/g)].map((match) => match[1])
for (const operation of operationModules) {
  test(`${operation} routes every existing method to the same shared function with decoded parameters`, async () => {
    const file = `src/lib/mcp/operations/${operation}/operation.ts`
    const params = {}
    const pathname = '/mcp/' + operation.replace(/\[([^\]]+)\]/g, (_match, name) => {
      params[name] = `${name} fixture / value`
      return encodeURIComponent(params[name])
    })
    for (const method of exportedMethods(file)) {
      const request = new NextRequest('http://mcp.internal' + pathname, { method })
      const response = await executeMcpOperation(request)
      assert.equal(response.status, 200)
      assert.deepEqual(call, { file, method, params, request })
    }
  })
}
test('the operation registry rejects unknown routes and methods without loading a handler', async () => {
  await assert.rejects(executeMcpOperation(new NextRequest('http://mcp.internal/mcp/no-such-operation')), /MCP operation not found/)
  await assert.rejects(executeMcpOperation(new NextRequest('http://mcp.internal/mcp/tasks', { method: 'DELETE' })), /Method Not Allowed/)
})
