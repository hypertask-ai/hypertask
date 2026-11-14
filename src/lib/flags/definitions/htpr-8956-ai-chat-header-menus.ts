import type { FeatureFlagDefinition } from "../definitions";

export const HTPR_8956_AI_CHAT_HEADER_MENUS_FLAG = "htpr-8956-ai-chat-header-menus";

export default {
  key: HTPR_8956_AI_CHAT_HEADER_MENUS_FLAG,
  kind: "improvement",
  defaultMode: "OWNER_AND_QA",
  shippedOn: "2026-11-09",
  description: "The AI chat header title and chevron form one button that opens a searchable chat history grouped by Today, Previous 7 days and Older, the clock icon is gone, and the three-dot menu lists one line per item with a Pin chat open and Keep chat closed pair.",
  releaseRisk: {
    risk: "small",
    reason: "Only changes how the AI chat header and its menus look and where history opens. Chats, saved settings and shortcuts stay the same, and Off restores the previous header.",
  },
} as const satisfies FeatureFlagDefinition;
