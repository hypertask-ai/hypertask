import { withoutAuth } from "#with-auth";
import { createAiSessionItemHandlers } from '@/lib/mcp/ai/sessionHandler';
import { aiSessionDependencies } from '../_dependencies';

const handlers = createAiSessionItemHandlers(aiSessionDependencies);

export const PATCH = withoutAuth(handlers.PATCH);
export const DELETE = withoutAuth(handlers.DELETE);
