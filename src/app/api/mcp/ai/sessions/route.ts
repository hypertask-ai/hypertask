import { createAiSessionsCollectionHandlers } from '@/lib/mcp/ai/sessionHandler';
import { aiSessionDependencies } from './_dependencies';

const handlers = createAiSessionsCollectionHandlers(aiSessionDependencies);

export const GET = handlers.GET;
export const POST = handlers.POST;
