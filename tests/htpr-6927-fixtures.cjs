const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const snapshots = require('./fixtures/mcp-6927/catalog-baseline.json')

function loader(overrides = {}, before = false) {
  const cache = new Map()
  function load(file) {
    const filename = path.resolve(root, file)
    if (filename in overrides) return overrides[filename]
    if (file in overrides) return overrides[file]
    if (cache.has(filename)) return cache.get(filename).exports
    const relative = path.relative(root, filename)
    const source = before && snapshots[relative] ? snapshots[relative] : fs.readFileSync(filename, 'utf8')
    const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, resolveJsonModule: true } }).outputText
    const loaded = { exports: {} }
    cache.set(filename, loaded)
    new Function('module', 'exports', 'require', javascript)(loaded, loaded.exports, (name) => {
      if (name in overrides) return overrides[name]
      if (name.startsWith('.') || name.startsWith('@/')) {
        const resolved = name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : path.resolve(path.dirname(filename), name)
        if (fs.existsSync(`${resolved}.ts`)) return load(`${resolved}.ts`)
        if (fs.existsSync(path.join(resolved, 'index.ts'))) return load(path.join(resolved, 'index.ts'))
        if (resolved.endsWith('.json')) return JSON.parse(fs.readFileSync(resolved, 'utf8'))
      }
      return require(name)
    })
    return loaded.exports
  }
  return load
}

function sample(schema) {
  if (schema.const !== undefined) return schema.const
  if (schema.default !== undefined) return schema.default
  if (schema.enum) return schema.enum[0]
  if (schema.anyOf || schema.oneOf) return sample((schema.anyOf ?? schema.oneOf)[0])
  if (schema.type === 'object') {
    const input = Object.fromEntries((schema.required ?? []).map((key) => [key, sample(schema.properties[key])]))
    const fields = schema.properties ?? {}
    if (fields.ticket_number && !input.task_id && !input.unique_index) input.ticket_number = fields.ticket_number.type === 'array' ? ['HTPR-1234'] : 'HTPR-1234'
    if (fields.page_id && !input.id) input.page_id = sample(fields.page_id)
    if (fields.revoke_all) input.revoke_all = true
    if (fields.task_identifier) input.task_identifier = 'HTPR-1234'
    if (fields.task) input.task = 'HTPR-1234'
    if (fields.minutes) input.minutes = 25
    if (fields.filename && fields.content_type) { input.content_type = 'text/plain'; input.data = 'Rml4dHVyZQ==' }
    return input
  }
  if (schema.type === 'array') return Array.from({ length: Math.max(schema.minItems ?? 1, 1) }, () => sample(schema.items))
  if (schema.type === 'integer' || schema.type === 'number') return Math.max(schema.minimum ?? 1, 1)
  if (schema.type === 'boolean') return false
  if (schema.format === 'email') return 'fixture@example.com'
  if (schema.format === 'uri') return 'https://example.com/source'
  if (schema.format === 'uuid') return '00000000-0000-4000-8000-000000000001'
  return 'Fixture'
}
module.exports = { root, loader, sample }
