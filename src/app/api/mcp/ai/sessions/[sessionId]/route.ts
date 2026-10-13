import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { createAiSessionItemHandlers } from '@/lib/mcp/ai/sessionHandler';
import { aiSessionDependencies } from '../_dependencies';

const handlers = createAiSessionItemHandlers(aiSessionDependencies);

export const PATCH = wrapMcpRoute(handlers.PATCH);
export const DELETE = wrapMcpRoute(handlers.DELETE);
