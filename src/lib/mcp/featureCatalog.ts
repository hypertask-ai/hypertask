import { featureFlagsForUser } from '@/lib/flags'
import { FEATURE_FLAG_DEFINITIONS } from '@/lib/flags/definitions'

const FEATURE_DESTINATIONS: Record<string, { name: string; url: string }> = {
  'htpr-7092-decisions': { name: 'Decisions', url: 'https://app.hypertask.ai/inbox?split=Decisions' },
  'htpr-6422-my-tasks-views': { name: 'My Tasks views', url: 'https://app.hypertask.ai/my-tasks' },
  'htpr-6457-my-tasks-scopes': { name: 'My Tasks scope', url: 'https://app.hypertask.ai/my-tasks' },
  'htpr-6461-my-tasks-snooze': { name: 'My Tasks snooze', url: 'https://app.hypertask.ai/my-tasks' },
  'htpr-6688-search-autocomplete': { name: 'Search suggestions', url: 'https://app.hypertask.ai/search' },
}

export const DECISIONS_GUIDANCE = 'For a person to decide, add a ticket comment with a line starting Question: and @mention that person using a real mention, not just their name. The mention notification appears in their Inbox; when Decisions is enabled for them and the notification is visible, the unanswered ticket appears in Inbox, split Decisions: https://app.hypertask.ai/inbox?split=Decisions. A later non-agent comment by that person on the ticket removes it from Decisions. Ordinary mentions are not Decisions. Structured decision records are separate; creating one alone does not create this Question: + @mention workflow. Use a comment, not a page, to request a decision.'

const CORE_DESTINATIONS = [
  { key: 'core-inbox', name: 'Inbox', url: 'https://app.hypertask.ai/inbox', description: 'Read and manage your notifications.' },
  { key: 'core-decisions', name: 'Decisions', url: 'https://app.hypertask.ai/inbox?split=Decisions', description: 'Find tickets waiting on your answer to a Question: mention.' },
  { key: 'core-my-tasks', name: 'My Tasks', url: 'https://app.hypertask.ai/my-tasks', description: 'See and organize tasks assigned to you.' },
  { key: 'core-search', name: 'Search', url: 'https://app.hypertask.ai/search', description: 'Search your accessible tasks and boards.' },
  { key: 'core-reports', name: 'Reports', url: 'https://app.hypertask.ai/report', description: 'View and manage your reports.' },
]

export async function getFeatureCatalog(userId: number) {
  const availability = await featureFlagsForUser(userId)
  const features = FEATURE_FLAG_DEFINITIONS.flatMap(({ key, kind, description, shippedOn }) => {
    if (kind !== 'feature' || !availability[key]) return []
    const destination = Object.hasOwn(FEATURE_DESTINATIONS, key) ? FEATURE_DESTINATIONS[key] : undefined
    return [{ key, description, shippedOn, available: true as const, ...destination }]
  })
  return [
    ...features,
    ...CORE_DESTINATIONS
      .filter(({ key }) => key !== 'core-decisions' || availability['htpr-7092-decisions'])
      .map((destination) => ({ ...destination, available: true as const })),
  ]
}

export async function getFeaturePageWarnings(title: string, userId: number) {
  const normalizedTitle = title.trim().replace(/\s+/g, ' ').toLowerCase()
  const destinations = [
    { name: 'Inbox', url: 'https://app.hypertask.ai/inbox', titles: /\binbox\b/ },
    { name: 'My Tasks', url: 'https://app.hypertask.ai/my-tasks', titles: /\bmy tasks\b/ },
    { name: 'Search', url: 'https://app.hypertask.ai/search', titles: /^search$|\bsearch page\b/ },
    { name: 'Reports', url: 'https://app.hypertask.ai/report', titles: /\b(?:reports|dashboard)\b/ },
  ]
  let destination: { name: string; url: string } | undefined
  if (/\bdecisions?\b/.test(normalizedTitle)) {
    destination = (await getFeatureCatalog(userId)).find(({ name }) => name === 'Decisions')
  }
  destination ??= destinations.find(({ titles }) => titles.test(normalizedTitle))
  return destination ? [{
    code: 'existing_feature',
    message: `Page created. ${destination.name} already exists at ${destination.url}; use the existing feature rather than recreating it on a page. ${DECISIONS_GUIDANCE}`,
    url: destination.url,
  }] : []
}
