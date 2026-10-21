import { test as base, expect } from '@playwright/test'
import { allowsRequest, selectScript } from './run.mjs'

export const test = base.extend({
  context: async ({ context }, provideContext) => {
    const entry = selectScript(process.env.LIVE_QA_TICKET, process.env.LIVE_QA_SCRIPT, process.env.LIVE_QA_EXPECTED_SHA)
    await context.route('**/*', route => {
      const request = route.request()
      return allowsRequest(request.method(), request.url(), request.postData(), entry.boardIds)
        ? route.continue()
        : route.abort('blockedbyclient')
    })
    await context.routeWebSocket('**/*', socket => socket.close())
    await provideContext(context)
  },
})

export { expect }
