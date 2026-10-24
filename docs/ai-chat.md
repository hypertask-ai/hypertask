# AI settings changes

Ticket: https://app.hypertask.ai/detail/project-15/7622

`htpr-7622-ai-settings` starts at Owner + QA because it includes access changes. With it on, the existing chat works beside Settings on desktop and in its existing phone sheet. Ctrl+J opens that chat while Settings is open; phones reuse the existing AI button.

Open Appearance to ask for a theme, Notifications to change one category's email or push preference, or Board → Members to change an accepted human member's board role. Team → Members also supports the selected board's roles. Read the single From/To card, then Apply or Cancel. Applied changes offer Undo for 15 minutes. The board owner is the only person who can change roles, exactly as with the existing manual app action. Neither AI nor an agent receives extra permission.

The AI's settings tool only reads, proposes, or opens a settings page. The model cannot apply changes, and Settings-scoped turns do not expose other mutation tools. Server-owned proposals are bound to the person's account and private chat. Apply and Undo require a human session, a same-origin browser request, the original page/board, current permissions and an unchanged original value. Cancel is safe from any page. A stale or expired card asks for a fresh proposal instead of overwriting a later choice.

Master email/device push switches, billing, deletion, keys, invitations and all other settings stay manual: the AI explains the location and opens the exact settings section. This is the page-by-page path, not a team-scoped management key.

Implementation: `src/lib/ai/tools/settings.ts`, `src/lib/ai/settings/`, `src/app/api/ai/settings/route.ts`, `src/components/AI_CHAT/AiSettingChangeCard.tsx`.
Regression coverage: `tests/htpr-7622-ai-settings.test.cjs` (permission refusals and still-allowed callers, confirmation, Undo, stale values, isolation, notification preservation, flag-off behavior, tool isolation and persisted cards). Run through normal GitHub CI; no suite was executed on the VPS for this change.

# AI chat history

`htpr-6971-chat-history-paging` (feature, Owner + QA) changes history loading, not the existing history menu or composer. `useSessionAndChatHistory` keeps the legacy full-session query when the flag is off or for the anonymous demo.

With the flag on, `usePagedChatHistory` owns an infinite React Query summary list (30 titles per page) and a transcript query per selected conversation. The existing menu loads another page when its end becomes visible or the user scrolls near the bottom. Reopening a conversation revalidates its transcript, including conversations updated or deleted in another tab. Sends resolve the displayed transcript, not summary recency; writes and renames promote the summary without changing selection.

The already-shipped server contract requires both the server's `htpr-6924-rest-compat` flag and `compat=htpr-6924`. A legacy list response seeds the original `chat-sessions` cache and disables client paging for that context. No new server route or authorization path is introduced. Board-scoped lookups exclude ticket conversations; task chat and Compose greetings wait for their own transcript.

Sources: `src/hooks/MultiPages/AIChat/usePagedChatHistory.ts`, `src/hooks/MultiPages/AIChat/useSessionAndChatHistory.ts`, `src/components/AI_CHAT/ChatHeader.tsx`, `src/utils/api/ai_chat/aiChatHelpers.ts`.
Regression proof: `node --test tests/htpr-6971-chat-history-paging.test.cjs`.
Ticket: https://app.hypertask.ai/detail/project-15/6971
