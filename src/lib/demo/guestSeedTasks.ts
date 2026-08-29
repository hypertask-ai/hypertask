/**
 * The selling-point tasks seeded onto a fresh guest's skeleton board.
 * Shared between the server (provisionGuest seeds them) and the client
 * (isGuestBoardBuild must still treat a board holding only these as "empty",
 * so the AI chat keeps offering to build the real board).
 */
export const GUEST_SEED_TASKS = [
  {
    title: "Press Ctrl+K: every action is one keystroke away",
    description:
      "<p>Navigate with <strong>J</strong> and <strong>K</strong>, open with <strong>Enter</strong>, archive with <strong>E</strong>. The board keeps up with how fast you think. Try it on this task.</p>",
  },
  {
    title: "Ask the AI to build this board for you",
    description:
      "<p>The chat on the right turns one sentence about your work into a full board. <strong>Ctrl+J</strong> writes complete tickets from a one-line prompt, and your coding agents can work this board too (MCP, CLI, API).</p>",
  },
] as const;

export const GUEST_SEED_TASKS_IN_PROGRESS = [
  {
    title: "Hypertask CLI",
    description:
      '<p>Your <strong>coding agents</strong> and terminal can work this board directly with the Hypertask CLI.</p><pre><code>npm install -g @hypertask/hypertask_cli</code></pre><p>Use it to <strong>create and move tasks</strong>, comment, search, and manage boards from scripts and CI.</p><p>See the <a href="https://docs.hypertask.ai/cli/reference/">CLI reference</a> and <a href="https://docs.hypertask.ai">help center</a>.</p>',
  },
  {
    title: "Hypertask MCP",
    description:
      '<p>Any <strong>MCP client</strong>, including Claude, Cursor, and ChatGPT, can operate this board as an autonomous worker.</p><pre><code>claude mcp add --transport http hypertask https://mcp.hypertask.ai/mcp</code></pre><p>Other clients can connect through the <a href="https://mcp.hypertask.ai/sse">SSE endpoint</a>.</p><p>See the <a href="https://docs.hypertask.ai/mcp/overview/">MCP docs</a>.</p>',
  },
] as const;

export const GUEST_SEED_TASK_TITLES: readonly string[] = [
  ...GUEST_SEED_TASKS,
  ...GUEST_SEED_TASKS_IN_PROGRESS,
].map((task) => task.title);
