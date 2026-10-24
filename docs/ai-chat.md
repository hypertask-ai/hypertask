# AI chat history

`htpr-6971-chat-history-paging` (feature, Owner + QA) changes history loading, not the existing history menu or composer. `useSessionAndChatHistory` keeps the legacy full-session query when the flag is off or for the anonymous demo.

With the flag on, `usePagedChatHistory` owns an infinite React Query summary list (30 titles per page) and a transcript query per selected conversation. The existing menu loads another page when its end becomes visible or the user scrolls near the bottom. Reopening a conversation revalidates its transcript, including conversations updated or deleted in another tab. Sends resolve the displayed transcript, not summary recency; writes and renames promote the summary without changing selection.

The already-shipped server contract requires both the server's `htpr-6924-rest-compat` flag and `compat=htpr-6924`. A legacy list response seeds the original `chat-sessions` cache and disables client paging for that context. No new server route or authorization path is introduced. Board-scoped lookups exclude ticket conversations; task chat and Compose greetings wait for their own transcript.

Sources: `src/hooks/MultiPages/AIChat/usePagedChatHistory.ts`, `src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts`, `src/components/AI_CHAT/ChatHeader.tsx`, `src/utils/api/ai_chat/aiChatHelpers.ts`.
Regression proof: `node --test tests/htpr-6971-chat-history-paging.test.cjs`.
Ticket: https://app.hypertask.ai/detail/project-15/6971

## Ticket rows in answers

With `htpr-7683-ai-chat-ticket-rows` enabled (Everyone by default), ticket answers can show compact rows grouped under headings such as Done or New. Each row opens the ticket and shows its current status, assignee avatars and priority. Five rows appear per group; choose “+N more” to see the rest. Reopened conversations refresh the rows and omit tickets you can no longer access. Turning the flag off keeps the existing text-only answers.
