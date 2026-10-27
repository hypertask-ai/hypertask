# AI chat history

`htpr-6971-chat-history-paging` (feature, Owner + QA) changes history loading, not the existing history menu or composer. `useSessionAndChatHistory` keeps the legacy full-session query when the flag is off or for the anonymous demo.

With the flag on, `usePagedChatHistory` owns an infinite React Query summary list (30 titles per page) and a transcript query per selected conversation. The existing menu loads another page when its end becomes visible or the user scrolls near the bottom. Reopening a conversation revalidates its transcript, including conversations updated or deleted in another tab. Sends resolve the displayed transcript, not summary recency; writes and renames promote the summary without changing selection.

The already-shipped server contract requires `compat=htpr-6924`; the REST compatibility flag it once needed was removed and is permanently on. A legacy list response seeds the original `chat-sessions` cache and disables client paging for that context. No new server route or authorization path is introduced. Board-scoped lookups exclude ticket conversations; task chat and Compose greetings wait for their own transcript.

Sources: `src/hooks/MultiPages/AIChat/usePagedChatHistory.ts`, `src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts`, `src/components/AI_CHAT/ChatHeader.tsx`, `src/utils/api/ai_chat/aiChatHelpers.ts`.
Regression proof: `node --test tests/htpr-6971-chat-history-paging.test.cjs`.
Ticket: https://app.hypertask.ai/detail/project-15/6971

## Skills from ticket comments

With `htpr-7800-skill-runs-in-sidebar` on (Everyone by default), picking a slash skill in a new or edited ticket comment opens the existing AI chat sidebar, docked on desktop, and runs it in a fresh conversation. The run includes the current comment draft and the ticket description and existing comments; the result appears in chat, without posting or replacing the comment draft. Turning the flag off restores the previous skill writer window.
