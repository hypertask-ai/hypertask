import {
  FEATURE_FLAG_OWNER_USER_ID,
  HTPR_4638_AI_DIRECTORY_METADATA_FLAG,
  isFeatureEnabled,
} from '@/lib/flags'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const enabled = await isFeatureEnabled(
    HTPR_4638_AI_DIRECTORY_METADATA_FLAG,
    FEATURE_FLAG_OWNER_USER_ID
  ).catch(() => false)
  const token = process.env.OPENAI_APPS_CHALLENGE_TOKEN
  if (!enabled || !token) return new Response('Not found', { status: 404 })

  return new Response(token, {
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  })
}
