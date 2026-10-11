/** Client-safe keys. The server-only flags API reaches auth and Node sockets. */
export * from "./definitions/index.generated";

/** Sent on chat.message when HTPR-6407 is on so agent replies lead with the next action. */
export const AGENT_CHAT_ADHD_REPLY_GUIDANCE =
  "Lead with the next action. Keep replies short. Number steps. End with one concrete next action when something remains open.";
