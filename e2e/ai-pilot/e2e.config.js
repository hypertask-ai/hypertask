import { web } from '@e2e-dev/web'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { appendFileSync } from 'node:fs'

const baseURL = 'http://127.0.0.1:3100'
const recording = process.env.PILOT_RECORD === '1'
if (recording && !process.env.OPENCODE_API_KEY) throw new Error('Recording requires OPENCODE_API_KEY')

const provider = recording && createOpenAICompatible({
  name: 'opencode-go',
  baseURL: 'https://opencode.ai/inference/go/v1',
  headers: { 'User-Agent': 'hypertask-e2e-pilot/1.0', 'x-opencode-session': process.env.PILOT_SESSION_ID },
  apiKey: process.env.OPENCODE_API_KEY,
  fetch: async (...args) => {
    const start = Date.now()
    try {
      const response = await fetch(...args)
      appendFileSync(process.env.PILOT_REQUEST_LOG, JSON.stringify({ durationMs: Date.now() - start, status: response.status }) + '\n')
      return response
    } catch (error) {
      appendFileSync(process.env.PILOT_REQUEST_LOG, JSON.stringify({ durationMs: Date.now() - start, status: 0 }) + '\n')
      throw error
    }
  },
})

export default {
  projectId: 'hypertask-ai-pilot',
  tests: 'tests/**/*.e2e.js',
  targets: [{ name: 'chromium', engine: web({ browser: 'chromium', viewport: { width: 1440, height: 900 } }), app: { url: baseURL, identity: 'hypertask-smoke-fixture' } }],
  agents: { default: { model: recording ? provider.chatModel('deepseek-v4.1-flash') : { specificationVersion: 'v4', provider: 'replay-only', modelId: 'forbidden', supportedUrls: {}, doGenerate() { throw new Error('Model calls forbidden during replay') }, doStream() { throw new Error('Model calls forbidden during replay') } } } },
  cache: { mode: recording ? 'read-write' : 'read-only', dir: '.e2e/cache', strict: !recording },
  workers: 1,
  retries: 0,
  trace: 'off',
  video: 'off',
}
