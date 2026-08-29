import { normalizeAssistantHtml } from './normalizeAssistantHtml'

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
// stayed green. sanitizeRichHtml is server-safe but escapes the <code> inside a <pre> into
// visible text and drops task-list checkboxes, which would reintroduce the bug this fixes.
//
// So sanitizing happens inside normalizeAssistantHtml instead, at the one place this
// change actually creates exposure: markdown link syntax becoming a live anchor. Raw HTML
// the model writes is stored as-is, exactly as it was before this feature existed.
export function toStoredHtml(text: string): string {
  return normalizeAssistantHtml(text)
}
