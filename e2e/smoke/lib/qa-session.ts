import { request } from '@playwright/test'
import { chmodSync, mkdirSync } from 'node:fs'
import path from 'node:path'

export async function renewQaSession(baseURL: string, storageState: string) {
  const email = process.env.QA_LOGIN_EMAIL
  const password = process.env.QA_LOGIN_PASSWORD
  if (!email || !password) throw new Error('QA login credentials are missing')
  // No saved cookies: this flow can only issue the server-pinned QA identity.
  const context = await request.newContext({ baseURL })
  try {
    const login = await context.post('/api/auth/qa-login', { data: { email, password }, timeout: 20_000 })
    if (!login.ok()) throw new Error(`QA login renewal returned HTTP ${login.status()}`)
    const identity = await context.get('/api/users/getById', { timeout: 20_000 })
    if (identity.status() !== 200 || (await identity.json())?.id !== 985) {
      throw new Error('QA login renewal did not authenticate QA user 985')
    }
    mkdirSync(path.dirname(storageState), { recursive: true, mode: 0o700 })
    await context.storageState({ path: storageState })
    chmodSync(storageState, 0o600)
  } finally {
    await context.dispose()
  }
}
