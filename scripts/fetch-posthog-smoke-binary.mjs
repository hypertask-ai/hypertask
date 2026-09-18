// Fetch the @posthog/cli vendor binary for the isolated app smoke.
//
// @posthog/cli's postinstall downloads its binary from github.com, which the
// isolated smoke network blocks, and candidate-controlled install scripts must
// never run with egress. This trusted script (like fetch-prisma-smoke-engine.mjs)
// performs the download instead, constrained to the official PostHog release
// host, so `npm rebuild` finds the binary already installed and skips it.
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, chmod, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'

const cliPackagePath = 'node_modules/@posthog/cli/package.json'
const installDirectory = 'node_modules/@posthog/cli/node_modules/.bin_real'

const cliPackage = JSON.parse(await readFile(cliPackagePath, 'utf8'))
const baseUrl = cliPackage?.artifactDownloadUrls?.[0]
// package.json is candidate-controlled: parse the URL and pin it to the
// official PostHog release path on github.com after normalization.
const isOfficialPosthogReleaseBase = (value) => {
  if (typeof value !== 'string' || value.includes('\\') || value.includes('..')) return false
  try {
    const url = new URL(value)
    return (
      url.origin === 'https://github.com' &&
      url.pathname.startsWith('/PostHog/posthog/releases/download/')
    )
  } catch {
    return false
  }
}
if (!isOfficialPosthogReleaseBase(baseUrl)) {
  throw new Error(`Unexpected @posthog/cli artifact base URL: ${baseUrl}`)
}

const platform = cliPackage?.supportedPlatforms?.['x86_64-unknown-linux-gnu']
// ponytail: runners are x86_64 glibc; extend when the smoke needs arm runners.
if (!platform?.artifactName || !platform?.bins) {
  throw new Error('x86_64-unknown-linux-gnu platform missing from @posthog/cli package')
}

// package.json fields are candidate-controlled; only accept plain filenames so
// they can never traverse out of the scratch dir or the install directory.
const isPlainFilename = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) && !value.includes('..')
if (!isPlainFilename(platform.artifactName)) {
  throw new Error(`Unsafe artifact name in @posthog/cli package: ${platform.artifactName}`)
}
const binRelPaths = Object.values(platform.bins)
if (binRelPaths.length === 0 || !binRelPaths.every(isPlainFilename)) {
  throw new Error('Unsafe or missing binary names in @posthog/cli package')
}

const missingBins = binRelPaths.filter(
  (binRelPath) => !existsSync(join(installDirectory, binRelPath)),
)
if (missingBins.length === 0) {
  console.log('posthog CLI binary already installed, skipping download.')
  process.exit(0)
}

const artifactUrl = `${baseUrl}/${platform.artifactName}`
const archiveResponse = await fetch(artifactUrl, { signal: AbortSignal.timeout(120_000) })
if (!archiveResponse.ok) {
  throw new Error(`PostHog CLI download failed: ${archiveResponse.status} for ${artifactUrl}`)
}

const scratch = await mkdtemp(join(tmpdir(), `posthog-smoke-${randomUUID().slice(0, 8)}-`))
const archivePath = join(scratch, platform.artifactName)
try {
  await writeFile(archivePath, Buffer.from(await archiveResponse.arrayBuffer()))
  await mkdir(installDirectory, { recursive: true })
  const tar = spawnSync('tar', [
    'xzf',
    archivePath,
    '--strip-components',
    '1',
    '--no-same-owner',
    '-C',
    installDirectory,
  ])
  if (tar.status !== 0) {
    throw new Error(`Untarring the PostHog CLI artifact failed: ${tar.stderr}`)
  }
  for (const binRelPath of binRelPaths) {
    await chmod(join(installDirectory, binRelPath), 0o755)
  }
  console.log(`Installed posthog CLI binary from ${artifactUrl}`)
} finally {
  await rm(scratch, { recursive: true, force: true })
}
