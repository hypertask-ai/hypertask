import { normalizeMime } from '@/lib/mcp/attachments/constants'
import { bufferMatchesDeclaredMime } from '@/lib/mcp/attachments/magicBytes'
import { decodeBase64Data } from '@/lib/mcp/attachments/validateBody'
import { isBrowserRenderableImage } from '@/lib/media/browserRenderableImage'
import { getUploadSizeError } from '@/lib/storage/uploadLimits'
import { uploadTaskAttachmentToS3 } from '@/lib/storage/uploadTaskAttachmentToS3'

const PICTURE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

export type AgentPicture = { contentType: string; buffer: Buffer }

function rejectPicture(field: string, message: string) {
  return { ok: false as const, field, message }
}

export function parseAgentPicture(picture: unknown) {
  if (!picture || typeof picture !== 'object' || Array.isArray(picture)) {
    return rejectPicture('picture', 'picture must be an object with content_type and data')
  }
  const record = picture as { content_type?: unknown; data?: unknown }
  if (typeof record.content_type !== 'string') {
    return rejectPicture('picture.content_type', 'picture.content_type must be an image type')
  }
  const contentType = normalizeMime(record.content_type)
  if (!PICTURE_EXTENSIONS[contentType] || !isBrowserRenderableImage(contentType)) {
    return rejectPicture('picture.content_type', 'picture must be a PNG, JPEG, GIF, or WebP image')
  }
  if (typeof record.data !== 'string') return rejectPicture('picture.data', 'picture.data must be base64')
  let buffer: Buffer
  try {
    buffer = decodeBase64Data(record.data, 0)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'picture.data must be raw base64'
    return rejectPicture(message.includes('exceeds inline') ? 'picture' : 'picture.data', message)
  }
  const sizeError = getUploadSizeError([{ name: 'picture', size: buffer.length }])
  if (sizeError) return rejectPicture('picture', sizeError)
  if (!bufferMatchesDeclaredMime(buffer, contentType)) {
    return rejectPicture('picture.content_type', 'picture bytes do not match content_type')
  }
  return { ok: true as const, picture: { contentType, buffer } }
}

export function storeAgentPicture(picture: AgentPicture) {
  return uploadTaskAttachmentToS3(
    picture.buffer,
    `agent-picture.${PICTURE_EXTENSIONS[picture.contentType]}`,
    picture.contentType
  )
}
