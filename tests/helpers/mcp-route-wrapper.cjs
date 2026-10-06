const { load } = require('../task-route-loader.cjs')

function loadRouteWrapper(mocks) {
  const flags = mocks['@/lib/flags'] ?? {}
  const keys = mocks['@/lib/flags/keys'] ?? {}
  const flag = 'htpr-6926-mcp-route-wrapper'
  return load('src/lib/mcp/routeWrapper.ts', {
    ...mocks,
    '@/lib/flags/keys': { ...keys, HTPR_6926_MCP_ROUTE_WRAPPER_FLAG: flag },
    '@/lib/flags': {
      ...flags,
      isFeatureEnabled: (key, ...args) => key === flag
        ? Promise.resolve(process.env.HTPR_6926_TEST_FLAG === 'on')
        : flags.isFeatureEnabled?.(key, ...args) ?? Promise.resolve(false),
    },
  })
}

module.exports = { loadRouteWrapper }
