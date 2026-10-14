import { wrapMcpRoute } from '@/lib/mcp/routeWrapper'
import { createAiSessionsCollectionHandlers } from '@/lib/mcp/ai/sessionHandler';
import { aiSessionDependencies } from './_dependencies';

const handlers = createAiSessionsCollectionHandlers(aiSessionDependencies);

export const GET = wrapMcpRoute(handlers.GET);
export const POST = wrapMcpRoute(handlers.POST);
