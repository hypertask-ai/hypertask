import { appendFileSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const ticketPattern = /^(HTPR|HYFA|YPER4)-[1-9][0-9]*$/
export const themes = ['porcelain', 'graphite', 'amoled', 'dia']
export const viewports = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } }

export function selectWireframe(ticket, input, directory = root) {
  if (typeof ticket !== 'string' || ticket !== ticket.trim() || !ticketPattern.test(ticket) || input !== `docs/wireframes/${ticket}/index.html`) throw new Error('Invalid wireframe')
  const manifest = JSON.parse(readFileSync(path.join(directory, 'scripts/wireframe-capture-allowed.json'), 'utf8'))
  if (!Object.hasOwn(manifest, input) || manifest[input].ticket !== ticket) throw new Error('Wireframe not approved')
  const boundary = path.join(realpathSync(directory), 'docs/wireframes') + path.sep
  const file = realpathSync(path.join(directory, input))
  if (!file.startsWith(boundary) || !statSync(file).isFile()) throw new Error('Wireframe escaped its directory')
  return { ticket, file, directory: path.dirname(file) }
}

export function staticFile(directory, pathname) {
  const decoded = decodeURIComponent(pathname)
  if (!decoded.startsWith('/') || decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').includes('..')) throw new Error('Invalid static path')
  const resolved = realpathSync(path.join(directory, decoded === '/' ? 'index.html' : decoded.slice(1)))
  if (!resolved.startsWith(directory + path.sep) || !statSync(resolved).isFile() || statSync(resolved).size > 10 * 1024 * 1024) throw new Error('Static path refused')
  return resolved
}

function entries() {
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') return [selectWireframe(process.env.WIREFRAME_TICKET, process.env.WIREFRAME_PATH)]
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request' || !/^[a-f0-9]{40}$/.test(process.env.WIREFRAME_BASE_SHA || '')) throw new Error('Invalid capture event')
  const manifest = JSON.parse(readFileSync(path.join(root, 'scripts/wireframe-capture-allowed.json'), 'utf8'))
  const diff = spawnSync('git', ['diff', '--name-only', '-z', '--diff-filter=ACMRT', process.env.WIREFRAME_BASE_SHA, 'HEAD'], { cwd: root, shell: false, encoding: 'utf8', maxBuffer: 1024 * 1024 })
  if (diff.error || diff.status !== 0) throw new Error('Changed wireframes unavailable')
  const changed = diff.stdout.split('\0').filter(Boolean)
  const captureAll = changed.some(file => ['scripts/wireframe-capture.mjs', 'scripts/wireframe-capture-allowed.json', '.github/workflows/wireframe-capture.yml'].includes(file))
  const tickets = new Set(changed.map(file => file.match(/^docs\/wireframes\/((?:HTPR|HYFA|YPER4)-[1-9][0-9]*)\//)?.[1]).filter(Boolean))
  const inputs = new Set(captureAll ? Object.keys(manifest) : [])
  for (const ticket of tickets) inputs.add(`docs/wireframes/${ticket}/index.html`)
  if (inputs.size > 10) throw new Error('Too many wireframes')
  return [...inputs].map(input => selectWireframe(manifest[input]?.ticket, input))
}

async function capture(entry, output, chromium) {
  const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2' }
  const server = createServer((request, response) => {
    try {
      if (request.method !== 'GET') throw new Error('Read-only server')
      const file = staticFile(entry.directory, new URL(request.url, 'http://127.0.0.1').pathname)
      const type = mime[path.extname(file)]
      if (!type) throw new Error('Unsupported asset')
      response.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' })
      response.end(readFileSync(file))
    } catch {
      response.writeHead(404)
      response.end()
    }
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  let browser
  try {
    const origin = `http://127.0.0.1:${server.address().port}`
    browser = await chromium.launch({ headless: true })
    for (const [viewportName, viewport] of Object.entries(viewports)) {
      for (const theme of themes) {
        const context = await browser.newContext({ viewport, serviceWorkers: 'block', acceptDownloads: false, colorScheme: ['porcelain', 'dia'].includes(theme) ? 'light' : 'dark' })
        try {
          let refused = false
          await context.route('**/*', route => {
            const request = route.request()
            if (request.method() === 'GET' && new URL(request.url()).origin === origin) return route.continue()
            refused = true
            return route.abort('blockedbyclient')
          })
          await context.routeWebSocket('**/*', socket => { refused = true; socket.close() })
          await context.addCookies([{ name: 'theme', value: theme, url: origin }])
          const page = await context.newPage()
          const response = await page.goto(`${origin}/index.html?theme=${theme}`, { waitUntil: 'networkidle', timeout: 20_000 })
          if (!response?.ok()) throw new Error('Wireframe unavailable')
          await page.evaluate(theme => {
            const element = document.documentElement
            element.classList.remove('light', 'dark', 'porcelain', 'graphite', 'amoled', 'dia')
            element.classList.add(['porcelain', 'dia'].includes(theme) ? 'light' : 'dark', theme)
            element.dataset.theme = theme
          }, theme)
          await page.evaluate(() => document.fonts.ready)
          const png = await page.screenshot({ path: path.join(output, `${entry.ticket}-${theme}-${viewportName}.png`), animations: 'disabled' })
          if (refused || png.length >= 3 * 1024 * 1024) throw new Error('Wireframe network or image budget refused')
        } finally {
          await context.close()
        }
      }
    }
  } finally {
    await browser?.close()
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}

async function main() {
  const selected = entries()
  const output = path.join(process.env.RUNNER_TEMP, 'wireframe-captures')
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  try {
    if (selected.length) {
      const { chromium } = await import('@playwright/test')
      for (const entry of selected) await capture(entry, output, chromium)
    }
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `captured=${selected.length > 0}\n`)
    process.stdout.write(selected.length ? 'Wireframe capture complete\n' : 'No allowlisted wireframes changed\n')
  } catch {
    rmSync(output, { recursive: true, force: true })
    throw new Error('Wireframe capture failed')
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    process.stderr.write('FAIL: static wireframe selection or capture failed\n')
    process.exitCode = 1
  })
}
