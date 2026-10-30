const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const source = fs.readFileSync(
  path.join(__dirname, '../../src/lib/mcp/comments/visibleReactionAgents.ts'),
  'utf8'
)
const javascript = ts.transpileModule(source, {
  compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText

function loadVisibleReactionAgentsModule(requireStub) {
  const loaded = { exports: {} }
  new Function('module', 'exports', 'require', javascript)(loaded, loaded.exports, requireStub)
  return loaded.exports
}

module.exports = { loadVisibleReactionAgentsModule }
