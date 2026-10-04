const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const cp = require('node:child_process')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const git = (...args) => cp.execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
const base = git('merge-base', 'HEAD', 'origin/production').trim()
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')
function files(dir) {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = path.posix.join(dir, entry.name)
    return entry.isDirectory() ? files(file) : [file]
  })
}
const routes = files('src/app/api/mcp').filter((file) => file.endsWith('/route.ts'))
const relocations = new Map()
for (const route of routes) {
  const match = read(route).match(/from ['"](@\/lib\/mcp\/operations\/[^'"]+)['"]/)
  if (match) relocations.set(route, 'src/' + match[1].slice(2) + '.ts')
}
relocations.set('src/app/api/mcp/time/_lib.ts', 'src/lib/mcp/operations/time/helpers.ts')
relocations.set('src/app/api/mcp/pages/_lib/routeUtils.ts', 'src/lib/mcp/operations/pages/helpers.ts')
assert.ok(relocations.size > 0)
function canonical(source, filename) {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true)
  const replacements = []
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue
    const specifier = statement.moduleSpecifier
    if (!specifier || !ts.isStringLiteral(specifier)) continue
    let target = specifier.text
    if (target.startsWith('.')) target = path.posix.normalize(path.posix.join(path.posix.dirname(filename), target)) + '.ts'
    else if (target.startsWith('@/')) target = 'src/' + target.slice(2) + '.ts'
    else continue
    target = relocations.get(target) ?? target
    replacements.push({ start: specifier.getStart(sf), end: specifier.end, text: JSON.stringify(target) })
  }
  for (const edit of replacements.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end)
  return source.replaceAll('\u2014', '-').replace(/[ \t]+$/gm, '')
}
for (const [route, operation] of relocations) {
  assert.equal(canonical(read(operation), operation), canonical(git('show', `${base}:${route}`), route), `Business logic changed during relocation: ${route}`)
  if (!route.endsWith('/route.ts')) continue
  const wrapper = read(route)
  const original = git('show', `${base}:${route}`)
  const methods = [...original.matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((match) => match[1])
  if (/export const \{ GET \}/.test(original)) methods.push('GET')
  for (const method of methods) {
    assert.match(wrapper, new RegExp(`${method} as execute${method}`))
    assert.match(wrapper, new RegExp(`(?:export const ${method} = execute${method}|export const \\{ ${method} \\} = \\{ ${method}: execute${method} \\})`))
  }
  for (const config of original.matchAll(/export const (runtime|dynamic|maxDuration|revalidate|preferredRegion)\s*=\s*([^\n]+)/g)) {
    assert.ok(wrapper.includes(config[0]), `Route config changed: ${route}`)
  }
}
const forbiddenNetworkClient = (source) => /(?:from\s*['"]axios['"]|\bcreateApiClient\b|\bfetch\s*\(|\bhttps?\.request\s*\()/.test(source)
assert.equal(forbiddenNetworkClient("import axios from 'axios'"), true, 'Negative-check positive control failed')
assert.equal(forbiddenNetworkClient('fetch("https://app.hypertask.ai/api/mcp/tasks")'), true, 'Fetch positive control failed')
for (const file of files('src/lib/mcp-server').filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))) {
  assert.equal(forbiddenNetworkClient(read(file)), false, `Network client remains in the tool path: ${file}`)
}
assert.equal(fs.existsSync(path.join(root, 'src/lib/mcp-server/lib/api-client.ts')), false)
assert.match(read('src/lib/mcp-server/utils/executeWithService.ts'), /createInProcessMcpClient/)
for (const file of ['src/lib/flags.ts', 'src/lib/flags/keys.ts', 'src/lib/mcp-server/consolidated-tools.ts', 'package.json', 'package-lock.json']) {
  assert.equal(read(file), git('show', `${base}:${file}`), `Out-of-slice behavior or dependencies changed: ${file}`)
}
const changed = git('diff', '--name-only', base, '--').trim().split('\n').filter(Boolean)
const untracked = git('ls-files', '--others', '--exclude-standard').trim().split('\n').filter((file) => file && !file.startsWith('.htpr-6478-') && file !== '.mcp-route-inventory.txt')
for (const file of new Set([...changed, ...untracked])) {
  assert.ok(/^(?:src\/lib\/mcp(?:-server)?\/|src\/app\/api\/mcp\/|tests\/|evals\/mcp-client\/lib\/production\.cjs$|docs\/htpr-6478-slices\.md$|GATES\.md$)/.test(file), `Unexpected changed file: ${file}`)
}
const added = git('diff', '--unified=0', base, '--').split('\n').filter((line) => line.startsWith('+') && !line.startsWith('+++'))
assert.equal(added.some((line) => line.includes('\u2014')), false, 'Added em dash')
const doc = read('docs/htpr-6478-slices.md')
assert.match(doc, /Section 1: shared execution done; validation consolidation remaining/)
assert.match(doc, /absolute single-layer validation is not/)
for (const section of [2, 3, 4, 5, 6]) assert.match(doc, new RegExp(`Section ${section}: remaining`))
assert.match(doc, /legacy.*still needed/i)
assert.match(doc, /\[REFACTOR\]/)
console.log(`slice scope passed: ${relocations.size - 2} REST operation modules and 2 helpers preserve their original business logic; ${new Set([...changed, ...untracked]).size} changed files; section 4 deferred.`)
