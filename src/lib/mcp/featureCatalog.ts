import { featureFlagsForUser, isFeatureEnabled } from '@/lib/flags'
import { HTPR_7322_AGENT_FEATURE_DISCOVERY_FLAG } from '@/lib/flags/definitions/htpr-7322-agent-feature-discovery'
import { DECISIONS_GUIDANCE } from '@/lib/mcp/decisionsGuidance'
import { FEATURE_FLAG_DEFINITIONS } from '@/lib/flags/definitions'

const FEATURE_DESTINATIONS: Record<string, { name: string; url: string }> = {
  'htpr-7092-decisions': { name: 'Decisions', url: 'https://app.hypertask.ai/inbox?split=Decisions' },
  'htpr-6422-my-tasks-views': { name: 'My Tasks views', url: 'https://app.hypertask.ai/my-tasks' },
  'htpr-6457-my-tasks-scopes': { name: 'My Tasks scope', url: 'https://app.hypertask.ai/my-tasks' },
  'htpr-6461-my-tasks-snooze': { name: 'My Tasks snooze', url: 'https://app.hypertask.ai/my-tasks' },
  'htpr-6688-search-autocomplete': { name: 'Search suggestions', url: 'https://app.hypertask.ai/search' },
}

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
    return [{ key, name: destination?.name ?? key.replace(/^htpr-\d+-/, '').replace(/-/g, ' '), description, shippedOn, available: true as const, ...destination }]
  })
  return [
    ...features,
    ...CORE_DESTINATIONS
      .filter(({ key }) => key !== 'core-decisions' || (availability['htpr-7092-decisions'] && !features.some(({ key }) => key === 'htpr-7092-decisions')))
      .map((destination) => ({ ...destination, available: true as const })),
  ]
}

export async function getFeaturePageWarnings(title: string, userId: number) {
  if (!(await isFeatureEnabled(HTPR_7322_AGENT_FEATURE_DISCOVERY_FLAG, userId))) return []
  const normalizedTitle = title.trim().replace(/\s+/g, ' ').toLowerCase()
  const destinations = [
    { name: 'Inbox', url: 'https://app.hypertask.ai/inbox', titles: /\binbox\b/ },
    { name: 'My Tasks', url: 'https://app.hypertask.ai/my-tasks', titles: /^(?:my tasks|(?:.* )?my tasks page)$/ },
    { name: 'Search', url: 'https://app.hypertask.ai/search', titles: /^(?:search|(?:.* )?search page)$/ },
    { name: 'Reports', url: 'https://app.hypertask.ai/report', titles: /^(?:(?:reports|dashboard)(?: page| for .+)?|\S+ (?:reports|dashboard))$/ },
  ]
  let destination: { name: string; url: string } | undefined
  if (/\bdecisions?\b/.test(normalizedTitle)) {
    const decisions = (await getFeatureCatalog(userId)).find(({ name }) => name === 'Decisions')
    if (decisions?.url) destination = { name: decisions.name, url: decisions.url }
  }
  destination ??= destinations.find(({ titles }) => titles.test(normalizedTitle))
  return destination ? [{
    code: 'existing_feature',
    message: `Page created. ${destination.name} already exists at ${destination.url}; use the existing feature rather than recreating it on a page.${destination.name === 'Decisions' ? ` ${DECISIONS_GUIDANCE}` : ''}`,
    url: destination.url,
  }] : []
}
