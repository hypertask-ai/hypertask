import { AsyncLocalStorage } from 'node:async_hooks'
import type { McpAuthContext } from './auth/types'

type ExecutionContext = { token: string; auth: McpAuthContext }
type OperationContext = { auth: McpAuthContext; rateLimitChecked: boolean }

const executionContext = new AsyncLocalStorage<ExecutionContext>()
const operationContexts = new WeakMap<Request, OperationContext>()

export function withMcpExecutionContext<T>(
  token: string,
  auth: McpAuthContext | undefined,
  execute: () => T,
): T {
  return auth ? executionContext.run({ token, auth }, execute) : execute()
}

export function getMcpExecutionContext(token: string): McpAuthContext | undefined {
  const context = executionContext.getStore()
  return context?.token === token ? context.auth : undefined
}

// Only in-process requests receive this binding. HTTP headers cannot supply it.
export function bindMcpOperationContext(
  request: Request,
  auth: McpAuthContext,
  rateLimitChecked: boolean,
): void {
  operationContexts.set(request, { auth, rateLimitChecked })
}

export function getMcpOperationContext(request: Request): OperationContext | undefined {
  return operationContexts.get(request)
}
