const { withStubs } = require('./stub-map.cjs')
const { load } = require('../task-route-loader.cjs')

function loadRouteWrapper(mocks) {
  return load('src/lib/mcp/routeWrapper.ts', withStubs({
    './operationCrashReport': { reportUnexplainedMcpServerError: () => {} },
  }, mocks))
}

module.exports = { loadRouteWrapper }
