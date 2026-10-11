import { renderOnboardingEmail } from "./layout";

export function renderAgentFirstTaskEmail(input: {
  agentName: string;
  taskTitle: string;
  boardName: string;
  projectId: number;
  uniqueIndex: number;
}): { subject: string; html: string } {
  const { subject, html } = renderOnboardingEmail({
    subject: "Your agent just finished its first task",
    heading: "Your agent just finished its first task",
    paragraphs: [
      `${input.agentName} completed '${input.taskTitle}' on ${input.boardName}.`,
      "Hypertask works best when your team and your agents share the board.",
    ],
    cta: {
      label: "Review the work",
      url: `https://app.hypertask.ai/detail/project-${input.projectId}/${input.uniqueIndex}`,
    },
    secondaryCta: {
      label: "Invite a teammate",
      url: `https://app.hypertask.ai/project?id=${input.projectId}&invite=1`,
    },
  });
  return { subject, html };
}
