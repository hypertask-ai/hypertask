import prisma from '@/lib/prisma'
import { decryptSecret } from '@/lib/crypto/byokCipher'
import { postSlackMessage } from '@/lib/slack/api'

const FEEDBACK_PROJECT_ID = 15
const FEEDBACK_LABEL = 'ai-feedback'
const KINDS = 'bug|friction|missing|idea'
const KIND_PREFIX = new RegExp(`^\\s*Agent feedback,\\s*(${KINDS})\\s*:\\s*`, 'i')

function mrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function feedbackLine(title: string, url: string): string {
  const kind = title.match(KIND_PREFIX)?.[1].toLowerCase() ?? 'feedback'
  const summary = title.replace(KIND_PREFIX, '').trim() || title.trim()
  return `*${kind}* · ${mrkdwn(summary)} · ${url}`
}

export function feedbackTicketUrl(uniqueIndex: number): string {
  return `https://app.hypertask.ai/detail/project-${FEEDBACK_PROJECT_ID}/${uniqueIndex}`
}

export async function announceFeedbackTicket(input: {
  projectId: number
  labelIds?: (string | number)[]
  uniqueIndex: number
  title: string
}): Promise<void> {
  if (input.projectId !== FEEDBACK_PROJECT_ID || !input.labelIds?.length) return
  const channelId = process.env.SLACK_FEEDBACK_CHANNEL_ID?.trim()
  if (!channelId) return
  const label = await prisma.label.findFirst({
    where: { projectId: FEEDBACK_PROJECT_ID, value: FEEDBACK_LABEL, id: { in: input.labelIds.map(String) } },
    select: { id: true },
  })
  if (!label) return
  const install = await prisma.slackInstall.findFirst({
    where: { team: { projects: { some: { id: FEEDBACK_PROJECT_ID } } } },
    orderBy: { updatedAt: 'desc' },
    select: { encryptedBotToken: true },
  })
  if (!install) return
  await postSlackMessage(decryptSecret(install.encryptedBotToken), channelId, [
    { type: 'section', text: { type: 'mrkdwn', text: feedbackLine(input.title, feedbackTicketUrl(input.uniqueIndex)) } },
  ])
}
