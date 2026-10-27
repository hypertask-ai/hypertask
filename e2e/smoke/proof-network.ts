import { test as base, type Response, type Request } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
export * from '@playwright/test'

export const test = base.extend<{ proofNetwork: void }>({
  proofNetwork: [async ({ context }, run, testInfo) => {
    const entries: object[] = []
    const record = (request: Request, status: number, statusText: string, failure?: string) => {
      const observed = new Date().toISOString()
      const url = new URL(request.url())
      url.search = ''
      url.hash = ''
      const timing = request.timing()
      const start = timing.startTime > 0 ? timing.startTime : Date.now()
      const wait = timing.responseStart >= 0 && timing.requestStart >= 0 ? Math.max(0, timing.responseStart - timing.requestStart) : 0
      entries.push({
        startedDateTime: new Date(start).toISOString(), time: Math.max(0, Date.now() - start),
        request: { method: request.method(), url: url.href, httpVersion: 'HTTP/1.1', cookies: [], headers: [], queryString: [], headersSize: -1, bodySize: -1 },
        response: { status, statusText, httpVersion: 'HTTP/1.1', cookies: [], headers: [], content: { size: 0, mimeType: '' }, redirectURL: '', headersSize: -1, bodySize: -1 },
        cache: {}, timings: { send: 0, wait, receive: 0 },
        _observedAt: observed, _resourceType: request.resourceType(), ...(failure ? { _failure: failure } : {}),
        _redaction: 'Metadata only: authentication, cookies, all query values and request/response bodies omitted. Transfer timing not captured.',
      })
      if (status < 200 || status >= 300) console.log(`[proof http] ${observed} ${request.method()} ${url.pathname} status=${status}${failure ? ` failure=${failure}` : ''}`)
    }
    const response = (value: Response) => record(value.request(), value.status(), value.statusText())
    const failed = (value: Request) => record(value, 0, '', value.failure()?.errorText?.match(/(?:net::)?ERR_[A-Z_]+/)?.[0] ?? 'network failure')
    context.on('response', response)
    context.on('requestfailed', failed)
    try { await run() } finally {
      context.off('response', response)
      context.off('requestfailed', failed)
      const root = process.env.PROOF_NETWORK_DIR
      if (!root) throw new Error('PROOF_NETWORK_DIR is required for hosted proof')
      await mkdir(root, { recursive: true })
      const id = createHash('sha256').update(JSON.stringify([testInfo.titlePath, testInfo.project.name, testInfo.retry, process.pid, Date.now()])).digest('hex').slice(0, 24)
      await writeFile(path.join(root, `${id}.har`), JSON.stringify({ log: {
        version: '1.2', creator: { name: 'YPER4-826 metadata-only browser observer', version: '1' }, pages: [], entries,
        _proof: { title: testInfo.title, project: testInfo.project.name, retry: testInfo.retry, status: testInfo.status, expectedStatus: testInfo.expectedStatus, file: path.basename(testInfo.file), case: process.env.PROOF_CASE },
      } }, null, 2))
    }
  }, { auto: true }],
})
