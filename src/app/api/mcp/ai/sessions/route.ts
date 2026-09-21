import { withoutAuth } from "#with-auth";
import { createAiSessionsCollectionHandlers } from '@/lib/mcp/ai/sessionHandler';
import { aiSessionDependencies } from './_dependencies';

const handlers = createAiSessionsCollectionHandlers(aiSessionDependencies);

export const GET = withoutAuth(handlers.GET);
export const POST = withoutAuth(handlers.POST);
