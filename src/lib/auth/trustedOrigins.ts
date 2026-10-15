const HYPERTASK_ORIGINS = [
  'https://app.hypertask.ai',
  'https://staging.hypertask.ai',
  'https://demo.hypertask.ai',
]

type VercelDeploymentEnv = Readonly<Record<string, string | undefined>>

export function betterAuthTrustedOrigins(env: VercelDeploymentEnv = process.env): string[] {
  const ownDeploymentOrigins = [env.VERCEL_URL, env.VERCEL_BRANCH_URL]
    .filter((host): host is string => Boolean(host))
    .map((host) => `https://${host}`)
  return env.VERCEL_ENV === 'preview' && env.VERCEL_URL
    ? ['https://demo.hypertask.ai', ...ownDeploymentOrigins]
    : [...HYPERTASK_ORIGINS, ...ownDeploymentOrigins]
}
