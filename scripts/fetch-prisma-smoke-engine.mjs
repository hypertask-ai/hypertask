import { createHash } from 'node:crypto'
import { chmod, readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { gunzip } from 'node:zlib'

const enginesPackage = JSON.parse(
  await readFile('node_modules/@prisma/engines-version/package.json', 'utf8'),
)
const commit = enginesPackage?.prisma?.enginesVersion
if (!/^[0-9a-f]{40}$/.test(commit)) {
  throw new Error('Invalid Prisma engine commit')
}

const baseUrl = `https://binaries.prisma.sh/all_commits/${commit}/debian-openssl-3.0.x/schema-engine.gz`
const [archiveResponse, checksumResponse] = await Promise.all([
  fetch(baseUrl, { signal: AbortSignal.timeout(60_000) }),
  fetch(`${baseUrl}.sha256`, { signal: AbortSignal.timeout(60_000) }),
])
if (!archiveResponse.ok || !checksumResponse.ok) {
  throw new Error(
    `Prisma engine download failed: archive ${archiveResponse.status}, checksum ${checksumResponse.status}`,
  )
}

const archive = Buffer.from(await archiveResponse.arrayBuffer())
const expectedChecksum = (await checksumResponse.text()).trim().split(/\s+/)[0]
const actualChecksum = createHash('sha256').update(archive).digest('hex')
if (!/^[0-9a-f]{64}$/.test(expectedChecksum) || actualChecksum !== expectedChecksum) {
  throw new Error('Prisma engine checksum did not match')
}

const enginePath = 'node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x'
await writeFile(enginePath, await promisify(gunzip)(archive), { mode: 0o755 })
await chmod(enginePath, 0o755)
