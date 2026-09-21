import { createAiSessionItemHandlers } from '@/lib/mcp/ai/sessionHandler';
import { aiSessionDependencies } from '../_dependencies';

const handlers = createAiSessionItemHandlers(aiSessionDependencies);

export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
