import { renderOnboardingEmail } from "./layout";

export function renderAgentConnectedEmail(client: string, boardId?: number): { subject: string; html: string } {
  const { subject, html } = renderOnboardingEmail({
    subject: "Your agent is connected",
    heading: "Your agent is connected",
    paragraphs: [`${client} just talked to Hypertask. Ask your agent to pick up the top task on your board.`],
    cta: {
      label: "Open your board",
      url: boardId ? `https://app.hypertask.ai/project?id=${boardId}` : "https://app.hypertask.ai",
    },
  });
  return { subject, html };
}
