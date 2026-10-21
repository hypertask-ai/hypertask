import { featureFlagsForUser } from '@/lib/flags'
import { FEATURE_FLAG_DEFINITIONS } from '@/lib/flags/definitions'

const FEATURE_DESTINATIONS: Record<string, { name: string; url: string }> = {
  'htpr-7092-decisions': { name: 'Decisions', url: 'https://app.hypertask.ai/inbox?split=Decisions' },
  'htpr-7064-inbox-remind-returns': { name: 'Inbox reminders', url: 'https://app.hypertask.ai/inbox' },
  'htpr-6422-my-tasks-views': { name: 'My Tasks views', url: 'https://app.hypertask.ai/my-tasks' },
  'htpr-6457-my-tasks-scopes': { name: 'My Tasks scope', url: 'https://app.hypertask.ai/my-tasks' },
  'htpr-6461-my-tasks-snooze': { name: 'My Tasks snooze', url: 'https://app.hypertask.ai/my-tasks' },
  'htpr-6688-search-autocomplete': { name: 'Search suggestions', url: 'https://app.hypertask.ai/search' },
}

export const DECISIONS_GUIDANCE = 'For a person to decide, add a ticket comment with a line starting Question: and @mention that person using a real mention, not just their name. The mention notification appears in their Inbox; when Decisions is enabled for them and the notification is visible, the unanswered ticket appears in Inbox, split Decisions: https://app.hypertask.ai/inbox?split=Decisions. A later non-agent comment by that person on the ticket removes it from Decisions. Ordinary mentions are not Decisions. Structured decision records are separate; creating one alone does not create this Question: + @mention workflow. Use a comment, not a page, to request a decision.'

export async function getFeatureCatalog(userId: number) {
  const availability = await featureFlagsForUser(userId)
  return FEATURE_FLAG_DEFINITIONS.flatMap(({ key, description }) => {
    const destination = Object.hasOwn(FEATURE_DESTINATIONS, key) ? FEATURE_DESTINATIONS[key] : undefined
    if (!destination || !availability[key]) return []
    return [{ key, description, available: true as const, ...destination }]
  })
}

export async function getFeaturePageWarnings(title: string, userId: number) {
  const normalizedTitle = title.trim().replace(/\s+/g, ' ').toLowerCase()
  const destinations = [
    { name: 'Inbox', url: 'https://app.hypertask.ai/inbox', titles: ['inbox'] },
    { name: 'My Tasks', url: 'https://app.hypertask.ai/my-tasks', titles: ['my tasks'] },
    { name: 'Search', url: 'https://app.hypertask.ai/search', titles: ['search'] },
    { name: 'Reports', url: 'https://app.hypertask.ai/report', titles: ['reports', 'dashboard'] },
  ]
  let destination: { name: string; url: string } | undefined = destinations.find(({ titles }) => titles.includes(normalizedTitle))
  if (!destination && normalizedTitle === 'decisions') {
    destination = (await getFeatureCatalog(userId)).find(({ name }) => name === 'Decisions')
  }
  return destination ? [{
    code: 'existing_feature',
    message: `Page created. ${destination.name} already exists at ${destination.url}; use the existing feature rather than recreating it on a page.${destination.name === 'Decisions' ? ` ${DECISIONS_GUIDANCE}` : ''}`,
    url: destination.url,
  }] : []
}
