import { normalizeBlockHtml } from '@/lib/mcp/normalizeBlockHtml'
import { normalizeAssistantHtml } from './normalizeAssistantHtml'
import { sanitizeRichHtml } from './sanitizeRichHtml'

// Every rich-text value the AI chat persists (comments, drafts, task descriptions) goes
// through here first. Asking the model for HTML is not enough: it drifts back to markdown
// mid-answer and the raw asterisks end up in the comment (HTPR-4687), so the conversion is
// forced rather than requested.
//
// NOTHING here may pull in a browser-only dependency. This module is imported by
// src/app/api/ai/chat/stream/route.ts, a `runtime = "nodejs"` serverless function. An
// earlier version called sanitizeAiHtml, which reaches isomorphic-dompurify and jsdom;
// that had only ever been imported client-side, and it killed the chat route at module
// load in production while every local check (tsc, unit tests under jiti, the build)
// stayed green. sanitizeRichHtml is server-safe and keeps the editor's code-block and
// task-list structures while stripping executable markup from model output.
export function toStoredHtml(text: string): string {
  return sanitizeRichHtml(normalizeBlockHtml(normalizeAssistantHtml(text)))
}
