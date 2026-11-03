import { HTPR_8349_STANDALONE_HTML_PAGE_FLAG } from '@/lib/flags/definitions/htpr-8349-standalone-html-page'
import { isFeatureEnabled } from '@/lib/flags'
import type { PageContentType } from './pageService'

const SELF_CONTAINED_DOCUMENT = /<!doctype[\s>]|<(?:style|html|head|body)[\s>]/i
const INLINE_DATA_IMAGE = /<img\b[^>]*\ssrc\s*=\s*["']?data:/i

export function isSelfContainedDocument(content: string) {
  return SELF_CONTAINED_DOCUMENT.test(content) || INLINE_DATA_IMAGE.test(content)
}

export async function storedPageContentType({
  content,
  contentType,
  userId,
}: {
  content: string
  contentType: PageContentType
  userId: number
}): Promise<PageContentType> {
  if (contentType !== 'html' || !isSelfContainedDocument(content)) return contentType
  return await isFeatureEnabled(HTPR_8349_STANDALONE_HTML_PAGE_FLAG, userId)
    ? 'html_canvas'
    : contentType
}
