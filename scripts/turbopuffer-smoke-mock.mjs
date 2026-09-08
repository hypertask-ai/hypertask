import http from 'node:http'

const fixture = {
  id: String(process.env.CORE_SMOKE_TASK_ID),
  ticketNumber: 'SMOKE-1',
  title: 'Core actions smoke fixture',
  descriptionText: '',
  projectId: Number(process.env.CORE_SMOKE_PROJECT_ID),
  creatorName: process.env.CORE_SMOKE_USER_NAME,
  status: 'Normal',
  updatedAt: new Date().toISOString(),
  uniqueIndex: 1,
  projectTitle: 'Core actions smoke',
}

http.createServer((request, response) => {
  request.resume()
  const pathname = new URL(request.url ?? '/', 'http://smoke.invalid').pathname
  const isTaskQuery =
    request.method === 'POST' &&
    pathname === '/v2/namespaces/tasks/query'
  const body = isTaskQuery ? { rows: [fixture] } : { error: 'unexpected request' }
  response.writeHead(isTaskQuery ? 200 : 404, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}).listen(3200, '0.0.0.0')
